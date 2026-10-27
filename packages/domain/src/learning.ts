import type { LifeDomainId } from "./types";

/**
 * Generic, storage-independent contracts for Brad's Continuous Learning Engine, Phase 1
 * (PRD "Brad Continuous Learning & Verified Agent Execution v0.2"). Nothing here depends on
 * Supabase, Inkus, or any other provider — an adapter (e.g. `@brad/adapter-inkus`) implements
 * `MemoryProvider` against whatever storage it has. Only the minimal shape needed to demonstrate
 * record → persist → recall-in-a-new-session → apply → verify is modelled; consolidation,
 * deduplication by similarity and evaluation metrics are Phase 2+ (see ADR-0006).
 */

export const LEARNING_KINDS = ["correction", "preference", "decision"] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

export const LEARNING_STATUSES = ["active", "superseded", "rejected"] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

/**
 * Who else may ever see this learning, beyond the actor that recorded it. Phase 1 has no
 * mechanism that widens access on its own — everything is recorded and recalled scoped to a
 * single actor; `accessScope` only documents the intended boundary for a future consolidator
 * (PRD D5/FR9) and is not yet enforced beyond "actor".
 */
export const LEARNING_ACCESS_SCOPES = ["actor", "domain", "organization", "project"] as const;
export type LearningAccessScope = (typeof LEARNING_ACCESS_SCOPES)[number];

/** A single captured correction, preference or decision. Immutable once persisted. */
export interface LearningEvent {
  id: string;
  /** Bumped only on an incompatible shape change, so an adapter can refuse what it can't read. */
  schemaVersion: 1;
  actorId: string;
  domain: LifeDomainId | null;
  organizationId?: string | null;
  projectId?: string | null;
  /** The task/session this was observed in, for provenance; never used to widen a recall query. */
  sessionId?: string | null;
  kind: LearningKind;
  /** The learning itself, in the agent's own words. */
  content: string;
  /** The literal correction/evidence it is based on. Required: no evidence, no learning. */
  evidence: string;
  observedAt: string;
  accessScope: LearningAccessScope;
  /** A newer event that replaces this one; history is kept, never overwritten in place. */
  supersedesId?: string | null;
  status: LearningStatus;
}

export interface RecordLearningInput {
  actorId: string;
  domain?: LifeDomainId | null;
  organizationId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  kind: LearningKind;
  content: string;
  evidence: string;
  observedAt?: string;
  accessScope?: LearningAccessScope;
}

export interface RecallLearningsQuery {
  actorId: string;
  domain?: LifeDomainId | null;
  limit?: number;
}

/**
 * Contract for persisting and recalling learning events. Storage is pluggable: an adapter
 * (Inkus today) owns the physical table/RLS/isolation, Brad only depends on this shape.
 * `record` must be idempotent for equivalent content of the same actor+kind (PRD idempotency
 * requirement): a repeat call returns the existing event with `duplicate: true` instead of
 * creating a second row.
 */
export interface MemoryProvider {
  record(input: RecordLearningInput): Promise<{ event: LearningEvent; duplicate: boolean }>;
  /** Must filter by `query.actorId` (and `domain`, when given) before returning anything; an
   *  actor never receives another actor's events, whatever the caller asks for. */
  recall(query: RecallLearningsQuery): Promise<LearningEvent[]>;
}
