import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCatalogRecords, type InkusClient } from "@brad/adapter-inkus";
import { dataDirFrom, dbPath, inkusFrom } from "@brad/api/config";
import { TransferError, exportData, importData, previewImport } from "@brad/api/snapshot";
import { Store } from "@brad/api/store";
import { parseInkusCatalog } from "@brad/discovery";
import { AGENT_STATES, isGrantValid, validateExport, validateLifeMap } from "@brad/domain";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  /** Directory relative paths are resolved against (where the owner ran the command). */
  cwd: string;
}

/** Exit codes: 0 ok, 1 a problem, 2 needs a confirmation flag (nothing was changed). */
export const EXIT = { ok: 0, problem: 1, confirm: 2 } as const;

const HELP = `Brad CLI: operate the local store without the Studio.

Usage: pnpm brad <command> [options]

  validate <file>                 Check an export or a bare life map. Exit 1 on any problem.
  export [--out <file>]           Write your life map, agents and grants as JSON.
  import <file> [--yes] [--time-zone <zone>] [--force]
                                  Show what would change; apply only with --yes. Active agents
                                  arrive paused, and the previous version can be restored.
  doctor                          Where the data is and what it holds (counts only, no content).
  inkus check                     Read-only check of the Inkus connection: agents, question
                                  catalog, answers. Writes nothing.
  help                            This text.

Options:
  --data-dir <dir>                Local store (default: BRAD_DATA_DIR or .brad in the repository).`;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--")) {
      if (["--out", "--time-zone", "--data-dir"].includes(args[i]!)) i++;
      continue;
    }
    out.push(args[i]!);
  }
  return out;
}

function readJson(path: string, io: Io): unknown {
  return JSON.parse(readFileSync(resolve(io.cwd, path), "utf8"));
}

function openStore(args: string[], io: Io): { store: Store; path: string; existed: boolean } {
  const fromFlag = option(args, "--data-dir") ?? io.env.BRAD_DATA_DIR;
  const dir = fromFlag ? resolve(io.cwd, fromFlag) : dataDirFrom(io.env);
  const path = dbPath(dir);
  const existed = existsSync(path);
  return { store: new Store(path), path, existed };
}

function validate(file: string | undefined, io: Io): number {
  if (!file) {
    io.err("validate: missing <file>");
    return EXIT.problem;
  }
  let data: unknown;
  try {
    data = readJson(file, io);
  } catch (error) {
    io.err(`validate: cannot read JSON from ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.problem;
  }
  const isExport = typeof data === "object" && data !== null && "format" in data;
  const problems = isExport ? validateExport(data) : validateLifeMap(data);
  if (problems.length > 0) {
    io.err(`${file}: ${problems.length} problem(s) in this ${isExport ? "export" : "life map"}`);
    for (const p of problems) io.err(`  - ${p}`);
    return EXIT.problem;
  }
  io.out(`${file}: valid ${isExport ? "export" : "life map"}`);
  return EXIT.ok;
}

function exportCommand(args: string[], io: Io): number {
  const { store } = openStore(args, io);
  try {
    const json = JSON.stringify(exportData(store), null, 2);
    const out = option(args, "--out");
    if (out) {
      writeFileSync(resolve(io.cwd, out), `${json}\n`);
      io.err(`Exported to ${out}. It contains your life map: keep it private.`);
    } else {
      io.out(json);
    }
    return EXIT.ok;
  } catch (error) {
    if (error instanceof TransferError && error.code === "no_life_map") {
      io.err("export: there is no life map yet (run the diagnostic or load the demo profile first)");
      return EXIT.problem;
    }
    throw error;
  } finally {
    store.close();
  }
}

function importCommand(args: string[], io: Io): number {
  const file = positional(args)[1];
  if (!file) {
    io.err("import: missing <file>");
    return EXIT.problem;
  }
  const { store } = openStore(args, io);
  try {
    const data = readJson(file, io);
    const { plan, alreadyImported } = previewImport(store, data);
    io.out(`Import preview for ${file}:${plan.identical ? " nothing would change" : ""}`);
    io.out(`  area assessments changed: ${plan.assessments.length}`);
    io.out(`  people added/removed/changed: ${plan.people.added.length}/${plan.people.removed.length}/${plan.people.changed.length}`);
    io.out(`  boundaries changed: ${plan.boundariesChanged ? "yes" : "no"}`);
    io.out(`  agents added/removed/updated: ${plan.agents.added.length}/${plan.agents.removed.length}/${plan.agents.updated.length}`);
    io.out(`  grants added/removed: ${plan.grants.added}/${plan.grants.removed}`);
    for (const w of plan.warnings) io.out(`  warning: ${w}`);
    if (alreadyImported) io.out("  this exact file was already imported (use --force to apply it again)");
    if (!args.includes("--yes")) {
      io.err("Nothing changed. Re-run with --yes to apply.");
      return EXIT.confirm;
    }
    const { snapshotId } = importData(store, data, { timeZone: option(args, "--time-zone"), force: args.includes("--force") });
    io.out(`Imported. Active agents arrive paused. Previous version kept as v${snapshotId} (restore it in the Studio's Audit step).`);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof TransferError) {
      const hints: Record<TransferError["code"], string> = {
        no_life_map: "there is no life map",
        invalid_export: "the file is not a valid Brad export",
        already_imported: "this exact file was already imported; add --force to apply it again",
        invalid_time_zone: "unknown --time-zone",
        needs_timezone: "the file uses UTC; choose your zone with --time-zone (for example --time-zone Europe/Lisbon)",
      };
      io.err(`import: ${hints[error.code]}`);
      for (const d of error.details ?? []) io.err(`  - ${d}`);
      return EXIT.problem;
    }
    if (error instanceof SyntaxError) {
      io.err(`import: ${file} is not valid JSON`);
      return EXIT.problem;
    }
    throw error;
  } finally {
    store.close();
  }
}

function doctor(args: string[], io: Io): number {
  const { store, path, existed } = openStore(args, io);
  try {
    const now = new Date().toISOString();
    const agents = store.getAgents();
    const grants = store.getGrants();
    const answers = store.getAnswers();
    const byState = AGENT_STATES.map((s) => [s, agents.filter((a) => a.state === s).length] as const).filter(([, n]) => n > 0);
    const inkus = inkusFrom(io.env, () => undefined);
    io.out(`Database:        ${path}${existed ? "" : " (new, empty)"}`);
    io.out(`Schema version:  ${store.schemaVersion()}`);
    io.out(`Life map:        ${store.getLifeMap() ? "present" : "missing"}`);
    io.out(`Agents:          ${agents.length}${byState.length ? ` (${byState.map(([s, n]) => `${s} ${n}`).join(", ")})` : ""}`);
    io.out(`Inkus drafts:    ${agents.filter((a) => a.inkus?.draft).length} waiting for activation`);
    io.out(
      `Grants:          ${grants.filter((g) => isGrantValid(g, now)).length} valid, ${grants.filter((g) => g.revokedAt).length} revoked, ${
        grants.filter((g) => !g.revokedAt && !isGrantValid(g, now)).length
      } expired`,
    );
    io.out(`Answers:         ${answers.filter((a) => a.status !== "stale").length} current, ${answers.filter((a) => a.status === "stale").length} earlier versions`);
    io.out(`Questions from:  ${store.getSetting<string>("discovery.catalogSource", "builtin") === "inkus" ? "Inkus (local copy)" : "Brad (built-in)"}`);
    io.out(`Versions kept:   ${store.listSnapshots(1000).length}`);
    io.out(`Decisions:       ${store.countDecisions()}`);
    io.out(
      `Inkus adapter:   ${
        inkus
          ? `enabled${inkus.fake ? " (synthetic)" : ""}; questions db ${inkus.databases.questions ? "set" : "missing"}, answers db ${inkus.databases.answers ? "set" : "missing"}`
          : "disabled"
      }`,
    );
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/** Read-only check of the Inkus connection. Never writes; the token is never printed. */
async function inkusCheck(io: Io): Promise<number> {
  const warnings: string[] = [];
  const inkus = inkusFrom(io.env, (m) => warnings.push(m));
  if (!inkus) {
    io.err(warnings[0] ?? "Inkus adapter is disabled: set BRAD_ADAPTER_INKUS_ENABLED=true, BRAD_INKUS_MCP_URL and BRAD_INKUS_TOKEN.");
    return EXIT.problem;
  }
  let client: (InkusClient & { close?: () => Promise<void> }) | undefined;
  let problems = 0;
  try {
    client = await inkus.open();
    io.out(`Connected to Inkus${inkus.fake ? " (synthetic)" : ""}. Read-only: nothing will be written.`);
    const actors = (await client.listActors()).filter((a) => a.type === "ai");
    const statuses = { active: 0, draft: 0, deprecated: 0, none: 0 };
    for (const actor of actors) {
      const spec = await client.getActiveSpec(actor.id);
      statuses[spec ? spec.status : "none"] += 1;
    }
    io.out(`AI agents:       ${actors.length} (active ${statuses.active}, draft only ${statuses.draft}, retired ${statuses.deprecated}, no spec ${statuses.none})`);

    if (inkus.databases.questions) {
      const records = await loadCatalogRecords(client, inkus.databases.questions);
      const { catalog, errors } = parseInkusCatalog(records);
      io.out(`Questions:       ${catalog.questions.length} active of ${records.length} rows, ${errors.length} catalog problem(s)`);
      for (const e of errors) io.out(`  - ${e.questionId ?? "?"}: ${e.code}${e.detail ? ` (${e.detail})` : ""}`);
      if (catalog.questions.length === 0) problems += 1;
      if (inkus.databases.answers) {
        const rows = await client.listRecords(inkus.databases.answers);
        const scores = rows.filter((r) => String(r.fields.question_id ?? "").startsWith("assessment.")).length;
        const unknown = rows.filter((r) => {
          const q = String(r.fields.question_id ?? "");
          return !q.startsWith("assessment.") && !catalog.get(q);
        }).length;
        io.out(`Answers:         ${rows.length} rows (${scores} scores, ${rows.length - scores - unknown} answers, ${unknown} for questions not in the catalog)`);
      } else {
        io.out("Answers:         BRAD_INKUS_ANSWERS_DB not set");
      }
    } else {
      io.out("Questions:       BRAD_INKUS_QUESTIONS_DB not set");
    }
    return problems > 0 ? EXIT.problem : EXIT.ok;
  } catch (error) {
    io.err(`inkus check: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.problem;
  } finally {
    await client?.close?.();
  }
}

export async function run(argv: string[], io: Io): Promise<number> {
  const [command, sub] = positional(argv);
  switch (command) {
    case "validate":
      return validate(positional(argv)[1], io);
    case "export":
      return exportCommand(argv, io);
    case "import":
      return importCommand(argv, io);
    case "doctor":
      return doctor(argv, io);
    case "inkus":
      if (sub === "check") return inkusCheck(io);
      io.err("Usage: pnpm brad inkus check");
      return EXIT.problem;
    case undefined:
    case "help":
      io.out(HELP);
      return EXIT.ok;
    default:
      io.err(`Unknown command: ${command}\n`);
      io.err(HELP);
      return EXIT.problem;
  }
}
