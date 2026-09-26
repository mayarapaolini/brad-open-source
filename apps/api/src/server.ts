import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { generateDraftAgents } from "@brad/agent-factory";
import {
  AGENT_STATES,
  CAPABILITIES,
  LIFE_DOMAINS,
  demoGrants,
  demoInbox,
  demoLifeMap,
  validateLifeMap,
  type AgentState,
  type ConsentGrant,
  type IncomingItem,
  type LifeMap,
} from "@brad/domain";
import { evaluate, type ActionRequest } from "@brad/policy-engine";
import { rankItems } from "@brad/priority-engine";
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

const routes: Record<string, Handler> = {
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
    store.replaceGrants(demoGrants);
    return { lifeMap: store.getLifeMap(), agents: store.getAgents() };
  },

  "POST /api/agents/generate": (_req, store) => {
    store.replaceAgents(generateDraftAgents(requireLifeMap(store)));
    return { agents: store.getAgents() };
  },

  "GET /api/agents": (_req, store) => ({ agents: store.getAgents(), grants: store.getGrants() }),

  "GET /api/inbox/demo": () => ({ items: demoInbox }),

  "POST /api/simulate/priority": async (req, store) => {
    const map = requireLifeMap(store);
    const body = (await readJson(req)) as { items?: IncomingItem[] };
    const items = Array.isArray(body.items) ? body.items : demoInbox;
    const ranked = rankItems(items, map);
    const decision = store.addDecision(
      "priority",
      { itemIds: items.map((i) => i.id) },
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
    const now = typeof body.now === "string" && !Number.isNaN(Date.parse(body.now)) ? body.now : new Date().toISOString();

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

  "GET /api/decisions": (_req, store) => ({ decisions: store.listDecisions() }),

  "DELETE /api/data": (_req, store) => {
    store.reset();
    return { ok: true };
  },
};

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
}

export function createApiServer(store: Store, options: ServerOptions = {}): Server {
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
