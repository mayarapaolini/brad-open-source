import { describe, expect, it } from "vitest";
import type { AgentDefinition, ConsentGrant } from "@brad/domain";
import {
  FakeInkus,
  capabilitiesFromSpec,
  domainFromSpec,
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
  it("imports every Inkus agent as a draft with no permissions", async () => {
    const fake = await seedDemoInkus();
    const { agents, report } = await run(fake, []);
    expect(report.imported).toHaveLength(4);
    expect(agents.every((a) => a.state === "draft" && a.origin === "inkus" && a.requestedCapabilities.length === 0)).toBe(true);
    const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
    expect(byName["Demo Family"]?.domain).toBe("family");
    expect(byName["Demo Life Orchestrator"]?.domain).toBeNull();
    // Nothing was pushed back: the imported copies are in sync.
    expect(report.pushed).toEqual([]);
  });

  it("pushes local edits as a new active version and creates actors for Brad-only agents", async () => {
    const fake = await seedDemoInkus();
    const first = await run(fake, []);
    const family = first.agents.find((a) => a.name === "Demo Family")!;
    const edited: AgentDefinition = { ...family, goal: "Edited in Brad", requestedCapabilities: ["draft_reply"], revision: 1 };
    const generated: AgentDefinition = {
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
    const others = first.agents.filter((a) => a.id !== family.id);
    const second = await run(fake, [...others, edited, generated]);

    expect(second.report.pushed).toEqual([family.id]);
    expect(second.report.created).toEqual(["agent-work"]);
    const spec = await fake.getActiveSpec(family.inkus!.actorId);
    expect(spec).toMatchObject({ version: 2, status: "active", mission: "Edited in Brad" });
    expect((spec!.capabilities as { brad: { requested: string[] } }).brad.requested).toEqual(["draft_reply"]);
    expect(second.agents.find((a) => a.id === family.id)?.inkus?.syncedRevision).toBe(1);

    // A third sync has nothing to do.
    const third = await run(fake, second.agents);
    expect([...third.report.pushed, ...third.report.created, ...third.report.updated]).toEqual([]);
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
            if (id === target.actors[0]!.id) throw new Error("boom");
            return target.getActiveSpec(id);
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    const { report } = await run(broken, []);
    expect(report.imported).toHaveLength(3);
    expect(report.errors).toEqual([{ agentId: `inkus-${fake.actors[0]!.id}`, message: "boom" }]);
  });
});
