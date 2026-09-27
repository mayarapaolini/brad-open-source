import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { DEMO_ANSWERS_DB, DEMO_QUESTIONS_DB, FakeInkus, connectInkus, seedDemoInkus } from "@brad/adapter-inkus";
import { createApiServer, type ServerOptions } from "./server";
import { Store } from "./store";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const dataDir = process.env.BRAD_DATA_DIR ? resolve(process.env.BRAD_DATA_DIR) : join(root, ".brad");
const port = Number(process.env.BRAD_API_PORT ?? 4317);
const staticDir = join(root, "apps", "studio", "dist");

/**
 * The Inkus adapter is off unless explicitly enabled. Credentials come from the environment
 * (or a keychain wrapper that exports them); they are never read from files in the repo.
 * BRAD_INKUS_FAKE=1 uses an in-memory Inkus with synthetic agents, for demos and tests.
 */
function inkusFromEnv(): ServerOptions["inkus"] {
  if (process.env.BRAD_ADAPTER_INKUS_ENABLED !== "true") return undefined;
  if (process.env.BRAD_INKUS_FAKE === "1") {
    const fake = seedDemoInkus(new FakeInkus());
    return () => fake;
  }
  const url = process.env.BRAD_INKUS_MCP_URL;
  const token = process.env.BRAD_INKUS_TOKEN;
  if (!url || !token) {
    console.warn("Inkus adapter enabled but BRAD_INKUS_MCP_URL or BRAD_INKUS_TOKEN is missing; it stays disabled.");
    return undefined;
  }
  return () => connectInkus({ url, token });
}

const inkus = inkusFromEnv();
// The interview databases in Inkus (question catalog and answers); ids come from the environment.
const fakeInkus = process.env.BRAD_INKUS_FAKE === "1";
const inkusDatabases = {
  questions: process.env.BRAD_INKUS_QUESTIONS_DB ?? (fakeInkus ? DEMO_QUESTIONS_DB : undefined),
  answers: process.env.BRAD_INKUS_ANSWERS_DB ?? (fakeInkus ? DEMO_ANSWERS_DB : undefined),
};
const store = new Store(join(dataDir, "brad.db"));
const server = createApiServer(store, { staticDir: existsSync(staticDir) ? staticDir : undefined, inkus, inkusDatabases });

// Bind to loopback only: Brad is never reachable from the network.
server.listen(port, "127.0.0.1", () => {
  console.log(`Brad API listening on http://127.0.0.1:${port} (data: ${dataDir})`);
  if (inkus) console.log(`Inkus adapter enabled${process.env.BRAD_INKUS_FAKE === "1" ? " (synthetic in-memory Inkus)" : ""}`);
});

function shutdown(): void {
  server.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
