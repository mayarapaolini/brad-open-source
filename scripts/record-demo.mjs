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
  // Synthetic in-memory Inkus: the sync flow is exercised without any real account.
  env: {
    ...process.env,
    BRAD_API_PORT: String(PORT),
    BRAD_DATA_DIR: dataDir,
    BRAD_ADAPTER_INKUS_ENABLED: "true",
    BRAD_INKUS_FAKE: "1",
  },
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
  const cards = page.locator("article.card.agent");
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

  // Correction loop: the manager's late email should be "Now".
  const manager = page.getByTestId("ranked-item").filter({ hasText: "Q2 deck" });
  await manager.locator(".item-head").click();
  await manager.getByTestId("should-be-now").click();
  const suggestion = manager.getByTestId("suggestion");
  await suggestion.waitFor();
  const suggestionText = await suggestion.innerText();
  assert(
    suggestionText.includes("Let Jordan Blake interrupt quiet hours") && suggestionText.includes("61 → 86"),
    "marking an item as misranked suggests one change and shows its effect",
  );
  await manager.scrollIntoViewIfNeeded();
  await capture(page, 3000);
  await manager.getByTestId("apply-suggestion").click();
  await manager.locator(".applied").waitFor();
  assert((await manager.locator(".badge.tier").innerText()) === "Now", "applying the suggestion moves the item to Now");
  await capture(page, 2400);

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

  // Governance: walk the family agent to active, then revoke its permission.
  const family = page.getByTestId("agent-agent-family");
  const familyState = family.getByTestId("agent-state");
  await page.getByTestId("step-agents").click();
  for (const [to, label] of [
    ["configured", "configured"],
    ["simulated", "simulated"],
    ["approved", "approved"],
    ["active", "active"],
  ]) {
    await family.getByTestId(`move-${to}`).click();
    await page.waitForFunction(
      ([sel, text]) => document.querySelector(sel)?.textContent === text,
      ['[data-testid="agent-agent-family"] [data-testid="agent-state"]', label],
    );
  }
  assert((await familyState.innerText()) === "active", "the family agent can be configured, simulated, approved and activated");
  await family.scrollIntoViewIfNeeded();
  await capture(page, 2600);

  const allowedOrDenied = async () => {
    await page.getByTestId("step-simulation").click();
    await page.getByTestId("policy-capability").selectOption("draft_reply");
    await page.getByTestId("evaluate-policy").click();
    await page.getByTestId("policy-decision").waitFor();
    await page.getByTestId("policy-decision").scrollIntoViewIfNeeded();
    return page.getByTestId("policy-decision").innerText();
  };
  assert((await allowedOrDenied()).includes("Allowed"), "an active agent with a current grant may draft replies");
  await capture(page, 2200);

  await page.getByTestId("step-agents").click();
  await family.getByTestId("revoke-draft_reply").click();
  await family.getByTestId("grant-draft_reply").waitFor();
  assert((await allowedOrDenied()).includes("Denied"), "revoking the grant denies the action immediately");

  await page.getByTestId("step-audit").click();
  await page.getByTestId("audit-item").first().waitFor();
  const audit = await page.getByTestId("audit-list").innerText();
  assert(
    audit.includes("Family agent: approved → active") &&
      audit.includes("Revoked Family agent's permission to draft replies") &&
      audit.includes("Applied: Let Jordan Blake interrupt quiet hours"),
    "the audit history records corrections, lifecycle and permission changes",
  );
  await capture(page, 2600);

  // Inkus: import its agents, export Brad's, then edit one here and push it back.
  await page.getByTestId("step-agents").click();
  await page.getByTestId("inkus-sync").click();
  const syncReport = page.getByTestId("inkus-report");
  await syncReport.waitFor();
  assert(
    (await syncReport.innerText()).includes("4 imported") && (await syncReport.innerText()).includes("6 created in Inkus"),
    "one sync imports the Inkus agents and exports Brad's agents",
  );
  const orchestrator = page.locator("article.card.agent").filter({ hasText: "Demo Life Orchestrator" });
  assert(
    (await orchestrator.innerText()).includes("no area yet (denied everywhere)"),
    "a cross-cutting Inkus agent may act nowhere until the owner allows it",
  );
  await orchestrator.getByTestId("edit-agent").click();
  await orchestrator.getByTestId("edit-action-work").check();
  await orchestrator.getByTestId("edit-save").click();
  await orchestrator.locator(".badge.unsynced").waitFor();
  await orchestrator.scrollIntoViewIfNeeded();
  await capture(page, 2600);
  await page.getByTestId("inkus-sync").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="inkus-report"]')?.textContent?.includes("1 pushed"));
  assert((await orchestrator.innerText()).includes("May act in: Work"), "an edit made in Brad is pushed to Inkus");
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 2600);

  await page.getByTestId("lang-pt").click();
  await page.getByTestId("step-simulation").click();
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
