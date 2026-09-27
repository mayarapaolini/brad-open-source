/** Shapes used by Inkus' MCP tools (only the fields Brad reads or writes). */
export interface InkusActor {
  id: string;
  name: string;
  type: "human" | "ai" | "automation" | "integration" | "system";
  description?: string | null;
}

export interface InkusSpecFields {
  mission?: string | null;
  scope?: string | null;
  responsibilities?: string[] | null;
  prompt?: string | null;
  allowed_tools?: string[] | null;
  capabilities?: Record<string, unknown> | null;
  knowledge_domains?: string[] | null;
  model?: string | null;
  temperature?: number | null;
}

export interface InkusSpec extends InkusSpecFields {
  id: string;
  actor_id: string;
  version: number;
  status: "draft" | "active" | "deprecated";
}

/** A row of an Inkus structured database, keyed by field name. */
export interface InkusDatabaseRecord {
  id: string;
  fields: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

/** The operations Brad needs from Inkus. The MCP client and the test fake both implement it. */
export interface InkusClient {
  listActors(): Promise<InkusActor[]>;
  /** The active spec, or the latest draft when none is active; null when the actor has no spec. */
  getActiveSpec(actorId: string): Promise<InkusSpec | null>;
  createActor(input: { name: string; description: string }): Promise<InkusActor>;
  /** Creates a new draft version; Inkus never overwrites an existing one. */
  createSpec(actorId: string, fields: InkusSpecFields): Promise<InkusSpec>;
  activateSpec(specId: string): Promise<void>;
  listRecords(databaseId: string): Promise<InkusDatabaseRecord[]>;
  /** The idempotency key makes a retried push create the row once. */
  createRecord(databaseId: string, fields: Record<string, unknown>, idempotencyKey?: string): Promise<InkusDatabaseRecord>;
  updateRecord(recordId: string, fields: Record<string, unknown>): Promise<void>;
}
