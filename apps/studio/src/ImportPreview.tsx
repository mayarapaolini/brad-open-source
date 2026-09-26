import { useState } from "react";
import type { ImportPlan } from "@brad/domain";
import { useI18n } from "./i18n";

interface Props {
  plan: ImportPlan;
  alreadyImported: boolean;
  onApply: (timeZone: string | undefined) => void;
  onCancel: () => void;
}

const COMMON_ZONES = ["America/Sao_Paulo", "America/New_York", "Europe/Lisbon", "Europe/London", "UTC"];

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Shows what an import would change and asks for the decisions only the owner can make. */
export function ImportPreview({ plan, alreadyImported, onApply, onCancel }: Props) {
  const { t } = useI18n();
  const utc = plan.warnings.some((w) => w.code === "timezone_utc");
  const suggested = plan.timeZone.from && plan.timeZone.from !== "UTC" ? plan.timeZone.from : browserZone();
  const [zone, setZone] = useState(utc ? (suggested === "UTC" ? "America/Sao_Paulo" : suggested) : plan.timeZone.to);
  const zones = [...new Set([zone, suggested, ...COMMON_ZONES])];

  return (
    <section className="import-preview" data-testid="import-preview">
      <h2>{t("importPreview.title")}</h2>
      {plan.identical ? (
        <p>{t("importPreview.identical")}</p>
      ) : (
        <ul className="small">
          <li>{t("importPreview.assessments", { count: plan.assessments.length })}</li>
          <li>
            {t("importPreview.people", {
              added: plan.people.added.length,
              removed: plan.people.removed.length,
              changed: plan.people.changed.length,
            })}
          </li>
          <li>
            {t("importPreview.agents", {
              added: plan.agents.added.length,
              removed: plan.agents.removed.length,
              updated: plan.agents.updated.length,
            })}
          </li>
          <li>{t("importPreview.grants", { added: plan.grants.added, removed: plan.grants.removed })}</li>
          {plan.boundariesChanged && <li>{t("importPreview.boundaries")}</li>}
        </ul>
      )}

      {plan.warnings.map((w) => (
        <p key={w.code} className="notice" data-testid={`import-warning-${w.code}`}>
          {w.code === "active_agents_paused"
            ? t("importPreview.warning.active_agents_paused", { count: w.agentIds.length })
            : w.code === "grants_present"
              ? t("importPreview.warning.grants_present", { count: w.count })
              : t(`importPreview.warning.${w.code}`)}
        </p>
      ))}
      {alreadyImported && <p className="notice">{t("importPreview.alreadyImported")}</p>}

      {utc && (
        <label className="field inline">
          {t("importPreview.timeZone")}
          <select value={zone} onChange={(e) => setZone(e.target.value)} data-testid="import-timezone">
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="muted small">{t("importPreview.quietHoursNote")}</span>
        </label>
      )}

      <div className="actions left">
        <button className="primary" onClick={() => onApply(utc ? zone : undefined)} data-testid="import-apply">
          {t("importPreview.apply")}
        </button>
        <button className="ghost" onClick={onCancel}>
          {t("editor.cancel")}
        </button>
      </div>
    </section>
  );
}
