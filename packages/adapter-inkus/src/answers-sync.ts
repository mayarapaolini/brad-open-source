import { currentAnswer, type Answer, type AnswerStatus, type Catalog, type CatalogRecord } from "@brad/discovery";
import type { LifeDomainId, LifeMap } from "@brad/domain";
import type { InkusClient, InkusDatabaseRecord } from "./types";

const STATUSES: AnswerStatus[] = ["self_reported", "user_confirmed", "corrected", "inferred"];
const SCORE_QUESTIONS = { "assessment.satisfaction": "satisfaction", "assessment.importance": "importance" } as const;

/** A score stored in Inkus that differs from the life map. Shown to the owner, never applied silently. */
export interface AssessmentDiff {
  domain: LifeDomainId;
  field: "satisfaction" | "importance";
  inkus: number;
  local: number | null;
  asOf: string;
}

export interface AnswerSyncReport {
  imported: number;
  pushed: number;
  updated: number;
  /** Rows for questions that are not in the current catalog. */
  skipped: number;
  assessments: AssessmentDiff[];
}

/** Reads the question catalog database. */
export async function loadCatalogRecords(client: InkusClient, databaseId: string): Promise<CatalogRecord[]> {
  return (await client.listRecords(databaseId)).map((r) => ({ id: r.id, fields: r.fields }));
}

function parseIds(raw: unknown): string[] {
  try {
    const value = JSON.parse(String(raw ?? "[]")) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

/** An Inkus answer row as a Brad answer. "unknown" and "skip" are Brad's universal outcomes. */
export function recordToAnswer(record: InkusDatabaseRecord): Answer {
  const f = record.fields;
  const ids = parseIds(f.selected_option_ids_json);
  const status = STATUSES.includes(f.epistemic_status as AnswerStatus) ? (f.epistemic_status as AnswerStatus) : "self_reported";
  const outcome = ids.includes("unknown") ? "dont_know" : ids.includes("skip") ? "prefer_not" : "answered";
  const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  return {
    id: `inkus-${record.id}`,
    questionId: String(f.question_id),
    questionVersion: String(f.question_version ?? ""),
    domain: f.domain as LifeDomainId,
    selectedOptionIds: ids.filter((id) => !["other", "unknown", "skip"].includes(id)),
    otherText: text(f.other_text),
    freeText: text(f.free_text),
    outcome,
    status,
    asOf: String(f.answered_at ?? record.created_at ?? ""),
    syncToInkus: true,
    inkus: { recordId: record.id, pushedStatus: status },
  };
}

/** A Brad answer as an Inkus row, linked to the question record and to the answer it replaces. */
export function answerToFields(answer: Answer, catalog: Catalog, supersedes: string | null): Record<string, unknown> {
  const question = catalog.get(answer.questionId);
  const ids =
    answer.outcome === "answered"
      ? [...answer.selectedOptionIds, ...(answer.otherText ? ["other"] : [])]
      : answer.outcome === "dont_know"
        ? ["unknown"]
        : ["skip"];
  const fields: Record<string, unknown> = {
    question_id: answer.questionId,
    question_record_id: question?.externalId ?? "",
    question_version: String(answer.questionVersion),
    domain: answer.domain,
    selected_option_ids_json: JSON.stringify(ids),
    other_text: answer.otherText ?? "",
    free_text: answer.freeText ?? "",
    epistemic_status: answer.status,
    answered_at: answer.asOf,
    supersedes_answer_id: supersedes ?? "",
  };
  // Inkus leaves empty fields out; so does Brad.
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
}

/**
 * Two-way sync of discovery answers with the Inkus answers database (ADR 0005).
 * - Pull: rows Brad has not seen and that no other row replaces become current answers. When the
 *   owner answered the same question in Brad more recently and it is not pushed yet, the local
 *   answer stays current and the Inkus row is kept as history.
 * - Push: every current local answer to a catalog question goes to Inkus as a new row, pointing
 *   at the row it replaces (`supersedes_answer_id`); a confirmation updates the row's status.
 * - Scores: rows for satisfaction and importance are compared with the life map and reported.
 * Rows are never deleted or rewritten in content: history stays in Inkus.
 */
export async function syncAnswers(input: {
  client: InkusClient;
  databaseId: string;
  catalog: Catalog;
  answers: Answer[];
  lifeMap: LifeMap;
}): Promise<{ answers: Answer[]; report: AnswerSyncReport }> {
  const { client, databaseId, catalog, lifeMap } = input;
  const answers = input.answers.map((a) => ({ ...a }));
  const report: AnswerSyncReport = { imported: 0, pushed: 0, updated: 0, skipped: 0, assessments: [] };
  const records = await client.listRecords(databaseId);
  const superseded = new Set(records.map((r) => String(r.fields.supersedes_answer_id ?? "")).filter(Boolean));
  const known = new Set(answers.flatMap((a) => (a.inkus ? [a.inkus.recordId] : [])));

  // Scores: the latest row per domain and field, compared with the life map.
  const latestScores = new Map<string, InkusDatabaseRecord>();
  for (const r of records) {
    const field = SCORE_QUESTIONS[String(r.fields.question_id) as keyof typeof SCORE_QUESTIONS];
    if (!field) continue;
    const key = `${String(r.fields.domain)}:${field}`;
    const prev = latestScores.get(key);
    if (!prev || String(r.fields.answered_at) > String(prev.fields.answered_at)) latestScores.set(key, r);
  }
  for (const [key, r] of latestScores) {
    const [domain, field] = key.split(":") as [LifeDomainId, "satisfaction" | "importance"];
    const local = lifeMap.assessments.find((a) => a.domain === domain)?.[field] ?? null;
    const inkus = Number(r.fields.numeric_value);
    if (!Number.isNaN(inkus) && inkus !== local) report.assessments.push({ domain, field, inkus, local, asOf: String(r.fields.answered_at ?? "") });
  }

  // Pull.
  for (const r of records) {
    const questionId = String(r.fields.question_id ?? "");
    if (questionId in SCORE_QUESTIONS || known.has(r.id)) continue;
    if (!catalog.get(questionId)) {
      report.skipped += 1;
      continue;
    }
    if (superseded.has(r.id)) continue; // an older version; Inkus keeps the history
    const incoming = recordToAnswer(r);
    const local = currentAnswer(answers, incoming.domain, questionId);
    if (local && !local.inkus && local.asOf >= incoming.asOf) {
      answers.push({ ...incoming, status: "stale" });
    } else {
      if (local) local.status = "stale";
      answers.push(incoming);
    }
    report.imported += 1;
  }

  // Push new answers, then status changes.
  for (const answer of answers) {
    if (answer.status === "stale" || answer.inkus || !catalog.get(answer.questionId)) continue;
    const previous = answers
      .filter((a) => a !== answer && a.inkus && a.domain === answer.domain && a.questionId === answer.questionId)
      .sort((x, y) => x.asOf.localeCompare(y.asOf))
      .at(-1);
    const row = await client.createRecord(
      databaseId,
      answerToFields(answer, catalog, previous?.inkus?.recordId ?? null),
      `brad-answer-${answer.id}`,
    );
    answer.inkus = { recordId: row.id, pushedStatus: answer.status };
    answer.syncToInkus = true;
    report.pushed += 1;
  }
  for (const answer of answers) {
    if (!answer.inkus || answer.status === "stale" || answer.inkus.pushedStatus === answer.status) continue;
    await client.updateRecord(answer.inkus.recordId, { epistemic_status: answer.status });
    answer.inkus = { ...answer.inkus, pushedStatus: answer.status };
    report.updated += 1;
  }

  return { answers, report };
}
