import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import {
  AgentSpecError,
  buildAgentPackage,
  canonicalJson,
  parseAgentPackage,
  validateAgentSpec,
  validateAgentSpecFrontmatter,
  type AgentPackageFiles,
  type AgentSpecFrontmatter,
  type AgentSpecV1,
} from "../src/agent-spec";

// Agent Spec v1, conforme RFC-002 (rascunho no Inkus, aguarda aprovação).
// Dados fictícios apenas.

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, "../schema/agent-spec-v1.schema.json"), "utf8")) as {
  $schema: string;
  required: string[];
  properties: Record<string, unknown>;
  additionalProperties: boolean;
};
const spec = JSON.parse(readFileSync(resolve(here, "fixtures/agent-spec.synthetic.json"), "utf8")) as AgentSpecV1;
const minimal = JSON.parse(readFileSync(resolve(here, "fixtures/agent-spec.minimal.json"), "utf8")) as AgentSpecV1;

// Validador JSON Schema real (ajv, draft 2020-12). Serve para garantir que o schema e o validador TypeScript não divergem.
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateWithSchema = ajv.compile(schema);

const frontmatter: AgentSpecFrontmatter = {
  id: "agent-exemplo",
  name: "Agente Exemplo",
  version: 1,
  schema_version: 1,
  status: "draft",
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("Agent Spec v1: contrato do schema", () => {
  it("declara JSON Schema 2020-12 e rejeita chaves extras", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
  });

  it("o validador cobre exatamente os campos obrigatórios do schema", () => {
    expect(schema.required).toEqual(["mission", "scope", "permissions", "confirmation_required", "models", "routines", "channels", "context_isolation"]);
    expect(Object.keys(schema.properties).sort()).toEqual([...schema.required].sort());
  });
});

describe("Agent Spec v1: validação", () => {
  it("aceita a fixture sintética", () => {
    expect(validateAgentSpec(spec)).toEqual([]);
  });

  it("aceita o frontmatter do agent.md", () => {
    expect(validateAgentSpecFrontmatter(frontmatter)).toEqual([]);
  });

  it("rejeita chave desconhecida no topo", () => {
    expect(validateAgentSpec({ ...spec, api_key: "x" })).toContain("$.api_key: unknown key");
  });

  it("rejeita grants dentro do pacote", () => {
    expect(validateAgentSpec({ ...spec, grants: [] })).toContain("$.grants: unknown key");
  });

  it("rejeita campo obrigatório ausente", () => {
    const missing = clone(spec) as Partial<AgentSpecV1>;
    delete missing.mission;
    expect(validateAgentSpec(missing)).toContain("$.mission: missing");
  });

  it("rejeita custo negativo no orçamento", () => {
    const bad = clone(spec);
    bad.routines[0]!.budget.max_cost = -1;
    expect(validateAgentSpec(bad)).toContain("$.routines[0].budget.max_cost: below 0");
  });

  it("rejeita max_seconds fracionário", () => {
    const bad = clone(spec);
    bad.routines[0]!.budget.max_seconds = 1.5;
    expect(validateAgentSpec(bad)).toContain("$.routines[0].budget.max_seconds: expected integer");
  });

  it("rejeita status de canal fora de active e archived", () => {
    const bad = clone(spec) as unknown as { channels: { status: string }[] };
    bad.channels[0]!.status = "paused";
    expect(validateAgentSpec(bad)).toContain('$.channels[0].status: not one of ["active","archived"]');
  });

  it("rejeita pedido duplicado em permissions.requested", () => {
    const bad = clone(spec);
    bad.permissions.requested = ["read_notes", "read_notes"];
    expect(validateAgentSpec(bad)).toContain("$.permissions.requested: items must be unique");
  });

  it("rejeita modelo de papel ausente", () => {
    const bad = clone(spec) as unknown as { models: Record<string, string> };
    delete bad.models.research;
    expect(validateAgentSpec(bad)).toContain("$.models.research: missing");
  });

  it("rejeita status de ciclo de vida desconhecido no frontmatter", () => {
    expect(validateAgentSpecFrontmatter({ ...frontmatter, status: "live" })).toContain("$.status: not a lifecycle state");
  });

  it("rejeita schema_version diferente de 1", () => {
    expect(validateAgentSpecFrontmatter({ ...frontmatter, schema_version: 2 })).toContain("$.schema_version: must be 1");
  });
});

describe("Agent Spec v1: round-trip com hash", () => {
  it("exportar, importar e exportar de novo gera os mesmos bytes e o mesmo manifest", async () => {
    const first = await buildAgentPackage(frontmatter, spec);
    const parsed = await parseAgentPackage(first);
    const second = await buildAgentPackage(parsed.frontmatter, parsed.spec);
    expect(second).toEqual(first);
    expect(second["manifest.json"]).toBe(first["manifest.json"]);
  });

  it("não perde nenhum campo do spec", async () => {
    const files = await buildAgentPackage(frontmatter, spec);
    const { spec: back } = await parseAgentPackage(files);
    expect(back).toEqual(spec);
  });

  it("a saída é LF, UTF-8 e termina com nova linha", async () => {
    const files = await buildAgentPackage(frontmatter, spec);
    for (const name of ["agent.md", "spec.json", "manifest.json"] as const) {
      expect(files[name]).not.toContain("\r");
      expect(files[name].endsWith("\n")).toBe(true);
    }
  });

  it("não inclui timestamps", async () => {
    const files = await buildAgentPackage(frontmatter, spec);
    expect(JSON.stringify(files)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("ordena chaves de forma determinística, independente da ordem de entrada", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
  });

  it("detecta arquivo alterado depois do export", async () => {
    const files = await buildAgentPackage(frontmatter, spec);
    const tampered: AgentPackageFiles = { ...files, "spec.json": files["spec.json"].replace("Planejar", "Editar") };
    await expect(parseAgentPackage(tampered)).rejects.toThrow("spec.json: hash does not match manifest");
  });
});

describe("Agent Spec v1: segredos e export", () => {
  it("recusa exportar um token falso e não devolve arquivo", async () => {
    const leaky = { ...spec, mission: "Usar o token inkus_pat_FAKE0000000000000000 para sincronizar." };
    await expect(buildAgentPackage(frontmatter, leaky)).rejects.toBeInstanceOf(AgentSpecError);
    await expect(buildAgentPackage(frontmatter, leaky)).rejects.toThrow("export aborted, no file written");
  });

  it("recusa chave de API no texto do scope", async () => {
    const leaky = { ...spec, scope: "api_key = FAKE_SYNTHETIC_KEY_123456" };
    await expect(buildAgentPackage(frontmatter, leaky)).rejects.toThrow("export aborted");
  });

  it("recusa export com spec inválido e não gera pacote", async () => {
    const invalid = { ...spec, grants: [] } as unknown as AgentSpecV1;
    await expect(buildAgentPackage(frontmatter, invalid)).rejects.toThrow("$.grants: unknown key");
  });
});

type Json = Record<string, unknown>;
const firstOf = (list: unknown, index = 0) => (list as Json[])[index] as Json;

describe("Agent Spec v1: JSON Schema (ajv) e validador TypeScript não divergem", () => {
  it("ambos aceitam a fixture sintética", () => {
    expect(validateWithSchema(spec)).toBe(true);
    expect(validateAgentSpec(spec)).toEqual([]);
  });

  it("ambos aceitam a fixture mínima", () => {
    expect(validateWithSchema(minimal)).toBe(true);
    expect(validateAgentSpec(minimal)).toEqual([]);
  });

  const mutations: [string, (s: Json) => void][] = [
    ["chave extra no topo", (s) => (s.api_key = "x")],
    ["grants no pacote", (s) => (s.grants = [])],
    ["campo obrigatório ausente", (s) => delete s.mission],
    ["custo negativo", (s) => (firstOf(s.routines).budget as Json).max_cost = -1],
    ["max_seconds fracionário", (s) => (firstOf(s.routines).budget as Json).max_seconds = 1.5],
    ["status de canal inválido", (s) => (firstOf(s.channels) as Json).status = "paused"],
    ["pedido duplicado", (s) => ((s.permissions as Json).requested = ["read_notes", "read_notes"])],
    ["modelo de papel ausente", (s) => delete (s.models as Json).research],
    ["bloqueio entre contextos não booleano", (s) => ((s.context_isolation as Json).block_between_contexts = "yes")],
    ["mission vazia", (s) => (s.mission = "")],
  ];

  it.each(mutations)("ambos rejeitam: %s", (_name, mutate) => {
    const bad = clone(spec) as unknown as Json;
    mutate(bad);
    expect(validateWithSchema(bad)).toBe(false);
    expect(validateAgentSpec(bad).length).toBeGreaterThan(0);
  });

  it("a fixture mínima não tem chaves fora do schema", () => {
    expect(Object.keys(minimal).sort()).toEqual([...schema.required].sort());
  });
});

describe("Agent Spec v1: segunda fixture (listas vazias)", () => {
  it("exportar, importar e exportar de novo gera os mesmos bytes", async () => {
    const first = await buildAgentPackage(frontmatter, minimal);
    const parsed = await parseAgentPackage(first);
    const second = await buildAgentPackage(parsed.frontmatter, parsed.spec);
    expect(second).toEqual(first);
    expect(parsed.spec).toEqual(minimal);
  });
});

// Credenciais montadas em tempo de execução: o texto do teste não contém um token que pareça real.
describe("Agent Spec v1: padrões de credencial ampliados", () => {
  it.each([
    ["GitHub classic", "ghp" + "_" + "A".repeat(36)],
    ["GitHub fine-grained", "github" + "_pat_" + "B".repeat(40)],
    ["Slack", "xox" + "b-" + "1".repeat(20)],
    ["Google API", "AIza" + "C".repeat(35)],
  ])("recusa export com token do tipo %s", async (_name, token) => {
    await expect(buildAgentPackage(frontmatter, { ...spec, mission: `Usar ${token} para sincronizar.` })).rejects.toThrow(
      "export aborted, no file written",
    );
  });
});
