import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Answer, Verdict } from "@brad/discovery";
import type { ProposalFeedback } from "@brad/secretary";
import { normalizeAgent, type AgentDefinition, type ConsentGrant, type DecisionRecord, type LifeMap } from "@brad/domain";

const SCHEMA_VERSION = 4;

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
  2: `
    CREATE TABLE snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      body TEXT NOT NULL
    );
  `,
  3: `
    CREATE TABLE answers (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      as_of TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE synthesis_feedback (
      item_id TEXT PRIMARY KEY,
      verdict TEXT NOT NULL,
      correction TEXT,
      updated_at TEXT NOT NULL
    );
  `,
  4: `
    CREATE TABLE proposal_feedback (
      proposal_id TEXT PRIMARY KEY,
      body TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      load TEXT NOT NULL
    );
  `,
};

export interface SnapshotBody {
  lifeMap: LifeMap | null;
  agents: AgentDefinition[];
  grants: ConsentGrant[];
  /** Discovery answers (history included). Missing in snapshots taken before answers were versioned. */
  answers?: Answer[];
}

export interface SnapshotInfo {
  id: number;
  createdAt: string;
  reason: string;
  agents: number;
  grants: number;
  answers: number | null;
  people: number;
  goals: number;
}

export type RestoreScope = "all" | "lifeMap" | "answers";

/** Older versions beyond this are pruned, oldest first. */
export const MAX_SNAPSHOTS = 50;

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
    return rows.map((r) => normalizeAgent(JSON.parse(r.body) as AgentDefinition));
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

  getDecision(id: number): DecisionRecord | null {
    const row = this.db
      .prepare("SELECT id, kind, created_at, input, result FROM decisions WHERE id = ?")
      .get(id) as { id: number; kind: DecisionRecord["kind"]; created_at: string; input: string; result: string } | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      kind: row.kind,
      createdAt: row.created_at,
      input: JSON.parse(row.input),
      result: JSON.parse(row.result),
    };
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

  /** Discovery answers, oldest first. Edited answers stay, marked stale. */
  getAnswers(): Answer[] {
    const rows = this.db.prepare("SELECT body FROM answers ORDER BY as_of, id").all() as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as Answer);
  }

  saveAnswer(answer: Answer): void {
    this.db
      .prepare("INSERT INTO answers (id, domain, as_of, body) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body")
      .run(answer.id, answer.domain, answer.asOf, JSON.stringify(answer));
  }

  /** Replaces every discovery answer (used when restoring a previous version). */
  replaceAnswers(answers: Answer[]): void {
    this.db.exec("DELETE FROM answers");
    for (const answer of answers) this.saveAnswer(answer);
  }

  getFeedback(): Record<string, { verdict: Verdict; correction: string | null }> {
    const rows = this.db.prepare("SELECT item_id, verdict, correction FROM synthesis_feedback").all() as {
      item_id: string;
      verdict: Verdict;
      correction: string | null;
    }[];
    return Object.fromEntries(rows.map((r) => [r.item_id, { verdict: r.verdict, correction: r.correction }]));
  }

  setFeedback(itemId: string, verdict: Verdict, correction: string | null): void {
    this.db
      .prepare(
        "INSERT INTO synthesis_feedback (item_id, verdict, correction, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET verdict = excluded.verdict, correction = excluded.correction, updated_at = excluded.updated_at",
      )
      .run(itemId, verdict, correction, new Date().toISOString());
  }

  getProposalFeedback(): Record<string, ProposalFeedback> {
    const rows = this.db.prepare("SELECT proposal_id, body FROM proposal_feedback").all() as { proposal_id: string; body: string }[];
    return Object.fromEntries(rows.map((r) => [r.proposal_id, JSON.parse(r.body) as ProposalFeedback]));
  }

  setProposalFeedback(proposalId: string, feedback: ProposalFeedback): void {
    this.db
      .prepare("INSERT INTO proposal_feedback (proposal_id, body) VALUES (?, ?) ON CONFLICT(proposal_id) DO UPDATE SET body = excluded.body")
      .run(proposalId, JSON.stringify(feedback));
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  addCheckin(load: string): void {
    this.db.prepare("INSERT INTO checkins (at, load) VALUES (?, ?)").run(new Date().toISOString(), load);
  }

  listCheckins(limit = 8): { at: string; load: string }[] {
    return this.db.prepare("SELECT at, load FROM checkins ORDER BY id DESC LIMIT ?").all(limit) as { at: string; load: string }[];
  }

  /** Saves the current life map, agents, grants and answers so a change can be undone. */
  createSnapshot(reason: string): number {
    const body: SnapshotBody = {
      lifeMap: this.getLifeMap(),
      agents: this.getAgents(),
      grants: this.getGrants(),
      answers: this.getAnswers(),
    };
    let id = 0;
    this.transaction(() => {
      const info = this.db
        .prepare("INSERT INTO snapshots (created_at, reason, body) VALUES (?, ?, ?)")
        .run(new Date().toISOString(), reason, JSON.stringify(body));
      id = Number(info.lastInsertRowid);
      this.db
        .prepare("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)")
        .run(MAX_SNAPSHOTS);
    });
    return id;
  }

  getSnapshot(id: number): SnapshotBody | null {
    const row = this.db.prepare("SELECT body FROM snapshots WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as SnapshotBody) : null;
  }

  listSnapshots(limit = 20): SnapshotInfo[] {
    const rows = this.db
      .prepare("SELECT id, created_at, reason, body FROM snapshots ORDER BY id DESC LIMIT ?")
      .all(limit) as { id: number; created_at: string; reason: string; body: string }[];
    return rows.map((r) => {
      const body = JSON.parse(r.body) as SnapshotBody;
      return {
        id: Number(r.id),
        createdAt: r.created_at,
        reason: r.reason,
        agents: body.agents.length,
        grants: body.grants.length,
        answers: body.answers ? body.answers.filter((a) => a.status !== "stale").length : null,
        people: body.lifeMap?.people.length ?? 0,
        goals: body.lifeMap?.assessments.filter((a) => a.goal.trim() !== "").length ?? 0,
      };
    });
  }

  /**
   * Replaces the current state with a snapshot, or only part of it (`scope`).
   * An empty snapshot clears the life map too.
   */
  restore(body: SnapshotBody, scope: RestoreScope = "all"): void {
    this.transaction(() => {
      if (scope !== "lifeMap" && body.answers) this.replaceAnswers(body.answers);
      if (scope === "answers") return;
      if (body.lifeMap) this.saveLifeMap(body.lifeMap);
      else this.db.exec("DELETE FROM life_map");
      if (scope === "lifeMap") return;
      this.db.exec("DELETE FROM agents");
      const insertAgent = this.db.prepare("INSERT INTO agents (id, position, body) VALUES (?, ?, ?)");
      body.agents.forEach((a, i) => insertAgent.run(a.id, i, JSON.stringify(a)));
      this.db.exec("DELETE FROM grants");
      const insertGrant = this.db.prepare("INSERT INTO grants (id, agent_id, body) VALUES (?, ?, ?)");
      for (const g of body.grants) insertGrant.run(g.id, g.agentId, JSON.stringify(g));
    });
  }

  /** The schema version this database has been migrated to. */
  schemaVersion(): number {
    return Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  }

  countDecisions(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM decisions").get() as { n: number }).n);
  }

  /** Deletes every record. Used by "reset" in Studio. */
  reset(): void {
    this.transaction(() => {
      for (const table of ["life_map", "agents", "grants", "decisions", "snapshots", "answers", "synthesis_feedback", "proposal_feedback", "settings", "checkins"]) this.db.exec(`DELETE FROM ${table}`);
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
