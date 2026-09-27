import {
  CAPABILITIES,
  LIFE_DOMAINS,
  RELATIONSHIPS,
  type Boundaries,
  type Capability,
  workDomains,
  type LifeDomainId,
  type LifeMap,
  type Person,
} from "@brad/domain";
import { useI18n } from "../i18n";

interface Props {
  lifeMap: LifeMap;
  onChange: (map: LifeMap) => void;
  onNext: () => void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function LifeMapEditor({ lifeMap, onChange, onNext }: Props) {
  const { t } = useI18n();
  const { boundaries } = lifeMap;

  const setPerson = (id: string, patch: Partial<Person>) =>
    onChange({ ...lifeMap, people: lifeMap.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const setBoundaries = (patch: Partial<Boundaries>) =>
    onChange({ ...lifeMap, boundaries: { ...boundaries, ...patch } });

  const addPerson = () => {
    const n = lifeMap.people.length + 1;
    let id = `p-${n}`;
    while (lifeMap.people.some((p) => p.id === id)) id += "x";
    onChange({
      ...lifeMap,
      people: [
        ...lifeMap.people,
        { id, name: "", relationship: "friend", domain: "social", priority: 3, bypassQuietHours: false },
      ],
    });
  };

  return (
    <section>
      <h2>{t("lifeMap.title")}</h2>
      <p className="muted">{t("lifeMap.intro")}</p>

      <label className="field inline">
        {t("lifeMap.displayName")}
        <input
          value={lifeMap.owner.displayName}
          onChange={(e) => onChange({ ...lifeMap, owner: { displayName: e.target.value } })}
        />
      </label>

      <h3>{t("lifeMap.goals")}</h3>
      <div className="goals">
        {lifeMap.assessments.map((a) => (
          <label key={a.domain} className="field">
            <span>
              {t(`domain.${a.domain}`)} <span className="muted small">({a.importance}/10)</span>
            </span>
            <input
              value={a.goal}
              placeholder={t("lifeMap.goalPlaceholder")}
              onChange={(e) =>
                onChange({
                  ...lifeMap,
                  assessments: lifeMap.assessments.map((x) =>
                    x.domain === a.domain ? { ...x, goal: e.target.value } : x,
                  ),
                })
              }
            />
          </label>
        ))}
      </div>

      <h3>{t("lifeMap.people")}</h3>
      <div className="table-wrap">
        <table className="people">
          <thead>
            <tr>
              <th>{t("lifeMap.name")}</th>
              <th>{t("lifeMap.relationship")}</th>
              <th>{t("lifeMap.domain")}</th>
              <th>{t("lifeMap.priority")}</th>
              <th>{t("lifeMap.bypass")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lifeMap.people.map((p) => (
              <tr key={p.id}>
                <td>
                  <input value={p.name} aria-label={t("lifeMap.name")} onChange={(e) => setPerson(p.id, { name: e.target.value })} />
                </td>
                <td>
                  <select
                    value={p.relationship}
                    aria-label={t("lifeMap.relationship")}
                    onChange={(e) => setPerson(p.id, { relationship: e.target.value as Person["relationship"] })}
                  >
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {t(`relationship.${r}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={p.domain}
                    aria-label={t("lifeMap.domain")}
                    onChange={(e) => setPerson(p.id, { domain: e.target.value as LifeDomainId })}
                  >
                    {LIFE_DOMAINS.map((d) => (
                      <option key={d} value={d}>
                        {t(`domain.${d}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={p.priority}
                    aria-label={t("lifeMap.priority")}
                    onChange={(e) => setPerson(p.id, { priority: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="center">
                  <input
                    type="checkbox"
                    checked={p.bypassQuietHours}
                    aria-label={t("lifeMap.bypass")}
                    onChange={(e) => setPerson(p.id, { bypassQuietHours: e.target.checked })}
                  />
                </td>
                <td>
                  <button
                    className="ghost"
                    onClick={() => onChange({ ...lifeMap, people: lifeMap.people.filter((x) => x.id !== p.id) })}
                  >
                    {t("common.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="ghost" onClick={addPerson}>
        + {t("lifeMap.addPerson")}
      </button>

      <h3>{t("lifeMap.boundaries")}</h3>
      <div className="boundaries">
        <label className="field">
          {t("lifeMap.timeZone")}
          <input value={boundaries.timeZone} onChange={(e) => setBoundaries({ timeZone: e.target.value })} />
        </label>
        <fieldset>
          <legend>{t("lifeMap.quietHours")}</legend>
          <label>
            <input
              type="checkbox"
              checked={boundaries.quietHours !== null}
              onChange={(e) => setBoundaries({ quietHours: e.target.checked ? { start: "22:00", end: "07:00" } : null })}
            />{" "}
            {t("lifeMap.quietEnabled")}
          </label>
          {boundaries.quietHours && (
            <span className="time-range">
              <input
                type="time"
                value={boundaries.quietHours.start}
                onChange={(e) => setBoundaries({ quietHours: { ...boundaries.quietHours!, start: e.target.value } })}
              />
              –
              <input
                type="time"
                value={boundaries.quietHours.end}
                onChange={(e) => setBoundaries({ quietHours: { ...boundaries.quietHours!, end: e.target.value } })}
              />
            </span>
          )}
        </fieldset>
        <fieldset>
          <legend>{t("lifeMap.forbidden")}</legend>
          {CAPABILITIES.map((c: Capability) => (
            <label key={c} className="check">
              <input
                type="checkbox"
                checked={boundaries.forbiddenCapabilities.includes(c)}
                onChange={() => setBoundaries({ forbiddenCapabilities: toggle(boundaries.forbiddenCapabilities, c) })}
              />{" "}
              {t(`capability.${c}`)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t("lifeMap.sensitive")}</legend>
          {LIFE_DOMAINS.map((d) => (
            <label key={d} className="check">
              <input
                type="checkbox"
                checked={boundaries.sensitiveDomains.includes(d)}
                onChange={() => setBoundaries({ sensitiveDomains: toggle(boundaries.sensitiveDomains, d) })}
              />{" "}
              {t(`domain.${d}`)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t("lifeMap.work")}</legend>
          {LIFE_DOMAINS.map((d) => (
            <label key={d} className="check">
              <input
                type="checkbox"
                checked={workDomains(boundaries).includes(d)}
                onChange={() => setBoundaries({ workDomains: toggle([...workDomains(boundaries)], d) })}
              />{" "}
              {t(`domain.${d}`)}
            </label>
          ))}
          <p className="muted small">{t("lifeMap.workHint")}</p>
        </fieldset>
      </div>

      <div className="actions">
        <button className="primary" onClick={onNext}>
          {t("common.save")} · {t("common.next")} →
        </button>
      </div>
    </section>
  );
}
