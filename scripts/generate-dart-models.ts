/**
 * Generate Dart model decoders from the core's exported wire types.
 *
 * This is the first model in the deferred generated-bindings item: the Dart
 * decoders are hand-written and drift silently when a TypeScript field is
 * renamed. The generator reads a small allowlist of exported type aliases from
 * `src/server/protocol.ts` with the TypeScript compiler API and emits a
 * tolerant `fromJson` (a missing or mistyped field becomes `''`, `0`, `false`
 * or an empty list, as the hand-written decoders did).
 *
 * The pilot covers `KnowledgeHit`. Add a name to `MODEL_NAMES` only when every
 * field maps to one of the supported shapes (`string`, `number`, `boolean`,
 * `string[]`, or a union of string literals); the generator refuses anything
 * else rather than emitting a wrong type.
 *
 *   bun run scripts/generate-dart-models.ts            # write the file
 *   bun run scripts/generate-dart-models.ts --check    # fail if it is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

export const MODELS_SOURCE = "src/server/protocol.ts";
export const MODELS_PATH = "desktop/lib/bridge/core_models.g.dart";

/**
 * The exported type aliases the pilot generates.
 *
 * `lowercase` and `numericStrings` are the tolerant client policies the
 * hand-written decoder applied: the wire says these are lowercase strings and a
 * number, but a defensive read of `MEMORY` or `"0.5"` still works. They are
 * declared here so the generated code carries the same behaviour instead of
 * silently dropping it.
 */
export type ModelSpec = {
  name: string;
  lowercase?: readonly string[];
  numericStrings?: readonly string[];
};

export const MODEL_SPECS: readonly ModelSpec[] = [
  { name: "KnowledgeHit", lowercase: ["kind", "side"], numericStrings: ["score"] },
];

export type DartFieldType = "string" | "double" | "bool" | "strings";

export type DartField = {
  name: string;
  type: DartFieldType;
  doc: string;
};

export type DartModel = {
  name: string;
  doc: string;
  fields: DartField[];
  lowercase: readonly string[];
  numericStrings: readonly string[];
};

function docOf(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): string {
  if (symbol === undefined) return "";
  return ts
    .displayPartsToString(symbol.getDocumentationComment(checker))
    .replace(/\*\//g, "* /")
    .trim();
}

function mapType(
  checker: ts.TypeChecker,
  type: ts.Type,
  where: string,
): DartFieldType {
  if ((type.flags & ts.TypeFlags.String) !== 0) return "string";
  if ((type.flags & ts.TypeFlags.Number) !== 0) return "double";
  if ((type.flags & ts.TypeFlags.Boolean) !== 0) return "bool";
  if (type.isUnion()) {
    const members = type.types;
    if (
      members.length > 0 &&
      members.every((member) => (member.flags & ts.TypeFlags.StringLiteral) !== 0)
    ) {
      return "string";
    }
    throw new Error(`${where}: unsupported union ${checker.typeToString(type)}`);
  }
  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    if (element !== undefined) {
      if ((element.flags & ts.TypeFlags.String) !== 0) return "strings";
      if (
        element.isUnion() &&
        element.types.every((member) => (member.flags & ts.TypeFlags.StringLiteral) !== 0)
      ) {
        return "strings";
      }
    }
    throw new Error(`${where}: only string[] arrays are supported`);
  }
  throw new Error(`${where}: unsupported type ${checker.typeToString(type)}`);
}

/** The allowlisted models, in source order of the allowlist. */
export function extractModels(root: string): DartModel[] {
  const file = join(root, MODELS_SOURCE);
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`cannot read ${MODELS_SOURCE}`);

  const declarations = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>();
  const wanted = MODEL_SPECS.map((spec) => spec.name);
  ts.forEachChild(source, (node) => {
    if (
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      wanted.includes(node.name.text)
    ) {
      declarations.set(node.name.text, node);
    }
  });

  return MODEL_SPECS.map((spec) => {
    const name = spec.name;
    const node = declarations.get(name);
    if (node === undefined) {
      throw new Error(`exported type ${name} not found in ${MODELS_SOURCE}`);
    }
    const type = checker.getTypeAtLocation(node);
    const fields = type.getProperties().map((property) => {
      const fieldType = checker.getTypeOfSymbolAtLocation(property, node);
      return {
        name: property.name,
        type: mapType(checker, fieldType, `${name}.${property.name}`),
        doc: docOf(checker, property),
      } satisfies DartField;
    });
    if (fields.length === 0) throw new Error(`${name} has no fields`);
    return {
      name,
      doc: docOf(
        checker,
        (node as unknown as { symbol?: ts.Symbol }).symbol ??
          checker.getSymbolAtLocation(node),
      ),
      fields,
      lowercase: spec.lowercase ?? [],
      numericStrings: spec.numericStrings ?? [],
    };
  });
}

function docLines(doc: string): string[] {
  if (doc === "") return [];
  return doc.split("\n").map((line) => (line.trim() === "" ? "///" : `/// ${line.trim()}`));
}

function dartType(field: DartField): string {
  switch (field.type) {
    case "string":
      return "String";
    case "double":
      return "double";
    case "bool":
      return "bool";
    case "strings":
      return "List<String>";
  }
}

function parser(field: DartField, model: DartModel): string {
  const read = `json['${field.name}']`;
  switch (field.type) {
    case "string": {
      const value = `_string(${read})`;
      return model.lowercase.includes(field.name) ? `${value}.toLowerCase()` : value;
    }
    case "double":
      return model.numericStrings.includes(field.name)
        ? `_numberOrString(${read})`
        : `_number(${read})`;
    case "bool":
      return `_bool(${read})`;
    case "strings":
      return `_strings(${read})`;
  }
}

export function renderModels(models: readonly DartModel[]): string {
  const has = (kind: string): boolean =>
    models.some((model) => model.fields.some((field) => field.type === kind));
  const needsNumericString = models.some((model) =>
    model.fields.some(
      (field) => field.type === "double" && model.numericStrings.includes(field.name),
    ),
  );
  const helperLines: string[] = [];
  if (has("string")) helperLines.push("String _string(Object? value) => value is String ? value : '';");
  if (
    models.some((model) =>
      model.fields.some(
        (field) => field.type === "double" && !model.numericStrings.includes(field.name),
      ),
    )
  ) {
    helperLines.push("double _number(Object? value) => value is num ? value.toDouble() : 0;");
  }
  if (has("bool")) helperLines.push("bool _bool(Object? value) => value is bool ? value : false;");
  if (has("strings")) {
    helperLines.push(
      "List<String> _strings(Object? value) =>",
      "    value is List ? value.whereType<String>().toList(growable: false) : const [];",
    );
  }
  if (needsNumericString) {
    helperLines.push(
      "",
      "/// A number from a number or a numeric string; anything else is zero.",
      "double _numberOrString(Object? value) {",
      "  if (value is num) return value.toDouble();",
      "  if (value is String) return double.tryParse(value.trim()) ?? 0;",
      "  return 0;",
      "}",
    );
  }
  const lines: string[] = [
    "// GENERATED FILE — do not edit by hand.",
    "// dart format off",
    "//",
    `// Generated from the exported types in \`${MODELS_SOURCE}\`.`,
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
    lines.push(`class ${model.name} {`);
    lines.push(`  const ${model.name}({`);
    for (const field of model.fields) lines.push(`    required this.${field.name},`);
    lines.push("  });", "");
    for (const field of model.fields) {
      lines.push(...docLines(field.doc).map((line) => `  ${line}`));
      lines.push(`  final ${dartType(field)} ${field.name};`, "");
    }
    lines.push(
      `  factory ${model.name}.fromJson(Map<String, dynamic> json) => ${model.name}(`,
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
