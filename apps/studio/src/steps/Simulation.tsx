import { useEffect, useState } from "react";
import {
  CAPABILITIES,
  LIFE_DOMAINS,
  demoNow,
  type AgentDefinition,
  type AgentState,
  type Capability,
  type LifeDomainId,
  type LifeMap,
} from "@brad/domain";
import type { PolicyDecision } from "@brad/policy-engine";
import type { Contribution, RankedItem, Suggestion, Tier } from "@brad/priority-engine";
import { api, ApiError } from "../api";
import { describeSuggestion } from "../suggestions";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";

interface Props {
  lifeMap: LifeMap;
  agents: AgentDefinition[];
  onError: (e: unknown) => void;
  onLifeMapChanged: (map: LifeMap) => void;
  onEditLifeMap: () => void;
}

interface CorrectionState {
  correctionId: number;
  current: { score: number; tier: Tier };
  suggestion: Suggestion | null;
  applied: boolean;
}

const TIERS: Tier[] = ["now", "today", "later"];

export function Simulation({ lifeMap, agents, onError, onLifeMapChanged, onEditLifeMap }: Props) {
  const { t, lang } = useI18n();
  const [ranked, setRanked] = useState<RankedItem[] | null>(null);
  const [decisionId, setDecisionId] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [corrections, setCorrections] = useState<Record<string, CorrectionState>>({});
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const tz = lifeMap.boundaries.timeZone;
  const locale = lang === "pt" ? "pt-BR" : "en-GB";
  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );

  const describe = (c: Contribution): string => {
    const params = { ...c.params };
    if (typeof params.domain === "string") params.domain = t(`domain.${params.domain as LifeDomainId}`);
    if (typeof params.relationship === "string")
      params.relationship = t(`relationship.${params.relationship as (typeof lifeMap.people)[number]["relationship"]}`);
    return t(`rule.${c.rule}`, params);
  };

  const run = async (keepOpen?: string) => {
    try {
      const res = await api.simulatePriority();
      setRanked(res.ranked);
      setDecisionId(res.decisionId);
      setOpen(keepOpen ?? res.ranked[0]?.item.id ?? null);
    } catch (e) {
      onError(e);
    }
  };

  const correct = async (itemId: string, expected: Tier) => {
    if (decisionId === null) return;
    try {
      const res = await api.correct(decisionId, itemId, expected, notes[itemId] ?? "");
      setCorrections((c) => ({ ...c, [itemId]: { ...res, applied: false } }));
      setCorrectionError(null);
    } catch (e) {
      setCorrectionError(e instanceof ApiError ? t(`correctionError.${e.message}` as MessageKey) : String(e));
    }
  };

  const apply = async (itemId: string) => {
    const state = corrections[itemId];
    if (!state) return;
    try {
      const res = await api.applyCorrection(state.correctionId);
      onLifeMapChanged(res.lifeMap);
      setCorrections((c) => ({ ...c, [itemId]: { ...state, applied: true } }));
      setCorrectionError(null);
      await run(itemId);
    } catch (e) {
      setCorrectionError(e instanceof ApiError ? t(`correctionError.${e.message}` as MessageKey) : String(e));
    }
  };

  return (
    <section>
      <h2>{t("sim.title")}</h2>
      <p className="muted">{t("sim.intro")}</p>
      <div className="actions left">
        <button className="primary" onClick={() => run()} data-testid="run-simulation">
          {t("sim.run")}
        </button>
        <span className="muted small">{t("sim.clock", { time: formatTime(demoNow), tz })}</span>
      </div>

      {ranked && (
        <ol className="inbox" data-testid="ranked">
          {ranked.map((r) => {
            const person = lifeMap.people.find((p) => p.id === r.item.from.personId);
            const expanded = open === r.item.id;
            return (
              <li key={r.item.id} className={`item tier-${r.tier}`} data-testid="ranked-item">
                <button className="item-head" onClick={() => setOpen(expanded ? null : r.item.id)} aria-expanded={expanded}>
                  <span className={`badge tier ${r.tier}`}>{t(`tier.${r.tier}`)}</span>
                  <span className="subject">
                    {r.item.subject[lang]}
                    <span className="muted small">
                      {" "}
                      · {t("sim.from")} {person ? person.name : `${r.item.from.address} (${t("sim.unknown")})`} ·{" "}
                      {formatTime(r.item.receivedAt)}
                    </span>
                  </span>
                  <span className="score" title={t("sim.score")}>
                    {r.score}
                  </span>
                </button>
                {expanded && (
                  <div className="why">
                    <strong>{t("sim.why")}</strong>
                    <ul>
                      {r.explanation.map((c) => (
                        <li key={c.rule} className={c.points < 0 ? "neg" : c.points > 0 ? "pos" : ""}>
                          <span className="pts">
                            {c.points > 0 ? "+" : ""}
                            {t("common.points", { points: c.points })}
                          </span>
                          {describe(c)}
                        </li>
                      ))}
                    </ul>
                    <CorrectionPanel
                      tier={r.tier}
                      note={notes[r.item.id] ?? ""}
                      state={corrections[r.item.id]}
                      error={correctionError}
                      onNote={(value) => setNotes((n) => ({ ...n, [r.item.id]: value }))}
                      onCorrect={(tier) => correct(r.item.id, tier)}
                      onApply={() => apply(r.item.id)}
                      onEditLifeMap={onEditLifeMap}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {decisionId !== null && <p className="muted small">{t("sim.decision", { id: decisionId })}</p>}

      <PolicyPanel agents={agents} onError={onError} />
    </section>
  );
}

interface CorrectionPanelProps {
  tier: Tier;
  note: string;
  state: CorrectionState | undefined;
  error: string | null;
  onNote: (value: string) => void;
  onCorrect: (tier: Tier) => void;
  onApply: () => void;
  onEditLifeMap: () => void;
}

function CorrectionPanel({ tier, note, state, error, onNote, onCorrect, onApply, onEditLifeMap }: CorrectionPanelProps) {
  const { t } = useI18n();
  const s = state?.suggestion;
  return (
    <div className="correction" data-testid="correction">
      <div className="correction-row">
        <span className="small">{t("correction.shouldBe")}</span>
        {TIERS.map((x) => (
          <button
            key={x}
            className="small-btn"
            disabled={x === tier}
            onClick={() => onCorrect(x)}
            data-testid={`should-be-${x}`}
          >
            {t(`tier.${x}`)}
          </button>
        ))}
        <input
          className="note"
          value={note}
          maxLength={500}
          placeholder={t("correction.notePlaceholder")}
          onChange={(e) => onNote(e.target.value)}
        />
      </div>
      {error && <p className="notice">{error}</p>}
      {state && (
        <div className="suggestion" data-testid="suggestion">
          {!s ? (
            <p>{t("correction.noSuggestion")}</p>
          ) : (
            <>
              <p>
                <strong>{t("correction.suggestion")}</strong> {describeSuggestion(t, s)}
              </p>
              {s.projected ? (
                <p className="muted small">
                  {t("correction.projection", {
                    from: state.current.score,
                    to: s.projected.score,
                    fromTier: t(`tier.${state.current.tier}`),
                    toTier: t(`tier.${s.projected.tier}`),
                  })}
                </p>
              ) : (
                <p className="muted small">{t("correction.manual")}</p>
              )}
              {state.applied ? (
                <p className="applied">✓ {t("correction.applied")}</p>
              ) : s.projected ? (
                <button className="primary small-btn" onClick={onApply} data-testid="apply-suggestion">
                  {t("correction.apply")}
                </button>
              ) : (
                <button className="small-btn" onClick={onEditLifeMap}>
                  {t("correction.openLifeMap")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PolicyPanel({ agents, onError }: { agents: AgentDefinition[]; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [capability, setCapability] = useState<Capability>("send_message");
  const [domain, setDomain] = useState<LifeDomainId>(agents[0]?.domain ?? "family");
  const [assumeApproved, setAssumeApproved] = useState(false);
  const [assumeGrant, setAssumeGrant] = useState(false);
  const [decision, setDecision] = useState<PolicyDecision | null>(null);

  useEffect(() => {
    if (!agents.some((a) => a.id === agentId) && agents[0]) {
      setAgentId(agents[0].id);
      setDomain(agents[0].domain);
    }
  }, [agents, agentId]);

  // Any change to the question invalidates the previous answer.
  useEffect(() => setDecision(null), [agentId, capability, domain, assumeApproved, assumeGrant]);

  const explainDecision = (d: PolicyDecision): string => {
    const params: Record<string, string> = { ...d.trace.find((s) => s.rule === d.decidedBy)?.params };
    for (const key of ["domain", "agentDomain", "requestDomain"]) {
      if (params[key] && params[key] !== "unknown") params[key] = t(`domain.${params[key] as LifeDomainId}`);
    }
    if (params.capability) params.capability = t(`capability.${params.capability as Capability}`);
    if (params.state && params.state !== "unknown") params.state = t(`state.${params.state as AgentState}`);
    return t(`policyReason.${d.decidedBy}`, params);
  };

  const evaluate = async () => {
    try {
      const res = await api.simulatePolicy({
        request: { agentId, capability, domain },
        assumeState: assumeApproved ? "approved" : undefined,
        assumeGrant,
      });
      setDecision(res.decision);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="policy">
      <h2>{t("policy.title")}</h2>
      <p className="muted">{t("policy.intro")}</p>
      {agents.length === 0 ? (
        <p className="empty">{t("policy.noAgents")}</p>
      ) : (
        <>
          <div className="policy-form">
            <label className="field">
              {t("policy.agent")}
              <select
                value={agentId}
                data-testid="policy-agent"
                onChange={(e) => {
                  setAgentId(e.target.value);
                  const agent = agents.find((a) => a.id === e.target.value);
                  if (agent) setDomain(agent.domain);
                }}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {t("agents.name", { domain: t(`domain.${a.domain}`) })} ({t(`state.${a.state}`)})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("policy.capability")}
              <select
                value={capability}
                data-testid="policy-capability"
                onChange={(e) => setCapability(e.target.value as Capability)}
              >
                {CAPABILITIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`capability.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("policy.domain")}
              <select value={domain} onChange={(e) => setDomain(e.target.value as LifeDomainId)}>
                {LIFE_DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {t(`domain.${d}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="policy-whatif">
            <span className="muted small">{t("policy.whatIf")}</span>
            <label className="check">
              <input
                type="checkbox"
                checked={assumeApproved}
                data-testid="assume-approved"
                onChange={(e) => setAssumeApproved(e.target.checked)}
              />{" "}
              {t("policy.assumeApproved")}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={assumeGrant}
                data-testid="assume-grant"
                onChange={(e) => setAssumeGrant(e.target.checked)}
              />{" "}
              {t("policy.assumeGrant")}
            </label>
            <button className="primary" onClick={evaluate} data-testid="evaluate-policy">
              {t("policy.evaluate")}
            </button>
          </div>

          {decision && (
            <div className={`decision ${decision.outcome}`} data-testid="policy-decision">
              <p className="outcome">
                <span className={`badge outcome ${decision.outcome}`}>{t(`outcome.${decision.outcome}`)}</span>{" "}
                {explainDecision(decision)}
              </p>
              <ol className="trace">
                {decision.trace.map((s) => (
                  <li key={s.rule} className={`status-${s.status}`}>
                    <span className="status">{t(`status.${s.status}`)}</span> {t(`policyRule.${s.rule}`)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  );
}
