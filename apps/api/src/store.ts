import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentDefinition, ConsentGrant, DecisionRecord, LifeMap } from "@brad/domain";

const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE life_map (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE grants (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      input TEXT NOT NULL,
      result TEXT NOT NULL
    );
  `,
};

/** Local SQLite store. The file never leaves the machine; nothing is sent to a network service. */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    const current = Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    for (let version = current + 1; version <= SCHEMA_VERSION; version++) {
      this.db.exec("BEGIN");
      this.db.exec(MIGRATIONS[version]!);
      this.db.exec(`PRAGMA user_version = ${version}`);
      this.db.exec("COMMIT");
    }
  }

  getLifeMap(): LifeMap | null {
    const row = this.db.prepare("SELECT body FROM life_map WHERE id = 1").get() as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as LifeMap) : null;
  }

  saveLifeMap(map: LifeMap): void {
    this.db
      .prepare(
        "INSERT INTO life_map (id, body, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
      )
      .run(JSON.stringify(map), new Date().toISOString());
  }

  getAgents(): AgentDefinition[] {
    const rows = this.db.prepare("SELECT body FROM agents ORDER BY position").all() as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as AgentDefinition);
  }

  replaceAgents(agents: AgentDefinition[]): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM agents");
      const insert = this.db.prepare("INSERT INTO agents (id, position, body) VALUES (?, ?, ?)");
      agents.forEach((a, i) => insert.run(a.id, i, JSON.stringify(a)));
    });
  }

  saveAgent(agent: AgentDefinition): void {
    this.db.prepare("UPDATE agents SET body = ? WHERE id = ?").run(JSON.stringify(agent), agent.id);
  }

  getGrants(): ConsentGrant[] {
    const rows = this.db.prepare("SELECT body FROM grants ORDER BY id").all() as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as ConsentGrant);
  }

  replaceGrants(grants: ConsentGrant[]): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM grants");
      const insert = this.db.prepare("INSERT INTO grants (id, agent_id, body) VALUES (?, ?, ?)");
      for (const g of grants) insert.run(g.id, g.agentId, JSON.stringify(g));
    });
  }

  saveGrant(grant: ConsentGrant): void {
    this.db
      .prepare(
        "INSERT INTO grants (id, agent_id, body) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
      )
      .run(grant.id, grant.agentId, JSON.stringify(grant));
  }

  /** True when the owner has run at least one policy simulation for this agent. */
  hasPolicySimulation(agentId: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 AS hit FROM decisions WHERE kind = 'policy' AND json_extract(input, '$.request.agentId') = ? LIMIT 1",
      )
      .get(agentId);
    return row !== undefined;
  }

  /** Replaces the life map, agents and grants in one transaction; decision history is kept. */
  replaceAll(map: LifeMap, agents: AgentDefinition[], grants: ConsentGrant[]): void {
    this.transaction(() => {
      this.saveLifeMap(map);
      this.db.exec("DELETE FROM agents");
      const insertAgent = this.db.prepare("INSERT INTO agents (id, position, body) VALUES (?, ?, ?)");
      agents.forEach((a, i) => insertAgent.run(a.id, i, JSON.stringify(a)));
      this.db.exec("DELETE FROM grants");
      const insertGrant = this.db.prepare("INSERT INTO grants (id, agent_id, body) VALUES (?, ?, ?)");
      for (const g of grants) insertGrant.run(g.id, g.agentId, JSON.stringify(g));
    });
  }

  addDecision(kind: DecisionRecord["kind"], input: unknown, result: unknown): DecisionRecord {
    const createdAt = new Date().toISOString();
    const info = this.db
      .prepare("INSERT INTO decisions (kind, created_at, input, result) VALUES (?, ?, ?, ?)")
      .run(kind, createdAt, JSON.stringify(input), JSON.stringify(result));
    return { id: Number(info.lastInsertRowid), kind, createdAt, input, result };
  }

  listDecisions(limit = 50): DecisionRecord[] {
    const rows = this.db
      .prepare("SELECT id, kind, created_at, input, result FROM decisions ORDER BY id DESC LIMIT ?")
      .all(limit) as { id: number; kind: DecisionRecord["kind"]; created_at: string; input: string; result: string }[];
    return rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      createdAt: r.created_at,
      input: JSON.parse(r.input),
      result: JSON.parse(r.result),
    }));
  }

  /** Deletes every record. Used by "reset" in Studio. */
  reset(): void {
    this.transaction(() => {
      for (const table of ["life_map", "agents", "grants", "decisions"]) this.db.exec(`DELETE FROM ${table}`);
    });
  }

  close(): void {
    this.db.close();
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
