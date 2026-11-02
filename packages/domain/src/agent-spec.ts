// Agent Spec v1: pacote de um agente em formato aberto. Fonte: RFC-002 (rascunho, aguarda aprovação).
// Módulo sem dependências de Node (usa crypto.subtle), porque o Studio também importa @brad/domain.
// Pedido não é permissão: permissions.requested nunca concede acesso, e grants nunca entram no pacote.

export const AGENT_SPEC_SCHEMA_VERSION = 1 as const;

export const AGENT_LIFECYCLE_STATES = ["draft", "configured", "simulated", "approved", "active", "paused", "archived"] as const;
export type AgentLifecycleState = (typeof AGENT_LIFECYCLE_STATES)[number];

export type AgentSpecV1 = {
  mission: string;
  scope: string;
  permissions: { requested: string[] };
  confirmation_required: string[];
  models: { plan: string; implement: string; research: string };
  routines: {
    name: string;
    cron: string;
    enabled: boolean;
    respect_quiet_hours: boolean;
    budget: { max_seconds: number; max_tool_calls: number; max_cost: number };
  }[];
  channels: { channel: string; agent_id: string; status: "active" | "archived" }[];
  context_isolation: { contexts: string[]; block_between_contexts: boolean };
};

export type AgentSpecFrontmatter = {
  id: string;
  name: string;
  version: number;
  schema_version: typeof AGENT_SPEC_SCHEMA_VERSION;
  status: AgentLifecycleState;
};

export type AgentPackageFiles = {
  "agent.md": string;
  "spec.json": string;
  "manifest.json": string;
};

type Errors = string[];
type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

function checkKeys(value: Obj, path: string, required: string[], rejectUnknown: boolean, errors: Errors) {
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key}: missing`);
  if (rejectUnknown) for (const key of Object.keys(value)) if (!required.includes(key)) errors.push(`${path}.${key}: unknown key`);
}

function checkString(value: unknown, path: string, errors: Errors, minLength = 1) {
  if (typeof value !== "string") return void errors.push(`${path}: expected string`);
  if (value.length < minLength) errors.push(`${path}: shorter than ${minLength}`);
}

function checkStringList(value: unknown, path: string, errors: Errors) {
  if (!Array.isArray(value)) return void errors.push(`${path}: expected array`);
  value.forEach((item, i) => checkString(item, `${path}[${i}]`, errors));
  if (new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${path}: items must be unique`);
}

function checkInteger(value: unknown, path: string, minimum: number, errors: Errors) {
  if (typeof value !== "number" || !Number.isInteger(value)) return void errors.push(`${path}: expected integer`);
  if (value < minimum) errors.push(`${path}: below ${minimum}`);
}

function checkNumber(value: unknown, path: string, minimum: number, errors: Errors) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void errors.push(`${path}: expected number`);
  if (value < minimum) errors.push(`${path}: below ${minimum}`);
}

/** Lista de erros do spec.json (vazia quando válido). Espelha agent-spec-v1.schema.json. */
export function validateAgentSpec(value: unknown): Errors {
  const errors: Errors = [];
  if (!isObject(value)) return ["$: expected object"];
  checkKeys(value, "$", ["mission", "scope", "permissions", "confirmation_required", "models", "routines", "channels", "context_isolation"], true, errors);

  checkString(value.mission, "$.mission", errors);
  checkString(value.scope, "$.scope", errors);

  if (isObject(value.permissions)) {
    checkKeys(value.permissions, "$.permissions", ["requested"], true, errors);
    checkStringList(value.permissions.requested, "$.permissions.requested", errors);
  } else errors.push("$.permissions: expected object");

  checkStringList(value.confirmation_required, "$.confirmation_required", errors);

  if (isObject(value.models)) {
    checkKeys(value.models, "$.models", ["plan", "implement", "research"], true, errors);
    for (const role of ["plan", "implement", "research"]) checkString(value.models[role], `$.models.${role}`, errors);
  } else errors.push("$.models: expected object");

  if (!Array.isArray(value.routines)) errors.push("$.routines: expected array");
  else
    value.routines.forEach((routine, i) => {
      const path = `$.routines[${i}]`;
      if (!isObject(routine)) return void errors.push(`${path}: expected object`);
      checkKeys(routine, path, ["name", "cron", "enabled", "respect_quiet_hours", "budget"], true, errors);
      checkString(routine.name, `${path}.name`, errors);
      checkString(routine.cron, `${path}.cron`, errors);
      if (typeof routine.enabled !== "boolean") errors.push(`${path}.enabled: expected boolean`);
      if (typeof routine.respect_quiet_hours !== "boolean") errors.push(`${path}.respect_quiet_hours: expected boolean`);
      if (isObject(routine.budget)) {
        checkKeys(routine.budget, `${path}.budget`, ["max_seconds", "max_tool_calls", "max_cost"], true, errors);
        checkInteger(routine.budget.max_seconds, `${path}.budget.max_seconds`, 1, errors);
        checkInteger(routine.budget.max_tool_calls, `${path}.budget.max_tool_calls`, 0, errors);
        checkNumber(routine.budget.max_cost, `${path}.budget.max_cost`, 0, errors);
      } else errors.push(`${path}.budget: expected object`);
    });

  if (!Array.isArray(value.channels)) errors.push("$.channels: expected array");
  else
    value.channels.forEach((channel, i) => {
      const path = `$.channels[${i}]`;
      if (!isObject(channel)) return void errors.push(`${path}: expected object`);
      checkKeys(channel, path, ["channel", "agent_id", "status"], true, errors);
      checkString(channel.channel, `${path}.channel`, errors);
      checkString(channel.agent_id, `${path}.agent_id`, errors);
      if (channel.status !== "active" && channel.status !== "archived") errors.push(`${path}.status: not one of ["active","archived"]`);
    });

  if (isObject(value.context_isolation)) {
    checkKeys(value.context_isolation, "$.context_isolation", ["contexts", "block_between_contexts"], true, errors);
    checkStringList(value.context_isolation.contexts, "$.context_isolation.contexts", errors);
    if (typeof value.context_isolation.block_between_contexts !== "boolean") errors.push("$.context_isolation.block_between_contexts: expected boolean");
  } else errors.push("$.context_isolation: expected object");

  return errors;
}

/** Lista de erros do frontmatter do agent.md. */
export function validateAgentSpecFrontmatter(value: unknown): Errors {
  const errors: Errors = [];
  if (!isObject(value)) return ["$: expected object"];
  checkKeys(value, "$", ["id", "name", "version", "schema_version", "status"], true, errors);
  checkString(value.id, "$.id", errors);
  checkString(value.name, "$.name", errors);
  checkInteger(value.version, "$.version", 1, errors);
  if (value.schema_version !== AGENT_SPEC_SCHEMA_VERSION) errors.push(`$.schema_version: must be ${AGENT_SPEC_SCHEMA_VERSION}`);
  if (!(AGENT_LIFECYCLE_STATES as readonly unknown[]).includes(value.status)) errors.push(`$.status: not a lifecycle state`);
  return errors;
}

/** JSON com chaves ordenadas, LF e nova linha final. A mesma entrada sempre gera o mesmo texto. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map((key) => [key, sort(v[key])]));
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Frontmatter YAML com valores escalares. Strings saem entre aspas JSON, que também é YAML válido. */
function renderFrontmatter(frontmatter: AgentSpecFrontmatter): string {
  const lines = Object.keys(frontmatter)
    .sort()
    .map((key) => {
      const value = (frontmatter as unknown as Obj)[key];
      return `${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
    });
  return `---\n${lines.join("\n")}\n---\n`;
}

function parseFrontmatter(text: string): Obj {
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new AgentSpecError(["agent.md: missing frontmatter"]);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new AgentSpecError(["agent.md: unterminated frontmatter"]);
  const result: Obj = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([a-z_]+): (.+)$/);
    if (!match) throw new AgentSpecError([`agent.md: invalid frontmatter line "${line}"`]);
    const raw = match[2]!;
    result[match[1]!] = raw.startsWith('"') ? (JSON.parse(raw) as string) : Number(raw);
  }
  return result;
}

export class AgentSpecError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.name = "AgentSpecError";
    this.errors = errors;
  }
}

// Padrões de credencial. Falso positivo é preferível a exportar um segredo.
const SECRET_PATTERNS: RegExp[] = [
  /inkus_pat_[A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[^\s"',]{8,}/i,
];

/** Lança AgentSpecError se algum texto tiver padrão de credencial. Usado antes de qualquer export. */
export function assertNoSecrets(texts: string[]): void {
  const hits = texts.filter((text) => SECRET_PATTERNS.some((pattern) => pattern.test(text)));
  if (hits.length) throw new AgentSpecError(["secret-like value found; export aborted, no file written"]);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Gera os três arquivos do pacote. Valida, verifica segredos e só então devolve o texto.
 * Não grava nada: quem chama decide onde gravar.
 */
export async function buildAgentPackage(frontmatter: AgentSpecFrontmatter, spec: AgentSpecV1): Promise<AgentPackageFiles> {
  const errors = [...validateAgentSpecFrontmatter(frontmatter), ...validateAgentSpec(spec)];
  if (errors.length) throw new AgentSpecError(errors);

  const specText = canonicalJson(spec);
  const agentText = `${renderFrontmatter(frontmatter)}\n# ${frontmatter.name}\n\n${spec.mission}\n`;
  assertNoSecrets([specText, agentText]);

  const manifest = canonicalJson({
    schema_version: AGENT_SPEC_SCHEMA_VERSION,
    files: { "agent.md": await sha256Hex(agentText), "spec.json": await sha256Hex(specText) },
  });
  return { "agent.md": agentText, "spec.json": specText, "manifest.json": manifest };
}

/** Lê o pacote e confere os hashes do manifest antes de devolver os dados. Falha se algum arquivo foi alterado. */
export async function parseAgentPackage(files: AgentPackageFiles): Promise<{ frontmatter: AgentSpecFrontmatter; spec: AgentSpecV1 }> {
  let manifest: { schema_version?: unknown; files?: Record<string, string> };
  try {
    manifest = JSON.parse(files["manifest.json"]) as typeof manifest;
  } catch {
    throw new AgentSpecError(["manifest.json: invalid JSON"]);
  }
  if (manifest.schema_version !== AGENT_SPEC_SCHEMA_VERSION) throw new AgentSpecError(["manifest.json: unsupported schema_version"]);
  for (const name of ["agent.md", "spec.json"] as const) {
    if ((await sha256Hex(files[name])) !== manifest.files?.[name]) throw new AgentSpecError([`${name}: hash does not match manifest`]);
  }

  const frontmatter = parseFrontmatter(files["agent.md"]) as unknown as AgentSpecFrontmatter;
  const frontmatterErrors = validateAgentSpecFrontmatter(frontmatter);
  if (frontmatterErrors.length) throw new AgentSpecError(frontmatterErrors);

  let spec: unknown;
  try {
    spec = JSON.parse(files["spec.json"]);
  } catch {
    throw new AgentSpecError(["spec.json: invalid JSON"]);
  }
  const specErrors = validateAgentSpec(spec);
  if (specErrors.length) throw new AgentSpecError(specErrors);
  return { frontmatter, spec: spec as AgentSpecV1 };
}
