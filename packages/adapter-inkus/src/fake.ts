import { demoInkusCatalogRecords } from "@brad/discovery";
import type {
  InkusActor,
  InkusClient,
  InkusDatabaseRecord,
  InkusLearningEvent,
  InkusRecallLearningsQuery,
  InkusRecordLearningInput,
  InkusSpec,
  InkusSpecFields,
} from "./types";

function normalizeLearningContent(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Database ids of the synthetic workspace (the real ones come from the environment). */
export const DEMO_QUESTIONS_DB = "demo-questions-db";
export const DEMO_ANSWERS_DB = "demo-answers-db";

/** In-memory Inkus for tests and the offline demo. Mirrors versioning: new versions start as drafts. */
export class FakeInkus implements InkusClient {
  actors: InkusActor[] = [];
  specs: InkusSpec[] = [];
  databases: Record<string, InkusDatabaseRecord[]> = {};
  learnings: (InkusLearningEvent & { actorId: string; status: "active" })[] = [];
  /** Mirrors the token→actor binding `set_my_actor` persists in Inkus (per `InkusClient.setMyActor`). */
  private boundActorId: string | null = null;
  private idempotency = new Map<string, InkusDatabaseRecord>();
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, "0")}`;
  }

  async listActors(): Promise<InkusActor[]> {
    return structuredClone(this.actors);
  }

  async getActiveSpec(actorId: string): Promise<InkusSpec | null> {
    const versions = this.specs.filter((s) => s.actor_id === actorId).sort((a, b) => b.version - a.version);
    // Mirrors the real Inkus: with no active or draft version it returns the latest deprecated one.
    const spec =
      versions.find((s) => s.status === "active") ?? versions.find((s) => s.status === "draft") ?? versions[0] ?? null;
    return spec ? structuredClone(spec) : null;
  }

  async createActor(input: { name: string; description: string }): Promise<InkusActor> {
    const actor: InkusActor = { id: this.id("actor"), name: input.name, type: "ai", description: input.description };
    this.actors.push(actor);
    return structuredClone(actor);
  }

  async createSpec(actorId: string, fields: InkusSpecFields): Promise<InkusSpec> {
    if (!this.actors.some((a) => a.id === actorId)) throw new Error(`unknown actor ${actorId}`);
    const version = Math.max(0, ...this.specs.filter((s) => s.actor_id === actorId).map((s) => s.version)) + 1;
    const spec: InkusSpec = { ...structuredClone(fields), id: this.id("spec"), actor_id: actorId, version, status: "draft" };
    this.specs.push(spec);
    return structuredClone(spec);
  }

  async activateSpec(specId: string): Promise<void> {
    const spec = this.specs.find((s) => s.id === specId);
    if (!spec) throw new Error(`unknown spec ${specId}`);
    for (const other of this.specs) if (other.actor_id === spec.actor_id && other.status === "active") other.status = "deprecated";
    spec.status = "active";
  }

  async listRecords(databaseId: string): Promise<InkusDatabaseRecord[]> {
    const rows = this.databases[databaseId];
    if (!rows) throw new Error(`unknown database ${databaseId}`);
    return structuredClone(rows);
  }

  async createRecord(databaseId: string, fields: Record<string, unknown>, idempotencyKey?: string): Promise<InkusDatabaseRecord> {
    const rows = this.databases[databaseId];
    if (!rows) throw new Error(`unknown database ${databaseId}`);
    const key = idempotencyKey && `${databaseId}:${idempotencyKey}`;
    if (key && this.idempotency.has(key)) return structuredClone(this.idempotency.get(key)!);
    const now = new Date().toISOString();
    const row: InkusDatabaseRecord = { id: this.id("rec"), fields: structuredClone(fields), created_at: now, updated_at: now };
    rows.push(row);
    if (key) this.idempotency.set(key, row);
    return structuredClone(row);
  }

  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
    const row = Object.values(this.databases).flat().find((r) => r.id === recordId);
    if (!row) throw new Error(`unknown record ${recordId}`);
    row.fields = { ...row.fields, ...structuredClone(fields) };
    row.updated_at = new Date().toISOString();
  }

  async setMyActor(actorId: string): Promise<void> {
    if (!this.actors.some((a) => a.id === actorId)) throw new Error(`unknown actor ${actorId}`);
    this.boundActorId = actorId;
  }

  async recordLearning(input: InkusRecordLearningInput): Promise<{ learningId: string; duplicate: boolean }> {
    if (!this.boundActorId) throw new Error("Chame set_my_actor antes de registrar um aprendizado.");
    if (!input.content.trim()) throw new Error("content é obrigatório.");
    if (!input.evidence.trim()) throw new Error("evidence é obrigatório.");
    const normalized = normalizeLearningContent(input.content);
    const duplicate = this.learnings.find(
      (l) => l.actorId === this.boundActorId && l.kind === input.kind && l.status === "active" && normalizeLearningContent(l.content) === normalized,
    );
    if (duplicate) return { learningId: duplicate.id, duplicate: true };
    const row: InkusLearningEvent & { actorId: string; status: "active" } = {
      id: this.id("learning"),
      actorId: this.boundActorId,
      kind: input.kind,
      content: input.content,
      evidence: input.evidence,
      context: input.context ?? null,
      domain: input.domain ?? null,
      created_at: new Date().toISOString(),
      status: "active",
    };
    this.learnings.push(row);
    return { learningId: row.id, duplicate: false };
  }

  async recallLearnings(query: InkusRecallLearningsQuery): Promise<InkusLearningEvent[]> {
    if (!this.boundActorId) throw new Error("Chame set_my_actor antes de recuperar aprendizados.");
    const limit = Math.min(20, Math.max(1, query.limit ?? 20));
    const rows = this.learnings
      .filter((l) => l.actorId === this.boundActorId && l.status === "active" && (!query.domain || l.domain === query.domain))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit);
    return structuredClone(
      rows.map((row) => ({ id: row.id, kind: row.kind, content: row.content, evidence: row.evidence, context: row.context, domain: row.domain, created_at: row.created_at })),
    );
  }

  /** Test helper: retire every version of an actor, as a migration in Inkus would. */
  deprecateAll(actorId: string): void {
    for (const spec of this.specs) if (spec.actor_id === actorId) spec.status = "deprecated";
  }

  /** Test helper: what an edit made directly in Inkus looks like (new active version). */
  async editInInkus(actorId: string, patch: InkusSpecFields): Promise<InkusSpec> {
    const current = await this.getActiveSpec(actorId);
    const rest: Record<string, unknown> = { ...(current ?? {}) };
    for (const key of ["id", "actor_id", "version", "status"]) delete rest[key];
    const spec = await this.createSpec(actorId, { ...(rest as InkusSpecFields), ...patch });
    await this.activateSpec(spec.id);
    return spec;
  }
}

/**
 * A synthetic Inkus workspace with the same shape as a real one: domain agents with Portuguese
 * labels and cross-cutting agents. Every name and text here is fictional.
 */
export async function seedDemoInkus(fake = new FakeInkus()): Promise<FakeInkus> {
  const seeds: { name: string; mission: string; domains: string[]; responsibilities: string[] }[] = [
    {
      name: "Demo Family",
      mission: "Coordinate family routines and school events.",
      domains: ["família e cuidado"],
      responsibilities: ["Track school calendar", "Prepare replies without sending them"],
    },
    {
      name: "Demo Physical Health",
      mission: "Keep appointments and prevention on track.",
      domains: ["saúde física"],
      responsibilities: ["Remind about check-ups"],
    },
    {
      name: "Demo Life Orchestrator",
      mission: "Balance priorities across areas and hand decisions back to the owner.",
      domains: ["coordenação entre domínios"],
      responsibilities: ["Detect conflicts between agents", "Escalate trade-offs"],
    },
    {
      name: "Demo Privacy Guardian",
      mission: "Apply least privilege and consent before any action.",
      domains: ["privacidade e governança"],
      responsibilities: ["Review requested capabilities"],
    },
  ];
  // The interview lives in two databases, as in a real workspace: questions and answers.
  fake.databases[DEMO_QUESTIONS_DB] = demoInkusCatalogRecords().map((r) => ({ ...r, created_at: "2026-09-26T20:00:00.000Z" }));
  const answer = (fields: Record<string, unknown>): InkusDatabaseRecord => ({
    id: `demo-a-${fields.domain}-${fields.question_id}`,
    fields: { answered_at: "2026-09-20T09:00:00.000Z", epistemic_status: "self_reported", question_version: "export-v1", selected_option_ids_json: "[]", ...fields },
  });
  fake.databases[DEMO_ANSWERS_DB] = [
    answer({ domain: "family", question_id: "assessment.satisfaction", numeric_value: 5 }),
    answer({ domain: "family", question_id: "assessment.importance", numeric_value: 10 }),
    answer({ domain: "work", question_id: "assessment.satisfaction", numeric_value: 6 }),
    answer({ domain: "family", question_id: "goal.meaning", free_text: "Dinner together on weekdays" }),
  ];

  // A retired agent: only deprecated versions. Brad must never load it.
  const legacy = await fake.createActor({ name: "Demo Legacy Writer", description: "Retired agent" });
  await fake.editInInkus(legacy.id, { mission: "Old mission", knowledge_domains: ["escrita"] });
  fake.deprecateAll(legacy.id);

  for (const seed of seeds) {
    const actor = await fake.createActor({ name: seed.name, description: seed.mission });
    await fake.editInInkus(actor.id, {
      mission: seed.mission,
      scope: `Domínio principal: ${seed.domains[0]}. Atua somente dentro dos escopos autorizados.`,
      responsibilities: seed.responsibilities,
      prompt: `You are ${seed.name}. Never act without authorisation.`,
      allowed_tools: [],
      capabilities: { default_access: "deny", external_writes: "approval_required" },
      knowledge_domains: seed.domains,
      temperature: 0.2,
    });
  }
  return fake;
}
