/**
 * The generated Dart method catalogue tracks the core.
 *
 * `scripts/generate-dart-bindings.ts` turns `CAPABILITIES` into
 * `desktop/lib/bridge/core_methods.g.dart`. The shell calls those constants, so
 * a renamed capability is a compile error rather than a runtime `-32601`. This
 * test fails when the checked-in file is stale or a raw method literal returns.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
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

  test("every bridge file calls a capability by its constant", () => {
    // The store was split into part files, and this test only looked at the
    // barrel: two raw `teach.practice` strings and the transport's deadline
    // table slipped through. Every Dart file under `bridge/` is scanned now,
    // except the generated catalogue and comments.
    const capabilities = new Set(capabilitiesFrom(read(CAPABILITIES_SOURCE)));
    const directory = join(ROOT, "desktop/lib/bridge");
    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".dart"))
      .filter((name) => name !== "core_methods.g.dart")
      .sort();

    const offenders: string[] = [];
    for (const name of files) {
      const lines = readFileSync(join(directory, name), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (line.trimStart().startsWith("//")) return;
        for (const capability of capabilities) {
          if (
            line.includes(`'${capability}'`) ||
            line.includes(`"${capability}"`)
          ) {
            offenders.push(`${name}:${index + 1}: ${capability}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
