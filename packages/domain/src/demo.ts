import type { ConsentGrant, IncomingItem, LifeMap } from "./types";

/**
 * Synthetic demonstration profile. Every name, address and message here is fictional.
 * Never replace it with real personal data.
 */
export const demoLifeMap: LifeMap = {
  schemaVersion: 1,
  owner: { displayName: "Alex (demo)" },
  assessments: [
    { domain: "family", satisfaction: 5, importance: 10, goal: "Be present for dinner and school events" },
    { domain: "work", satisfaction: 7, importance: 8, goal: "Ship the Q2 roadmap without late nights" },
    { domain: "study", satisfaction: 3, importance: 6, goal: "Finish the data course by June" },
    { domain: "health", satisfaction: 4, importance: 9, goal: "Sleep 7 hours and keep medical follow-ups" },
    { domain: "finances", satisfaction: 6, importance: 7, goal: "Keep a six-month emergency fund" },
    { domain: "home", satisfaction: 6, importance: 5, goal: "Handle home admin in one weekly block" },
    { domain: "social", satisfaction: 4, importance: 6, goal: "See close friends twice a month" },
    { domain: "leisure", satisfaction: 3, importance: 5, goal: "Play guitar on weekends" },
    { domain: "growth", satisfaction: 5, importance: 4, goal: "" },
    { domain: "contribution", satisfaction: 6, importance: 3, goal: "" },
  ],
  people: [
    { id: "p-sam", name: "Sam Rivera", relationship: "partner", domain: "family", priority: 5, bypassQuietHours: true },
    { id: "p-noa", name: "Noa Rivera", relationship: "child", domain: "family", priority: 5, bypassQuietHours: true },
    { id: "p-jordan", name: "Jordan Blake", relationship: "manager", domain: "work", priority: 4, bypassQuietHours: false },
    { id: "p-priya", name: "Priya Nair", relationship: "colleague", domain: "work", priority: 3, bypassQuietHours: false },
    { id: "p-lee", name: "Dr. Morgan Lee", relationship: "provider", domain: "health", priority: 3, bypassQuietHours: false },
    { id: "p-riley", name: "Riley Chen", relationship: "friend", domain: "social", priority: 2, bypassQuietHours: false },
  ],
  boundaries: {
    timeZone: "America/Sao_Paulo",
    quietHours: { start: "22:00", end: "07:00" },
    forbiddenCapabilities: ["make_payment", "delete_item"],
    sensitiveDomains: ["health", "finances"],
  },
};

/** The moment the demo simulation is evaluated at. */
export const demoNow = "2026-03-10T08:30:00-03:00";

export const demoInbox: IncomingItem[] = [
  {
    id: "i-newsletter",
    kind: "message",
    channel: "email",
    from: { personId: null, address: "news@industry-digest.example" },
    domain: "work",
    subject: { en: "Weekly industry digest", pt: "Resumo semanal do setor" },
    receivedAt: "2026-03-10T07:55:00-03:00",
    urgency: 0,
  },
  {
    id: "i-family",
    kind: "message",
    channel: "chat",
    from: { personId: "p-sam", address: "sam@family.example" },
    domain: "family",
    subject: {
      en: "Noa has a fever. Can you pick her up from school at 10?",
      pt: "A Noa está com febre. Você consegue buscá-la na escola às 10h?",
    },
    receivedAt: "2026-03-10T06:40:00-03:00",
    urgency: 2,
  },
  {
    id: "i-manager",
    kind: "message",
    channel: "email",
    from: { personId: "p-jordan", address: "jordan@work.example" },
    domain: "work",
    subject: {
      en: "Can you review the Q2 deck before standup?",
      pt: "Você pode revisar a apresentação do 2º trimestre antes da daily?",
    },
    receivedAt: "2026-03-09T23:30:00-03:00",
    urgency: 2,
  },
  {
    id: "i-colleague",
    kind: "message",
    channel: "chat",
    from: { personId: "p-priya", address: "priya@work.example" },
    domain: "work",
    subject: { en: "Notes from yesterday's sync", pt: "Notas da reunião de ontem" },
    receivedAt: "2026-03-10T08:05:00-03:00",
    urgency: 1,
  },
  {
    id: "i-clinic",
    kind: "event",
    channel: "calendar",
    from: { personId: "p-lee", address: "appointments@clinic.example" },
    domain: "health",
    subject: { en: "Reminder: annual check-up on Thursday", pt: "Lembrete: check-up anual na quinta-feira" },
    receivedAt: "2026-03-10T08:20:00-03:00",
    urgency: 1,
  },
  {
    id: "i-friend",
    kind: "message",
    channel: "chat",
    from: { personId: "p-riley", address: "riley@friends.example" },
    domain: "social",
    subject: { en: "Dinner next Friday?", pt: "Jantar na próxima sexta?" },
    receivedAt: "2026-03-09T21:15:00-03:00",
    urgency: 0,
  },
];

/** Consent grants used by the policy simulation. None of them reach a real system. */
export const demoGrants: ConsentGrant[] = [
  {
    id: "g-family-draft",
    agentId: "agent-family",
    capability: "draft_reply",
    purpose: "Draft replies to family messages for owner review",
    issuedAt: "2026-03-01T09:00:00-03:00",
    expiresAt: "2026-12-31T23:59:00-03:00",
    revokedAt: null,
  },
  {
    id: "g-health-event",
    agentId: "agent-health",
    capability: "create_event",
    purpose: "Add confirmed medical appointments to the calendar",
    issuedAt: "2026-03-01T09:00:00-03:00",
    expiresAt: "2026-12-31T23:59:00-03:00",
    revokedAt: null,
  },
  {
    id: "g-work-read",
    agentId: "agent-work",
    capability: "read_messages",
    purpose: "Summarise work email",
    issuedAt: "2026-01-01T09:00:00-03:00",
    expiresAt: "2026-01-31T23:59:00-03:00",
    revokedAt: null,
  },
];

/**
 * The demo grants shifted so they are meaningful at `now`: two current grants and one
 * that expired a month ago. Used when the demo is loaded into a running Studio.
 */
export function demoGrantsAt(now: string): ConsentGrant[] {
  const t = Date.parse(now);
  const day = 24 * 60 * 60 * 1000;
  const at = (offsetDays: number) => new Date(t + offsetDays * day).toISOString();
  return demoGrants.map((g) =>
    g.id === "g-work-read"
      ? { ...g, issuedAt: at(-60), expiresAt: at(-30) }
      : { ...g, issuedAt: at(-9), expiresAt: at(300) },
  );
}

/**
 * A synthetic export shaped like a real first export: stored in UTC by mistake, with the
 * generated agents in draft and no grants. Used to exercise the import preview and time-zone fix.
 */
export function demoExportUtc(agents: import("./types").AgentDefinition[] = []): import("./export").BradExport {
  return {
    format: "brad-export",
    version: 1,
    exportedAt: "2026-09-26T12:00:00Z",
    lifeMap: {
      ...demoLifeMap,
      boundaries: { ...demoLifeMap.boundaries, timeZone: "UTC", quietHours: { start: "19:00", end: "10:00" } },
    },
    agents,
    grants: [],
  };
}
