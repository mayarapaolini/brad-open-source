import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createApiServer } from "./server";
import { Store } from "./store";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const dataDir = process.env.BRAD_DATA_DIR ? resolve(process.env.BRAD_DATA_DIR) : join(root, ".brad");
const port = Number(process.env.BRAD_API_PORT ?? 4317);
const staticDir = join(root, "apps", "studio", "dist");

const store = new Store(join(dataDir, "brad.db"));
const server = createApiServer(store, { staticDir: existsSync(staticDir) ? staticDir : undefined });

// Bind to loopback only: Brad is never reachable from the network.
server.listen(port, "127.0.0.1", () => {
  console.log(`Brad API listening on http://127.0.0.1:${port} (data: ${dataDir})`);
});

function shutdown(): void {
  server.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
