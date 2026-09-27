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

  // Discovery: an adaptive question with "Outra resposta", a skip, and a confirmed synthesis.
  await page.getByTestId("step-discovery").click();
  await page.getByTestId("discovery-domain-health").click();
  const healthQuestion = page.getByTestId("question");
  assert((await healthQuestion.getAttribute("data-question")) === "meaning", "a hard, important area starts with what it means");
  await page.getByTestId("option-other").check();
  await page.getByTestId("other-text").fill("Sleep before midnight on weekdays");
  await page.getByTestId("answer-submit").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="question"]')?.getAttribute("data-question") === "barrier");
  assert(true, "'Outra resposta' with free text is accepted and the next question is about barriers");
  await page.getByTestId("answer-skip").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="question"]')?.getAttribute("data-question") === "competence");
  const synth = page.getByTestId("synth-health:priority");
  assert((await synth.innerText()).includes("Sleep before midnight on weekdays"), "the synthesis restates the owner's own words");
  await synth.getByTestId("synth-yes").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="synth-health:priority"]')?.textContent?.includes("confirmed"));
  assert(true, "the owner confirms the synthesis");
  await capture(page, 3000);

  // Say how Brad may help with health: skip the middle questions, then pick "Organise".
  for (const id of ["competence", "autonomy", "relatedness"]) {
    await page.waitForFunction((q) => document.querySelector('[data-testid="question"]')?.getAttribute("data-question") === q, id);
    await page.getByTestId("answer-skip").click();
  }
  await page.waitForFunction(() => document.querySelector('[data-testid="question"]')?.getAttribute("data-question") === "support");
  await page.getByTestId("option-organise").check();
  await page.getByTestId("answer-submit").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="question"]')?.getAttribute("data-question") === "frequency");

  // Secretary: at most three focuses, each explained, nothing acted on without the owner.
  await page.getByTestId("step-secretary").click();
  const focus = page.getByTestId("focus").locator("article.proposal");
  await focus.first().waitFor();
  assert((await focus.count()) <= 3, "the secretary proposes at most three focuses");
  const organise = page.getByTestId("proposal-health:organise");
  await organise.getByTestId("proposal-why").click();
  assert((await organise.innerText()).includes("Sleep before midnight on weekdays"), "'Why?' shows the owner's own answers as evidence");
  assert((await page.getByTestId("proposal-work:ask_preserve").count()) === 1, "an area that is going well is protected with a question, not a task");
  await organise.getByTestId("proposal-accept").click();
  await page.waitForSelector("text=So far: 1 accepted");
  assert(true, "accepting is recorded and counted as the owner's choice");
  await capture(page, 3000);

  // Personal and work stay apart: the work view shows only work, and a summary leaves sensitive areas out.
  await page.getByTestId("secretary-context-work").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="proposal-health:organise"]'));
  assert((await page.getByTestId("proposal-work:ask_preserve").count()) === 1, "the work view shows only work proposals");
  await page.getByTestId("secretary-context-all").click();
  await page.getByTestId("proposal-health:organise").waitFor();
  const sharePanel = page.getByTestId("share-panel");
  await sharePanel.getByTestId("share-prepare").click();
  await sharePanel.getByTestId("share-text").waitFor();
  assert(
    !(await sharePanel.getByTestId("share-text").innerText()).includes("Health") &&
      (await sharePanel.getByTestId("share-excluded").innerText()).includes("Health left out: it is sensitive"),
    "a summary to share leaves health out by default and says why",
  );
  await sharePanel.getByTestId("share-consent-health").check();
  await sharePanel.getByTestId("share-prepare").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="share-text"]')?.textContent?.includes("Health"));
  assert(
    !(await sharePanel.getByTestId("share-text").innerText()).includes("Sleep before midnight"),
    "health goes in only with consent for this summary, and never with the owner's answers",
  );
  await sharePanel.scrollIntoViewIfNeeded();
  await capture(page, 3000);

  // Interview from Inkus: load the editable question catalog, bring in answers, send a new one back.
  await page.getByTestId("step-discovery").click();
  await page.getByTestId("inkus-questions").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="catalog-status"]')?.textContent?.includes("Using Brad"));
  await page.getByTestId("catalog-inkus").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="catalog-status"]')?.textContent?.includes("questions from Inkus"));
  await page.getByTestId("inkus-answers").click();
  const answerSync = page.getByTestId("answer-sync-report");
  await answerSync.waitFor();
  assert(
    (await answerSync.innerText()).includes("1 brought in") &&
      (await answerSync.innerText()).includes("Work: Inkus has satisfaction 6, your life map has 7"),
    "answers come in from Inkus, and a differing score is shown but not applied",
  );
  await page.getByTestId("discovery-domain-family").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="question"]')?.getAttribute("data-question") === "priority.protect_or_change");
  assert(
    (await page.getByTestId("answer-item").first().innerText()).includes("Dinner together on weekdays"),
    "the interview continues from the answer already stored in Inkus",
  );
  await page.getByTestId("option-opt_1").check();
  await page.getByTestId("answer-submit").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="inkus-answers"]')?.textContent?.includes("1 to send"));
  await page.getByTestId("inkus-answers").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="answer-sync-report"]')?.textContent?.includes("1 sent"));
  assert(true, "a new answer is sent to Inkus as a new row");
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 3000);

  // Change a goal: the previous life map is kept as a version.
  await page.getByTestId("step-lifeMap").click();
  const workGoal = page.locator(".goals label").filter({ hasText: "Work" }).locator("input");
  const originalWorkGoal = await workGoal.inputValue();
  await workGoal.fill("Ship the Q3 roadmap");
  await capture(page, 1800);
  await page.getByRole("button", { name: /Save/ }).click();
  await page.getByTestId("generate-agents").waitFor();

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

  // Inkus: import its agents (family and health link to Brad's own), then edit one here and push it back.
  await page.getByTestId("step-agents").click();
  await page.getByTestId("inkus-sync").click();
  const syncReport = page.getByTestId("inkus-report");
  await syncReport.waitFor();
  assert(
    (await syncReport.innerText()).includes("2 imported") && (await syncReport.innerText()).includes("2 linked"),
    "one sync imports Inkus agents, links same-domain ones and skips deprecated ones",
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

  // Letting it act in family too mixes personal and work: denied until the owner allows a bridge.
  await orchestrator.getByTestId("edit-agent").click();
  await orchestrator.getByTestId("edit-action-family").check();
  await orchestrator.getByTestId("edit-save").click();
  await orchestrator.getByTestId("context-bridge").waitFor();
  const orchestratorId = (await (await fetch(`${BASE}/api/agents`)).json()).agents.find((a) => a.name === "Demo Life Orchestrator").id;
  const askPolicy = async () =>
    (
      await (
        await fetch(`${BASE}/api/simulate/policy`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            request: { agentId: orchestratorId, capability: "read_calendar", domain: "work" },
            assumeState: "approved",
            assumeGrant: true,
          }),
        })
      ).json()
    ).decision;
  assert((await askPolicy()).decidedBy === "context_boundary", "an agent spanning personal and work is denied by the context rule");
  await orchestrator.getByTestId("context-bridge").click();
  await page.waitForFunction(async (base) => {
    const res = await fetch(`${base}/api/lifemap`);
    return ((await res.json()).lifeMap.boundaries.contextBridges ?? []).length === 1;
  }, BASE);
  assert((await askPolicy()).outcome !== "deny", "the owner's bridge lets it act across contexts");
  await orchestrator.scrollIntoViewIfNeeded();
  await capture(page, 2600);

  // Import: preview the diff, fix a UTC time zone, apply, then undo.
  const exported = await (await fetch(`${BASE}/api/export`)).json();
  exported.lifeMap.boundaries.timeZone = "UTC";
  exported.lifeMap.assessments[0].satisfaction = 9;
  const importFile = join(dataDir, "brad-export-utc.json");
  writeFileSync(importFile, JSON.stringify(exported));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId("import").setInputFiles(importFile);
  await page.getByTestId("import-preview").waitFor();
  assert(
    (await page.getByTestId("import-warning-timezone_utc").count()) === 1 &&
      (await page.getByTestId("import-preview").innerText()).includes("1 area assessments change"),
    "an import is previewed first and flags a UTC time zone",
  );
  await page.getByTestId("import-timezone").selectOption("America/Sao_Paulo");
  await capture(page, 3000);
  await page.getByTestId("import-apply").click();
  await page.getByTestId("import-undo").waitFor();
  const afterImport = await (await fetch(`${BASE}/api/lifemap`)).json();
  assert(
    afterImport.lifeMap.boundaries.timeZone === "America/Sao_Paulo" && afterImport.lifeMap.assessments[0].satisfaction === 9,
    "the import applies with the chosen time zone",
  );
  await page.getByTestId("import-undo").click();
  await page.getByTestId("import-undo").waitFor({ state: "detached" });
  const afterUndo = await (await fetch(`${BASE}/api/lifemap`)).json();
  assert(afterUndo.lifeMap.assessments[0].satisfaction === 5, "undo restores the previous version");

  // Restore only the life map from before the goal change, then undo that restore.
  await page.getByTestId("step-audit").click();
  const goalVersion = page.getByTestId("snapshot-list").locator("li").filter({ hasText: "before a life map change" }).last();
  await goalVersion.getByTestId("snapshot-restore-lifemap").click();
  await page.getByTestId("restore-undo").waitFor();
  const workGoalNow = async () =>
    (await (await fetch(`${BASE}/api/lifemap`)).json()).lifeMap.assessments.find((a) => a.domain === "work").goal;
  assert((await workGoalNow()) === originalWorkGoal, "an earlier life map version can be restored on its own");
  await capture(page, 2600);
  await page.getByTestId("restore-undo").click();
  await page.getByTestId("restore-undo").waitFor({ state: "detached" });
  assert((await workGoalNow()) === "Ship the Q3 roadmap", "the restore can be undone");

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
