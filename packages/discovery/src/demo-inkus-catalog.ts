import type { CatalogRecord } from "./catalogs";

const UNIVERSAL = [
  { id: "other", label: "Outra resposta" },
  { id: "unknown", label: "Não sei ainda" },
  { id: "skip", label: "Prefiro não responder" },
];

function options(labels: string[]): string {
  return JSON.stringify([...labels.map((label, i) => ({ id: `opt_${i + 1}`, label })), ...UNIVERSAL]);
}

let n = 0;
function record(fields: Record<string, unknown>): CatalogRecord {
  n += 1;
  return { id: `demo-q-${String(n).padStart(2, "0")}`, fields: { status: "active", source: "demo", ...fields } };
}

/**
 * A synthetic question catalog with the same shape as the Inkus database "Perguntas para
 * configurar agentes": positional option ids (opt_1…), branch_json rules and domain triggers.
 * Used by tests and the offline demo; the wording is illustrative.
 */
export function demoInkusCatalogRecords(): CatalogRecord[] {
  n = 0;
  return [
    record({ question_id: "assessment.satisfaction", order: 1, stage: "initial", domain: "all", construct: "wellbeing", answer_type: "scale_0_10", prompt_pt_br: "Quão satisfeita você está com esta área, de 0 a 10?", options_json: options(["0–5", "6–10"]), branch_json: '{"next":"assessment.importance"}' }),
    record({ question_id: "assessment.importance", order: 2, stage: "initial", domain: "all", construct: "values", answer_type: "scale_0_10", prompt_pt_br: "Quão importante é esta área agora, de 0 a 10?", options_json: options(["0–5", "6–10"]), branch_json: '{"next":"goal.meaning"}' }),
    record({ question_id: "goal.meaning", order: 3, stage: "discovery", domain: "all", construct: "personal_goal", answer_type: "multi_select_with_free_text", prompt_pt_br: "O que você gostaria de preservar ou mudar aqui?", options_json: options(["Preservar como está", "Reduzir um peso", "Ganhar tempo"]), branch_json: '{"next":"priority.protect_or_change"}' }),
    record({ question_id: "priority.protect_or_change", order: 4, stage: "discovery", domain: "all", construct: "priority_direction", answer_type: "single_select_with_free_text", prompt_pt_br: "O que faria diferença agora?", options_json: options(["Proteger o que já funciona", "Resolver algo urgente", "Fazer um pequeno ajuste", "Só entender melhor", "Não quero mexer nisso agora"]), branch_json: '{"if":"importance>=7 && satisfaction<=3","next":"barrier.comb","else":"autonomy.control"}' }),
    record({ question_id: "barrier.comb", order: 5, stage: "deepening", domain: "all", construct: "COM-B", answer_type: "multi_select_with_free_text", prompt_pt_br: "O que mais impede uma melhora hoje?", options_json: options(["Falta de tempo", "Falta de informação", "Não quero agir agora"]), branch_json: '{"next":"autonomy.control"}' }),
    record({ question_id: "autonomy.control", order: 6, stage: "deepening", domain: "all", construct: "autonomy", answer_type: "single_select_with_free_text", prompt_pt_br: "Quanto disso você consegue decidir?", options_json: options(["Consigo decidir", "Dependo de outras pessoas"]), branch_json: '{"next":"help.preference"}' }),
    record({ question_id: "help.preference", order: 7, stage: "configuration", domain: "all", construct: "agency", answer_type: "multi_select_with_free_text", prompt_pt_br: "Como você quer que eu ajude nesta área?", options_json: options(["Só quando eu pedir", "Organizar informações", "Mostrar opções", "Preparar rascunhos", "Não atuar"]), branch_json: '{"next":"cadence.preference"}' }),
    record({ question_id: "cadence.preference", order: 8, stage: "configuration", domain: "all", construct: "contact_preference", answer_type: "single_select_with_free_text", prompt_pt_br: "Quando você quer rever este assunto?", options_json: options(["Esta semana", "Mensalmente"]), branch_json: '{"next":"summary.confirm"}' }),
    record({ question_id: "summary.confirm", order: 9, stage: "confirmation", domain: "all", construct: "reflective_listening", answer_type: "single_select_with_free_text", prompt_pt_br: "Resumi seu objetivo e o tipo de ajuda. O que devo corrigir?", options_json: options(["Está certo", "Precisa mudar"]), branch_json: '{"end":true}' }),
    record({ question_id: "finances.weight", order: 10, stage: "deepening", domain: "finances", construct: "context", answer_type: "multi_select_with_free_text", prompt_pt_br: "O que pesa mais nas finanças agora?", options_json: options(["Dívidas", "Impostos"]), branch_json: '{"trigger":"domain=finances && satisfaction<=4","then":"barrier.comb"}' }),
    record({ question_id: "family.protect", order: 11, stage: "deepening", domain: "family", construct: "values", answer_type: "multi_select_with_free_text", prompt_pt_br: "Que momento com a família você quer proteger?", options_json: options(["Refeição", "Passeio", "Conversa"]), branch_json: '{"trigger":"domain=family && importance>=7 && satisfaction>=7","then":"help.preference"}' }),
    record({ question_id: "retired.question", order: 12, stage: "deepening", domain: "all", status: "inactive", prompt_pt_br: "Pergunta antiga", options_json: options(["A"]), branch_json: '{"end":true}' }),
  ];
}
