/**
 * The generated Dart model decoders track the core's exported types.
 *
 * The pilot covers `KnowledgeHit`: the generator reads the type with the
 * TypeScript compiler API and emits a tolerant `fromJson`. This test fails when
 * the checked-in file is stale, when a field stops mapping, or when the
 * declared client tolerances (lowercase kind/side, a numeric-string score)
 * disappear.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MODELS_PATH,
  MODEL_SOURCES,
  extractModels,
  renderModels,
} from "../../scripts/generate-dart-models";

const ROOT = join(import.meta.dir, "..", "..");

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

describe("generated Dart models", () => {
  test("the checked-in file is exactly what the generator renders", () => {
    const models = extractModels(ROOT);
    expect(models.map((model) => model.name)).toEqual([
      "KnowledgeHit",
      "KnowledgeTreeNode",
      "KnowledgeTopicGroup",
      "StatsOverview",
      "ModelTotal",
      "ToolTotal",
      "LearningStats",
      "ActivityDay",
      "StatsPeriod",
      "StatsSummary",
      "LearningNode",
      "LearningEdge",
      "LearningGraph",
    ]);
    expect(read(MODELS_PATH)).toBe(renderModels(models));
  });

  test("KnowledgeHit keeps its eight wire fields and their shapes", () => {
    const [model] = extractModels(ROOT);
    expect(model?.fields.map((field) => [field.name, field.type])).toEqual([
      ["id", "string"],
      ["kind", "string"],
      ["title", "string"],
      ["excerpt", "string"],
      ["side", "string"],
      ["path", "string"],
      ["updated", "string"],
      ["score", "double"],
    ]);
  });

  test("the generated decoder carries the hand-written tolerances", () => {
    const generated = read(MODELS_PATH);
    expect(generated).toContain("kind: _string(json['kind']).toLowerCase()");
    expect(generated).toContain("side: _string(json['side']).toLowerCase()");
    expect(generated).toContain("score: _numberOrString(json['score'])");
    expect(generated).toContain("class KnowledgeHit");
    expect(generated).toContain("// dart format off");
  });

  test("the Knowledge tree models keep their Dart names and nesting", () => {
    const models = extractModels(ROOT);
    const note = models.find((model) => model.name === "KnowledgeTreeNode");
    expect(note?.dartName).toBe("KnowledgeNote");
    expect(note?.fields.map((field) => [field.name, field.type])).toEqual([
      ["path", "string"],
      ["title", "string"],
      ["updated", "string"],
    ]);

    const group = models.find((model) => model.name === "KnowledgeTopicGroup");
    expect(group?.dartName).toBe("KnowledgeGroup");
    expect(group?.fields.map((field) => [field.name, field.type, field.model])).toEqual([
      ["topic", "string", undefined],
      ["notes", "models", "KnowledgeNote"],
    ]);

    const generated = read(MODELS_PATH);
    expect(generated).toContain("class KnowledgeNote");
    expect(generated).toContain("class KnowledgeGroup");
    expect(generated).toContain("final List<KnowledgeNote> notes;");
    expect(generated).toContain("notes: _models(json['notes'], KnowledgeNote.fromJson)");
  });

  test("the source is the exported protocol type", () => {
    expect(MODEL_SOURCES).toContain("src/server/protocol.ts");
    expect(read("src/server/protocol.ts")).toContain("export type KnowledgeHit = {");
  });

  test("stats keeps its ints, nullable fields and nested models", () => {
    const models = extractModels(ROOT);
    const summary = models.find((model) => model.name === "StatsSummary");
    expect(summary?.fields.map((field) => [field.name, field.type, field.nullable, field.model])).toEqual([
      ["range", "string", false, undefined],
      ["scope", "string", false, undefined],
      ["overview", "model", false, "StatsOverview"],
      ["costMicroUsd", "int", true, undefined],
      ["costLabel", "string", false, undefined],
      ["models", "models", false, "StatsModelRow"],
      ["tools", "models", false, "StatsToolRow"],
      ["learning", "model", false, "LearningStats"],
      ["activity", "models", false, "ActivityDay"],
      ["bestStreak", "int", false, undefined],
      ["activeDays", "int", false, undefined],
      ["period", "model", false, "StatsPeriod"],
      ["diagnostic", "string", true, undefined],
    ]);

    const generated = read(MODELS_PATH);
    expect(generated).toContain("final int? costMicroUsd;");
    expect(generated).toContain("final String? diagnostic;");
    expect(generated).toContain("overview: StatsOverview.fromJson(_map(json['overview']))");
    expect(generated).toContain("diagnostic: _stringOrNull(json['diagnostic'])");
  });

  test("a union-keyed Record becomes an int map and model arrays nest", () => {
    const models = extractModels(ROOT);
    const graph = models.find((model) => model.name === "LearningGraph");
    expect(graph?.fields.map((field) => [field.name, field.type, field.model])).toEqual([
      ["nodes", "models", "LearningNode"],
      ["edges", "models", "LearningEdge"],
      ["counts", "intMap", undefined],
      ["diagnostics", "strings", undefined],
      ["truncated", "bool", undefined],
    ]);
    const generated = read(MODELS_PATH);
    expect(generated).toContain("final Map<String, int> counts;");
    expect(generated).toContain("counts: _intMap(json['counts'])");
    expect(generated).toContain("nodes: _models(json['nodes'], LearningNode.fromJson)");
  });
});
