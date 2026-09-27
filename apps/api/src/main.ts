import { existsSync } from "node:fs";
import { join } from "node:path";
import { dataDirFrom, dbPath, inkusFrom, repoRoot } from "./config";
import { createApiServer } from "./server";
import { Store } from "./store";

const dataDir = dataDirFrom();
const port = Number(process.env.BRAD_API_PORT ?? 4317);
const staticDir = join(repoRoot, "apps", "studio", "dist");

const inkus = inkusFrom();
const store = new Store(dbPath(dataDir));
const server = createApiServer(store, {
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  inkus: inkus?.open,
  inkusDatabases: inkus?.databases,
});

// Bind to loopback only: Brad is never reachable from the network.
server.listen(port, "127.0.0.1", () => {
  console.log(`Brad API listening on http://127.0.0.1:${port} (data: ${dataDir})`);
  if (inkus) console.log(`Inkus adapter enabled${inkus.fake ? " (synthetic in-memory Inkus)" : ""}`);
});

function shutdown(): void {
  server.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
