import { describe, expect, it } from "vitest";
import { demoLifeMap, emptyLifeMap, isWithinQuietHours, validateLifeMap } from "../src";

describe("validateLifeMap", () => {
  it("accepts the demo and empty profiles", () => {
    expect(validateLifeMap(demoLifeMap)).toEqual([]);
    expect(validateLifeMap(emptyLifeMap())).toEqual([]);
  });

  it("rejects out-of-range scores and unknown capabilities", () => {
    const broken = structuredClone(demoLifeMap);
    broken.assessments[0]!.importance = 11;
    (broken.boundaries.forbiddenCapabilities as string[]).push("launch_rockets");
    expect(validateLifeMap(broken)).toEqual([
      "assessments[0].importance must be an integer 0–10",
      "boundaries.forbiddenCapabilities contains an unknown capability",
    ]);
  });
});

describe("isWithinQuietHours", () => {
  const quiet = { start: "22:00", end: "07:00" };
  const tz = "America/Sao_Paulo";

  it("handles windows that cross midnight", () => {
    expect(isWithinQuietHours("2026-03-09T23:30:00-03:00", quiet, tz)).toBe(true);
    expect(isWithinQuietHours("2026-03-10T06:59:00-03:00", quiet, tz)).toBe(true);
    expect(isWithinQuietHours("2026-03-10T07:00:00-03:00", quiet, tz)).toBe(false);
    expect(isWithinQuietHours("2026-03-10T21:59:00-03:00", quiet, tz)).toBe(false);
  });

  it("uses the owner's time zone, not the host's", () => {
    // 01:30 UTC is 22:30 in São Paulo.
    expect(isWithinQuietHours("2026-03-10T01:30:00Z", quiet, tz)).toBe(true);
  });
});
