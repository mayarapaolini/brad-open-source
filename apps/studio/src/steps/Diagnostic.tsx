import type { DomainAssessment, LifeMap } from "@brad/domain";
import { useI18n } from "../i18n";
import { Wheel } from "../Wheel";

interface Props {
  lifeMap: LifeMap;
  onChange: (map: LifeMap) => void;
  onNext: () => void;
}

export function Diagnostic({ lifeMap, onChange, onNext }: Props) {
  const { t } = useI18n();

  const update = (domain: DomainAssessment["domain"], patch: Partial<DomainAssessment>) =>
    onChange({
      ...lifeMap,
      assessments: lifeMap.assessments.map((a) => (a.domain === domain ? { ...a, ...patch } : a)),
    });

  return (
    <section>
      <h2>{t("diagnostic.title")}</h2>
      <p className="muted">{t("diagnostic.intro")}</p>
      <div className="diagnostic">
        <Wheel assessments={lifeMap.assessments} />
        <table className="scores">
          <thead>
            <tr>
              <th />
              <th>{t("diagnostic.satisfaction")}</th>
              <th>{t("diagnostic.importance")}</th>
              <th>{t("diagnostic.gap")}</th>
            </tr>
          </thead>
          <tbody>
            {lifeMap.assessments.map((a) => {
              const gap = a.importance - a.satisfaction;
              return (
                <tr key={a.domain}>
                  <th scope="row">{t(`domain.${a.domain}`)}</th>
                  {(["satisfaction", "importance"] as const).map((field) => (
                    <td key={field}>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        value={a[field]}
                        aria-label={`${t(`domain.${a.domain}`)} · ${t(`diagnostic.${field}`)}`}
                        onChange={(e) => update(a.domain, { [field]: Number(e.target.value) })}
                      />
                      <output>{a[field]}</output>
                    </td>
                  ))}
                  <td className={gap >= 3 ? "gap high" : "gap"}>{gap > 0 ? `+${gap}` : gap}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="primary" onClick={onNext}>
          {t("common.save")} · {t("common.next")} →
        </button>
      </div>
    </section>
  );
}
