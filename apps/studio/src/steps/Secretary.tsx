import { useEffect, useState } from "react";
import { LIFE_DOMAINS, domainContext, type LifeContext, type LifeDomainId, type LifeMap } from "@brad/domain";
import type { Evidence, Load, Proposal, ShareSummary } from "@brad/secretary";
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
  // The question text and option labels travel with the evidence (built-in or Inkus catalog).
  const question = String((lang === "pt" ? e.detail.questionPt : e.detail.questionEn) ?? e.detail.questionId);
  const options = ((lang === "pt" ? e.detail.labelsPt : e.detail.labelsEn) as string[] | null) ?? [];
  const other = [e.detail.otherText, e.detail.freeText].filter(Boolean).map((text) => `“${String(text)}”`);
  return (
    <li>
      {question} <strong>{[...options, ...other].join(", ")}</strong>{" "}
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

/** A summary the owner copies and shares. Sensitive areas need a tick for this summary only. */
function SharePanel({ lifeMap, onError }: { lifeMap: LifeMap; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const [audience, setAudience] = useState<LifeContext>("personal");
  const [consents, setConsents] = useState<LifeDomainId[]>([]);
  const [summary, setSummary] = useState<ShareSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const sensitive = lifeMap.boundaries.sensitiveDomains.filter((d) => domainContext(lifeMap.boundaries, d) === audience);

  const prepare = async () => {
    try {
      setSummary(await api.shareSummary(audience, consents.filter((d) => sensitive.includes(d))));
      setCopied(false);
    } catch (e) {
      onError(e);
    }
  };
  const text = summary
    ? summary.lines
        .map((l) =>
          [
            `• ${t(`domain.${l.domain}`)}`,
            l.goal && t("share.goal", { goal: l.goal }),
            l.focus && t("share.focus", { focus: t(`proposal.${l.focus}` as MessageKey, { domain: t(`domain.${l.domain}`) }) }),
          ]
            .filter(Boolean)
            .join(" — "),
        )
        .join("\n")
    : "";

  return (
    <div className="share" data-testid="share-panel">
      <h3>{t("share.title")}</h3>
      <p className="muted small">{t("share.intro")}</p>
      <div className="segmented">
        {(["personal", "work"] as LifeContext[]).map((a) => (
          <button
            key={a}
            className={`small-btn ${audience === a ? "primary" : ""}`}
            onClick={() => {
              setAudience(a);
              setSummary(null);
            }}
            data-testid={`share-audience-${a}`}
          >
            {t(`share.audience.${a}` as MessageKey)}
          </button>
        ))}
      </div>
      {sensitive.map((d) => (
        <label key={d} className="check small">
          <input
            type="checkbox"
            checked={consents.includes(d)}
            onChange={(e) => {
              setConsents(e.target.checked ? [...consents, d] : consents.filter((c) => c !== d));
              setSummary(null);
            }}
            data-testid={`share-consent-${d}`}
          />{" "}
          {t("share.consent", { domain: t(`domain.${d}`) })}
        </label>
      ))}
      <div>
        <button className="small-btn primary" onClick={() => void prepare()} data-testid="share-prepare">
          {t("share.prepare")}
        </button>
      </div>
      {summary && (
        <>
          <pre className="share-text" data-testid="share-text">
            {text || t("share.nothing")}
          </pre>
          {text && (
            <button
              className="small-btn"
              onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}
            >
              {copied ? t("share.copied") : t("share.copy")}
            </button>
          )}
          {summary.excluded.length > 0 && (
            <ul className="small muted" data-testid="share-excluded">
              {summary.excluded.map((e) => (
                <li key={e.domain}>{t(`share.excluded.${e.reason}` as MessageKey, { domain: t(`domain.${e.domain}`) })}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
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
      <div className="segmented" role="group" aria-label={t("secretary.contextLabel")}>
        {(["all", "personal", "work"] as const).map((c) => (
          <button
            key={c}
            className={`small-btn ${state.context === c ? "primary" : ""}`}
            onClick={() => void run(api.secretaryContext(c))}
            data-testid={`secretary-context-${c}`}
          >
            {t(`secretary.context.${c}` as MessageKey)}
          </button>
        ))}
      </div>

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
      <SharePanel lifeMap={lifeMap} onError={onError} />
      {state.checkins.length > 0 && (
        <p className="muted small">
          {t("secretary.loadHistory")}{" "}
          {state.checkins.map((c) => `${new Date(c.at).toLocaleDateString()}: ${t(`secretary.load.${c.load}` as MessageKey)}`).join(" · ")}
        </p>
      )}
    </section>
  );
}
