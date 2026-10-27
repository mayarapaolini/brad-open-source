/**
 * Verification-first contract (PRD v0.2 §19, FR11/FR12, AC11/AC12): a learning is never
 * considered applied just because it was recalled or because the agent claims to have used it.
 * Something must actually be executed and its outcome checked against an objective criterion.
 */

export const VERIFICATION_STATUSES = ["pass", "fail", "indeterminate"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface VerificationResult {
  status: VerificationStatus;
  /** What was actually observed (inputs/outputs), never just a restated claim of success. */
  evidence: string;
  observedAt: string;
  agentVersion: string;
  runId: string;
}

/**
 * A synthetic regression fixture (PRD FR12): a task run once without the correction applied
 * (baseline) and once with it applied, decided by an objective comparison — never an LLM
 * grading its own output.
 */
export interface VerificationCase {
  id: string;
  before: () => Promise<unknown> | unknown;
  after: () => Promise<unknown> | unknown;
  isCorrect: (afterOutput: unknown, beforeOutput: unknown) => boolean;
}

/** Contract any Phase-1 verifier implements. A real pilot's runtime may supply a different one. */
export interface VerificationInterface {
  verify(testCase: VerificationCase, meta: { agentVersion: string; runId: string }): Promise<VerificationResult>;
}

/**
 * Reference implementation: deterministic, no model call, no self-report. Runs `before`/`after`
 * and applies `isCorrect`. A thrown error on either side is `indeterminate`, never `fail` — a
 * broken test harness is not evidence the correction doesn't work (PRD: distinguish failure to
 * verify from verified failure).
 */
export const syntheticRegressionVerifier: VerificationInterface = {
  async verify(testCase, meta) {
    const observedAt = new Date().toISOString();
    let before: unknown;
    let after: unknown;
    try {
      before = await testCase.before();
      after = await testCase.after();
    } catch (error) {
      return {
        status: "indeterminate",
        evidence: JSON.stringify({ case: testCase.id, error: error instanceof Error ? error.message : String(error) }),
        observedAt,
        ...meta,
      };
    }
    const status: VerificationStatus = testCase.isCorrect(after, before) ? "pass" : "fail";
    return { status, evidence: JSON.stringify({ case: testCase.id, before, after }), observedAt, ...meta };
  },
};
