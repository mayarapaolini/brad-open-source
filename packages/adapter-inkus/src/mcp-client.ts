import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { InkusActor, InkusClient, InkusDatabaseRecord, InkusSpec, InkusSpecFields } from "./types";

export interface McpInkusOptions {
  url: string;
  /** Bearer token for Inkus. Read from the environment or the OS keychain; never stored in the repo. */
  token: string;
}

/** Fields `create_agent_specification` accepts; anything else in a passthrough is dropped. */
const SPEC_INPUT_FIELDS = [
  "mission",
  "scope",
  "responsibilities",
  "prompt",
  "allowed_tools",
  "capabilities",
  "model",
  "temperature",
  "knowledge_domains",
  "owner_actor_id",
  "default_project_id",
] as const;

function specInput(fields: InkusSpecFields): Record<string, unknown> {
  const source = fields as Record<string, unknown>;
  return Object.fromEntries(
    SPEC_INPUT_FIELDS.filter((k) => source[k] !== undefined && source[k] !== null).map((k) => [k, source[k]]),
  );
}

/** Inkus client over MCP (streamable HTTP). One connection per sync; closed by `close()`. */
export async function connectInkus(options: McpInkusOptions): Promise<InkusClient & { close(): Promise<void> }> {
  const client = new Client({ name: "brad", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
  });
  try {
    await client.connect(transport);
  } catch (error) {
    // Release the connection before reporting, so a failed login never leaves a handle open.
    await client.close().catch(() => undefined);
    throw error;
  }

  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as { type: string; text?: string }[];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    if (result.isError) throw new Error(`Inkus ${name} failed: ${text.slice(0, 200)}`);
    if (text.trim() === "") return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Inkus ${name} returned non-JSON content`);
    }
  }

  return {
    listActors: () => call<InkusActor[]>("list_actors", {}),
    getActiveSpec: (actorId) => call<InkusSpec | null>("get_active_agent_specification", { actor_id: actorId }),
    createActor: ({ name, description }) => call<InkusActor>("create_actor", { name, description, type: "ai" }),
    createSpec: (actorId, fields) =>
      call<InkusSpec>("create_agent_specification", { actor_id: actorId, ...specInput(fields) }),
    activateSpec: async (specId) => {
      await call("set_agent_specification_status", { agent_specification_id: specId, status: "active" });
    },
    listRecords: async (databaseId) => (await call<InkusDatabaseRecord[] | null>("list_database_records", { database_id: databaseId })) ?? [],
    createRecord: (databaseId, fields, idempotencyKey) =>
      call<InkusDatabaseRecord>("create_database_record", {
        database_id: databaseId,
        fields,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      }),
    updateRecord: async (recordId, fields) => {
      await call("update_database_record", { record_id: recordId, fields });
    },
    close: () => client.close(),
  };
}
