import { useEffect, useState } from "react";
import {
  ALLOWED_TRANSITIONS,
  CAPABILITIES,
  LIFE_DOMAINS,
  type LifeDomainId,
  isGrantValid,
  type AgentDefinition,
  type AgentState,
  type Capability,
  type ConsentGrant,
  type LifeMap,
  agentContexts,
} from "@brad/domain";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { agentLabel } from "../agentLabel";
import type { SyncReport } from "@brad/adapter-inkus";

interface Props {
  agents: AgentDefinition[];
  grants: ConsentGrant[];
  forbidden: Capability[];
  lifeMap: LifeMap;
  onLifeMapChanged: (map: LifeMap) => void;
  onGenerate: () => void;
  onChanged: () => Promise<void>;
  onNext: () => void;
}

interface Draft {
  name: string;
  goal: string;
  responsibilities: string;
  domain: LifeDomainId | "";
  actionDomains: LifeDomainId[];
  requestedCapabilities: Capability[];
}

function toDraft(a: AgentDefinition): Draft {
  return {
    name: a.name ?? "",
    goal: a.goal,
    responsibilities: (a.responsibilities ?? []).join("\n"),
    domain: a.domain ?? "",
    actionDomains: a.actionDomains ?? [],
    requestedCapabilities: [...a.requestedCapabilities, ...a.excludedByBoundary],
  };
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function AgentEditor({
  agent,
  forbidden,
  onCancel,
  onSaved,
}: {
  agent: AgentDefinition;
  forbidden: Capability[];
  onCancel: () => void;
  onSaved: (error?: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => toDraft(agent));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    try {
      await api.updateAgent(agent.id, {
        name: draft.name,
        goal: draft.goal,
        responsibilities: draft.responsibilities.split("\n"),
        domain: draft.domain || null,
        actionDomains: draft.actionDomains,
        requestedCapabilities: draft.requestedCapabilities,
      });
      onSaved();
    } catch (e) {
      onSaved(e instanceof ApiError ? t(`editError.${e.message}` as MessageKey) : String(e));
    }
  };

  return (
    <div className="editor" data-testid="agent-editor">
      <label className="field">
        {t("editor.name")}
        <input value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} data-testid="edit-name" />
      </label>
      <label className="field">
        {t("editor.goal")}
        <textarea rows={2} value={draft.goal} onChange={(e) => set({ goal: e.target.value })} data-testid="edit-goal" />
      </label>
      <label className="field">
        {t("editor.responsibilities")}
        <textarea rows={3} value={draft.responsibilities} onChange={(e) => set({ responsibilities: e.target.value })} />
      </label>
      <label className="field">
        {t("editor.domain")}
        <select
          value={draft.domain}
          onChange={(e) => set({ domain: e.target.value as LifeDomainId | "" })}
          data-testid="edit-domain"
        >
          <option value="">{t("agents.crossCutting")}</option>
          {LIFE_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {t(`domain.${d}`)}
            </option>
          ))}
        </select>
      </label>
      {draft.domain === "" && (
        <fieldset>
          <legend>{t("editor.actionDomains")}</legend>
          {LIFE_DOMAINS.map((d) => (
            <label key={d} className="check">
              <input
                type="checkbox"
                checked={draft.actionDomains.includes(d)}
                onChange={() => set({ actionDomains: toggle(draft.actionDomains, d) })}
                data-testid={`edit-action-${d}`}
              />{" "}
              {t(`domain.${d}`)}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>{t("editor.capabilities")}</legend>
        {CAPABILITIES.map((c) => (
          <label key={c} className="check">
            <input
              type="checkbox"
              disabled={forbidden.includes(c)}
              checked={draft.requestedCapabilities.includes(c) && !forbidden.includes(c)}
              onChange={() => set({ requestedCapabilities: toggle(draft.requestedCapabilities, c) })}
              data-testid={`edit-cap-${c}`}
            />{" "}
            {t(`capability.${c}`)}
            {forbidden.includes(c) && <span className="muted small"> · {t("editor.forbidden")}</span>}
          </label>
        ))}
      </fieldset>
      <p className="muted small">{t("editor.note")}</p>
      <div className="lifecycle">
        <button className="primary small-btn" onClick={save} data-testid="edit-save">
          {t("common.save")}
        </button>
        <button className="ghost small-btn" onClick={onCancel}>
          {t("editor.cancel")}
        </button>
      </div>
    </div>
  );
}

function InkusPanel({ onSynced, onStatus }: { onSynced: () => Promise<void>; onStatus: (enabled: boolean) => void }) {
  const { t } = useI18n();
  const [enabled, setEnabledState] = useState(false);
  const setEnabled = (value: boolean) => {
    setEnabledState(value);
    onStatus(value);
  };
  const [report, setReport] = useState<SyncReport | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .inkusStatus()
      .then((s) => {
        setEnabled(s.enabled);
        if (s.lastSync) {
          setReport(s.lastSync.result as SyncReport);
          setLastAt(s.lastSync.createdAt);
        }
      })
      .catch(() => setEnabled(false));
    // Load once; onStatus only mirrors the flag to the parent.
  }, []);

  if (!enabled) return <p className="muted small inkus-off">{t("inkus.disabled")}</p>;

  const sync = async () => {
    setBusy(true);
    try {
      const res = await api.inkusSync();
      setReport(res.report);
      setLastAt(new Date().toISOString());
      setError(null);
      await onSynced();
    } catch (e) {
      setError(e instanceof ApiError ? [t(`inkusError.${e.message}` as MessageKey), ...(e.details ?? [])].join(" · ") : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inkus" data-testid="inkus-panel">
      <button onClick={sync} disabled={busy} data-testid="inkus-sync">
        {busy ? t("inkus.syncing") : t("inkus.sync")}
      </button>
      {report && (
        <span className="small" data-testid="inkus-report">
          {t("inkus.report", {
            imported: report.imported.length,
            adopted: report.adopted.length,
            updated: report.updated.length,
            retired: report.retired.length,
            pushed: report.pushed.length,
          })}
          {report.overwritten.length > 0 && ` · ${t("inkus.overwritten", { count: report.overwritten.length })}`}
          {report.errors.length > 0 && ` · ${t("inkus.errors", { count: report.errors.length })}`}
          {lastAt && <span className="muted"> · {new Date(lastAt).toLocaleString()}</span>}
        </span>
      )}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}

export function Agents({ agents, grants, forbidden, lifeMap, onLifeMapChanged, onGenerate, onChanged, onNext }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [inkusEnabled, setInkusEnabled] = useState(false);

  const exportToInkus = async (agent: AgentDefinition) => {
    try {
      await api.inkusExport(agent.id);
      note(agent.id, "");
      await onChanged();
    } catch (e) {
      note(agent.id, e instanceof ApiError ? t(`inkusError.${e.message}` as MessageKey) : String(e));
    }
  };
  const [notices, setNotices] = useState<Record<string, string>>({});

  // Personal and work stay apart unless the owner lets this agent cross (saved in the life map).
  const setBridge = async (agentId: string, allowed: boolean) => {
    const bridges = (lifeMap.boundaries.contextBridges ?? []).filter((id) => id !== agentId);
    const next = { ...lifeMap, boundaries: { ...lifeMap.boundaries, contextBridges: allowed ? [...bridges, agentId] : bridges } };
    try {
      onLifeMapChanged((await api.saveLifeMap(next)).lifeMap);
      note(agentId, "");
    } catch (e) {
      note(agentId, String(e));
    }
  };
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
        <InkusPanel onSynced={onChanged} onStatus={setInkusEnabled} />
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
              <article key={a.id} className={`card agent state-${a.state}`} data-testid={`agent-${a.id}`}>
                <header>
                  <h3>{agentLabel(t, a)}</h3>
                  <span className={`badge state-${a.state}`} data-testid="agent-state">
                    {t(`state.${a.state}`)}
                  </span>
                </header>
                <p className="muted small tags">
                  {a.origin === "inkus" && <span className="badge origin-inkus">Inkus</span>}
                  {a.inkus && a.origin !== "inkus" && <span className="badge origin-synced">{t("agents.inInkus")}</span>}
                  {a.domain ? t(`domain.${a.domain}`) : t("agents.crossCutting")} · {t(`reason.${a.reason}`)}
                  {a.inkus && (a.revision ?? 0) > a.inkus.syncedRevision && (
                    <span className="badge unsynced"> {t("agents.unsynced")}</span>
                  )}
                </p>
                {!a.domain && (
                  <p className="small">
                    {t("agents.actsIn")}{" "}
                    {(a.actionDomains ?? []).length > 0
                      ? (a.actionDomains ?? []).map((d) => t(`domain.${d}`)).join(", ")
                      : t("agents.actsNowhere")}
                  </p>
                )}
                {agentContexts(a, lifeMap.boundaries).length > 1 && (
                  <label className="check small bridge">
                    <input
                      type="checkbox"
                      checked={(lifeMap.boundaries.contextBridges ?? []).includes(a.id)}
                      onChange={(e) => void setBridge(a.id, e.target.checked)}
                      data-testid="context-bridge"
                    />{" "}
                    {t("agents.bridge")}
                  </label>
                )}
                <p>
                  <strong>{t("agents.goal")}:</strong> {a.goal || <em className="muted">{t("agents.noGoal")}</em>}
                </p>
                {(a.responsibilities ?? []).length > 0 && (
                  <ul className="responsibilities small">
                    {(a.responsibilities ?? []).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}

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

                {editing === a.id ? (
                  <AgentEditor
                    agent={a}
                    forbidden={forbidden}
                    onCancel={() => setEditing(null)}
                    onSaved={async (error) => {
                      if (error) return note(a.id, error);
                      setEditing(null);
                      note(a.id, "");
                      await onChanged();
                    }}
                  />
                ) : (
                  a.state !== "archived" && (
                    <p className="links">
                      <button className="link edit" onClick={() => setEditing(a.id)} data-testid="edit-agent">
                        {t("agents.edit")}
                      </button>
                      {inkusEnabled && !a.inkus && (
                        <button className="link" onClick={() => exportToInkus(a)} data-testid="export-inkus">
                          {t("agents.exportInkus")}
                        </button>
                      )}
                    </p>
                  )
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
