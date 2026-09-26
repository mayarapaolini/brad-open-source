import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { exportAgentToInkus, syncWithInkus, type InkusClient } from "@brad/adapter-inkus";
import { generateDraftAgents, reconcileAgents } from "@brad/agent-factory";
import {
  AGENT_STATES,
  CAPABILITIES,
  LIFE_DOMAINS,
  EXPORT_FORMAT,
  checkTransition,
  datedAssessments,
  planImport,
  withTimeZone,
  demoGrantsAt,
  demoInbox,
  demoLifeMap,
  isGrantValid,
  validateExport,
  validateLifeMap,
  type AgentDefinition,
  type AgentState,
  type BradExport,
  type Capability,
  type ConsentGrant,
  type IncomingItem,
  type LifeMap,
} from "@brad/domain";
import { evaluate, type ActionRequest } from "@brad/policy-engine";
import {
  applyAdjustment,
  rankItems,
  suggestAdjustment,
  type RankedItem,
  type Suggestion,
  type Tier,
} from "@brad/priority-engine";
import type { Store } from "./store";

const MAX_BODY_BYTES = 1_000_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function requireLifeMap(store: Store): LifeMap {
  const map = store.getLifeMap();
  if (!map) throw new HttpError(409, "no life map yet: complete the diagnostic or load the demo profile");
  return map;
}

function parseExport(input: unknown): BradExport {
  const errors = validateExport(input);
  if (errors.length > 0) throw new HttpError(400, "invalid_export", errors);
  return input as BradExport;
}

/** Identity of an export's content (not its timestamp), so the same data is never applied twice by accident. */
function contentHash(data: BradExport): string {
  return createHash("sha256").update(JSON.stringify([data.lifeMap, data.agents, data.grants])).digest("hex");
}

function lastImportHash(store: Store): string | null {
  const last = store.listDecisions(500).find((d) => d.kind === "import" && (d.input as { hash?: string }).hash);
  return last ? ((last.input as { hash: string }).hash ?? null) : null;
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function currentTime(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
}

const DAY = 24 * 60 * 60 * 1000;
const TIERS: readonly Tier[] = ["now", "today", "later"];
const MAX_NOTE_LENGTH = 500;
const MAX_NAME_LENGTH = 120;
const MAX_GOAL_LENGTH = 2000;
const MAX_RESPONSIBILITIES = 30;

const DOMAIN_NAMES: Record<string, string> = {
  family: "Family",
  work: "Work",
  study: "Study",
  health: "Health",
  finances: "Finances",
  home: "Home",
  social: "Social",
  leisure: "Leisure",
  growth: "Growth",
  contribution: "Contribution",
};

/** Name used when an agent is created in Inkus and has no name of its own. */
function displayName(agent: AgentDefinition): string {
  return agent.name?.trim() || `Brad ${agent.domain ? DOMAIN_NAMES[agent.domain] : "Agent"}`;
}

interface AgentPatch {
  name?: string;
  goal?: string;
  responsibilities?: string[];
  domain?: string | null;
  actionDomains?: string[];
  requestedCapabilities?: string[];
}

function parseAgentPatch(input: unknown): AgentPatch {
  const p = (input ?? {}) as AgentPatch;
  const bad = (code: string) => new HttpError(400, code);
  if (p.name !== undefined && (typeof p.name !== "string" || p.name.length > MAX_NAME_LENGTH)) throw bad("invalid_name");
  if (p.goal !== undefined && (typeof p.goal !== "string" || p.goal.length > MAX_GOAL_LENGTH)) throw bad("invalid_goal");
  if (
    p.responsibilities !== undefined &&
    (!Array.isArray(p.responsibilities) ||
      p.responsibilities.length > MAX_RESPONSIBILITIES ||
      !p.responsibilities.every((r) => typeof r === "string" && r.length <= MAX_NAME_LENGTH * 2))
  )
    throw bad("invalid_responsibilities");
  if (p.domain !== undefined && p.domain !== null && !LIFE_DOMAINS.includes(p.domain as never)) throw bad("unknown_domain");
  if (p.actionDomains !== undefined && (!Array.isArray(p.actionDomains) || !p.actionDomains.every((d) => LIFE_DOMAINS.includes(d as never))))
    throw bad("unknown_domain");
  if (
    p.requestedCapabilities !== undefined &&
    (!Array.isArray(p.requestedCapabilities) || !p.requestedCapabilities.every((c) => CAPABILITIES.includes(c as never)))
  )
    throw bad("unknown_capability");
  return p;
}

/** Revokes every grant the agent no longer needs; returns the revoked ids. */
function revokeUnneeded(store: Store, agent: AgentDefinition, now: string, cause: string): string[] {
  const revoked: string[] = [];
  for (const grant of store.getGrants()) {
    if (grant.agentId !== agent.id || grant.revokedAt !== null) continue;
    if (agent.state !== "archived" && agent.requestedCapabilities.includes(grant.capability)) continue;
    store.saveGrant({ ...grant, revokedAt: now });
    store.addDecision("grant", { action: "revoke", grantId: grant.id, agentId: grant.agentId, capability: grant.capability, cause }, { ok: true });
    revoked.push(grant.id);
  }
  return revoked;
}

interface CorrectionInput {
  action: "feedback";
  decisionId: number;
  itemId: string;
  recordedTier: Tier;
  expectedTier: Tier;
  note: string;
}

/** Re-ranks the items of a stored priority decision against the current life map. */
function rerank(store: Store, decisionId: number, itemId: string): { map: LifeMap; ranked: RankedItem } {
  const decision = store.getDecision(decisionId);
  if (!decision) throw new HttpError(404, "decision_not_found");
  if (decision.kind !== "priority") throw new HttpError(400, "not_a_priority_decision");
  const input = decision.input as { itemIds?: string[]; items?: IncomingItem[] };
  // Older records only kept ids; those always came from the demo inbox.
  const items = input.items ?? demoInbox.filter((i) => input.itemIds?.includes(i.id));
  const map = requireLifeMap(store);
  const ranked = rankItems(items, map).find((r) => r.item.id === itemId);
  if (!ranked) throw new HttpError(400, "item_not_in_decision");
  return { map, ranked };
}

function sameSuggestion(a: Suggestion | null, b: Suggestion | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
const MAX_GRANT_DAYS = 365;

function parseActionRequest(input: unknown): ActionRequest {
  const r = input as Partial<ActionRequest> | undefined;
  if (
    typeof r?.agentId !== "string" ||
    !CAPABILITIES.includes(r.capability as never) ||
    !LIFE_DOMAINS.includes(r.domain as never)
  ) {
    throw new HttpError(400, "request must include agentId, a known capability and a known domain");
  }
  return { agentId: r.agentId, capability: r.capability!, domain: r.domain! };
}

type Handler = (req: IncomingMessage, store: Store) => Promise<unknown> | unknown;

function makeRoutes(options: ServerOptions): Record<string, Handler> {
  return {
  "GET /api/health": () => ({ ok: true }),

  "GET /api/lifemap": (_req, store) => ({ lifeMap: store.getLifeMap() }),

  "PUT /api/lifemap": async (req, store) => {
    const body = (await readJson(req)) as { lifeMap?: unknown };
    const errors = validateLifeMap(body.lifeMap);
    if (errors.length > 0) throw new HttpError(400, "invalid life map", errors);
    store.saveLifeMap(body.lifeMap as LifeMap);
    return { lifeMap: store.getLifeMap() };
  },

  "POST /api/demo/load": (_req, store) => {
    store.reset();
    store.saveLifeMap(demoLifeMap);
    store.replaceAgents(generateDraftAgents(demoLifeMap));
    store.replaceGrants(demoGrantsAt(new Date().toISOString()));
    return { lifeMap: store.getLifeMap(), agents: store.getAgents() };
  },

  "POST /api/agents/generate": (_req, store) => {
    const { agents, reset, archived } = reconcileAgents(store.getAgents(), generateDraftAgents(requireLifeMap(store)));
    store.replaceAgents(agents);

    // Grants never outlive the need for them: revoke what an agent no longer requests.
    const now = new Date().toISOString();
    const byId = new Map(agents.map((a) => [a.id, a]));
    for (const grant of store.getGrants()) {
      const agent = byId.get(grant.agentId);
      const stillNeeded = agent && agent.state !== "archived" && agent.requestedCapabilities.includes(grant.capability);
      if (!stillNeeded && grant.revokedAt === null) {
        store.saveGrant({ ...grant, revokedAt: now });
        store.addDecision("grant", { action: "revoke", grantId: grant.id, agentId: grant.agentId, capability: grant.capability, cause: "regenerate" }, { ok: true });
      }
    }
    if (reset.length > 0 || archived.length > 0) store.addDecision("lifecycle", { action: "regenerate" }, { reset, archived });
    return { agents: store.getAgents(), grants: store.getGrants(), reset, archived };
  },

  "POST /api/agents/transition": async (req, store) => {
    const body = (await readJson(req)) as { agentId?: string; to?: AgentState; now?: string };
    const agent = store.getAgents().find((a) => a.id === body.agentId);
    if (!agent) throw new HttpError(404, "agent_not_found");
    if (!AGENT_STATES.includes(body.to as AgentState)) throw new HttpError(400, "unknown_state");
    const to = body.to as AgentState;
    const now = currentTime(body.now);
    const check = checkTransition(agent, to, {
      grants: store.getGrants(),
      hasSimulation: store.hasPolicySimulation(agent.id),
      now,
    });
    const next = check.ok ? { ...agent, state: to } : agent;
    if (check.ok) store.saveAgent(next);
    store.addDecision("lifecycle", { agentId: agent.id, from: agent.state, to }, check);
    return { result: check, agent: next };
  },

  "POST /api/grants": async (req, store) => {
    const body = (await readJson(req)) as { agentId?: string; capability?: Capability; days?: number; now?: string };
    const map = requireLifeMap(store);
    const agent = store.getAgents().find((a) => a.id === body.agentId);
    if (!agent) throw new HttpError(404, "agent_not_found");
    if (agent.state === "archived") throw new HttpError(409, "agent_archived");
    const capability = body.capability as Capability;
    if (!CAPABILITIES.includes(capability)) throw new HttpError(400, "unknown_capability");
    if (map.boundaries.forbiddenCapabilities.includes(capability)) throw new HttpError(409, "capability_forbidden");
    if (!agent.requestedCapabilities.includes(capability)) throw new HttpError(409, "capability_not_requested");
    const days = body.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > MAX_GRANT_DAYS) throw new HttpError(400, "invalid_duration");
    const now = currentTime(body.now);
    if (store.getGrants().some((g) => g.agentId === agent.id && g.capability === capability && isGrantValid(g, now))) {
      throw new HttpError(409, "grant_exists");
    }
    const grant: ConsentGrant = {
      id: `g-${randomUUID()}`,
      agentId: agent.id,
      capability,
      purpose: agent.goal || agent.name || agent.domain || agent.id,
      issuedAt: now,
      expiresAt: new Date(Date.parse(now) + days * DAY).toISOString(),
      revokedAt: null,
    };
    store.saveGrant(grant);
    store.addDecision("grant", { action: "grant", grantId: grant.id, agentId: agent.id, capability, expiresAt: grant.expiresAt }, { ok: true });
    return { grant };
  },

  "POST /api/grants/revoke": async (req, store) => {
    const body = (await readJson(req)) as { grantId?: string; now?: string };
    const grant = store.getGrants().find((g) => g.id === body.grantId);
    if (!grant) throw new HttpError(404, "grant_not_found");
    if (grant.revokedAt !== null) return { grant };
    const revoked = { ...grant, revokedAt: currentTime(body.now) };
    store.saveGrant(revoked);
    store.addDecision("grant", { action: "revoke", grantId: grant.id, agentId: grant.agentId, capability: grant.capability }, { ok: true });
    return { grant: revoked };
  },

  "GET /api/export": (_req, store) => {
    const snapshot: BradExport = {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      lifeMap: requireLifeMap(store),
      agents: store.getAgents(),
      grants: store.getGrants(),
    };
    return snapshot;
  },

  "POST /api/import/preview": async (req, store) => {
    const data = parseExport(await readJson(req));
    const plan = planImport({ lifeMap: store.getLifeMap(), agents: store.getAgents(), grants: store.getGrants() }, data);
    const hash = contentHash(data);
    return { plan, hash, alreadyImported: lastImportHash(store) === hash };
  },

  "POST /api/import": async (req, store) => {
    const body = (await readJson(req)) as { export?: unknown; timeZone?: unknown; force?: unknown } & Record<string, unknown>;
    // Older clients post the export itself; newer ones wrap it with options.
    const wrapped = body.export !== undefined;
    const data = parseExport(wrapped ? body.export : body);
    const hash = contentHash(data);
    if (body.force !== true && lastImportHash(store) === hash) throw new HttpError(409, "already_imported");

    const fromZone = data.lifeMap.boundaries.timeZone;
    let lifeMap = datedAssessments(data.lifeMap, data.exportedAt);
    if (typeof body.timeZone === "string") {
      if (!isValidTimeZone(body.timeZone)) throw new HttpError(400, "invalid_time_zone");
      lifeMap = withTimeZone(lifeMap, body.timeZone);
    } else if (fromZone === "UTC") {
      // UTC in a personal export is almost always a configuration mistake: ask before storing it.
      throw new HttpError(409, "needs_timezone");
    }

    const snapshotId = store.createSnapshot("before_import");
    // An imported agent never starts acting on its own: active agents arrive paused.
    const agents = data.agents.map((a) => (a.state === "active" ? { ...a, state: "paused" as const } : a));
    store.replaceAll(lifeMap, agents, data.grants);
    store.addDecision(
      "import",
      { exportedAt: data.exportedAt, hash, snapshotId, timeZoneFrom: fromZone, timeZoneTo: lifeMap.boundaries.timeZone },
      { agents: agents.length, grants: data.grants.length },
    );
    return { lifeMap: store.getLifeMap(), agents: store.getAgents(), grants: store.getGrants(), snapshotId };
  },

  "GET /api/snapshots": (_req, store) => ({ snapshots: store.listSnapshots() }),

  "POST /api/snapshots/restore": async (req, store) => {
    const body = (await readJson(req)) as { snapshotId?: number };
    const snapshot = Number.isInteger(body.snapshotId) ? store.getSnapshot(body.snapshotId!) : null;
    if (!snapshot) throw new HttpError(404, "snapshot_not_found");
    // Restoring is itself undoable, and never re-activates anything.
    const undoId = store.createSnapshot("before_restore");
    store.restore({
      ...snapshot,
      agents: snapshot.agents.map((a) => (a.state === "active" ? { ...a, state: "paused" as const } : a)),
    });
    store.addDecision("import", { action: "restore", snapshotId: body.snapshotId, undoSnapshotId: undoId }, { agents: snapshot.agents.length });
    return { lifeMap: store.getLifeMap(), agents: store.getAgents(), grants: store.getGrants(), snapshotId: undoId };
  },

  "GET /api/agents": (_req, store) => ({ agents: store.getAgents(), grants: store.getGrants() }),

  "GET /api/inbox/demo": () => ({ items: demoInbox }),

  "POST /api/simulate/priority": async (req, store) => {
    const map = requireLifeMap(store);
    const body = (await readJson(req)) as { items?: IncomingItem[] };
    const items = Array.isArray(body.items) ? body.items : demoInbox;
    const ranked = rankItems(items, map);
    // Keep the items themselves (synthetic today) so a later correction can re-rank them.
    const decision = store.addDecision(
      "priority",
      { itemIds: items.map((i) => i.id), items },
      { order: ranked.map((r) => ({ id: r.item.id, score: r.score, tier: r.tier })) },
    );
    return { ranked, decisionId: decision.id };
  },

  "POST /api/simulate/policy": async (req, store) => {
    const map = requireLifeMap(store);
    const body = (await readJson(req)) as { request?: unknown; assumeState?: AgentState; assumeGrant?: boolean; now?: string };
    const request = parseActionRequest(body.request);
    if (body.assumeState !== undefined && !AGENT_STATES.includes(body.assumeState)) {
      throw new HttpError(400, "assumeState is not a known agent state");
    }
    const now = currentTime(body.now);

    // What-if overrides live only in this request; stored agents stay drafts.
    const agents = store
      .getAgents()
      .map((a) => (a.id === request.agentId && body.assumeState ? { ...a, state: body.assumeState } : a));
    const grants: ConsentGrant[] = store.getGrants();
    if (body.assumeGrant && !grants.some((g) => g.agentId === request.agentId && g.capability === request.capability)) {
      const day = 24 * 60 * 60 * 1000;
      grants.push({
        id: "g-simulated",
        agentId: request.agentId,
        capability: request.capability,
        purpose: "Simulated grant (not stored)",
        issuedAt: new Date(Date.parse(now) - day).toISOString(),
        expiresAt: new Date(Date.parse(now) + 30 * day).toISOString(),
        revokedAt: null,
      });
    }

    const decision = evaluate(request, { agents, grants, boundaries: map.boundaries, now });
    const record = store.addDecision("policy", { request, assumeState: body.assumeState ?? null, assumeGrant: !!body.assumeGrant, now }, decision);
    return { decision, decisionId: record.id };
  },

  "POST /api/corrections": async (req, store) => {
    const body = (await readJson(req)) as { decisionId?: number; itemId?: string; expectedTier?: Tier; note?: string };
    if (!Number.isInteger(body.decisionId) || typeof body.itemId !== "string") throw new HttpError(400, "invalid_request");
    if (!TIERS.includes(body.expectedTier as Tier)) throw new HttpError(400, "unknown_tier");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > MAX_NOTE_LENGTH) throw new HttpError(400, "note_too_long");

    const decision = store.getDecision(body.decisionId!);
    const recorded = (decision?.result as { order?: { id: string; tier: Tier }[] } | undefined)?.order?.find(
      (o) => o.id === body.itemId,
    );
    const { map, ranked } = rerank(store, body.decisionId!, body.itemId);
    const recordedTier = recorded?.tier ?? ranked.tier;
    if (body.expectedTier === ranked.tier) throw new HttpError(400, "same_tier");

    const suggestion = suggestAdjustment(ranked, body.expectedTier!, map);
    const input: CorrectionInput = {
      action: "feedback",
      decisionId: body.decisionId!,
      itemId: body.itemId,
      recordedTier,
      expectedTier: body.expectedTier!,
      note,
    };
    const record = store.addDecision("correction", input, { current: { score: ranked.score, tier: ranked.tier }, suggestion });
    return { correctionId: record.id, current: { score: ranked.score, tier: ranked.tier }, suggestion };
  },

  "POST /api/corrections/apply": async (req, store) => {
    const body = (await readJson(req)) as { correctionId?: number };
    const record = Number.isInteger(body.correctionId) ? store.getDecision(body.correctionId!) : null;
    const input = record?.input as CorrectionInput | undefined;
    if (!record || record.kind !== "correction" || input?.action !== "feedback") throw new HttpError(404, "correction_not_found");
    const stored = (record.result as { suggestion: Suggestion | null }).suggestion;
    if (!stored) throw new HttpError(409, "no_suggestion");
    if (stored.change === "add_person") throw new HttpError(409, "manual_change");

    // Only apply what the owner saw: if the life map moved on, the suggestion is stale.
    const { map, ranked } = rerank(store, input.decisionId, input.itemId);
    const fresh = suggestAdjustment(ranked, input.expectedTier, map);
    if (!sameSuggestion(fresh, stored)) throw new HttpError(409, "stale_correction");

    const next = applyAdjustment(map, stored);
    store.saveLifeMap(next);
    store.addDecision(
      "correction",
      { action: "apply", correctionId: record.id, itemId: input.itemId, change: stored.change, params: stored.params },
      { before: { score: ranked.score, tier: ranked.tier }, after: stored.projected },
    );
    return { lifeMap: store.getLifeMap(), suggestion: stored };
  },

  "GET /api/decisions": (_req, store) => ({ decisions: store.listDecisions() }),

  "DELETE /api/data": (_req, store) => {
    store.reset();
    return { ok: true };
  },

  "POST /api/agents/update": async (req, store) => {
    const body = (await readJson(req)) as { agentId?: string; patch?: unknown };
    const agent = store.getAgents().find((a) => a.id === body.agentId);
    if (!agent) throw new HttpError(404, "agent_not_found");
    if (agent.state === "archived") throw new HttpError(409, "agent_archived");
    const patch = parseAgentPatch(body.patch);
    const forbidden = requireLifeMap(store).boundaries.forbiddenCapabilities;
    const wanted = (patch.requestedCapabilities ?? [...agent.requestedCapabilities, ...agent.excludedByBoundary]) as AgentDefinition["requestedCapabilities"];
    const domain = patch.domain === undefined ? agent.domain : (patch.domain as AgentDefinition["domain"]);
    const next: AgentDefinition = {
      ...agent,
      name: patch.name?.trim() ?? agent.name,
      goal: patch.goal ?? agent.goal,
      responsibilities: patch.responsibilities?.map((r) => r.trim()).filter(Boolean) ?? agent.responsibilities,
      domain,
      actionDomains: domain ? [] : ((patch.actionDomains ?? agent.actionDomains ?? []) as AgentDefinition["actionDomains"]),
      requestedCapabilities: [...new Set(wanted.filter((c) => !forbidden.includes(c)))],
      excludedByBoundary: [...new Set(wanted.filter((c) => forbidden.includes(c)))],
      revision: (agent.revision ?? 0) + 1,
    };
    store.saveAgent(next);
    const now = new Date().toISOString();
    const revoked = revokeUnneeded(store, next, now, "edit");
    const fields = (["name", "goal", "responsibilities", "domain", "actionDomains", "requestedCapabilities"] as const).filter(
      (f) => JSON.stringify(agent[f]) !== JSON.stringify(next[f]),
    );
    store.addDecision("lifecycle", { action: "edit", agentId: agent.id, fields }, { ok: true, revokedGrants: revoked });
    return { agent: next, grants: store.getGrants() };
  },

  "POST /api/adapters/inkus/export": async (req, store) => {
    if (!options.inkus) throw new HttpError(409, "adapter_disabled");
    const body = (await readJson(req)) as { agentId?: string };
    const agent = store.getAgents().find((a) => a.id === body.agentId);
    if (!agent) throw new HttpError(404, "agent_not_found");
    if (agent.inkus) throw new HttpError(409, "already_linked");
    if (agent.state === "archived") throw new HttpError(409, "agent_archived");
    let client: InkusClient & { close?: () => Promise<void> };
    try {
      client = await options.inkus();
    } catch (error) {
      throw new HttpError(502, "inkus_unreachable", [error instanceof Error ? error.message : String(error)]);
    }
    try {
      const linked = await exportAgentToInkus(client, agent, displayName(agent), new Date().toISOString());
      store.saveAgent(linked);
      store.addDecision("sync", { source: "inkus", action: "export", agentId: agent.id }, { created: [agent.id], actorId: linked.inkus?.actorId });
      return { agent: linked };
    } catch (error) {
      throw new HttpError(502, "inkus_sync_failed", [error instanceof Error ? error.message : String(error)]);
    } finally {
      await client.close?.();
    }
  },

  "GET /api/adapters/inkus": (_req, store) => ({
    enabled: Boolean(options.inkus),
    lastSync: store.listDecisions(200).find((d) => d.kind === "sync" && (d.input as { action?: string }).action !== "export") ?? null,
  }),

  "POST /api/adapters/inkus/sync": async (_req, store) => {
    if (!options.inkus) throw new HttpError(409, "adapter_disabled");
    const map = requireLifeMap(store);
    const now = new Date().toISOString();
    let client: InkusClient & { close?: () => Promise<void> };
    try {
      client = await options.inkus();
    } catch (error) {
      throw new HttpError(502, "inkus_unreachable", [error instanceof Error ? error.message : String(error)]);
    }
    try {
      const result = await syncWithInkus({
        agents: store.getAgents(),
        grants: store.getGrants(),
        forbidden: map.boundaries.forbiddenCapabilities,
        client,
        now,
        displayName,
      });
      store.replaceAgents(result.agents);
      const revokeIds = new Set(result.revokeGrantIds);
      for (const grant of store.getGrants()) {
        if (!revokeIds.has(grant.id)) continue;
        store.saveGrant({ ...grant, revokedAt: now });
        store.addDecision("grant", { action: "revoke", grantId: grant.id, agentId: grant.agentId, capability: grant.capability, cause: "inkus" }, { ok: true });
      }
      const record = store.addDecision("sync", { source: "inkus" }, result.report);
      return { report: result.report, decisionId: record.id, agents: store.getAgents(), grants: store.getGrants() };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "inkus_sync_failed", [error instanceof Error ? error.message : String(error)]);
    } finally {
      await client.close?.();
    }
  },
  };
}

function serveStatic(res: ServerResponse, root: string, urlPath: string): boolean {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  let file = resolve(root, safe);
  if (!file.startsWith(resolve(root))) return false;
  if (!existsSync(file) || !statSync(file).isFile()) file = join(root, "index.html");
  if (!existsSync(file)) return false;
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
  return true;
}

export interface ServerOptions {
  /** Directory with the built Studio. Served when present. */
  staticDir?: string;
  /** Opens a connection to Inkus for one sync. Absent means the adapter is disabled. */
  inkus?: () => Promise<InkusClient & { close?: () => Promise<void> }>;
}

export function createApiServer(store: Store, options: ServerOptions = {}): Server {
  const routes = makeRoutes(options);
  return createServer(async (req, res) => {
    try {
      // Refuse requests addressed to anything but this machine (DNS-rebinding guard).
      const hostname = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (!LOCAL_HOSTS.has(hostname)) throw new HttpError(403, "Brad only answers on localhost");

      const url = new URL(req.url ?? "/", "http://localhost");
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) return send(res, 200, await handler(req, store));
      if (url.pathname.startsWith("/api/")) throw new HttpError(404, "not found");
      if (req.method === "GET" && options.staticDir && serveStatic(res, options.staticDir, url.pathname)) return;
      throw new HttpError(404, "not found");
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message, details: error.details });
      console.error(error);
      return send(res, 500, { error: "internal error" });
    }
  });
}
