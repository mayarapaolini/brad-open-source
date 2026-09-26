import { useEffect, useState } from "react";
import { demoInbox, type DecisionRecord, type LifeDomainId } from "@brad/domain";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/en";

// Records are stored as JSON; read them loosely and only for display.
type Loose = Record<string, unknown>;

export function Audit({ onError }: { onError: (e: unknown) => void }) {
  const { t, lang } = useI18n();
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);

  useEffect(() => {
    api
      .getDecisions()
      .then((r) => setRecords(r.decisions))
      .catch(onError);
  }, [onError]);

  const agentName = (id: unknown) => {
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
      case "import":
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
    </section>
  );
}
