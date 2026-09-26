import { useEffect, useState } from "react";
import { LIFE_DOMAINS, type LifeMap } from "@brad/domain";
import { getQuestion } from "@brad/discovery";
import type { Evidence, Load, Proposal } from "@brad/secretary";
import { api, type SecretaryState } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";

function EvidenceLine({ e }: { e: Evidence }) {
  const { t, lang } = useI18n();
  if (e.type === "assessment") {
    return (
      <li>
        {t("secretary.evidence.assessment", {
          importance: Number(e.detail.importance),
          satisfaction: Number(e.detail.satisfaction),
          asOf: e.detail.asOf ? new Date(String(e.detail.asOf)).toLocaleDateString() : t("secretary.undated"),
        })}
      </li>
    );
  }
  const question = getQuestion(String(e.detail.questionId));
  const options = ((e.detail.options as string[] | null) ?? []).map(
    (id) => question?.options.find((o) => o.id === id)?.label[lang] ?? id,
  );
  const other = e.detail.otherText ? [`“${String(e.detail.otherText)}”`] : [];
  return (
    <li>
      {question?.text[lang]} <strong>{[...options, ...other].join(", ")}</strong>{" "}
      <span className="badge status">{t(`discovery.status.${String(e.detail.status)}` as MessageKey)}</span>
    </li>
  );
}

function ProposalCard({
  p,
  state,
  protectedId,
  onAction,
  onAnswer,
}: {
  p: Proposal;
  state: SecretaryState;
  protectedId: string | null;
  onAction: (action: "accept" | "decline" | "snooze" | "edit", note?: string) => void;
  onAnswer: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const feedback = state.feedback[p.id];
  return (
    <article className={`card proposal kind-${p.kind}`} data-testid={`proposal-${p.id}`}>
      <header>
        <h3>{t(`proposal.${p.action}` as MessageKey, { domain: t(`domain.${p.domain}`) })}</h3>
        <span className={`badge kind-${p.kind}`}>{t(`secretary.kind.${p.kind}` as MessageKey)}</span>
      </header>
      {p.id === protectedId && <p className="small protect-note">{t("secretary.protectedNote")}</p>}
      {p.goal && <p className="small">{t("secretary.goal", { goal: p.goal })}</p>}
      <p className="muted small">
        {t(`secretary.confidence.${p.confidence}` as MessageKey)}
        {p.thisWeek && ` · ${t("secretary.thisWeek")}`}
      </p>
      <button className="link" onClick={() => setOpen(!open)} data-testid="proposal-why">
        {t("secretary.why")}
      </button>
      {open && (
        <div className="why-box">
          <ul className="small">
            {p.evidence.map((e) => (
              <EvidenceLine key={e.ref} e={e} />
            ))}
          </ul>
          {p.missing.map((m) => (
            <p key={m} className="muted small">
              {t(`secretary.missing.${m}` as MessageKey)}
            </p>
          ))}
        </div>
      )}
      {feedback && (
        <p className="small applied">
          {t(`secretary.feedback.${feedback.action}` as MessageKey)}
          {feedback.note && ` · “${feedback.note}”`}
        </p>
      )}
      {p.kind === "question" ? (
        <div className="lifecycle">
          <button className="small-btn primary" onClick={onAnswer}>
            {t("secretary.answerInDiscovery")}
          </button>
          <button className="small-btn ghost" onClick={() => onAction("snooze")}>
            {t("secretary.snooze")}
          </button>
        </div>
      ) : (
        <div className="lifecycle">
          <button className="small-btn primary" onClick={() => onAction("accept")} data-testid="proposal-accept">
            {t("secretary.accept")}
          </button>
          <button className="small-btn" onClick={() => onAction("snooze")} data-testid="proposal-snooze">
            {t("secretary.snooze")}
          </button>
          <button className="small-btn ghost" onClick={() => onAction("decline")} data-testid="proposal-decline">
            {t("secretary.decline")}
          </button>
          <input
            className="note"
            value={note}
            placeholder={t("secretary.editPlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="small-btn ghost" disabled={!note.trim()} onClick={() => onAction("edit", note)}>
            {t("secretary.edit")}
          </button>
        </div>
      )}
    </article>
  );
}

export function Secretary({
  lifeMap,
  onError,
  onAnswer,
}: {
  lifeMap: LifeMap;
  onError: (e: unknown) => void;
  onAnswer: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<SecretaryState | null>(null);

  useEffect(() => {
    api.secretary().then(setState).catch(onError);
  }, [onError]);

  const run = async (p: Promise<SecretaryState>) => {
    try {
      setState(await p);
    } catch (e) {
      onError(e);
    }
  };

  if (!state) return null;
  const { plan } = state;
  const byId = (id: string) => plan.focus.find((p) => p.id === id) ?? plan.deferred.find((d) => d.proposal.id === id)?.proposal;
  const label = (p: Proposal | undefined) => (p ? t(`proposal.${p.action}` as MessageKey, { domain: t(`domain.${p.domain}`) }) : "");

  return (
    <section>
      <h2>{t("secretary.title")}</h2>
      <p>{t("secretary.intro")}</p>

      {state.weeklyDue && (
        <div className="checkin" data-testid="weekly-checkin">
          <span>{t("secretary.checkinQuestion")}</span>
          {(["lighter", "same", "heavier"] as Load[]).map((l) => (
            <button key={l} className="small-btn" onClick={() => void run(api.checkin(l))}>
              {t(`secretary.load.${l}` as MessageKey)}
            </button>
          ))}
          <span className="muted small">{t("secretary.checkinOptional")}</span>
        </div>
      )}

      {plan.focus.length === 0 ? (
        <p className="empty">{t("secretary.empty")}</p>
      ) : (
        <div className="cards" data-testid="focus">
          {plan.focus.map((p) => (
            <ProposalCard
              key={p.id}
              p={p}
              state={state}
              protectedId={plan.protectedId}
              onAction={(action, note) => void run(api.proposalFeedback(p.id, action, note))}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      )}

      {plan.deferred.length > 0 && (
        <>
          <h3>{t("secretary.deferredTitle")}</h3>
          <ul className="small" data-testid="deferred">
            {plan.deferred.map((d) => (
              <li key={d.proposal.id}>{t("secretary.tradeoff", { chosen: label(byId(d.because)), waiting: label(d.proposal) })}</li>
            ))}
          </ul>
        </>
      )}

      <h3>{t("secretary.controlTitle")}</h3>
      <p className="muted small">
        {t("secretary.metrics", {
          accepted: state.metrics.accepted,
          edited: state.metrics.edited,
          declined: state.metrics.declined,
          snoozed: state.metrics.snoozed,
        })}
      </p>
      <div className="silence">
        {LIFE_DOMAINS.filter((d) => lifeMap.assessments.some((a) => a.domain === d)).map((d) => (
          <label key={d} className="check small">
            <input
              type="checkbox"
              checked={plan.hidden.silenced.includes(d)}
              onChange={(e) => void run(api.silence(d, e.target.checked))}
            />{" "}
            {t("secretary.silence", { domain: t(`domain.${d}`) })}
          </label>
        ))}
      </div>
      {state.checkins.length > 0 && (
        <p className="muted small">
          {t("secretary.loadHistory")}{" "}
          {state.checkins.map((c) => `${new Date(c.at).toLocaleDateString()}: ${t(`secretary.load.${c.load}` as MessageKey)}`).join(" · ")}
        </p>
      )}
    </section>
  );
}
