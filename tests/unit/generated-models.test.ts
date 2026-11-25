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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
      "SettingsView",
      "SessionFigure",
      "ChatMessageWire",
      "ChatUsageWire",
      "ChatBlockedWire",
      "ChatErrorWire",
      "ChatSnapshotView",
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

  test("the settings view keeps its ints, doubles, bools and lists", () => {
    const models = extractModels(ROOT);
    const settings = models.find((model) => model.name === "SettingsView");
    const types = new Map(settings?.fields.map((field) => [field.name, field.type]));
    expect(types.get("username")).toBe("string");
    expect(types.get("maxToolCalls")).toBe("int");
    expect(types.get("maxTokensPerRequest")).toBe("int");
    expect(types.get("budgetUsd")).toBe("double");
    expect(types.get("warnAt")).toBe("double");
    expect(types.get("pauseAtLimit")).toBe("bool");
    expect(types.get("pluginServers")).toBe("strings");
    expect(types.get("disabledPlugins")).toBe("strings");
    expect(settings?.fields).toHaveLength(20);
    expect(read(MODELS_PATH)).toContain("class SettingsView");
  });

  test("a union flattens and a nullable nested model becomes nullable", () => {
    const root = mkdtempSync(join(tmpdir(), "lockedin-dart-models-"));
    writeFileSync(
      join(root, "sample.ts"),
      [
        "export type SampleChild = { a: string };",
        "export type SampleUnion =",
        '  | { kind: "one"; current: string; child: SampleChild }',
        '  | { kind: "two"; current: string; message: string };',
        "",
      ].join("\n"),
    );
    const models = extractModels(root, {
      sources: ["sample.ts"],
      specs: [
        { name: "SampleChild" },
        { name: "SampleUnion" },
      ],
    });
    const union = models.find((model) => model.name === "SampleUnion");
    expect(
      union?.fields.map((field) => [field.name, field.type, field.nullable, field.model]),
    ).toEqual([
      ["kind", "string", false, undefined],
      ["current", "string", false, undefined],
      ["child", "model", true, "SampleChild"],
      ["message", "string", true, undefined],
    ]);
    const generated = renderModels(models);
    expect(generated).toContain("class SampleUnion");
    expect(generated).toContain("final SampleChild? child;");
    expect(generated).toContain("child: _modelOrNull(json['child'], SampleChild.fromJson)");
    expect(generated).toContain("message: _stringOrNull(json['message'])");
  });

  test("a map of models and a recursive model are generated", () => {
    const root = mkdtempSync(join(tmpdir(), "lockedin-dart-models-"));
    writeFileSync(
      join(root, "sample.ts"),
      [
        "export type SampleChild = { a: string };",
        "export type SampleNode = { id: string; child?: SampleNode };",
        "export type SampleMap = {",
        "  items: Record<string, SampleChild>;",
        "  tree?: SampleNode;",
        "};",
        "",
      ].join("\n"),
    );
    const models = extractModels(root, {
      sources: ["sample.ts"],
      specs: [
        { name: "SampleChild" },
        { name: "SampleNode" },
        { name: "SampleMap" },
      ],
    });
    const map = models.find((model) => model.name === "SampleMap");
    expect(
      map?.fields.map((field) => [field.name, field.type, field.nullable, field.model]),
    ).toEqual([
      ["items", "modelMap", false, "SampleChild"],
      ["tree", "model", true, "SampleNode"],
    ]);
    const node = models.find((model) => model.name === "SampleNode");
    expect(node?.fields.map((field) => [field.name, field.type, field.nullable])).toEqual([
      ["id", "string", false],
      ["child", "model", true],
    ]);
    const generated = renderModels(models);
    expect(generated).toContain("final Map<String, SampleChild> items;");
    expect(generated).toContain("items: _modelMap(json['items'], SampleChild.fromJson)");
    expect(generated).toContain("final SampleNode? child;");
    expect(generated).toContain("child: _modelOrNull(json['child'], SampleNode.fromJson)");
  });

  test("SessionFigure keeps its ints and optional crop", () => {
    const models = extractModels(ROOT);
    const figure = models.find((model) => model.name === "SessionFigure");
    expect(
      figure?.fields.map((field) => [field.name, field.type, field.nullable]),
    ).toEqual([
      ["id", "string", false],
      ["source", "string", false],
      ["page", "int", false],
      ["x", "int", true],
      ["y", "int", true],
      ["width", "int", true],
      ["height", "int", true],
      ["caption", "string", false],
      ["note", "string", false],
      ["file", "string", false],
      ["createdAt", "string", false],
    ]);
  });

  test("the chat leaf models keep their nullable fields and ints", () => {
    const models = extractModels(ROOT);
    const byName = new Map(models.map((model) => [model.name, model]));
    const message = byName.get("ChatMessageWire");
    expect(message?.dartName).toBe("ChatMessageView");
    expect(
      message?.fields.map((field) => [field.name, field.type, field.nullable]),
    ).toEqual([
      ["id", "string", false],
      ["role", "string", false],
      ["text", "string", false],
      ["outcome", "string", true],
    ]);
    const usage = byName.get("ChatUsageWire");
    expect(usage?.dartName).toBe("ChatUsageView");
    expect(
      usage?.fields.map((field) => [field.name, field.type, field.nullable]),
    ).toEqual([
      ["tokens", "int", false],
      ["costMicroUsd", "int", true],
      ["durationMs", "int", true],
    ]);
    expect(byName.get("ChatBlockedWire")?.fields.map((field) => field.name)).toEqual([
      "reason",
      "fix",
    ]);
    expect(byName.get("ChatErrorWire")?.fields.map((field) => field.name)).toEqual([
      "failed",
      "kept",
      "next",
    ]);
  });

  test("ChatSnapshot omits the stream counter and keeps the nullable parts", () => {
    const models = extractModels(ROOT);
    const snapshot = models.find((model) => model.name === "ChatSnapshotView");
    expect(snapshot?.dartName).toBe("ChatSnapshot");
    expect(
      snapshot?.fields.map((field) => [field.name, field.type, field.nullable, field.model]),
    ).toEqual([
      ["status", "string", false, undefined],
      ["model", "string", true, undefined],
      ["streamed", "string", false, undefined],
      ["messages", "models", false, "ChatMessageView"],
      ["blocked", "model", true, "ChatBlocked"],
      ["error", "model", true, "ChatFailure"],
      ["usage", "model", false, "ChatUsageView"],
    ]);
    const generated = read(MODELS_PATH);
    expect(generated).toContain("class ChatSnapshot");
    expect(generated).not.toContain("final int seq;");
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
