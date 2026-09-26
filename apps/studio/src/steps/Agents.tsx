import { useState } from "react";
import {
  ALLOWED_TRANSITIONS,
  isGrantValid,
  type AgentDefinition,
  type AgentState,
  type Capability,
  type ConsentGrant,
} from "@brad/domain";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";

interface Props {
  agents: AgentDefinition[];
  grants: ConsentGrant[];
  onGenerate: () => void;
  onChanged: () => Promise<void>;
  onNext: () => void;
}

export function Agents({ agents, grants, onGenerate, onChanged, onNext }: Props) {
  const { t } = useI18n();
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const now = new Date().toISOString();

  const note = (agentId: string, text: string) => setNotices((n) => ({ ...n, [agentId]: text }));

  const errorText = (e: unknown) => {
    const key = `grantError.${e instanceof ApiError ? e.message : "unknown"}` as MessageKey;
    return t(key) === key ? t("grantError.unknown") : t(key);
  };

  const move = async (agent: AgentDefinition, to: AgentState) => {
    try {
      const { result } = await api.transition(agent.id, to);
      note(agent.id, result.ok ? "" : t(`transition.${result.reason}`, { to: t(`state.${to}`) }));
      await onChanged();
    } catch (e) {
      note(agent.id, errorText(e));
    }
  };

  const grant = async (agent: AgentDefinition, capability: Capability) => {
    try {
      await api.grant(agent.id, capability);
      note(agent.id, "");
      await onChanged();
    } catch (e) {
      note(agent.id, errorText(e));
    }
  };

  const revoke = async (agent: AgentDefinition, grantId: string) => {
    try {
      await api.revoke(grantId);
      note(agent.id, "");
      await onChanged();
    } catch (e) {
      note(agent.id, errorText(e));
    }
  };

  const visible = agents.filter((a) => showArchived || a.state !== "archived");
  const archivedCount = agents.length - agents.filter((a) => a.state !== "archived").length;
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString();

  return (
    <section>
      <h2>{t("agents.title")}</h2>
      <p className="muted">{t("agents.intro")}</p>
      <div className="actions left">
        <button className="primary" onClick={onGenerate} data-testid="generate-agents">
          {t("agents.generate")}
        </button>
        {archivedCount > 0 && (
          <label className="check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{" "}
            {t("agents.showArchived", { count: archivedCount })}
          </label>
        )}
      </div>
      {agents.length === 0 ? (
        <p className="empty">{t("agents.empty")}</p>
      ) : (
        <div className="cards">
          {visible.map((a) => {
            const agentGrants = grants.filter((g) => g.agentId === a.id);
            return (
              <article key={a.id} className={`card agent state-${a.state}`} data-testid={`agent-${a.domain}`}>
                <header>
                  <h3>{t("agents.name", { domain: t(`domain.${a.domain}`) })}</h3>
                  <span className={`badge state-${a.state}`} data-testid="agent-state">
                    {t(`state.${a.state}`)}
                  </span>
                </header>
                <p className="muted small">{t(`reason.${a.reason}`)}</p>
                <p>
                  <strong>{t("agents.goal")}:</strong> {a.goal || <em className="muted">{t("agents.noGoal")}</em>}
                </p>

                <p className="small">{t("agents.permissions")}</p>
                <ul className="grants">
                  {a.requestedCapabilities.map((c) => {
                    const valid = agentGrants.find((g) => g.capability === c && isGrantValid(g, now));
                    return (
                      <li key={c} className={valid ? "granted" : ""}>
                        <span className={`chip ${valid ? "granted" : ""}`}>{t(`capability.${c}`)}</span>
                        {valid ? (
                          <>
                            <span className="muted small">{t("agents.grantedUntil", { date: formatDate(valid.expiresAt) })}</span>
                            <button className="link" onClick={() => revoke(a, valid.id)} data-testid={`revoke-${c}`}>
                              {t("agents.revoke")}
                            </button>
                          </>
                        ) : (
                          a.state !== "archived" && (
                            <button className="link" onClick={() => grant(a, c)} data-testid={`grant-${c}`}>
                              {t("agents.grant")}
                            </button>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
                {a.excludedByBoundary.length > 0 && (
                  <>
                    <p className="small">{t("agents.excluded")}</p>
                    <ul className="chips">
                      {a.excludedByBoundary.map((c) => (
                        <li key={c} className="chip blocked">
                          {t(`capability.${c}`)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {ALLOWED_TRANSITIONS[a.state].length > 0 && (
                  <div className="lifecycle">
                    {ALLOWED_TRANSITIONS[a.state].map((to) => (
                      <button
                        key={to}
                        className={to === "archived" || to === "draft" || to === "paused" ? "ghost small-btn" : "small-btn"}
                        onClick={() => move(a, to)}
                        data-testid={`move-${to}`}
                      >
                        {t(`transitionTo.${to}`)}
                      </button>
                    ))}
                  </div>
                )}
                {notices[a.id] && (
                  <p className="notice" role="status" data-testid="agent-notice">
                    {notices[a.id]}
                  </p>
                )}
                <p className="muted small">↑ {t("agents.escalation")}</p>
              </article>
            );
          })}
        </div>
      )}
      {agents.length > 0 && (
        <div className="actions">
          <button className="primary" onClick={onNext}>
            {t("common.next")} →
          </button>
        </div>
      )}
    </section>
  );
}
