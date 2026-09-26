import { useEffect, useState } from "react";
import type { LifeDomainId } from "@brad/domain";
import { getQuestion, type Answer, type AnswerOutcome, type Question, type Verdict } from "@brad/discovery";
import { api, ApiError, type DiscoveryState } from "../api";
import { useI18n, type Lang } from "../i18n";
import type { MessageKey } from "../i18n/en";

/** Human-readable content of an answer: chosen options, "Outra resposta" and free text. */
function describeAnswer(lang: Lang, questionId: string, optionIds: string[], otherText: string | null, freeText: string | null): string {
  const question = getQuestion(questionId);
  const labels = optionIds.map((id) => question?.options.find((o) => o.id === id)?.label[lang] ?? id);
  return [...labels, ...(otherText ? [`“${otherText}”`] : []), ...(freeText ? [`“${freeText}”`] : [])].join(", ");
}

function QuestionCard({
  question,
  domain,
  initial,
  onSubmit,
}: {
  question: Question;
  domain: LifeDomainId;
  initial?: Answer;
  onSubmit: (input: { selectedOptionIds?: string[]; otherText?: string; freeText?: string; outcome: AnswerOutcome }) => void;
}) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<string[]>(initial?.selectedOptionIds ?? []);
  const [otherOn, setOtherOn] = useState(Boolean(initial?.otherText));
  const [otherText, setOtherText] = useState(initial?.otherText ?? "");
  const [freeText, setFreeText] = useState(initial?.freeText ?? "");

  useEffect(() => {
    setSelected(initial?.selectedOptionIds ?? []);
    setOtherOn(Boolean(initial?.otherText));
    setOtherText(initial?.otherText ?? "");
    setFreeText(initial?.freeText ?? "");
  }, [question.id, domain, initial]);

  const toggle = (id: string) =>
    setSelected((s) => (question.multiple ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : s.includes(id) ? [] : [id]));

  const canAnswer = selected.length > 0 || (otherOn && otherText.trim() !== "") || freeText.trim() !== "";

  return (
    <div className="question" data-testid="question" data-question={question.id}>
      <p className="question-text">{question.text[lang]}</p>
      <p className="muted small">{question.multiple ? t("discovery.multiple") : t("discovery.single")}</p>
      <div className="options">
        {question.options.map((o) => (
          <label key={o.id} className={`option ${selected.includes(o.id) ? "on" : ""}`}>
            <input
              type={question.multiple ? "checkbox" : "radio"}
              name={`q-${question.id}`}
              checked={selected.includes(o.id)}
              onChange={() => toggle(o.id)}
              data-testid={`option-${o.id}`}
            />{" "}
            {o.label[lang]}
          </label>
        ))}
        <label className={`option ${otherOn ? "on" : ""}`}>
          <input type="checkbox" checked={otherOn} onChange={(e) => setOtherOn(e.target.checked)} data-testid="option-other" />{" "}
          {t("discovery.other")}
        </label>
      </div>
      {otherOn && (
        <textarea
          rows={2}
          maxLength={2000}
          value={otherText}
          placeholder={t("discovery.otherPlaceholder")}
          onChange={(e) => setOtherText(e.target.value)}
          data-testid="other-text"
        />
      )}
      <label className="field">
        <span className="small">{t("discovery.freeText")}</span>
        <textarea rows={2} maxLength={2000} value={freeText} onChange={(e) => setFreeText(e.target.value)} data-testid="free-text" />
      </label>
      <div className="lifecycle">
        <button
          className="primary small-btn"
          disabled={!canAnswer}
          onClick={() =>
            onSubmit({
              selectedOptionIds: selected,
              otherText: otherOn ? otherText : undefined,
              freeText,
              outcome: "answered",
            })
          }
          data-testid="answer-submit"
        >
          {t("discovery.answer")}
        </button>
        <button className="small-btn ghost" onClick={() => onSubmit({ outcome: "dont_know" })}>
          {t("discovery.dontKnow")}
        </button>
        <button className="small-btn ghost" onClick={() => onSubmit({ outcome: "prefer_not" })}>
          {t("discovery.preferNot")}
        </button>
        <button className="small-btn ghost" onClick={() => onSubmit({ outcome: "skipped" })} data-testid="answer-skip">
          {t("discovery.skip")}
        </button>
      </div>
      <p className="muted small">{question.purpose[lang]}</p>
    </div>
  );
}

export function Discovery({ onError, onNext }: { onError: (e: unknown) => void; onNext: () => void }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<DiscoveryState | null>(null);
  const [domain, setDomain] = useState<LifeDomainId | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .discovery()
      .then((s) => {
        setState(s);
        setDomain((d) => d ?? s.domains.find((x) => x.next)?.domain ?? s.domains[0]?.domain ?? null);
      })
      .catch(onError);
  }, [onError]);

  const run = async (p: Promise<DiscoveryState>) => {
    try {
      setState(await p);
    } catch (e) {
      onError(e instanceof ApiError ? new ApiError(t(`discoveryError.${e.message}` as MessageKey)) : e);
    }
  };

  if (!state) return null;
  const current = state.domains.find((d) => d.domain === domain) ?? state.domains[0];
  const domainAnswers = state.answers.filter((a) => a.domain === current?.domain);
  const editingAnswer = domainAnswers.find((a) => a.questionId === editing);
  const question = editing ? getQuestion(editing) : current?.next;
  const minutes = Math.max(1, Math.round((state.estimate * 20) / 60));

  const submit = (input: { selectedOptionIds?: string[]; otherText?: string; freeText?: string; outcome: AnswerOutcome }) => {
    if (!current || !question) return;
    setEditing(null);
    void run(api.answer({ questionId: question.id, domain: current.domain, ...input }));
  };

  return (
    <section>
      <h2>{t("discovery.title")}</h2>
      <p>{t("discovery.intro")}</p>
      <p className="muted small">{t("discovery.estimate", { minutes })}</p>

      <div className="discovery">
        <nav className="domain-list" aria-label={t("discovery.areas")}>
          {state.domains.map((d) => (
            <button
              key={d.domain}
              className={d.domain === current?.domain ? "on" : ""}
              onClick={() => {
                setDomain(d.domain);
                setEditing(null);
              }}
              data-testid={`discovery-domain-${d.domain}`}
            >
              <span>{t(`domain.${d.domain}`)}</span>
              <span className={`badge path-${d.path}`}>{t(`discovery.path.${d.path}`)}</span>
              <span className="muted small">
                {d.closed || !d.next ? "✓" : `${d.done}/${d.total}`}
              </span>
            </button>
          ))}
        </nav>

        <div className="domain-panel">
          {current && (
            <>
              <h3>{t(`domain.${current.domain}`)}</h3>
              <p className="muted small">{t(`discovery.pathIntro.${current.path}`)}</p>
              {question ? (
                <QuestionCard question={question} domain={current.domain} initial={editingAnswer} onSubmit={submit} />
              ) : (
                <p className="done" data-testid="domain-done">
                  {current.closed ? t("discovery.closed") : t("discovery.done")}
                </p>
              )}

              {domainAnswers.length > 0 && (
                <>
                  <h4>{t("discovery.yourAnswers")}</h4>
                  <ul className="answers">
                    {domainAnswers.map((a) => (
                      <li key={a.id} data-testid="answer-item">
                        <span className="small">
                          <strong>{getQuestion(a.questionId)?.text[lang]}</strong>{" "}
                          {a.outcome === "answered"
                            ? describeAnswer(lang, a.questionId, a.selectedOptionIds, a.otherText, a.freeText)
                            : t(`discovery.outcome.${a.outcome}`)}
                          {a.status !== "self_reported" && <span className="badge status"> {t(`discovery.status.${a.status}`)}</span>}
                        </span>
                        <span className="answer-actions">
                          <button className="link" onClick={() => setEditing(a.questionId)}>
                            {t("discovery.edit")}
                          </button>
                          <label className="check small">
                            <input
                              type="checkbox"
                              checked={a.syncToInkus}
                              onChange={(e) => void run(api.setAnswerSync(a.id, e.target.checked))}
                            />{" "}
                            {t("discovery.syncInkus")}
                          </label>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {state.synthesis.length > 0 && (
        <div className="synthesis" data-testid="synthesis">
          <h3>{t("discovery.synthesisTitle")}</h3>
          <p className="muted small">{t("discovery.synthesisIntro")}</p>
          <ul>
            {state.synthesis.map((item) => (
              <li key={item.id} className={`synth status-${item.status}`} data-testid={`synth-${item.id}`}>
                <p>
                  {t(`synth.${item.kind}`, {
                    domain: t(`domain.${item.domain}`),
                    what: describeAnswer(lang, item.questionId, item.optionIds, item.otherText, item.freeText),
                  })}{" "}
                  <span className="badge status">{t(`discovery.status.${item.status}`)}</span>
                </p>
                {item.correction && <p className="muted small">{t("discovery.yourCorrection", { text: item.correction })}</p>}
                <div className="lifecycle">
                  <span className="small">{t("discovery.didIGetItRight")}</span>
                  {(["yes", "partly", "no"] as Verdict[]).map((v) => (
                    <button
                      key={v}
                      className="small-btn"
                      onClick={() => void run(api.confirmSynthesis(item.id, v, corrections[item.id]))}
                      data-testid={`synth-${v}`}
                    >
                      {t(`discovery.verdict.${v}`)}
                    </button>
                  ))}
                  <input
                    className="note"
                    placeholder={t("discovery.correctionPlaceholder")}
                    value={corrections[item.id] ?? ""}
                    onChange={(e) => setCorrections((c) => ({ ...c, [item.id]: e.target.value }))}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <button className="primary" onClick={onNext}>
          {t("common.next")} →
        </button>
      </div>
    </section>
  );
}
