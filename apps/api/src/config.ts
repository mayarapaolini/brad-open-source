import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { DEMO_ANSWERS_DB, DEMO_QUESTIONS_DB, FakeInkus, connectInkus, seedDemoInkus, type InkusClient } from "@brad/adapter-inkus";

/** Repository root, so the API and the CLI find the same local data. */
export const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** Where the local store lives: BRAD_DATA_DIR, or `.brad` in the repository. */
export function dataDirFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAD_DATA_DIR ? resolve(env.BRAD_DATA_DIR) : join(repoRoot, ".brad");
}

export function dbPath(dataDir: string): string {
  return join(dataDir, "brad.db");
}

export interface InkusConfig {
  open: () => Promise<InkusClient & { close?: () => Promise<void> }>;
  fake: boolean;
  databases: { questions?: string; answers?: string };
}

/**
 * The Inkus adapter is off unless explicitly enabled. Credentials come from the environment
 * (or a keychain wrapper that exports them); they are never read from files in the repo.
 * BRAD_INKUS_FAKE=1 uses an in-memory Inkus with synthetic data, for demos and tests.
 */
export function inkusFrom(env: NodeJS.ProcessEnv = process.env, warn: (message: string) => void = console.warn): InkusConfig | undefined {
  if (env.BRAD_ADAPTER_INKUS_ENABLED !== "true") return undefined;
  const fake = env.BRAD_INKUS_FAKE === "1";
  const databases = {
    questions: env.BRAD_INKUS_QUESTIONS_DB ?? (fake ? DEMO_QUESTIONS_DB : undefined),
    answers: env.BRAD_INKUS_ANSWERS_DB ?? (fake ? DEMO_ANSWERS_DB : undefined),
  };
  if (fake) {
    const seeded = seedDemoInkus(new FakeInkus());
    return { open: () => seeded, fake, databases };
  }
  const url = env.BRAD_INKUS_MCP_URL;
  const token = env.BRAD_INKUS_TOKEN;
  if (!url || !token) {
    warn("Inkus adapter enabled but BRAD_INKUS_MCP_URL or BRAD_INKUS_TOKEN is missing; it stays disabled.");
    return undefined;
  }
  return { open: () => connectInkus({ url, token }), fake, databases };
}
