/**
 * The generated Dart method catalogue tracks the core.
 *
 * `scripts/generate-dart-bindings.ts` turns `CAPABILITIES` into
 * `desktop/lib/bridge/core_methods.g.dart`. The shell calls those constants, so
 * a renamed capability is a compile error rather than a runtime `-32601`. This
 * test fails when the checked-in file is stale or a raw method literal returns.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BINDINGS_PATH,
  CAPABILITIES_SOURCE,
  capabilitiesFrom,
  dartName,
  renderBindings,
} from "../../scripts/generate-dart-bindings";

const ROOT = join(import.meta.dir, "..", "..");

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

describe("generated Dart bindings", () => {
  test("the checked-in file is exactly what the generator renders", () => {
    const capabilities = capabilitiesFrom(read(CAPABILITIES_SOURCE));
    expect(capabilities.length).toBeGreaterThan(100);
    expect(read(BINDINGS_PATH)).toBe(renderBindings(capabilities));
  });

  test("method names are unique and round-trip to their wire strings", () => {
    const capabilities = capabilitiesFrom(read(CAPABILITIES_SOURCE));
    const generated = read(BINDINGS_PATH);
    const names = capabilities.map(dartName);
    expect(new Set(names).size).toBe(names.length);
    for (const [index, method] of capabilities.entries()) {
      expect(generated).toContain(
        `static const String ${names[index]} = '${method}';`,
      );
    }
  });

  test("the shell never calls a method by a raw literal", () => {
    const client = read("desktop/lib/bridge/core_client.dart");
    expect(client).not.toContain("_connection.call('");
    expect(client).toContain("import 'core_methods.g.dart';");
    // The envelope methods are not data capabilities; they stay explicit.
    expect(client).toContain("call('initialize'");
  });
});
