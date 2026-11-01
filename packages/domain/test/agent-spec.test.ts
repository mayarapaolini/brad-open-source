import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Draft for Agent Spec v1 (RFC-002 pending). Only the schema contract and round-trip are covered here.
// Parse and serialise helpers wait for RFC-002.

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, "../schema/agent-spec.v1.schema.json"), "utf8")) as Schema;
const fixture = JSON.parse(readFileSync(resolve(here, "fixtures/agent-spec.synthetic.json"), "utf8")) as Record<string, unknown>;

type Schema = {
  $schema?: string;
  const?: unknown;
  type?: "object" | "array" | "string" | "integer" | "number";
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  uniqueItems?: boolean;
  minLength?: number;
  minimum?: number;
};

// Verificador mínimo do subconjunto de JSON Schema que o arquivo usa. O projeto não tem um validador
// de JSON Schema como dependência, e este teste não adiciona nenhuma.
function check(s: Schema, value: unknown, path: string, errors: string[]): void {
  if (s.const !== undefined && value !== s.const) errors.push(`${path}: expected ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: not one of ${JSON.stringify(s.enum)}`);
  if (s.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return void errors.push(`${path}: expected object`);
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: missing`);
    for (const key of Object.keys(obj)) {
      const sub = s.properties?.[key];
      if (sub) check(sub, obj[key], `${path}.${key}`, errors);
      else if (s.additionalProperties === false) errors.push(`${path}.${key}: unknown key`);
      else if (typeof s.additionalProperties === "object") check(s.additionalProperties, obj[key], `${path}.${key}`, errors);
    }
    return;
  }
  if (s.type === "array") {
    if (!Array.isArray(value)) return void errors.push(`${path}: expected array`);
    value.forEach((item, i) => s.items && check(s.items, item, `${path}[${i}]`, errors));
    if (s.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${path}: items must be unique`);
    return;
  }
  if (s.type === "string") {
    if (typeof value !== "string") return void errors.push(`${path}: expected string`);
    if (s.minLength !== undefined && value.length < s.minLength) errors.push(`${path}: shorter than ${s.minLength}`);
    return;
  }
  if (s.type === "integer" || s.type === "number") {
    if (typeof value !== "number" || (s.type === "integer" && !Number.isInteger(value))) return void errors.push(`${path}: expected ${s.type}`);
    if (s.minimum !== undefined && value < s.minimum) errors.push(`${path}: below ${s.minimum}`);
  }
}

function validate(value: unknown): string[] {
  const errors: string[] = [];
  check(schema, value, "$", errors);
  return errors;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("Agent Spec v1: schema", () => {
  it("declares version 1 and the required fields from the spec", () => {
    expect(schema.properties?.specVersion).toEqual({ const: 1 });
    expect(schema.required).toEqual([
      "specVersion",
      "id",
      "name",
      "mission",
      "scope",
      "permissions",
      "confirmRequired",
      "models",
      "routines",
      "channels",
      "contextIsolation",
    ]);
  });

  it("declares JSON Schema draft 2020-12", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});

describe("Agent Spec v1: fixture validation", () => {
  it("accepts the synthetic fixture", () => {
    expect(validate(fixture)).toEqual([]);
  });

  it("rejects an unknown top-level key", () => {
    const spec = clone(fixture);
    spec.apiKey = "not-allowed";
    expect(validate(spec)).toContain("$.apiKey: unknown key");
  });

  it("rejects a missing required field", () => {
    const spec = clone(fixture);
    delete spec.mission;
    expect(validate(spec)).toContain("$.mission: missing");
  });

  it("rejects an unknown key inside a routine budget", () => {
    const spec = clone(fixture) as { routines: { budget: Record<string, unknown> }[] };
    spec.routines[0]!.budget.maxTokens = 1000;
    expect(validate(spec)).toContain("$.routines[0].budget.maxTokens: unknown key");
  });

  it("rejects a negative cost budget", () => {
    const spec = clone(fixture) as { routines: { budget: { maxCostUsd: number } }[] };
    spec.routines[0]!.budget.maxCostUsd = -1;
    expect(validate(spec)).toContain("$.routines[0].budget.maxCostUsd: below 0");
  });

  it("rejects a context outside personal and work", () => {
    const spec = clone(fixture) as { contextIsolation: { context: string } };
    spec.contextIsolation.context = "shared";
    expect(validate(spec)).toContain("$.contextIsolation.context: not one of [\"personal\",\"work\"]");
  });

  it("rejects duplicate confirmation actions", () => {
    const spec = clone(fixture);
    spec.confirmRequired = ["send_message", "send_message"];
    expect(validate(spec)).toContain("$.confirmRequired: items must be unique");
  });

  it("rejects a non-integer tool-call budget", () => {
    const spec = clone(fixture) as { routines: { budget: { maxToolCalls: number } }[] };
    spec.routines[0]!.budget.maxToolCalls = 2.5;
    expect(validate(spec)).toContain("$.routines[0].budget.maxToolCalls: expected integer");
  });
});

describe("Agent Spec v1: round-trip", () => {
  it("JSON survives a round-trip without losing any field", () => {
    const again = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    expect(again).toEqual(fixture);
    expect(validate(again)).toEqual([]);
  });

  it("pretty-printed output is stable across a second round-trip", () => {
    const once = JSON.stringify(fixture, null, 2);
    const twice = JSON.stringify(JSON.parse(once), null, 2);
    expect(twice).toBe(once);
  });

  it("keeps every field of the spec, including empty lists and zero budgets", () => {
    const spec = clone(fixture) as Record<string, unknown> & { routines: { budget: { maxToolCalls: number } }[] };
    spec.confirmRequired = [];
    spec.routines[0]!.budget.maxToolCalls = 0;
    const again = JSON.parse(JSON.stringify(spec)) as typeof spec;
    expect(again.confirmRequired).toEqual([]);
    expect(again.routines[0]!.budget.maxToolCalls).toBe(0);
    expect(validate(again)).toEqual([]);
  });

  it("the fixture contains only synthetic identifiers", () => {
    expect(String(fixture.name)).toMatch(/Example/);
    expect(JSON.stringify(fixture)).not.toMatch(/Gedanken|Hermes|mayar/i);
  });
});
