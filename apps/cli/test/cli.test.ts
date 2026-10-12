import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "@brad/api/store";
import { demoExportUtc, demoLifeMap } from "@brad/domain";
import { generateDraftAgents } from "@brad/agent-factory";
import { EXIT, run } from "../src/commands";

let dir = "";
let out: string[] = [];
let err: string[] = [];
const io = (env: NodeJS.ProcessEnv = {}) => ({
  out: (l: string) => out.push(l),
  err: (l: string) => err.push(l),
  env: { BRAD_DATA_DIR: join(dir, "data"), ...env },
  cwd: dir,
});
const brad = (args: string, env?: NodeJS.ProcessEnv) => run(args.split(" ").filter(Boolean), io(env));

function seed(): void {
  const store = new Store(join(dir, "data", "brad.db"));
  const agents = generateDraftAgents(demoLifeMap).map((a, i) => (i === 0 ? { ...a, state: "active" as const } : a));
  store.replaceAll(demoLifeMap, agents, []);
  store.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "brad-cli-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("brad CLI", () => {
  it("prints help, and fails on unknown commands", async () => {
    expect(await brad("help")).toBe(EXIT.ok);
    expect(out.join("\n")).toContain("inkus check");
    expect(await brad("fly")).toBe(EXIT.problem);
  });

  it("validates exports and bare life maps, exiting 1 on problems", async () => {
    writeFileSync(join(dir, "map.json"), JSON.stringify(demoLifeMap));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...demoLifeMap, assessments: [{ domain: "mars" }] }));
    writeFileSync(join(dir, "broken.json"), "{");
    expect(await brad("validate map.json")).toBe(EXIT.ok);
    expect(out.at(-1)).toContain("valid life map");
    expect(await brad("validate bad.json")).toBe(EXIT.problem);
    expect(err.join("\n")).toContain("problem(s)");
    expect(await brad("validate broken.json")).toBe(EXIT.problem);
    expect(await brad("validate")).toBe(EXIT.problem);
  });

  it("round-trips: export, validate, then import into an empty store only with --yes", async () => {
    seed();
    expect(await brad("export --out export.json")).toBe(EXIT.ok);
    expect(await brad("validate export.json")).toBe(EXIT.ok);
    expect(out.at(-1)).toContain("valid export");

    const other = { BRAD_DATA_DIR: join(dir, "other") };
    expect(await brad("import export.json", other)).toBe(EXIT.confirm);
    expect(err.at(-1)).toContain("Nothing changed");
    const empty = new Store(join(dir, "other", "brad.db"));
    expect(empty.getLifeMap()).toBeNull();
    empty.close();

    expect(await brad("import export.json --yes", other)).toBe(EXIT.ok);
    const imported = new Store(join(dir, "other", "brad.db"));
    expect(imported.getLifeMap()?.owner.displayName).toBe(demoLifeMap.owner.displayName);
    // An imported agent never keeps acting on its own.
    expect(imported.getAgents().filter((a) => a.state === "active")).toEqual([]);
    expect(imported.getAgents().filter((a) => a.state === "paused")).toHaveLength(1);
    imported.close();

    expect(await brad("import export.json --yes", other)).toBe(EXIT.problem);
    expect(err.at(-1)).toContain("already imported");
    expect(await brad("import export.json --yes --force", other)).toBe(EXIT.ok);
  });

  it("asks for a time zone when the export says UTC", async () => {
    writeFileSync(join(dir, "utc.json"), JSON.stringify(demoExportUtc()));
    expect(await brad("import utc.json --yes")).toBe(EXIT.problem);
    expect(err.at(-1)).toContain("--time-zone");
    expect(await brad("import utc.json --yes --time-zone Europe/Lisbon")).toBe(EXIT.ok);
    const store = new Store(join(dir, "data", "brad.db"));
    expect(store.getLifeMap()?.boundaries.timeZone).toBe("Europe/Lisbon");
    store.close();
  });

  it("export fails clearly without a life map; stdout export is valid JSON", async () => {
    expect(await brad("export")).toBe(EXIT.problem);
    seed();
    out = [];
    expect(await brad("export")).toBe(EXIT.ok);
    expect(JSON.parse(out.join("\n")).format).toBeTruthy();
  });

  it("doctor reports counts only", async () => {
    seed();
    expect(await brad("doctor")).toBe(EXIT.ok);
    const report = out.join("\n");
    expect(report).toContain("Schema version:  4");
    expect(report).toContain("Life map:        present");
    expect(report).toMatch(/Agents:\s+\d+ \(.*active 1/);
    expect(report).toContain("Inkus adapter:   disabled");
    expect(report).not.toContain(demoLifeMap.assessments[0]!.goal);
  });

  it("inkus check is read-only and explains when the adapter is off", async () => {
    expect(await brad("inkus check")).toBe(EXIT.problem);
    expect(err.at(-1)).toContain("BRAD_ADAPTER_INKUS_ENABLED");
    const env = { BRAD_ADAPTER_INKUS_ENABLED: "true", BRAD_INKUS_FAKE: "1" };
    expect(await brad("inkus check", env)).toBe(EXIT.ok);
    const report = out.join("\n");
    expect(report).toContain("Read-only");
    expect(report).toMatch(/Questions:\s+11 active/);
    expect(report).toMatch(/Answers:\s+4 rows/);
    expect(await brad("inkus check", { BRAD_ADAPTER_INKUS_ENABLED: "true", BRAD_INKUS_MCP_URL: "http://127.0.0.1:9/mcp" })).toBe(EXIT.problem);
    expect(err.at(-1)).toContain("BRAD_INKUS_TOKEN");
  });

  it("never writes the export file content to stderr and resolves paths from where it was run", async () => {
    seed();
    expect(await brad("export --out nested.json")).toBe(EXIT.ok);
    expect(JSON.parse(readFileSync(join(dir, "nested.json"), "utf8")).lifeMap.owner.displayName).toBe(demoLifeMap.owner.displayName);
    expect(err.join("\n")).not.toContain(demoLifeMap.assessments[0]!.goal);
  });

  it("explains a rejected token without printing it", async () => {
    // Answers like Inkus does for a revoked token.
    const inkus = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32001, message: "Token de API inválido ou revogado." } }));
    });
    await new Promise<void>((done) => inkus.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(inkus.address() as AddressInfo).port}/mcp`;
    try {
      const code = await brad("inkus check", { BRAD_ADAPTER_INKUS_ENABLED: "true", BRAD_INKUS_MCP_URL: url, BRAD_INKUS_TOKEN: "secret-token-123" });
      expect(code).toBe(EXIT.problem);
      const text = [...out, ...err].join("\n");
      expect(text).toContain("did not accept BRAD_INKUS_TOKEN");
      expect(text).not.toContain("secret-token-123");
    } finally {
      inkus.close();
    }
  });
});

