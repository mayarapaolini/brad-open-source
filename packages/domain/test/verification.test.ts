import { describe, expect, it } from "vitest";
import { syntheticRegressionVerifier } from "../src";

const META = { agentVersion: "pilot-1", runId: "run-1" };

describe("syntheticRegressionVerifier", () => {
  it("passes when the corrected run matches the objective criterion", async () => {
    const result = await syntheticRegressionVerifier.verify(
      { id: "case-1", before: () => "wrong answer", after: () => "right answer", isCorrect: (after) => after === "right answer" },
      META,
    );
    expect(result).toMatchObject({ status: "pass", ...META });
    expect(JSON.parse(result.evidence)).toMatchObject({ case: "case-1", before: "wrong answer", after: "right answer" });
  });

  it("fails when the corrected run still doesn't satisfy the criterion", async () => {
    const result = await syntheticRegressionVerifier.verify(
      { id: "case-2", before: () => "wrong", after: () => "still wrong", isCorrect: (after) => after === "right" },
      META,
    );
    expect(result.status).toBe("fail");
  });

  it("never reports pass/fail for an irrelevant memory that doesn't change the output (negative test, PRD AC12)", async () => {
    // The "after" run here represents a task where the recalled memory does NOT apply; it must
    // not be scored as if the correction had been exercised.
    const result = await syntheticRegressionVerifier.verify(
      { id: "case-3", before: () => "baseline", after: () => "baseline", isCorrect: (after, before) => after !== before },
      META,
    );
    expect(result.status).toBe("fail");
  });

  it("is indeterminate, never fail, when the task itself cannot be executed", async () => {
    const result = await syntheticRegressionVerifier.verify(
      {
        id: "case-4",
        before: () => "ok",
        after: () => {
          throw new Error("pilot runtime unavailable");
        },
        isCorrect: () => true,
      },
      META,
    );
    expect(result.status).toBe("indeterminate");
    expect(result.evidence).toContain("pilot runtime unavailable");
  });
});
