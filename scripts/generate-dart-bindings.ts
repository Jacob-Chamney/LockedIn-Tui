/**
 * Generate the Dart wire-method catalogue from the core's capabilities.
 *
 * The Flutter client names every JSON-RPC method with a string. A rename on the
 * TypeScript side was caught only at runtime (-32601) unless a hand-written
 * fixture happened to cover it. `desktop/lib/bridge/core_methods.g.dart` is
 * generated from `CAPABILITIES`; the client calls `CoreMethod.sessionList`, so a
 * renamed capability changes the constant and a stale call site stops
 * compiling.
 *
 *   bun run scripts/generate-dart-bindings.ts            # write the file
 *   bun run scripts/generate-dart-bindings.ts --check    # fail if it is stale
 *
 * `tests/unit/generated-bindings.test.ts` runs the check, so CI fails when the
 * file and the source disagree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CAPABILITIES_SOURCE = "src/server/protocol.ts";
export const BINDINGS_PATH = "desktop/lib/bridge/core_methods.g.dart";

/** The advertised capability strings, in declaration order. */
export function capabilitiesFrom(source: string): string[] {
  const match = /CAPABILITIES\s*=\s*\[(.*?)\]/s.exec(source);
  if (match === null || match[1] === undefined) {
    throw new Error("CAPABILITIES not found in the protocol source");
  }
  const capabilities = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!);
  if (capabilities.length === 0) {
    throw new Error("CAPABILITIES is empty");
  }
  return capabilities;
}

/** `session.chat.snapshot` → `sessionChatSnapshot`. */
export function dartName(method: string): string {
  const parts = method.split(/[._-]/).filter((part) => part !== "");
  const [head, ...rest] = parts;
  if (head === undefined || !/^[a-z]/.test(head)) {
    throw new Error(`cannot generate a Dart name for ${JSON.stringify(method)}`);
  }
  return head + rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

export function renderBindings(capabilities: readonly string[]): string {
  const seen = new Set<string>();
  const rows = capabilities.map((method) => {
    const name = dartName(method);
    if (seen.has(name)) throw new Error(`duplicate Dart name ${name} for ${method}`);
    seen.add(name);
    return { method, name };
  });
  const lines = [
    "// GENERATED FILE — do not edit by hand.",
    "// dart format off",
    "//",
    "// Generated from `CAPABILITIES` in `src/server/protocol.ts`.",
    "// Regenerate: `bun run scripts/generate-dart-bindings.ts`.",
    "//",
    "// The shell calls `CoreMethod.sessionList` instead of `'session.list'`, so a",
    "// renamed capability changes this file and a stale call site stops compiling.",
    "",
    "abstract final class CoreMethod {",
    ...rows.map(({ method, name }) => `  static const String ${name} = '${method}';`),
    "",
    "  /// Every generated method, in the core's declaration order.",
    "  static const List<String> all = <String>[",
    ...rows.map(({ name }) => `    ${name},`),
    "  ];",
    "}",
    "",
  ];
  return lines.join("\n");
}

export function generate(root: string): { path: string; content: string } {
  const source = readFileSync(join(root, CAPABILITIES_SOURCE), "utf8");
  return {
    path: join(root, BINDINGS_PATH),
    content: renderBindings(capabilitiesFrom(source)),
  };
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const { path, content } = generate(root);
  const check = process.argv.includes("--check");
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current !== content) {
      console.error(
        `${BINDINGS_PATH} is stale; run: bun run scripts/generate-dart-bindings.ts`,
      );
      process.exit(1);
    }
    console.log(`${BINDINGS_PATH} is up to date`);
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${BINDINGS_PATH}`);
  }
}
