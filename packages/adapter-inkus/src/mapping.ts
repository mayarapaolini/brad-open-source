import {
  CAPABILITIES,
  LIFE_DOMAINS,
  type AgentDefinition,
  type Capability,
  type LifeDomainId,
} from "@brad/domain";
import type { InkusActor, InkusSpec, InkusSpecFields } from "./types";

/** Keywords (accent-insensitive) that map an Inkus domain label to a Brad life domain. */
const DOMAIN_KEYWORDS: [LifeDomainId, string[]][] = [
  ["family", ["famil", "relacao afetiva", "relacionamento", "relationship", "dependente"]],
  ["work", ["trabalho", "carreira", "career", "work"]],
  ["study", ["estud", "aprend", "learning", "study", "curso"]],
  ["health", ["saude", "health", "bem-estar", "wellbeing", "emocional", "emotional"]],
  ["finances", ["financ", "dinheiro", "money", "imposto"]],
  ["home", ["casa", "home", "domestic", "lar "]],
  ["social", ["amizade", "comunidade", "community", "social", "friends"]],
  ["leisure", ["lazer", "hobb", "descanso", "rest", "leisure", "criativ", "creativ"]],
  ["growth", ["crescimento", "desenvolvimento pessoal", "espiritual", "growth", "spiritual"]],
  ["contribution", ["proposito", "contribu", "purpose", "impacto", "civic"]],
];

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function labelToDomain(label: string): LifeDomainId | null {
  const folded = fold(label);
  for (const [domain, words] of DOMAIN_KEYWORDS) if (words.some((w) => folded.includes(w))) return domain;
  return null;
}

interface BradNamespace {
  requested?: unknown;
  domain?: unknown;
  actionDomains?: unknown;
  state?: unknown;
}

function bradNamespace(spec: InkusSpecFields): BradNamespace {
  const brad = spec.capabilities?.brad;
  return brad && typeof brad === "object" ? (brad as BradNamespace) : {};
}

function isDomain(value: unknown): value is LifeDomainId {
  return typeof value === "string" && (LIFE_DOMAINS as readonly string[]).includes(value);
}

/**
 * The domain Brad files an Inkus agent under. An explicit `capabilities.brad.domain` wins;
 * otherwise the first knowledge domain, then "Domínio principal: …" in the scope. Anything
 * unrecognised is cross-cutting (null) and cannot act anywhere until the owner says so.
 */
export function domainFromSpec(spec: InkusSpecFields): LifeDomainId | null {
  const brad = bradNamespace(spec);
  if (brad.domain === null) return null;
  if (isDomain(brad.domain)) return brad.domain;
  const first = spec.knowledge_domains?.[0];
  if (first) {
    const fromLabel = labelToDomain(first);
    if (fromLabel) return fromLabel;
  }
  const principal = /dom[ií]nio principal:\s*([^.]+)/i.exec(spec.scope ?? "");
  return principal?.[1] ? labelToDomain(principal[1]) : null;
}

/** Only capabilities Brad knows, and only from Brad's own namespace; anything else is ignored. */
export function capabilitiesFromSpec(spec: InkusSpecFields): Capability[] {
  const requested = bradNamespace(spec).requested;
  if (!Array.isArray(requested)) return [];
  return [...new Set(requested.filter((c): c is Capability => (CAPABILITIES as readonly unknown[]).includes(c)))];
}

function actionDomainsFromSpec(spec: InkusSpecFields): LifeDomainId[] {
  const value = bradNamespace(spec).actionDomains;
  return Array.isArray(value) ? [...new Set(value.filter(isDomain))] : [];
}

const MAPPED_FIELDS = new Set(["mission", "responsibilities", "id", "actor_id", "version", "status", "created_at", "updated_at", "user_id"]);

function passthroughOf(spec: InkusSpec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).filter(([key]) => !MAPPED_FIELDS.has(key)));
}

/** The Brad-side content an Inkus spec defines. Lifecycle state and grants are never taken from Inkus. */
function contentFromSpec(actor: InkusActor, spec: InkusSpec, forbidden: Capability[]) {
  const wanted = capabilitiesFromSpec(spec);
  return {
    name: actor.name,
    goal: spec.mission ?? "",
    responsibilities: (spec.responsibilities ?? []).filter((r): r is string => typeof r === "string"),
    domain: domainFromSpec(spec),
    actionDomains: actionDomainsFromSpec(spec),
    requestedCapabilities: wanted.filter((c) => !forbidden.includes(c)),
    excludedByBoundary: wanted.filter((c) => forbidden.includes(c)),
  };
}

export function inkusAgentId(actorId: string): string {
  return `inkus-${actorId}`;
}

/** A new Brad agent for an Inkus actor: always a draft with no grants. */
export function agentFromInkus(actor: InkusActor, spec: InkusSpec, now: string, forbidden: Capability[]): AgentDefinition {
  return {
    id: inkusAgentId(actor.id),
    state: "draft",
    reason: "imported",
    escalation: "ask_owner",
    origin: "inkus",
    revision: 0,
    ...contentFromSpec(actor, spec, forbidden),
    inkus: {
      actorId: actor.id,
      specId: spec.id,
      specVersion: spec.version,
      syncedAt: now,
      syncedRevision: 0,
      passthrough: passthroughOf(spec),
    },
  };
}

export type ContentField = "name" | "goal" | "responsibilities" | "domain" | "actionDomains" | "requestedCapabilities";
const CONTENT_FIELDS: ContentField[] = ["name", "goal", "responsibilities", "domain", "actionDomains", "requestedCapabilities"];

/**
 * Applies a newer Inkus spec to an existing Brad agent (Inkus wins on content, by owner decision).
 * State, id and origin stay local. Returns which content fields actually changed.
 */
export function applyInkusSpec(
  local: AgentDefinition,
  actor: InkusActor,
  spec: InkusSpec,
  now: string,
  forbidden: Capability[],
): { agent: AgentDefinition; changed: ContentField[] } {
  const content = contentFromSpec(actor, spec, forbidden);
  const changed = CONTENT_FIELDS.filter(
    (f) => JSON.stringify(local[f] ?? (f === "name" ? "" : f === "domain" ? null : [])) !== JSON.stringify(content[f]),
  );
  const revision = local.revision ?? 0;
  return {
    agent: {
      ...local,
      ...content,
      revision,
      inkus: {
        actorId: actor.id,
        specId: spec.id,
        specVersion: spec.version,
        syncedAt: now,
        syncedRevision: revision,
        passthrough: passthroughOf(spec),
      },
    },
    changed,
  };
}

/** The spec Brad writes to Inkus: mapped fields plus Brad's namespace; unknown Inkus fields are kept. */
export function specFromAgent(agent: AgentDefinition, displayName: string): InkusSpecFields {
  const passthrough = (agent.inkus?.passthrough ?? {}) as InkusSpecFields & Record<string, unknown>;
  const inkusCapabilities = (passthrough.capabilities ?? {}) as Record<string, unknown>;
  const fields: InkusSpecFields = {
    ...passthrough,
    mission: agent.goal,
    responsibilities: agent.responsibilities ?? [],
    capabilities: {
      ...inkusCapabilities,
      brad: {
        requested: agent.requestedCapabilities,
        domain: agent.domain,
        actionDomains: agent.domain ? [] : (agent.actionDomains ?? []),
        state: agent.state,
      },
    },
  };
  if (!passthrough.scope) {
    fields.scope = agent.domain
      ? `Primary domain: ${agent.domain}. Acts only within explicitly authorised scopes.`
      : `Cross-cutting agent (${displayName}). Acts only within explicitly authorised scopes.`;
  }
  return fields;
}
