# ADR 0005: Inkus as the source of the interview

- **Status:** accepted
- **Date:** 2026-09-27
- **Amends:** [ADR 0004](0004-life-map-sync-consent.md) (answers sync by default when the Inkus catalog is in use)
- **Code:** `packages/discovery` (`parseInkusCatalog`, `Catalog`), `packages/adapter-inkus` (`syncAnswers`), `POST /api/adapters/inkus/questions`, `POST /api/adapters/inkus/answers`, `POST /api/discovery/catalog`

## Context

The owner keeps the interview in Inkus, so questions can be edited without touching Brad's code:

- a **question database**, one row per question, with fields `question_id`, `order`, `stage`, `domain`, `construct`, `prompt_pt_br`, `options_json`, `branch_json`, `answer_type`, `required`, `status` and `source`;
- an **answers database**, one row per answer, with fields `question_id`, `question_record_id`, `question_version`, `domain`, `selected_option_ids_json`, `other_text`, `free_text`, `numeric_value`, `epistemic_status`, `answered_at`, `agent_id` and `supersedes_answer_id`;
- a **workflow text** describing how to read the catalog, branch, and turn answers into agent drafts.

## Decision

- **Two catalogs, one engine contract.** Discovery runs on a `Catalog`, either Brad's built-in questions or one parsed from the Inkus question database. The secretary and the synthesis read answers through *slots* (meaning, barrier, support, preserve…) and option *tags*, so they work the same with either catalog.
- **Reading the Inkus catalog:**
  - Brad keeps only rows with `status=active`, ordered by `order`, and checks that ids are unique and that `options_json` and `branch_json` are valid.
  - Problems are reported, not hidden. A question missing `other`/`unknown`/`skip` still gets Brad's universal controls, and the gap is listed.
  - The question version is a hash of its prompt, options and branch.
- **Branching:**
  - `branch_json` supports `next`, `if`/`else`, `trigger`/`then` and `end`. Conditions (`importance>=7 && satisfaction<=3`, `domain=finances`) go through a small parser, never `eval`.
  - The scores come from the diagnostic, so the interview starts after them.
  - A domain's own question is inserted after `priority.protect_or_change` when its trigger applies.
  - No question is asked twice, and "Não quero mexer nisso agora" closes the area.
- **Option ids stay positional (`opt_1`…)**, as the owner chose. Brad reads their meaning from the label (for example "Preparar rascunhos" means prepare a draft), falling back to position. An answer given to an earlier version of a question is flagged for re-confirmation, never reinterpreted.
- **Explicit actions, local snapshot:**
  - Questions are read when the owner presses "Recarregar perguntas do Inkus". Brad keeps a dated local copy.
  - If Inkus is unreachable, the interview continues on that copy and the Studio says it may be out of date. Brad never claims the catalog is current.
- **Answers go to Inkus (owner decision).** With the Inkus catalog active, every answer is written to the answers database at the next "Sincronizar respostas". This replaces ADR 0004's off-by-default and the second confirmation for sensitive areas, which still apply to the built-in catalog.
  - An edit creates a new row with `supersedes_answer_id`; rows are never rewritten in content.
  - A confirmation updates `epistemic_status`.
  - Retries are idempotent.
- **Scores are compared, not applied.** Satisfaction and importance rows that differ from the life map are listed for the owner, and the life map changes only when the owner edits it.
- **From answers to a draft agent version.**
  - `proposeFromInterview` turns an area's answers into a proposed update of that area's agent:
    - the goal is the owner's own words;
    - responsibilities come from the help they asked for, the barriers and the review cadence;
    - capabilities are only *requested*, always within the boundaries.
  - The Studio shows the proposal next to the owner's words. Nothing changes until the owner applies it.
  - Applying updates the agent. For an agent linked to Inkus, it also writes a **draft** spec and records the agent on the answer rows it came from (`agent_id`).
- **Every version Brad writes to Inkus is a draft.** This covers the interview, Studio edits, sync pushes and first exports. Activation is an explicit owner action: "Activate in Inkus" in Brad, or directly in Inkus. Hermes runs only active specs, so nothing Brad writes reaches Hermes without the owner.
- **Nothing here grants anything.** No answer or proposal creates a grant, activates an agent or sends a message.

## Consequences

- The owner can edit questions, options, order and branching in Inkus and see the change after a reload, without changing code.
- Answers must use catalog option ids, so an answer written for one catalog is not valid in the other. Built-in answers stay local.
- The share summary (RF11) still leaves sensitive areas out unless consented for that summary. Its rules are unchanged.
