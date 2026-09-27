import type { AgentDefinition, Capability, LifeMap } from "@brad/domain";
import { BUILTIN_CATALOG, answerTags, slotAnswer, type Answer, type Catalog } from "@brad/discovery";

type Lang = "en" | "pt";

/** What the help the owner asked for means as responsibilities. Every one stops before acting outside Brad. */
const HELP: Record<string, { en: string; pt: string; capabilities: Capability[] }> = {
  prepare_draft: {
    en: "Prepare drafts for your review; never send them",
    pt: "Preparar rascunhos para sua revisão; nunca enviar",
    capabilities: ["draft_reply"],
  },
  organise: { en: "Organise the information for this area", pt: "Organizar as informações desta área", capabilities: ["read_notes"] },
  show_options: { en: "Show options and a possible next step", pt: "Mostrar opções e um possível próximo passo", capabilities: ["read_notes"] },
  remind_when_asked: { en: "Remind you only when and how you asked", pt: "Lembrar só quando e como você pediu", capabilities: ["read_calendar"] },
  ask_before_acting: { en: "Ask before doing anything", pt: "Perguntar antes de fazer qualquer coisa", capabilities: [] },
};

export interface ProposedContent {
  goal: string;
  responsibilities: string[];
  requestedCapabilities: Capability[];
}

export interface InterviewProposal {
  agentId: string;
  domain: NonNullable<AgentDefinition["domain"]>;
  /** The answers this proposal restates, for the audit trail and to link them in Inkus. */
  basis: string[];
  /** The owner's own words, shown next to Brad's reading of them. */
  ownerWords: string[];
  current: ProposedContent;
  proposed: ProposedContent;
  /** Capabilities the answers suggest but the owner's boundaries forbid. */
  excludedByBoundary: Capability[];
  /** True when every basis answer was confirmed or corrected by the owner. */
  confirmed: boolean;
  warnings: ("summary_needs_change" | "do_not_act")[];
  changed: boolean;
}

function words(answer: Answer | undefined, catalog: Catalog, lang: Lang): string[] {
  if (!answer) return [];
  const question = catalog.get(answer.questionId);
  const labels = answer.selectedOptionIds.map((id) => question?.options.find((o) => o.id === id)?.label[lang] ?? id);
  return [...labels, ...[answer.otherText, answer.freeText].filter((t): t is string => Boolean(t))];
}

/**
 * Turns the owner's interview answers for one area into a proposed update of that area's agent
 * (workflow "Configurar e ajustar agentes por perguntas"). Deterministic and explainable: the goal
 * is the owner's own words, responsibilities come from the help they asked for, and capabilities
 * are only *requested*, never granted. Nothing is applied until the owner confirms.
 */
export function proposeFromInterview(
  agent: AgentDefinition,
  map: LifeMap,
  answers: Answer[],
  catalog: Catalog = BUILTIN_CATALOG,
  lang: Lang = "pt",
): InterviewProposal | null {
  const domain = agent.domain;
  if (!domain || agent.state === "archived") return null;
  const meaning = slotAnswer(catalog, answers, domain, "meaning");
  const support = slotAnswer(catalog, answers, domain, "support");
  const barrier = slotAnswer(catalog, answers, domain, "barrier");
  const frequency = slotAnswer(catalog, answers, domain, "frequency");
  const confirmation = slotAnswer(catalog, answers, domain, "confirmation");
  if (!meaning && !support) return null;

  const tags = support ? answerTags(catalog, support) : [];
  const warnings: InterviewProposal["warnings"] = [];
  if (confirmation && answerTags(catalog, confirmation).includes("needs_change")) warnings.push("summary_needs_change");

  // Goal: the owner's own words for what this area should be, else the current goal.
  const own = meaning ? [meaning.otherText, meaning.freeText].filter((t): t is string => Boolean(t)) : [];
  const goal = own.join(" — ") || words(meaning, catalog, lang).join(", ") || agent.goal;

  let responsibilities: string[];
  let wanted: Capability[];
  if (tags.includes("do_not_act")) {
    warnings.push("do_not_act");
    responsibilities = [lang === "pt" ? "Não atuar nesta área" : "Do not act in this area"];
    wanted = [];
  } else {
    const helps = Object.keys(HELP).filter((h) => tags.includes(h));
    responsibilities = helps.map((h) => HELP[h]![lang]);
    const barriers = words(barrier, catalog, lang);
    if (barriers.length > 0) responsibilities.push(`${lang === "pt" ? "Levar em conta" : "Take into account"}: ${barriers.join(", ")}`);
    const cadence = words(frequency, catalog, lang);
    if (cadence.length > 0) responsibilities.push(`${lang === "pt" ? "Rever com você" : "Review with you"}: ${cadence.join(", ")}`);
    if (responsibilities.length === 0) responsibilities = agent.responsibilities ?? [];
    wanted = [...new Set([...agent.requestedCapabilities, ...helps.flatMap((h) => HELP[h]!.capabilities)])];
  }
  const forbidden = map.boundaries.forbiddenCapabilities;
  const requestedCapabilities = wanted.filter((c) => !forbidden.includes(c));
  const basisAnswers = [meaning, support, barrier, frequency, confirmation].filter((a): a is Answer => Boolean(a));

  const current = { goal: agent.goal, responsibilities: agent.responsibilities ?? [], requestedCapabilities: agent.requestedCapabilities };
  const proposed = { goal, responsibilities, requestedCapabilities };
  return {
    agentId: agent.id,
    domain,
    basis: basisAnswers.map((a) => a.id),
    ownerWords: basisAnswers.flatMap((a) => words(a, catalog, lang)),
    current,
    proposed,
    excludedByBoundary: wanted.filter((c) => forbidden.includes(c)),
    confirmed: basisAnswers.every((a) => a.status === "user_confirmed" || a.status === "corrected"),
    warnings,
    changed: JSON.stringify(current) !== JSON.stringify(proposed),
  };
}
