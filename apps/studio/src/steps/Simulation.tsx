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
import type { Contribution, RankedItem } from "@brad/priority-engine";
import { api } from "../api";
import { useI18n } from "../i18n";

interface Props {
  lifeMap: LifeMap;
  agents: AgentDefinition[];
  onError: (e: unknown) => void;
}

export function Simulation({ lifeMap, agents, onError }: Props) {
  const { t, lang } = useI18n();
  const [ranked, setRanked] = useState<RankedItem[] | null>(null);
  const [decisionId, setDecisionId] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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

  const run = async () => {
    try {
      const res = await api.simulatePriority();
      setRanked(res.ranked);
      setDecisionId(res.decisionId);
      setOpen(res.ranked[0]?.item.id ?? null);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <section>
      <h2>{t("sim.title")}</h2>
      <p className="muted">{t("sim.intro")}</p>
      <div className="actions left">
        <button className="primary" onClick={run} data-testid="run-simulation">
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
