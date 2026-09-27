import { useEffect, useState } from "react";
import { demoInbox, type AgentDefinition, type DecisionRecord, type LifeDomainId } from "@brad/domain";
import { agentLabel } from "../agentLabel";
import type { Suggestion } from "@brad/priority-engine";
import { api, type RestoreScope, type SnapshotInfo } from "../api";
import { describeSuggestion } from "../suggestions";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";

// Records are stored as JSON; read them loosely and only for display.
type Loose = Record<string, unknown>;

export function Audit({
  onError,
  agents,
  onRestore,
}: {
  onError: (e: unknown) => void;
  agents: AgentDefinition[];
  onRestore: (snapshotId: number, scope: RestoreScope) => void;
}) {
  const { t, lang } = useI18n();
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);

  useEffect(() => {
    api
      .getDecisions()
      .then((r) => setRecords(r.decisions))
      .catch(onError);
    api
      .snapshots()
      .then((r) => setSnapshots(r.snapshots))
      .catch(onError);
  }, [onError]);

  const agentName = (id: unknown) => {
    const known = agents.find((a) => a.id === id);
    if (known) return agentLabel(t, known);
    const domain = String(id ?? "").replace(/^agent-/, "") as LifeDomainId;
    const key = `domain.${domain}` as MessageKey;
    return t(key) === key ? String(id) : t("agents.name", { domain: t(key) });
  };

  const describe = (r: DecisionRecord): string => {
    const input = (r.input ?? {}) as Loose;
    const result = (r.result ?? {}) as Loose;
    switch (r.kind) {
      case "priority": {
        const order = (result.order as { id: string }[] | undefined) ?? [];
        const top = demoInbox.find((i) => i.id === order[0]?.id);
        return t("audit.priority", { count: order.length, top: top ? `“${top.subject[lang]}”` : (order[0]?.id ?? "—") });
      }
      case "policy": {
        const request = (input.request ?? {}) as Loose;
        const text = t("audit.policy", {
          agent: agentName(request.agentId),
          capability: t(`capability.${request.capability}` as MessageKey),
          outcome: t(`outcome.${result.outcome}` as MessageKey),
        });
        return input.assumeState || input.assumeGrant ? `${text} ${t("audit.whatIf")}` : text;
      }
      case "lifecycle":
        if (input.action === "edit") {
          return t("audit.edit", {
            agent: agentName(input.agentId),
            fields: ((input.fields as string[]) ?? []).map((f) => t(`editField.${f}` as MessageKey)).join(", ") || "—",
          });
        }
        if (input.action === "regenerate") {
          return t("audit.regenerate", {
            reset: ((result.reset as string[]) ?? []).length,
            archived: ((result.archived as string[]) ?? []).length,
          });
        }
        return t(result.ok ? "audit.transition" : "audit.transitionBlocked", {
          agent: agentName(input.agentId),
          from: t(`state.${input.from}` as MessageKey),
          to: t(`state.${input.to}` as MessageKey),
          reason: result.ok ? "" : t(`transition.${result.reason}` as MessageKey, { to: t(`state.${input.to}` as MessageKey) }),
        });
      case "grant":
        return t(input.action === "grant" ? "audit.grant" : "audit.revoke", {
          agent: agentName(input.agentId),
          capability: t(`capability.${input.capability}` as MessageKey),
        });
      case "correction": {
        const item = demoInbox.find((i) => i.id === input.itemId);
        const subject = item ? `“${item.subject[lang]}”` : String(input.itemId);
        if (input.action === "apply") {
          const after = result.after as { tier: string } | null;
          return t("audit.correctionApply", {
            change: describeSuggestion(t, { change: input.change, params: input.params, projected: null } as Suggestion),
            item: subject,
            tier: after ? t(`tier.${after.tier}` as MessageKey) : "—",
          });
        }
        const suggestion = result.suggestion as Suggestion | null;
        return t("audit.correctionFeedback", {
          item: subject,
          expected: t(`tier.${input.expectedTier}` as MessageKey),
          suggestion: suggestion ? describeSuggestion(t, suggestion) : t("correction.noSuggestion"),
        });
      }
      case "sync": {
        if (input.action === "export") return t("audit.inkusExport", { agent: agentName(input.agentId) });
        const report = result as Record<string, unknown[] | undefined>;
        return t("audit.sync", {
          imported: report.imported?.length ?? 0,
          adopted: report.adopted?.length ?? 0,
          updated: report.updated?.length ?? 0,
          retired: report.retired?.length ?? 0,
          pushed: report.pushed?.length ?? 0,
          overwritten: report.overwritten?.length ?? 0,
          errors: report.errors?.length ?? 0,
        });
      }
      case "discovery":
        return input.action === "sync_consent"
          ? t((result.syncToInkus ? "audit.syncConsentOn" : "audit.syncConsentOff") as MessageKey)
          : t("audit.synthesis", { item: String(input.itemId), verdict: t(`discovery.verdict.${input.verdict}` as MessageKey) });
      case "secretary":
        if (input.action === "checkin") return t("audit.checkin", { load: t(`secretary.load.${result.load}` as MessageKey) });
        if (input.action === "silence" || input.action === "unsilence")
          return t(`audit.${input.action}` as MessageKey, { domain: t(`domain.${input.domain}` as MessageKey) });
        return t("audit.proposal", {
          proposal: String(input.proposalId),
          action: t(`secretary.feedback.${input.action}` as MessageKey),
        });
      case "share": {
        const included = (result.included as LifeDomainId[]).map((d) => t(`domain.${d}`)).join(", ") || "—";
        const excluded = (result.excluded as { domain: LifeDomainId }[]).map((e) => t(`domain.${e.domain}`)).join(", ") || "—";
        return t("audit.share", { audience: t(`context.${String(input.audience)}` as MessageKey), included, excluded });
      }
      case "import":
        if (input.action === "restore")
          return t(`audit.restore.${String(input.scope ?? "all")}` as MessageKey, { id: Number(input.snapshotId) });
        return t("audit.import", { agents: Number(result.agents ?? 0), grants: Number(result.grants ?? 0) });
    }
  };

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-GB", { dateStyle: "short", timeStyle: "medium" }).format(
      new Date(iso),
    );

  return (
    <section>
      <h2>{t("audit.title")}</h2>
      <p className="muted">{t("audit.intro")}</p>
      {records === null ? null : records.length === 0 ? (
        <p className="empty">{t("audit.empty")}</p>
      ) : (
        <ol className="audit" data-testid="audit-list">
          {records.map((r) => (
            <li key={r.id} data-testid="audit-item">
              <span className="muted small tabular">#{r.id}</span>
              <span className={`badge kind-${r.kind}`}>{t(`audit.kind.${r.kind}`)}</span>
              <span>{describe(r)}</span>
              <span className="muted small">{formatTime(r.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
      {snapshots.length > 0 && (
        <>
          <h3>{t("audit.versions")}</h3>
          <p className="muted small">{t("audit.versionsIntro")}</p>
          <ol className="audit" data-testid="snapshot-list">
            {snapshots.map((s) => (
              <li key={s.id}>
                <span className="muted small tabular">v{s.id}</span>
                <span className="badge kind-import">{t(`audit.snapshot.${s.reason}` as MessageKey)}</span>
                <span className="muted small">{formatTime(s.createdAt)}</span>
                <span className="small">
                  {t("audit.snapshotSummary", { agents: s.agents, grants: s.grants })}
                  {" · "}
                  {t("audit.snapshotLifeMap", { people: s.people, goals: s.goals })}
                  {s.answers !== null && ` · ${t("audit.snapshotAnswers", { answers: s.answers })}`}
                </span>
                <span className="restore-actions">
                  <button className="link" onClick={() => onRestore(s.id, "all")} data-testid="snapshot-restore">
                    {t("audit.restoreButton")}
                  </button>
                  <button className="link" onClick={() => onRestore(s.id, "lifeMap")} data-testid="snapshot-restore-lifemap">
                    {t("audit.restoreLifeMap")}
                  </button>
                  {s.answers !== null && (
                    <button className="link" onClick={() => onRestore(s.id, "answers")} data-testid="snapshot-restore-answers">
                      {t("audit.restoreAnswers")}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
