import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoExportUtc } from "@brad/domain";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("import with preview, time-zone confirmation and undo", () => {
  const store = new Store(":memory:");
  const server = createApiServer(store);
  let base = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON responses
  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  const exported = demoExportUtc([
    {
      id: "agent-finances",
      domain: "finances",
      state: "active",
      goal: "No debt",
      reason: "importance_and_gap",
      requestedCapabilities: ["read_messages"],
      excludedByBoundary: ["make_payment"],
      escalation: "ask_owner",
    },
  ]);

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  it("previews without changing anything", async () => {
    const before = (await call("GET", "/api/lifemap")).json.lifeMap;
    const { status, json } = await call("POST", "/api/import/preview", exported);
    expect(status).toBe(200);
    expect(json.plan.warnings.map((w: { code: string }) => w.code)).toEqual([
      "timezone_utc",
      "active_agents_paused",
      "replaces_local_data",
    ]);
    expect(json.alreadyImported).toBe(false);
    expect((await call("GET", "/api/lifemap")).json.lifeMap).toEqual(before);
  });

  it("refuses a UTC export until the owner picks a time zone", async () => {
    expect(await call("POST", "/api/import", { export: exported })).toMatchObject({ status: 409, json: { error: "needs_timezone" } });
    expect(await call("POST", "/api/import", { export: exported, timeZone: "Mars/Olympus" })).toMatchObject({
      status: 400,
      json: { error: "invalid_time_zone" },
    });
  });

  it("applies with the chosen zone, keeps quiet hours as local times, dates assessments and pauses active agents", async () => {
    const { status, json } = await call("POST", "/api/import", { export: exported, timeZone: "America/Sao_Paulo" });
    expect(status).toBe(200);
    expect(json.lifeMap.boundaries).toMatchObject({ timeZone: "America/Sao_Paulo", quietHours: { start: "19:00", end: "10:00" } });
    expect(json.lifeMap.assessments[0]).toMatchObject({ asOf: exported.exportedAt, source: "self_reported" });
    expect(json.agents).toEqual([expect.objectContaining({ id: "agent-finances", state: "paused" })]);
    expect(json.grants).toEqual([]);
    expect(json.snapshotId).toBeGreaterThan(0);
  });

  it("never applies the same export twice by accident", async () => {
    expect(await call("POST", "/api/import", { export: exported, timeZone: "America/Sao_Paulo" })).toMatchObject({
      status: 409,
      json: { error: "already_imported" },
    });
    expect((await call("POST", "/api/import/preview", exported)).json.alreadyImported).toBe(true);
    const forced = await call("POST", "/api/import", { export: exported, timeZone: "America/Sao_Paulo", force: true });
    expect(forced.status).toBe(200);
    expect(forced.json.agents).toHaveLength(1);
  });

  it("undoes an import by restoring the previous version, and the restore itself can be undone", async () => {
    const snapshots = (await call("GET", "/api/snapshots")).json.snapshots as { id: number; reason: string }[];
    const firstImport = snapshots.at(-1)!;
    expect(firstImport.reason).toBe("before_import");

    const restored = await call("POST", "/api/snapshots/restore", { snapshotId: firstImport.id });
    expect(restored.status).toBe(200);
    expect(restored.json.lifeMap.owner.displayName).toBe("Alex (demo)");
    expect(restored.json.lifeMap.boundaries.timeZone).toBe("America/Sao_Paulo");
    expect((restored.json.agents as { state: string }[]).every((a) => a.state !== "active")).toBe(true);
    expect((restored.json.agents as unknown[]).length).toBe(6);

    const undo = await call("POST", "/api/snapshots/restore", { snapshotId: restored.json.snapshotId });
    expect((undo.json.agents as { id: string }[]).map((a) => a.id)).toEqual(["agent-finances"]);
    expect(await call("POST", "/api/snapshots/restore", { snapshotId: 999 })).toMatchObject({ status: 404 });
  });
});
