import { describe, expect, it } from "vitest";
import type { AgentDefinition, ConsentGrant } from "@brad/domain";
import {
  FakeInkus,
  capabilitiesFromSpec,
  domainFromSpec,
  activateDraft,
  exportAgentToInkus,
  seedDemoInkus,
  specFromAgent,
  syncWithInkus,
  type SyncInput,
} from "../src";

const NOW = "2026-03-10T08:30:00-03:00";
const displayName = (a: AgentDefinition) => a.name || `${a.domain ?? "cross-cutting"} agent`;

async function run(fake: FakeInkus, agents: AgentDefinition[], extra: Partial<SyncInput> = {}) {
  return syncWithInkus({ agents, grants: [], forbidden: ["make_payment"], client: fake, now: NOW, displayName, ...extra });
}

describe("mapping", () => {
  it("maps Portuguese domain labels and falls back to cross-cutting", () => {
    expect(domainFromSpec({ knowledge_domains: ["família e cuidado"] })).toBe("family");
    expect(domainFromSpec({ knowledge_domains: ["Saúde física"] })).toBe("health");
    expect(domainFromSpec({ scope: "Domínio principal: finanças pessoais. Atua…" })).toBe("finances");
    expect(domainFromSpec({ scope: "Domínio family. Objetivo informado…" })).toBe("family");
    expect(domainFromSpec({ knowledge_domains: ["privacidade e governança"] })).toBeNull();
    expect(domainFromSpec({ knowledge_domains: ["família"], capabilities: { brad: { domain: "work" } } })).toBe("work");
    expect(domainFromSpec({ knowledge_domains: ["família"], capabilities: { brad: { domain: null } } })).toBeNull();
  });

  it("only trusts Brad's own namespace for capabilities", () => {
    expect(capabilitiesFromSpec({ capabilities: { default_access: "allow", send_message: true } })).toEqual([]);
    expect(capabilitiesFromSpec({ capabilities: { brad: { requested: ["draft_reply", "launch_rockets", "draft_reply"] } } })).toEqual([
      "draft_reply",
    ]);
  });

  it("keeps Inkus-only fields when writing back", () => {
    const agent = {
      id: "inkus-a",
      name: "Demo Family",
      domain: "family",
      state: "approved",
      goal: "New mission",
      responsibilities: ["One"],
      reason: "imported",
      requestedCapabilities: ["draft_reply"],
      excludedByBoundary: [],
      escalation: "ask_owner",
      inkus: {
        actorId: "a",
        specId: "s",
        specVersion: 2,
        syncedAt: NOW,
        syncedRevision: 0,
        passthrough: { prompt: "keep me", temperature: 0.2, capabilities: { default_access: "deny" } },
      },
    } as AgentDefinition;
    expect(specFromAgent(agent, "Demo Family")).toMatchObject({
      mission: "New mission",
      prompt: "keep me",
      temperature: 0.2,
      capabilities: { default_access: "deny", brad: { requested: ["draft_reply"], domain: "family", state: "approved" } },
    });
  });
});

describe("syncWithInkus", () => {
  it("imports every live Inkus agent as a draft with no permissions, and never a deprecated one", async () => {
    const fake = await seedDemoInkus();
    const { agents, report } = await run(fake, []);
    expect(report.imported).toHaveLength(4);
    expect(agents.some((a) => a.name === "Demo Legacy Writer")).toBe(false);
    expect(agents.every((a) => a.state === "draft" && a.origin === "inkus" && a.requestedCapabilities.length === 0)).toBe(true);
    const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
    expect(byName["Demo Family"]?.domain).toBe("family");
    expect(byName["Demo Life Orchestrator"]?.domain).toBeNull();
    // Nothing was pushed back: the imported copies are in sync.
    expect(report.pushed).toEqual([]);
  });

  it("pushes local edits as a new draft version, never activates it, and never creates Inkus agents on its own", async () => {
    const fake = await seedDemoInkus();
    const first = await run(fake, []);
    const family = first.agents.find((a) => a.name === "Demo Family")!;
    const edited: AgentDefinition = { ...family, goal: "Edited in Brad", requestedCapabilities: ["draft_reply"], revision: 1 };
    const bradOnly: AgentDefinition = {
      id: "agent-work",
      domain: "work",
      state: "draft",
      goal: "Ship the roadmap",
      reason: "importance",
      requestedCapabilities: ["read_messages"],
      excludedByBoundary: [],
      escalation: "ask_owner",
      origin: "generated",
      revision: 0,
    };
    const actorsBefore = fake.actors.length;
    const others = first.agents.filter((a) => a.id !== family.id);
    const second = await run(fake, [...others, edited, bradOnly]);

    expect(second.report.pushed).toEqual([family.id]);
    expect(fake.actors.length).toBe(actorsBefore);
    // The active version (what Hermes runs) is untouched; the edit waits as a draft.
    expect(await fake.getActiveSpec(family.inkus!.actorId)).toMatchObject({ status: "active", mission: family.goal });
    const draftSpec = fake.specs.find((s) => s.actor_id === family.inkus!.actorId && s.status === "draft")!;
    expect(draftSpec).toMatchObject({ mission: "Edited in Brad" });
    expect((draftSpec.capabilities as { brad: { requested: string[] } }).brad.requested).toEqual(["draft_reply"]);
    const drafted = second.agents.find((a) => a.id === family.id)!;
    expect(drafted.inkus).toMatchObject({ syncedRevision: 0, draft: { specId: draftSpec.id, revision: 1 } });

    // Syncing again neither re-drafts nor pulls the older active version over the edit.
    const again = await run(fake, second.agents);
    expect([...again.report.pushed, ...again.report.updated]).toEqual([]);

    // Activation is an explicit owner action.
    const active = await activateDraft(fake, drafted, NOW);
    expect(await fake.getActiveSpec(family.inkus!.actorId)).toMatchObject({ status: "active", mission: "Edited in Brad" });
    expect(active.inkus).toMatchObject({ specId: draftSpec.id, syncedRevision: 1 });
    expect(active.inkus!.draft).toBeUndefined();

    // Explicit export creates the actor once, with a draft first version.
    const exported = await exportAgentToInkus(fake, bradOnly, "Brad Work", NOW);
    expect(fake.actors.length).toBe(actorsBefore + 1);
    expect(await fake.getActiveSpec(exported.inkus!.actorId)).toMatchObject({ status: "draft", mission: "Ship the roadmap" });
    await expect(exportAgentToInkus(fake, exported, "Brad Work", NOW)).rejects.toThrow("already linked");

    const third = await run(fake, [...again.agents.filter((a) => a.id !== family.id), active, exported]);
    expect([...third.report.pushed, ...third.report.updated, ...third.report.imported]).toEqual([]);
  });

  it("notices when the owner activates Brad's draft directly in Inkus", async () => {
    const fake = await seedDemoInkus();
    const first = await run(fake, []);
    const family = first.agents.find((a) => a.name === "Demo Family")!;
    const second = await run(fake, [...first.agents.filter((a) => a.id !== family.id), { ...family, goal: "Draft me", revision: 1 }]);
    const draftId = second.agents.find((a) => a.id === family.id)!.inkus!.draft!.specId;
    await fake.activateSpec(draftId);
    const third = await run(fake, second.agents);
    expect(third.report).toMatchObject({ activated: [family.id], updated: [], overwritten: [] });
    expect(third.agents.find((a) => a.id === family.id)!.inkus).toMatchObject({ specId: draftId, syncedRevision: 1 });
  });

  it("links a Brad agent to the Inkus agent of the same domain instead of duplicating it", async () => {
    const fake = await seedDemoInkus();
    const generated: AgentDefinition = {
      id: "agent-family",
      domain: "family",
      state: "approved",
      goal: "Local goal",
      reason: "importance",
      requestedCapabilities: [],
      excludedByBoundary: [],
      escalation: "ask_owner",
      origin: "generated",
      revision: 0,
    };
    const { agents, report } = await run(fake, [generated]);
    expect(report.adopted).toEqual(["agent-family"]);
    expect(report.imported).toHaveLength(3);
    const family = agents.find((a) => a.id === "agent-family")!;
    expect(family).toMatchObject({ state: "approved", goal: "Coordinate family routines and school events.", origin: "generated" });
    expect(family.inkus?.actorId).toBe(fake.actors.find((a) => a.name === "Demo Family")!.id);
  });

  it("retires agents whose Inkus versions were all deprecated, revoking their grants", async () => {
    const fake = await seedDemoInkus();
    const first = await run(fake, []);
    const health = first.agents.find((a) => a.name === "Demo Physical Health")!;
    const grant: ConsentGrant = {
      id: "g-h",
      agentId: health.id,
      capability: "read_calendar",
      purpose: "test",
      issuedAt: NOW,
      expiresAt: "2026-12-31T00:00:00Z",
      revokedAt: null,
    };
    fake.deprecateAll(health.inkus!.actorId);
    const { agents, report, revokeGrantIds } = await run(fake, first.agents, { grants: [grant] });
    expect(report.retired).toEqual([health.id]);
    expect(agents.find((a) => a.id === health.id)?.state).toBe("archived");
    expect(revokeGrantIds).toEqual(["g-h"]);
  });

  it("applies Inkus edits directly, keeps local state, and reports overwritten local edits", async () => {
    const fake = await seedDemoInkus();
    const first = await run(fake, []);
    const family = first.agents.find((a) => a.name === "Demo Family")!;
    const localEdit: AgentDefinition = { ...family, state: "approved", goal: "Local edit", revision: 1 };
    await fake.editInInkus(family.inkus!.actorId, { mission: "Inkus edit" });

    const { agents, report } = await run(fake, [...first.agents.filter((a) => a.id !== family.id), localEdit]);
    const result = agents.find((a) => a.id === family.id)!;
    expect(result.goal).toBe("Inkus edit");
    expect(result.state).toBe("approved");
    expect(report.overwritten).toEqual([{ agentId: family.id, fields: ["goal"] }]);
    // The Inkus version won, so there is nothing to push back.
    expect(report.pushed).toEqual([]);
  });

  it("revokes grants for capabilities Inkus no longer requests, and never grants new ones", async () => {
    const fake = await seedDemoInkus();
    const actor = fake.actors[0]!;
    await fake.editInInkus(actor.id, { capabilities: { brad: { requested: ["draft_reply", "read_messages"] } } });
    const first = await run(fake, []);
    const agent = first.agents.find((a) => a.inkus?.actorId === actor.id)!;
    const grant: ConsentGrant = {
      id: "g-1",
      agentId: agent.id,
      capability: "read_messages",
      purpose: "test",
      issuedAt: NOW,
      expiresAt: "2026-12-31T00:00:00Z",
      revokedAt: null,
    };
    await fake.editInInkus(actor.id, { capabilities: { brad: { requested: ["draft_reply", "send_message"] } } });
    const { agents, revokeGrantIds } = await run(fake, first.agents, { grants: [grant] });
    expect(revokeGrantIds).toEqual(["g-1"]);
    expect(agents.find((a) => a.id === agent.id)?.requestedCapabilities).toEqual(["draft_reply", "send_message"]);
  });

  it("drops capabilities the owner forbids, even when Inkus requests them", async () => {
    const fake = await seedDemoInkus();
    await fake.editInInkus(fake.actors[0]!.id, { capabilities: { brad: { requested: ["make_payment", "read_notes"] } } });
    const { agents } = await run(fake, []);
    const agent = agents.find((a) => a.inkus?.actorId === fake.actors[0]!.id)!;
    expect(agent.requestedCapabilities).toEqual(["read_notes"]);
    expect(agent.excludedByBoundary).toEqual(["make_payment"]);
  });

  it("reports per-agent errors without aborting the sync", async () => {
    const fake = await seedDemoInkus();
    const broken = new Proxy(fake, {
      get(target, prop, receiver) {
        if (prop === "getActiveSpec")
          return async (id: string) => {
            if (id === target.actors.find((a) => a.name === "Demo Family")!.id) throw new Error("boom");
            return target.getActiveSpec(id);
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    const { report } = await run(broken, []);
    expect(report.imported).toHaveLength(3);
    const family = fake.actors.find((a) => a.name === "Demo Family")!;
    expect(report.errors).toEqual([{ agentId: `inkus-${family.id}`, message: "boom" }]);
  });
});
