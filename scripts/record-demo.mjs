// Drives the built Studio end to end with synthetic data, checks the key outcomes and
// writes docs/assets/demo.gif (pass --no-gif to only run the checks). Requires
// `pnpm build` first and a Playwright Chromium (`pnpm exec playwright install chromium`).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gifenc from "gifenc";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "docs/assets/demo.gif";
const writeGif = !process.argv.includes("--no-gif");
const dataDir = mkdtempSync(join(tmpdir(), "brad-demo-"));

const api = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/main.ts"], {
  cwd: "apps/api",
  env: { ...process.env, BRAD_API_PORT: String(PORT), BRAD_DATA_DIR: dataDir },
  stdio: "inherit",
  detached: true,
});

function stop() {
  try {
    process.kill(-api.pid, "SIGTERM");
  } catch {
    // already gone
  }
  rmSync(dataDir, { recursive: true, force: true });
}

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("API did not start");
}

function assert(condition, message) {
  if (!condition) throw new Error(`Demo check failed: ${message}`);
  console.log(`✓ ${message}`);
}

const frames = [];
async function capture(page, delay = 1800) {
  await page.waitForTimeout(150);
  const buffer = await page.screenshot();
  if (process.env.DEMO_FRAMES_DIR) writeFileSync(join(process.env.DEMO_FRAMES_DIR, `frame-${frames.length}.png`), buffer);
  frames.push({ png: PNG.sync.read(buffer), delay });
}

try {
  await waitForApi();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: "en-GB" });
  await page.goto(BASE);
  await page.getByTestId("lang-en").click();
  await capture(page, 1200);

  await page.getByTestId("load-demo").click();
  await page.waitForSelector("text=Saved locally");
  await capture(page, 2200);

  await page.getByTestId("step-lifeMap").click();
  await capture(page, 1800);

  await page.getByTestId("step-agents").click();
  await page.getByTestId("generate-agents").click();
  const cards = page.getByTestId("agent-card");
  await cards.first().waitFor();
  assert((await cards.count()) === 6, "six draft agents are proposed for the demo profile");
  assert((await page.locator(".badge.state-draft").count()) === 6, "every agent starts as a draft");
  await capture(page, 2200);

  await page.getByTestId("step-simulation").click();
  await page.getByTestId("run-simulation").click();
  const first = page.getByTestId("ranked-item").first();
  await first.waitFor();
  assert((await first.innerText()).includes("Noa has a fever"), "the family message is ranked first");
  assert((await first.innerText()).includes("Sam Rivera is your partner"), "the ranking explains why");
  await capture(page, 3200);

  await page.getByTestId("evaluate-policy").click();
  await page.getByTestId("policy-decision").waitFor();
  assert((await page.getByTestId("policy-decision").innerText()).includes("Denied"), "a draft agent cannot send messages");
  await page.getByTestId("policy-decision").scrollIntoViewIfNeeded();
  await capture(page, 2600);

  await page.getByTestId("assume-approved").check();
  await page.getByTestId("assume-grant").check();
  await page.getByTestId("evaluate-policy").click();
  await page.getByTestId("policy-decision").waitFor();
  assert(
    (await page.getByTestId("policy-decision").innerText()).includes("Needs your confirmation"),
    "an approved, granted agent still needs confirmation to send",
  );
  await page.getByTestId("policy-decision").scrollIntoViewIfNeeded();
  await capture(page, 2600);

  await page.getByTestId("lang-pt").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId("run-simulation").click();
  await page.getByTestId("ranked-item").first().waitFor();
  assert(
    (await page.getByTestId("ranked-item").first().innerText()).includes("A Noa está com febre"),
    "the interface switches to Portuguese",
  );
  await capture(page, 3000);

  await page.reload();
  const stored = await (await fetch(`${BASE}/api/lifemap`)).json();
  assert(stored.lifeMap?.owner.displayName === "Alex (demo)", "the life map is persisted in local SQLite");

  await browser.close();

  if (writeGif) {
    const { width, height } = frames[0].png;
    const gif = GIFEncoder();
    for (const { png, delay } of frames) {
      const palette = quantize(png.data, 256);
      gif.writeFrame(applyPalette(png.data, palette), width, height, { palette, delay });
    }
    gif.finish();
    writeFileSync(OUT, gif.bytes());
    console.log(`Wrote ${OUT} (${frames.length} frames)`);
  }
} finally {
  stop();
}
