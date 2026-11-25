/**
 * Generate Dart model decoders from the core's exported wire types.
 *
 * The Dart decoders are hand-written and drift silently when a TypeScript field
 * is renamed. This generator reads an allowlist of exported types with the
 * TypeScript compiler API and emits a tolerant `fromJson` (a missing or
 * mistyped field becomes `''`, `0`, `false`, an empty list or an empty map, as
 * the hand-written decoders did).
 *
 * Supported shapes: strings, numbers (`int` or `double` per the `ints` list),
 * booleans, string arrays, an allowlisted model, an array of one, and a
 * `Record<string, string | number>` map. Optional and `| null` fields become
 * nullable Dart fields. Anything else is refused with the field name rather
 * than emitted with a wrong type.
 *
 *   bun run scripts/generate-dart-models.ts            # write the file
 *   bun run scripts/generate-dart-models.ts --check    # fail if it is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

export const MODEL_SOURCES = [
  "src/server/protocol.ts",
  "src/stats/types.ts",
  "src/services/knowledge/learning-graph.ts",
  "src/types/settings.ts",
  "src/services/lockin/figures.ts",
];
export const MODELS_PATH = "desktop/lib/bridge/core_models.g.dart";

export type ModelSpec = {
  name: string;
  /** The Dart class name; defaults to [name]. */
  dart?: string;
  /** String fields normalised with `.toLowerCase()`. */
  lowercase?: readonly string[];
  /** Number fields that also accept a numeric string. */
  numericStrings?: readonly string[];
  /** Number fields rendered as `int`; everything else is `double`. */
  ints?: readonly string[];
  /** A fallback for a missing string field, rather than `''`. */
  defaults?: Readonly<Record<string, string>>;
};

export const MODEL_SPECS: readonly ModelSpec[] = [
  { name: "KnowledgeHit", lowercase: ["kind", "side"], numericStrings: ["score"] },
  { name: "KnowledgeTreeNode", dart: "KnowledgeNote" },
  { name: "KnowledgeTopicGroup", dart: "KnowledgeGroup" },
  { name: "StatsOverview", ints: ["runs", "failed", "input", "output"] },
  {
    name: "ModelTotal",
    dart: "StatsModelRow",
    ints: ["runs", "input", "output", "costMicroUsd"],
  },
  { name: "ToolTotal", dart: "StatsToolRow", ints: ["calls"] },
  { name: "LearningStats", ints: ["steps", "cardsKnown", "cardsMissed", "lessons"] },
  { name: "ActivityDay", ints: ["runs", "tokens"] },
  { name: "StatsPeriod" },
  { name: "StatsSummary", ints: ["bestStreak", "activeDays", "costMicroUsd"] },
  { name: "LearningNode", defaults: { grounded: "record" } },
  { name: "LearningEdge" },
  { name: "LearningGraph" },
  {
    name: "SettingsView",
    ints: ["maxToolCalls", "maxTokensPerRequest", "historyLimit"],
  },
  {
    name: "SessionFigure",
    ints: ["page", "x", "y", "width", "height"],
  },
];

export type DartFieldType =
  | "string"
  | "double"
  | "int"
  | "bool"
  | "strings"
  | "model"
  | "models"
  | "stringMap"
  | "intMap"
  | "modelMap";

export type DartField = {
  name: string;
  type: DartFieldType;
  /** The Dart class for `model` and `models`. */
  model?: string;
  nullable: boolean;
  doc: string;
};

export type DartModel = {
  name: string;
  dartName: string;
  doc: string;
  fields: DartField[];
  lowercase: readonly string[];
  numericStrings: readonly string[];
  defaults: Readonly<Record<string, string>>;
};

type MappedType = {
  type: DartFieldType;
  model?: string;
};

function docOf(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): string {
  if (symbol === undefined) return "";
  return ts
    .displayPartsToString(symbol.getDocumentationComment(checker))
    .replace(/\*\//g, "* /")
    .trim();
}

function symbolName(type: ts.Type): string | undefined {
  return type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
}

function isNullish(type: ts.Type): boolean {
  return (
    (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0
  );
}

function isStringUnion(type: ts.Type): boolean {
  return (
    type.isUnion() &&
    type.types.length > 0 &&
    type.types.every((member) => (member.flags & ts.TypeFlags.StringLiteral) !== 0)
  );
}

function mapType(
  checker: ts.TypeChecker,
  type: ts.Type,
  where: string,
  models: ReadonlyMap<string, string>,
  isInt: boolean,
): MappedType {
  if (
    (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0
  ) {
    return { type: "string" };
  }
  if ((type.flags & ts.TypeFlags.Number) !== 0) {
    return { type: isInt ? "int" : "double" };
  }
  if ((type.flags & ts.TypeFlags.Boolean) !== 0) return { type: "bool" };
  if (isStringUnion(type)) return { type: "string" };

  if (type.isUnion()) {
    throw new Error(`${where}: unsupported union ${checker.typeToString(type)}`);
  }

  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    if (element !== undefined) {
      if ((element.flags & ts.TypeFlags.String) !== 0 || isStringUnion(element)) {
        return { type: "strings" };
      }
      const model = symbolName(element);
      const dart = model === undefined ? undefined : models.get(model);
      if (dart !== undefined) return { type: "models", model: dart };
    }
    throw new Error(`${where}: only string[] and generated-model[] arrays are supported`);
  }

  const name = symbolName(type);
  const dart = name === undefined ? undefined : models.get(name);
  if (dart !== undefined) return { type: "model", model: dart };

  // A `Record<string, T>` may expose a string index or, when the key is a
  // union of literals, one property per key. Only string and number values are
  // generated (a map of models is not needed yet).
  const value = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (value !== undefined) {
    if ((value.flags & ts.TypeFlags.String) !== 0) return { type: "stringMap" };
    if ((value.flags & ts.TypeFlags.Number) !== 0) return { type: "intMap" };
    const model = symbolName(value);
    const dart = model === undefined ? undefined : models.get(model);
    if (dart !== undefined) return { type: "modelMap", model: dart };
    throw new Error(`${where}: only Record<string, string|number|model> maps are supported`);
  }
  const properties = type.getProperties();
  if (properties.length > 0) {
    const values = properties.map((property) => checker.getTypeOfSymbol(property));
    if (values.every((entry) => (entry.flags & ts.TypeFlags.String) !== 0)) {
      return { type: "stringMap" };
    }
    if (values.every((entry) => (entry.flags & ts.TypeFlags.Number) !== 0)) {
      return { type: "intMap" };
    }
    const modelNames = values.map((entry) => symbolName(entry));
    if (
      modelNames.length > 0 &&
      modelNames.every((name) => name !== undefined && models.has(name))
    ) {
      return { type: "modelMap", model: models.get(modelNames[0]!)! };
    }
  }

  throw new Error(`${where}: unsupported type ${checker.typeToString(type)}`);
}

/**
 * Merge a union of object types into one Dart class.
 *
 * The wire uses unions for alternative reply shapes (a flattened `update`
 * view). A Dart sealed hierarchy is more precise, but the shell only reads
 * fields, so the generator flattens: a field every member shares keeps its
 * type and requiredness; a field only some members carry becomes nullable. A
 * field that maps to different types across members is refused.
 */
function flattenUnion(
  checker: ts.TypeChecker,
  type: ts.UnionType,
  name: string,
  models: ReadonlyMap<string, string>,
  spec: ModelSpec,
): DartField[] {
  const order: string[] = [];
  const byName = new Map<
    string,
    { mapped: MappedType; count: number; optional: boolean; doc: string }
  >();
  const members = type.types.filter((member) => !isNullish(member));
  if (members.length !== type.types.length) {
    throw new Error(`${name}: a nullable union is not supported`);
  }
  for (const member of members) {
    if ((member.flags & ts.TypeFlags.Object) === 0) {
      throw new Error(`${name}: a union of object types is required`);
    }
    for (const property of member.getProperties()) {
      const raw = checker.getTypeOfSymbolAtLocation(
        property,
        property.valueDeclaration ?? property.declarations?.[0] ?? (undefined as never),
      );
      const nonNull = raw.isUnion()
        ? raw.types.filter((entry) => !isNullish(entry))
        : [];
      const base = nonNull.length === 1 ? nonNull[0]! : raw;
      const mapped = mapType(
        checker,
        base,
        `${name}.${property.name}`,
        models,
        (spec.ints ?? []).includes(property.name),
      );
      const existing = byName.get(property.name);
      if (existing === undefined) {
        order.push(property.name);
        byName.set(property.name, {
          mapped,
          count: 1,
          optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
          doc: docOf(checker, property),
        });
      } else {
        if (
          existing.mapped.type !== mapped.type ||
          existing.mapped.model !== mapped.model
        ) {
          throw new Error(
            `${name}.${property.name}: union members disagree on the field type`,
          );
        }
        existing.count += 1;
        existing.optional ||= (property.flags & ts.SymbolFlags.Optional) !== 0;
      }
    }
  }
  return order.map((fieldName) => {
    const entry = byName.get(fieldName)!;
    return {
      name: fieldName,
      type: entry.mapped.type,
      ...(entry.mapped.model === undefined ? {} : { model: entry.mapped.model }),
      nullable: entry.optional || entry.count < members.length,
      doc: entry.doc,
    } satisfies DartField;
  });
}

/** The allowlisted models, in source order of the allowlist. */
export type ExtractOptions = {
  sources?: readonly string[];
  specs?: readonly ModelSpec[];
};

export function extractModels(root: string, options: ExtractOptions = {}): DartModel[] {
  const sources = options.sources ?? MODEL_SOURCES;
  const specs = options.specs ?? MODEL_SPECS;
  const program = ts.createProgram(sources.map((source) => join(root, source)), {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();

  const declarations = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>();
  const wanted = specs.map((spec) => spec.name);
  for (const source of sources) {
    const file = program.getSourceFile(join(root, source));
    if (file === undefined) throw new Error(`cannot read ${source}`);
    ts.forEachChild(file, (node) => {
      if (
        (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
        wanted.includes(node.name.text)
      ) {
        declarations.set(node.name.text, node);
      }
    });
  }

  const modelsByTsName = new Map(
    specs.map((spec) => [spec.name, spec.dart ?? spec.name] as const),
  );

  return specs.map((spec) => {
    const name = spec.name;
    const node = declarations.get(name);
    if (node === undefined) {
      throw new Error(`exported type ${name} not found in ${sources.join(", ")}`);
    }
    const type = checker.getTypeAtLocation(node);
    const fields = type.isUnion()
      ? flattenUnion(checker, type, name, modelsByTsName, spec)
      : type.getProperties().map((property) => {
        const raw = checker.getTypeOfSymbolAtLocation(property, node);
        const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
        // `T | null` and `T | undefined` are the nullable spelling; the one
        // remaining member decides the Dart type.
        const nonNull = raw.isUnion()
          ? raw.types.filter((member) => !isNullish(member))
          : [];
        const nullable = optional || (raw.isUnion() && nonNull.length < raw.types.length);
        if (nullable && nonNull.length !== 1) {
          throw new Error(`${name}.${property.name}: ambiguous nullable union`);
        }
        const base = nullable && nonNull.length === 1 ? nonNull[0]! : raw;
        const mapped = mapType(
          checker,
          base,
          `${name}.${property.name}`,
          modelsByTsName,
          (spec.ints ?? []).includes(property.name),
        );
        return {
          name: property.name,
          type: mapped.type,
          ...(mapped.model === undefined ? {} : { model: mapped.model }),
          nullable,
          doc: docOf(checker, property),
        } satisfies DartField;
      });
    if (fields.length === 0) throw new Error(`${name} has no fields`);
    return {
      name,
      dartName: spec.dart ?? name,
      doc: docOf(
        checker,
        (node as unknown as { symbol?: ts.Symbol }).symbol ??
          checker.getSymbolAtLocation(node),
      ),
      fields,
      lowercase: spec.lowercase ?? [],
      numericStrings: spec.numericStrings ?? [],
      defaults: spec.defaults ?? {},
    };
  });
}

function docLines(doc: string): string[] {
  if (doc === "") return [];
  return doc.split("\n").map((line) => (line.trim() === "" ? "///" : `/// ${line.trim()}`));
}

function baseDartType(field: DartField): string {
  switch (field.type) {
    case "string":
      return "String";
    case "double":
      return "double";
    case "int":
      return "int";
    case "bool":
      return "bool";
    case "strings":
      return "List<String>";
    case "model":
      return field.model!;
    case "models":
      return `List<${field.model}>`;
    case "stringMap":
      return "Map<String, String>";
    case "intMap":
      return "Map<String, int>";
    case "modelMap":
      return `Map<String, ${field.model}>`;
  }
}

function dartType(field: DartField): string {
  return `${baseDartType(field)}${field.nullable ? "?" : ""}`;
}

function parser(field: DartField, model: DartModel): string {
  const read = `json['${field.name}']`;
  if (field.nullable) {
    switch (field.type) {
      case "string":
        return `_stringOrNull(${read})`;
      case "int":
        return `_intOrNull(${read})`;
      case "double":
        return `_doubleOrNull(${read})`;
      case "bool":
        return `_boolOrNull(${read})`;
      case "model":
        return `_modelOrNull(${read}, ${field.model}.fromJson)`;
      default:
        throw new Error(`${model.name}.${field.name}: a nullable ${field.type} is not supported`);
    }
  }
  switch (field.type) {
    case "string": {
      const fallback = model.defaults[field.name];
      const value = `_string(${read})`;
      return model.lowercase.includes(field.name)
        ? `${value}.toLowerCase()`
        : fallback !== undefined
          ? `_stringOrDefault(${read}, '${fallback}')`
          : value;
    }
    case "double":
      return model.numericStrings.includes(field.name)
        ? `_numberOrString(${read})`
        : `_double(${read})`;
    case "int":
      return `_int(${read})`;
    case "bool":
      return `_bool(${read})`;
    case "strings":
      return `_strings(${read})`;
    case "model":
      return `${field.model}.fromJson(_map(${read}))`;
    case "models":
      return `_models(${read}, ${field.model}.fromJson)`;
    case "stringMap":
      return `_stringMap(${read})`;
    case "intMap":
      return `_intMap(${read})`;
    case "modelMap":
      return `_modelMap(${read}, ${field.model}.fromJson)`;
  }
}

function helperFor(field: DartField): string[] {
  if (field.nullable) {
    switch (field.type) {
      case "string":
        return ["stringOrNull"];
      case "int":
        return ["intOrNull"];
      case "double":
        return ["doubleOrNull"];
      case "bool":
        return ["boolOrNull"];
      case "model":
        return ["modelOrNull"];
      default:
        return [];
    }
  }
  switch (field.type) {
    case "string":
      return ["string"];
    case "double":
      return ["double"];
    case "int":
      return ["int"];
    case "bool":
      return ["bool"];
    case "strings":
      return ["strings"];
    case "model":
      return ["map"];
    case "models":
      return ["models"];
    case "stringMap":
      return ["stringMap"];
    case "intMap":
      return ["intMap"];
    case "modelMap":
      return ["modelMap"];
  }
}

const HELPERS: Readonly<Record<string, readonly string[]>> = {
  string: ["String _string(Object? value) => value is String ? value : '';"],
  stringOrDefault: [
    "String _stringOrDefault(Object? value, String fallback) =>",
    "    value is String ? value : fallback;",
  ],
  int: ["int _int(Object? value) => value is num ? value.toInt() : 0;"],
  double: ["double _double(Object? value) => value is num ? value.toDouble() : 0;"],
  bool: ["bool _bool(Object? value) => value is bool ? value : false;"],
  strings: [
    "List<String> _strings(Object? value) =>",
    "    value is List ? value.whereType<String>().toList(growable: false) : const [];",
  ],
  numberOrString: [
    "/// A number from a number or a numeric string; anything else is zero.",
    "double _numberOrString(Object? value) {",
    "  if (value is num) return value.toDouble();",
    "  if (value is String) return double.tryParse(value.trim()) ?? 0;",
    "  return 0;",
    "}",
  ],
  map: [
    "Map<String, dynamic> _map(Object? value) =>",
    "    value is Map ? Map<String, dynamic>.from(value) : const <String, dynamic>{};",
  ],
  models: [
    "/// Parse a list of objects, skipping entries that are not maps.",
    "List<T> _models<T>(Object? value, T Function(Map<String, dynamic>) parse) {",
    "  if (value is! List) return const [];",
    "  return value",
    "      .whereType<Map>()",
    "      .map((map) => parse(Map<String, dynamic>.from(map)))",
    "      .toList(growable: false);",
    "}",
  ],
  stringMap: [
    "Map<String, String> _stringMap(Object? value) {",
    "  if (value is! Map) return const <String, String>{};",
    "  final out = <String, String>{};",
    "  value.forEach((key, entry) {",
    "    if (key is String && entry is String) out[key] = entry;",
    "  });",
    "  return out;",
    "}",
  ],
  modelMap: [
    "Map<String, T> _modelMap<T>(Object? value, T Function(Map<String, dynamic>) parse) {",
    "  if (value is! Map) return const {};",
    "  final out = <String, T>{};",
    "  value.forEach((key, entry) {",
    "    if (key is String && entry is Map) {",
    "      out[key] = parse(Map<String, dynamic>.from(entry));",
    "    }",
    "  });",
    "  return out;",
    "}",
  ],
  intMap: [
    "Map<String, int> _intMap(Object? value) {",
    "  if (value is! Map) return const <String, int>{};",
    "  final out = <String, int>{};",
    "  value.forEach((key, entry) {",
    "    if (key is String && entry is num) out[key] = entry.toInt();",
    "  });",
    "  return out;",
    "}",
  ],
  stringOrNull: [
    "String? _stringOrNull(Object? value) =>",
    "    value is String && value.isNotEmpty ? value : null;",
  ],
  intOrNull: ["int? _intOrNull(Object? value) => value is num ? value.toInt() : null;"],
  doubleOrNull: [
    "double? _doubleOrNull(Object? value) =>",
    "    value is num ? value.toDouble() : null;",
  ],
  boolOrNull: ["bool? _boolOrNull(Object? value) => value is bool ? value : null;"],
  modelOrNull: [
    "T? _modelOrNull<T>(Object? value, T Function(Map<String, dynamic>) parse) =>",
    "    value is Map ? parse(Map<String, dynamic>.from(value)) : null;",
  ],
};

export function renderModels(models: readonly DartModel[]): string {
  const needed = new Set<string>(["string"]);
  for (const model of models) {
    for (const field of model.fields) {
      for (const helper of helperFor(field)) needed.add(helper);
      if (field.type === "double" && model.numericStrings.includes(field.name)) {
        needed.add("numberOrString");
      }
      if (field.type === "string" && model.defaults[field.name] !== undefined) {
        needed.add("stringOrDefault");
      }
    }
  }
  if (
    !models.some((model) =>
      model.fields.some(
        (field) => field.type === "double" && !model.numericStrings.includes(field.name),
      ),
    )
  ) {
    needed.delete("double");
  }
  const helperLines: string[] = [];
  const order = [
    "string",
    "stringOrDefault",
    "int",
    "double",
    "bool",
    "strings",
    "numberOrString",
    "map",
    "models",
    "stringMap",
    "intMap",
    "modelMap",
    "stringOrNull",
    "intOrNull",
    "doubleOrNull",
    "boolOrNull",
    "modelOrNull",
  ];
  for (const helper of order) {
    if (!needed.has(helper)) continue;
    if (helperLines.length > 0) helperLines.push("");
    helperLines.push(...(HELPERS[helper] ?? []));
  }

  const lines: string[] = [
    "// GENERATED FILE — do not edit by hand.",
    "// dart format off",
    "//",
    `// Generated from the exported types in: ${MODEL_SOURCES.join(", ")}.`,
    "// Regenerate: `bun run scripts/generate-dart-models.ts`.",
    "//",
    "// The shell reads these models from the wire; every field is tolerant of a",
    "// missing or mistyped value so one odd reply cannot blank a surface.",
    "",
    ...helperLines,
    "",
  ];
  for (const model of models) {
    lines.push(...docLines(model.doc));
    lines.push(`class ${model.dartName} {`);
    lines.push(`  const ${model.dartName}({`);
    for (const field of model.fields) {
      lines.push(
        field.nullable ? `    this.${field.name},` : `    required this.${field.name},`,
      );
    }
    lines.push("  });", "");
    for (const field of model.fields) {
      lines.push(...docLines(field.doc).map((line) => `  ${line}`));
      lines.push(`  final ${dartType(field)} ${field.name};`, "");
    }
    lines.push(
      `  factory ${model.dartName}.fromJson(Map<String, dynamic> json) => ${model.dartName}(`,
    );
    for (const field of model.fields) {
      lines.push(`    ${field.name}: ${parser(field, model)},`);
    }
    lines.push("  );", "}", "");
  }
  return lines.join("\n");
}

export function generate(root: string): { path: string; content: string } {
  return {
    path: join(root, MODELS_PATH),
    content: renderModels(extractModels(root)),
  };
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const { path, content } = generate(root);
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current !== content) {
      console.error(`${MODELS_PATH} is stale; run: bun run scripts/generate-dart-models.ts`);
      process.exit(1);
    }
    console.log(`${MODELS_PATH} is up to date`);
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${MODELS_PATH}`);
  }
}
