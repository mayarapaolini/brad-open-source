import { createHash } from "node:crypto";
import {
  EXPORT_FORMAT,
  datedAssessments,
  planImport,
  validateExport,
  withTimeZone,
  type BradExport,
  type ImportPlan,
} from "@brad/domain";
import type { Store } from "./store";

/**
 * Export and import rules shared by the API and the CLI, so both behave the same way.
 * Errors carry a stable code; callers turn them into HTTP statuses or exit codes.
 */
export class TransferError extends Error {
  constructor(
    readonly code: "no_life_map" | "invalid_export" | "already_imported" | "invalid_time_zone" | "needs_timezone",
    readonly details?: string[],
  ) {
    super(code);
  }
}

export function exportData(store: Store): BradExport {
  const lifeMap = store.getLifeMap();
  if (!lifeMap) throw new TransferError("no_life_map");
  return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), lifeMap, agents: store.getAgents(), grants: store.getGrants() };
}

export function parseExport(input: unknown): BradExport {
  const errors = validateExport(input);
  if (errors.length > 0) throw new TransferError("invalid_export", errors);
  return input as BradExport;
}

/** Identity of an export's content (not its timestamp), so the same data is never applied twice by accident. */
export function contentHash(data: BradExport): string {
  return createHash("sha256").update(JSON.stringify([data.lifeMap, data.agents, data.grants])).digest("hex");
}

export function lastImportHash(store: Store): string | null {
  const last = store.listDecisions(500).find((d) => d.kind === "import" && (d.input as { hash?: string }).hash);
  return last ? ((last.input as { hash: string }).hash ?? null) : null;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** What an import would change, without changing anything. */
export function previewImport(store: Store, input: unknown): { plan: ImportPlan; hash: string; alreadyImported: boolean } {
  const data = parseExport(input);
  const plan = planImport({ lifeMap: store.getLifeMap(), agents: store.getAgents(), grants: store.getGrants() }, data);
  const hash = contentHash(data);
  return { plan, hash, alreadyImported: lastImportHash(store) === hash };
}

/**
 * Applies an export: refuses a repeated import unless forced, asks for a time zone when the
 * file says UTC, keeps a version to undo it, and never lets an imported agent keep acting
 * (active agents arrive paused). Recorded in the decision history.
 */
export function importData(store: Store, input: unknown, options: { timeZone?: string; force?: boolean } = {}): { snapshotId: number } {
  const data = parseExport(input);
  const hash = contentHash(data);
  if (options.force !== true && lastImportHash(store) === hash) throw new TransferError("already_imported");

  const fromZone = data.lifeMap.boundaries.timeZone;
  let lifeMap = datedAssessments(data.lifeMap, data.exportedAt);
  if (typeof options.timeZone === "string") {
    if (!isValidTimeZone(options.timeZone)) throw new TransferError("invalid_time_zone");
    lifeMap = withTimeZone(lifeMap, options.timeZone);
  } else if (fromZone === "UTC") {
    // UTC in a personal export is almost always a configuration mistake: ask before storing it.
    throw new TransferError("needs_timezone");
  }

  const snapshotId = store.createSnapshot("before_import");
  const agents = data.agents.map((a) => (a.state === "active" ? { ...a, state: "paused" as const } : a));
  store.replaceAll(lifeMap, agents, data.grants);
  store.addDecision(
    "import",
    { exportedAt: data.exportedAt, hash, snapshotId, timeZoneFrom: fromZone, timeZoneTo: lifeMap.boundaries.timeZone },
    { agents: agents.length, grants: data.grants.length },
  );
  return { snapshotId };
}
