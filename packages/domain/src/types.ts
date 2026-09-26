export const LIFE_DOMAINS = [
  "family",
  "work",
  "study",
  "health",
  "finances",
  "home",
  "social",
  "leisure",
  "growth",
  "contribution",
] as const;

export type LifeDomainId = (typeof LIFE_DOMAINS)[number];

export const CAPABILITIES = [
  "read_messages",
  "draft_reply",
  "send_message",
  "read_calendar",
  "create_event",
  "read_notes",
  "delete_item",
  "make_payment",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Capabilities that change something outside Brad and therefore always need owner confirmation. */
export const CONSEQUENTIAL_CAPABILITIES: readonly Capability[] = [
  "send_message",
  "create_event",
  "delete_item",
  "make_payment",
];

export const RELATIONSHIPS = [
  "partner",
  "child",
  "parent",
  "sibling",
  "friend",
  "colleague",
  "manager",
  "provider",
  "other",
] as const;

export type Relationship = (typeof RELATIONSHIPS)[number];

/** Text that ships in both supported interface languages. */
export interface Localized {
  en: string;
  pt: string;
}

export interface DomainAssessment {
  domain: LifeDomainId;
  /** How satisfied the person is today, 0–10. */
  satisfaction: number;
  /** How much the area matters to them, 0–10. */
  importance: number;
  goal: string;
}

export interface Person {
  id: string;
  name: string;
  relationship: Relationship;
  domain: LifeDomainId;
  /** User-defined priority, 1 (low) – 5 (highest). */
  priority: number;
  /** Messages from this person may interrupt quiet hours. */
  bypassQuietHours: boolean;
}

export interface QuietHours {
  /** "HH:MM", local to `Boundaries.timeZone`. */
  start: string;
  end: string;
}

export interface Boundaries {
  timeZone: string;
  quietHours: QuietHours | null;
  /** Capabilities no agent may ever use, whatever its grants say. */
  forbiddenCapabilities: Capability[];
  /** Domains where every action requires owner confirmation. */
  sensitiveDomains: LifeDomainId[];
}

export interface LifeMap {
  schemaVersion: 1;
  owner: { displayName: string };
  assessments: DomainAssessment[];
  people: Person[];
  boundaries: Boundaries;
}

export const AGENT_STATES = [
  "draft",
  "configured",
  "simulated",
  "approved",
  "active",
  "paused",
  "archived",
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export type AgentReason = "importance" | "gap" | "importance_and_gap";

export interface AgentDefinition {
  id: string;
  domain: LifeDomainId;
  state: AgentState;
  /** Owner goal the agent serves, copied from the life map. */
  goal: string;
  reason: AgentReason;
  /** Capabilities the agent would need. Requested is never granted. */
  requestedCapabilities: Capability[];
  /** Capabilities the template wanted but the owner's boundaries forbid. */
  excludedByBoundary: Capability[];
  escalation: "ask_owner";
}

export interface ConsentGrant {
  id: string;
  agentId: string;
  capability: Capability;
  purpose: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface IncomingItem {
  id: string;
  kind: "message" | "event" | "task";
  channel: "email" | "chat" | "calendar";
  from: { personId: string | null; address: string };
  domain: LifeDomainId;
  subject: Localized;
  /** ISO 8601 with offset. */
  receivedAt: string;
  /** Urgency declared by the source or a rule, 0–3. */
  urgency: number;
}

export interface DecisionRecord {
  id: number;
  kind: "priority" | "policy";
  createdAt: string;
  input: unknown;
  result: unknown;
}
