import { describe, expect, it } from "vitest";
import { demoInbox, demoLifeMap, type IncomingItem } from "@brad/domain";
import { rankItems } from "../src";

describe("rankItems", () => {
  const ranked = rankItems(demoInbox, demoLifeMap);

  it("puts the family message first and explains why", () => {
    const top = ranked[0]!;
    expect(top.item.id).toBe("i-family");
    expect(top.tier).toBe("now");
    expect(top.explanation.map((c) => c.rule)).toEqual([
      "declared_urgency",
      "person_priority",
      "domain_weight",
      "quiet_hours_bypass",
    ]);
    expect(top.explanation.find((c) => c.rule === "person_priority")).toMatchObject({
      points: 60,
      params: { name: "Sam Rivera", relationship: "partner", priority: 5 },
    });
    expect(top.score).toBe(110);
  });

  it("ranks the family message above the work newsletter", () => {
    const ids = ranked.map((r) => r.item.id);
    expect(ids.indexOf("i-family")).toBeLessThan(ids.indexOf("i-newsletter"));
    expect(ids.at(-1)).toBe("i-newsletter");
  });

  it("downgrades quiet-hours messages unless the sender may bypass them", () => {
    const manager = ranked.find((r) => r.item.id === "i-manager")!;
    expect(manager.explanation.find((c) => c.rule === "quiet_hours")?.points).toBe(-25);

    const bypassOff = structuredClone(demoLifeMap);
    bypassOff.people.find((p) => p.id === "p-sam")!.bypassQuietHours = false;
    const family = rankItems(demoInbox, bypassOff).find((r) => r.item.id === "i-family")!;
    expect(family.score).toBe(85);
  });

  it("is stable regardless of input order", () => {
    const reversed = rankItems([...demoInbox].reverse(), demoLifeMap);
    expect(reversed.map((r) => r.item.id)).toEqual(ranked.map((r) => r.item.id));
    expect(ranked.map((r) => r.item.id)).toEqual([
      "i-family",
      "i-clinic",
      "i-colleague",
      "i-manager",
      "i-friend",
      "i-newsletter",
    ]);
  });

  it("breaks ties by age, then id", () => {
    const base: IncomingItem = { ...demoInbox[0]!, id: "b" };
    const same = { ...base, id: "a" };
    const older = { ...base, id: "z", receivedAt: "2026-03-10T07:00:00-03:00" };
    expect(rankItems([base, same, older], demoLifeMap).map((r) => r.item.id)).toEqual(["z", "a", "b"]);
  });
});
