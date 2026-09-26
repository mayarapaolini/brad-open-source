import type { DomainAssessment } from "@brad/domain";
import { useI18n } from "./i18n";

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 120;

function point(angle: number, r: number): string {
  return `${CENTER + r * Math.cos(angle)},${CENTER + r * Math.sin(angle)}`;
}

function wedge(index: number, count: number, value: number): string {
  const step = (2 * Math.PI) / count;
  const start = -Math.PI / 2 + index * step + 0.02;
  const end = start + step - 0.04;
  const r = (Math.max(0, value) / 10) * RADIUS;
  return `M ${CENTER},${CENTER} L ${point(start, r)} A ${r},${r} 0 0 1 ${point(end, r)} Z`;
}

/** Wheel of Life: filled wedges show satisfaction, outlines show importance. */
export function Wheel({ assessments }: { assessments: DomainAssessment[] }) {
  const { t } = useI18n();
  const count = assessments.length;
  return (
    <figure className="wheel">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t("diagnostic.legend")}>
        {[2, 4, 6, 8, 10].map((v) => (
          <circle key={v} cx={CENTER} cy={CENTER} r={(v / 10) * RADIUS} className="ring" />
        ))}
        {assessments.map((a, i) => (
          <g key={a.domain}>
            <path d={wedge(i, count, a.satisfaction)} className={`fill d${i}`} />
            <path d={wedge(i, count, a.importance)} className={`outline d${i}`} />
            <text
              x={CENTER + (RADIUS + 24) * Math.cos(-Math.PI / 2 + (i + 0.5) * ((2 * Math.PI) / count))}
              y={CENTER + (RADIUS + 24) * Math.sin(-Math.PI / 2 + (i + 0.5) * ((2 * Math.PI) / count))}
              className="label"
            >
              {t(`domain.${a.domain}`)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="muted small">{t("diagnostic.legend")}</figcaption>
    </figure>
  );
}
