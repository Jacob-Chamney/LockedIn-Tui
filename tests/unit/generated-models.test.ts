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
  MODELS_SOURCE,
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
    expect(read(MODELS_SOURCE)).toContain("export type KnowledgeHit = {");
  });
});
