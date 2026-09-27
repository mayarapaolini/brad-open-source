# ADR 0001: Deterministic policy engine

- **Status:** accepted
- **Date:** 2026-09-26
- **Code:** `packages/policy-engine/src/index.ts`, `packages/domain/src/lifecycle.ts`

## Context

Brad decides whether an agent may act on someone's personal life: read messages, draft replies, create events. That decision must be trustworthy in three ways:

- **Predictable:** the same request in the same state always gets the same answer.
- **Explainable:** the owner can see exactly why an action was allowed, denied or held for confirmation.
- **Testable:** every rule can be exercised by a unit test.

A language model in this path would make answers vary between runs, hard to explain precisely, and open to manipulation through the content it reads (prompt injection from an email is enough to talk a model into "allow").

## Decision

Authorization is a pure function, `evaluate(request, { agents, grants, boundaries, now })`. It has no LLM, network or I/O, and `now` is passed in by the caller.

- It evaluates **9 rules in a fixed order**:
  1. `agent_known`
  2. `forbidden_capability`
  3. `agent_state`
  4. `domain_scope`
  5. `context_boundary` (added later: personal and work stay apart. An agent whose domains span both contexts, or that acts outside its own context, is denied unless the owner lists it in `contextBridges`. Work and study are the work context by default, and the owner can change that with `workDomains`.)
  6. `grant_present`
  7. `grant_valid`
  8. `sensitive_domain`
  9. `consequential_action`
- It **denies by default.** The first failing rule decides `deny`, and the rules after it are recorded as `skipped`. A flag rule (a sensitive domain, or a send/schedule/delete/pay action) turns the outcome into `confirm`. Only when every rule passes is the outcome `allow`, recorded as `decidedBy: "all_rules_passed"`.
- Every decision returns its **full trace**, and simulations are stored in the local decision history.
- Lifecycle transitions follow the same approach (`checkTransition`). An agent cannot become `active` without a goal, requested capabilities, a policy simulation the owner has seen, and a currently valid grant.

## Consequences

- Behaviour is covered by ordinary unit tests: allow, deny by default, expired or revoked grant, draft agent, forbidden capability, out-of-domain action, confirmation, and fixed trace order.
- The Studio can explain any decision in plain language (EN/PT) from the trace alone.
- The rules are deliberately coarse. Anything nuanced, such as "is this email really urgent?", belongs outside the policy path. An LLM may later *propose* things (a draft reply, a classification), but its output is treated as untrusted input to this engine, never as the authority.
- Adding a rule means changing code and tests. That friction is intended.

## Alternatives considered

- **An LLM as the judge**, with natural-language policies: rejected as non-deterministic, hard to audit and injectable.
- **A general policy language** (OPA/Rego, Cedar): stronger for large systems, but adds a runtime and a language to learn for about nine rules. We can revisit this if the rule set grows or third parties need to write policies.
