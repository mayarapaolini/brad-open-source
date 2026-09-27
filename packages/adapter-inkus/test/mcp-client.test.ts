import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { parseInkusCatalog, toAnswer } from "@brad/discovery";
import { demoLifeMap } from "@brad/domain";
import { DEMO_ANSWERS_DB, DEMO_QUESTIONS_DB, FakeInkus, activateDraft, connectInkus, loadCatalogRecords, seedDemoInkus, syncAnswers, syncWithInkus } from "../src";

/** A local MCP server exposing the same tool names and argument shapes as Inkus, backed by the fake. */
function inkusLikeServer(fake: FakeInkus, token: string): Server {
  const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const build = () => {
    const server = new McpServer({ name: "inkus-test", version: "0.0.0" });
    server.registerTool("list_actors", { inputSchema: {} }, async () => json(await fake.listActors()));
    server.registerTool("get_active_agent_specification", { inputSchema: { actor_id: z.string() } }, async ({ actor_id }) =>
      json(await fake.getActiveSpec(actor_id)),
    );
    server.registerTool(
      "create_actor",
      { inputSchema: { name: z.string(), description: z.string().optional(), type: z.enum(["human", "ai", "automation", "integration", "system"]) } },
      async ({ name, description }) => json(await fake.createActor({ name, description: description ?? "" })),
    );
    server.registerTool(
      "create_agent_specification",
      {
        inputSchema: {
          actor_id: z.string(),
          mission: z.string().optional(),
          scope: z.string().optional(),
          responsibilities: z.array(z.string()).optional(),
          prompt: z.string().optional(),
          allowed_tools: z.array(z.string()).optional(),
          capabilities: z.record(z.string(), z.unknown()).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
          knowledge_domains: z.array(z.string()).optional(),
        },
      },
      async ({ actor_id, ...fields }) => json(await fake.createSpec(actor_id, fields)),
    );
    server.registerTool(
      "set_agent_specification_status",
      { inputSchema: { agent_specification_id: z.string(), status: z.enum(["draft", "active", "deprecated"]) } },
      async ({ agent_specification_id }) => {
        await fake.activateSpec(agent_specification_id);
        return json({ ok: true });
      },
    );
    server.registerTool("list_database_records", { inputSchema: { database_id: z.string() } }, async ({ database_id }) =>
      json(await fake.listRecords(database_id)),
    );
    server.registerTool(
      "create_database_record",
      { inputSchema: { database_id: z.string(), fields: z.record(z.string(), z.unknown()).optional(), idempotency_key: z.string().optional() } },
      async ({ database_id, fields, idempotency_key }) => json(await fake.createRecord(database_id, fields ?? {}, idempotency_key)),
    );
    server.registerTool(
      "update_database_record",
      { inputSchema: { record_id: z.string(), fields: z.record(z.string(), z.unknown()) } },
      async ({ record_id, fields }) => {
        await fake.updateRecord(record_id, fields);
        return json({ ok: true });
      },
    );
    return server;
  };

  return createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    const server = build();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
}

describe("MCP Inkus client", () => {
  const fake = new FakeInkus();
  const http = inkusLikeServer(fake, "test-token");
  let url = "";

  beforeAll(async () => {
    await seedDemoInkus(fake);
    await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => {
    http.close();
  });

  it("rejects a wrong token", async () => {
    await expect(connectInkus({ url, token: "wrong" })).rejects.toThrow();
  });

  it("runs a full sync over MCP", async () => {
    const client = await connectInkus({ url, token: "test-token" });
    try {
      const first = await syncWithInkus({
        agents: [],
        grants: [],
        forbidden: [],
        client,
        now: "2026-03-10T08:30:00-03:00",
        displayName: (a) => a.name ?? a.id,
      });
      expect(first.report.imported).toHaveLength(4); // the deprecated legacy agent is skipped
      expect(first.report.errors).toEqual([]);

      const orchestrator = first.agents.find((a) => a.name === "Demo Life Orchestrator")!;
      const edited = { ...orchestrator, goal: "Edited over MCP", actionDomains: ["work" as const], revision: 1 };
      const second = await syncWithInkus({
        agents: [...first.agents.filter((a) => a.id !== orchestrator.id), edited],
        grants: [],
        forbidden: [],
        client,
        now: "2026-03-10T09:00:00-03:00",
        displayName: (a) => a.name ?? a.id,
      });
      expect(second.report).toMatchObject({ pushed: [orchestrator.id], errors: [] });
      // Brad writes a draft; activating it is a separate, explicit call.
      expect(await fake.getActiveSpec(orchestrator.inkus!.actorId)).toMatchObject({ status: "active", version: 1 });
      await activateDraft(client, second.agents.find((a) => a.id === orchestrator.id)!, "2026-03-10T09:05:00-03:00");
      const spec = await fake.getActiveSpec(orchestrator.inkus!.actorId);
      expect(spec).toMatchObject({ status: "active", version: 2, mission: "Edited over MCP" });
      // Inkus-only fields survived the round trip.
      expect(spec?.prompt).toContain("Never act without authorisation");
      expect((spec?.capabilities as Record<string, unknown>).default_access).toBe("deny");
    } finally {
      await client.close();
    }
  });

  it("reads the question catalog and syncs answers over MCP", async () => {
    const client = await connectInkus({ url, token: "test-token" });
    try {
      const { catalog, errors } = parseInkusCatalog(await loadCatalogRecords(client, DEMO_QUESTIONS_DB));
      expect(errors).toEqual([]);
      const answer = toAnswer({ questionId: "help.preference", domain: "health", selectedOptionIds: ["opt_4"] }, "mcp-1", "2026-09-27T10:00:00Z", catalog);
      const { report } = await syncAnswers({ client, databaseId: DEMO_ANSWERS_DB, catalog, answers: [answer], lifeMap: demoLifeMap });
      expect(report).toMatchObject({ imported: 1, pushed: 1 });
      expect(fake.databases[DEMO_ANSWERS_DB]!.at(-1)!.fields).toMatchObject({ question_id: "help.preference", selected_option_ids_json: '["opt_4"]' });
    } finally {
      await client.close();
    }
  });
});
