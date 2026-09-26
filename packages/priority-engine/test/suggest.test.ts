import { describe, expect, it } from "vitest";
import { demoInbox, demoLifeMap, validateLifeMap } from "@brad/domain";
import { applyAdjustment, rankItems, suggestAdjustment } from "../src";

const ranked = rankItems(demoInbox, demoLifeMap);
const find = (id: string) => ranked.find((r) => r.item.id === id)!;

describe("suggestAdjustment", () => {
  it("lets a quiet-hours sender through when their message should be Now", () => {
    const manager = find("i-manager");
    expect(manager).toMatchObject({ score: 61, tier: "today" });
    const s = suggestAdjustment(manager, "now", demoLifeMap);
    expect(s).toEqual({
      change: "allow_quiet_hours_bypass",
      params: { personId: "p-jordan", name: "Jordan Blake" },
      projected: { score: 86, tier: "now" },
    });
  });

  it("raises a known sender's priority one step", () => {
    const s = suggestAdjustment(find("i-colleague"), "now", demoLifeMap);
    expect(s).toMatchObject({ change: "raise_person_priority", params: { from: 3, to: 4 }, projected: { score: 76 } });
  });

  it("raises domain importance when the sender is already at the top", () => {
    const map = structuredClone(demoLifeMap);
    map.people.find((p) => p.id === "p-riley")!.priority = 5;
    const friend = rankItems(demoInbox, map).find((r) => r.item.id === "i-friend")!;
    expect(friend).toMatchObject({ score: 76, tier: "today" });
    expect(suggestAdjustment(friend, "now", map)).toMatchObject({
      change: "raise_domain_importance",
      params: { domain: "social", from: 6, to: 7 },
      projected: { score: 80, tier: "now" },
    });
  });

  it("asks to add unknown senders, without projecting", () => {
    const map = structuredClone(demoLifeMap);
    map.assessments.find((a) => a.domain === "work")!.importance = 10;
    const newsletter = rankItems(demoInbox, map).find((r) => r.item.id === "i-newsletter")!;
    expect(suggestAdjustment(newsletter, "today", map)).toEqual({
      change: "add_person",
      params: { address: "news@industry-digest.example", domain: "work" },
      projected: null,
    });
  });

  it("lowers priority, then removes a bypass, when an item should rank lower", () => {
    expect(suggestAdjustment(find("i-family"), "today", demoLifeMap)).toMatchObject({
      change: "lower_person_priority",
      params: { name: "Sam Rivera", from: 5, to: 4 },
      projected: { score: 98, tier: "now" },
    });
    const map = structuredClone(demoLifeMap);
    map.people.find((p) => p.id === "p-sam")!.priority = 1;
    const family = rankItems(demoInbox, map).find((r) => r.item.id === "i-family")!;
    expect(suggestAdjustment(family, "later", map)).toMatchObject({ change: "remove_quiet_hours_bypass" });
  });

  it("returns null when the tier is already the expected one", () => {
    expect(suggestAdjustment(find("i-family"), "now", demoLifeMap)).toBeNull();
  });

  it("is deterministic", () => {
    expect(suggestAdjustment(find("i-manager"), "now", structuredClone(demoLifeMap))).toEqual(
      suggestAdjustment(find("i-manager"), "now", demoLifeMap),
    );
  });
});

describe("applyAdjustment", () => {
  it("changes only the suggested field and keeps the map valid", () => {
    const s = suggestAdjustment(find("i-manager"), "now", demoLifeMap)!;
    const next = applyAdjustment(demoLifeMap, s);
    expect(validateLifeMap(next)).toEqual([]);
    expect(next.people.find((p) => p.id === "p-jordan")!.bypassQuietHours).toBe(true);
    expect(demoLifeMap.people.find((p) => p.id === "p-jordan")!.bypassQuietHours).toBe(false);
    expect(rankItems(demoInbox, next).find((r) => r.item.id === "i-manager")).toMatchObject({ score: 86, tier: "now" });
  });

  it("refuses manual changes", () => {
    expect(() =>
      applyAdjustment(demoLifeMap, { change: "add_person", params: { address: "x", domain: "work" }, projected: null }),
    ).toThrow("manual");
  });
});
