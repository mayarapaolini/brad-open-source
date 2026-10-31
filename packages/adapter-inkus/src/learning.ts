import type { LearningEvent, MemoryProvider, RecallLearningsQuery, RecordLearningInput } from "@brad/domain";
import type { InkusClient, InkusLearningEvent } from "./types";

function toLearningEvent(row: InkusLearningEvent, actorId: string): LearningEvent {
  return {
    id: row.id,
    schemaVersion: 1,
    actorId,
    domain: (row.domain as LearningEvent["domain"]) ?? null,
    // Inkus' agent_learnings (PR #130) does not carry these yet; see ADR-0006.
    organizationId: null,
    projectId: null,
    sessionId: row.context ?? null,
    kind: row.kind,
    content: row.content,
    evidence: row.evidence,
    observedAt: row.created_at,
    accessScope: "actor",
    supersedesId: null,
    status: "active",
  };
}

/**
 * Brad's generic `MemoryProvider` contract (`@brad/domain`), backed by Inkus' `agent_learnings`
 * table via MCP (PR #130's `record_learning`/`recall_learnings` tools). Physical storage, RLS
 * and per-actor isolation stay entirely in Inkus; this only translates between Brad's
 * provider-agnostic shape and Inkus' concrete tool arguments/results, so the generic learning
 * logic in `@brad/domain` and any caller of it never depends on Inkus directly (ADR-0006).
 *
 * The client must already be bound to `actorId` via `client.setMyActor(actorId)` — Inkus always
 * records/recalls for the actor its token is bound to, never one named in a call's own
 * arguments, so every event this provider returns is already scoped to that one actor.
 */
export function createInkusMemoryProvider(client: InkusClient, actorId: string): MemoryProvider {
  return {
    async record(input: RecordLearningInput) {
      if (input.actorId !== actorId) {
        throw new Error(`createInkusMemoryProvider is bound to actor ${actorId}, not ${input.actorId}`);
      }
      const { learningId, duplicate } = await client.recordLearning({
        kind: input.kind,
        content: input.content,
        evidence: input.evidence,
        context: input.sessionId ?? null,
        domain: input.domain ?? null,
      });
      const rows = await client.recallLearnings({ domain: input.domain ?? undefined, limit: 20 });
      const row = rows.find((r) => r.id === learningId);
      if (!row) throw new Error("Inkus did not return the learning it just recorded");
      return { event: toLearningEvent(row, actorId), duplicate };
    },
    async recall(query: RecallLearningsQuery) {
      if (query.actorId !== actorId) {
        throw new Error(`createInkusMemoryProvider is bound to actor ${actorId}, not ${query.actorId}`);
      }
      const rows = await client.recallLearnings({ domain: query.domain ?? undefined, limit: query.limit });
      return rows.map((row) => toLearningEvent(row, actorId));
    },
  };
}
