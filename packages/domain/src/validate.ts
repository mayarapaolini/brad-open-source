import {
  AGENT_STATES,
  CAPABILITIES,
  LIFE_DOMAINS,
  RELATIONSHIPS,
  type AgentDefinition,
  type ConsentGrant,
  type LifeMap,
} from "./types";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Returns a list of human-readable problems; an empty list means the life map is valid. */
export function validateLifeMap(input: unknown): string[] {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) return ["life map must be an object"];
  const map = input as Partial<LifeMap>;

  if (map.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof map.owner?.displayName !== "string") errors.push("owner.displayName must be a string");

  if (!Array.isArray(map.assessments)) {
    errors.push("assessments must be an array");
  } else {
    const seen = new Set<string>();
    for (const [i, a] of map.assessments.entries()) {
      if (!LIFE_DOMAINS.includes(a?.domain)) errors.push(`assessments[${i}].domain is unknown`);
      else if (seen.has(a.domain)) errors.push(`assessments[${i}].domain is duplicated`);
      else seen.add(a.domain);
      if (!isScore(a?.satisfaction)) errors.push(`assessments[${i}].satisfaction must be an integer 0–10`);
      if (!isScore(a?.importance)) errors.push(`assessments[${i}].importance must be an integer 0–10`);
      if (typeof a?.goal !== "string") errors.push(`assessments[${i}].goal must be a string`);
    }
  }

  if (!Array.isArray(map.people)) {
    errors.push("people must be an array");
  } else {
    const ids = new Set<string>();
    for (const [i, p] of map.people.entries()) {
      if (typeof p?.id !== "string" || p.id === "") errors.push(`people[${i}].id is required`);
      else if (ids.has(p.id)) errors.push(`people[${i}].id is duplicated`);
      else ids.add(p.id);
      if (typeof p?.name !== "string" || p.name.trim() === "") errors.push(`people[${i}].name is required`);
      if (!RELATIONSHIPS.includes(p?.relationship)) errors.push(`people[${i}].relationship is unknown`);
      if (!LIFE_DOMAINS.includes(p?.domain)) errors.push(`people[${i}].domain is unknown`);
      if (!Number.isInteger(p?.priority) || p.priority < 1 || p.priority > 5)
        errors.push(`people[${i}].priority must be an integer 1–5`);
      if (typeof p?.bypassQuietHours !== "boolean") errors.push(`people[${i}].bypassQuietHours must be a boolean`);
    }
  }

  const b = map.boundaries;
  if (typeof b !== "object" || b === null) {
    errors.push("boundaries must be an object");
  } else {
    if (typeof b.timeZone !== "string" || !isTimeZone(b.timeZone)) errors.push("boundaries.timeZone is invalid");
    if (b.quietHours !== null && (!TIME.test(b.quietHours?.start ?? "") || !TIME.test(b.quietHours?.end ?? "")))
      errors.push("boundaries.quietHours must be null or { start, end } in HH:MM");
    if (!Array.isArray(b.forbiddenCapabilities) || !b.forbiddenCapabilities.every((c) => CAPABILITIES.includes(c)))
      errors.push("boundaries.forbiddenCapabilities contains an unknown capability");
    if (!Array.isArray(b.sensitiveDomains) || !b.sensitiveDomains.every((d) => LIFE_DOMAINS.includes(d)))
      errors.push("boundaries.sensitiveDomains contains an unknown domain");
  }

  return errors;
}

/** An empty life map with every domain present and neutral scores. */
export function emptyLifeMap(): LifeMap {
  return {
    schemaVersion: 1,
    owner: { displayName: "" },
    assessments: LIFE_DOMAINS.map((domain) => ({ domain, satisfaction: 5, importance: 5, goal: "" })),
    people: [],
    boundaries: {
      timeZone: "UTC",
      quietHours: { start: "22:00", end: "07:00" },
      forbiddenCapabilities: ["make_payment", "delete_item"],
      sensitiveDomains: ["health", "finances"],
    },
  };
}

const REASONS = ["importance", "gap", "importance_and_gap", "imported"];

function isCapabilityList(value: unknown): boolean {
  return Array.isArray(value) && value.every((c) => CAPABILITIES.includes(c));
}

export function validateAgent(input: unknown, path = "agent"): string[] {
  const a = input as Partial<AgentDefinition> | null;
  if (typeof a !== "object" || a === null) return [`${path} must be an object`];
  const errors: string[] = [];
  if (typeof a.id !== "string" || a.id === "") errors.push(`${path}.id is required`);
  if (a.domain !== null && !LIFE_DOMAINS.includes(a.domain as never)) errors.push(`${path}.domain is unknown`);
  if (a.actionDomains !== undefined && (!Array.isArray(a.actionDomains) || !a.actionDomains.every((d) => LIFE_DOMAINS.includes(d))))
    errors.push(`${path}.actionDomains contains an unknown domain`);
  if (a.name !== undefined && typeof a.name !== "string") errors.push(`${path}.name must be a string`);
  if (a.responsibilities !== undefined && (!Array.isArray(a.responsibilities) || !a.responsibilities.every((r) => typeof r === "string")))
    errors.push(`${path}.responsibilities must be a list of strings`);
  if (a.origin !== undefined && a.origin !== "generated" && a.origin !== "inkus") errors.push(`${path}.origin is unknown`);
  if (!AGENT_STATES.includes(a.state as never)) errors.push(`${path}.state is unknown`);
  if (typeof a.goal !== "string") errors.push(`${path}.goal must be a string`);
  if (!REASONS.includes(a.reason as string)) errors.push(`${path}.reason is unknown`);
  if (!isCapabilityList(a.requestedCapabilities)) errors.push(`${path}.requestedCapabilities is invalid`);
  if (!isCapabilityList(a.excludedByBoundary)) errors.push(`${path}.excludedByBoundary is invalid`);
  if (a.escalation !== "ask_owner") errors.push(`${path}.escalation must be "ask_owner"`);
  return errors;
}

export function validateGrant(input: unknown, path = "grant"): string[] {
  const g = input as Partial<ConsentGrant> | null;
  if (typeof g !== "object" || g === null) return [`${path} must be an object`];
  const errors: string[] = [];
  for (const key of ["id", "agentId", "purpose", "issuedAt", "expiresAt"] as const) {
    if (typeof g[key] !== "string" || g[key] === "") errors.push(`${path}.${key} is required`);
  }
  if (!CAPABILITIES.includes(g.capability as never)) errors.push(`${path}.capability is unknown`);
  for (const key of ["issuedAt", "expiresAt"] as const) {
    if (typeof g[key] === "string" && Number.isNaN(Date.parse(g[key]))) errors.push(`${path}.${key} is not a date`);
  }
  if (g.revokedAt !== null && (typeof g.revokedAt !== "string" || Number.isNaN(Date.parse(g.revokedAt))))
    errors.push(`${path}.revokedAt must be null or a date`);
  return errors;
}
