import type { AgentDefinition } from "@brad/domain";
import { useI18n } from "../i18n";

interface Props {
  agents: AgentDefinition[];
  onGenerate: () => void;
  onNext: () => void;
}

export function Agents({ agents, onGenerate, onNext }: Props) {
  const { t } = useI18n();
  return (
    <section>
      <h2>{t("agents.title")}</h2>
      <p className="muted">{t("agents.intro")}</p>
      <div className="actions left">
        <button className="primary" onClick={onGenerate} data-testid="generate-agents">
          {t("agents.generate")}
        </button>
      </div>
      {agents.length === 0 ? (
        <p className="empty">{t("agents.empty")}</p>
      ) : (
        <div className="cards">
          {agents.map((a) => (
            <article key={a.id} className="card agent" data-testid="agent-card">
              <header>
                <h3>{t("agents.name", { domain: t(`domain.${a.domain}`) })}</h3>
                <span className={`badge state-${a.state}`}>{t(`state.${a.state}`)}</span>
              </header>
              <p className="muted small">{t(`reason.${a.reason}`)}</p>
              <p>
                <strong>{t("agents.goal")}:</strong> {a.goal || <em className="muted">{t("agents.noGoal")}</em>}
              </p>
              <p className="small">{t("agents.requested")}</p>
              <ul className="chips">
                {a.requestedCapabilities.map((c) => (
                  <li key={c} className="chip">
                    {t(`capability.${c}`)}
                  </li>
                ))}
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
              <p className="muted small">↑ {t("agents.escalation")}</p>
            </article>
          ))}
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
