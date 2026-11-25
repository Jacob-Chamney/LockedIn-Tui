/**
 * Every advertised capability is exercised somewhere in the suite.
 *
 * `protocol.md` guards the handshake list; this guards the other direction: a
 * method can be advertised and documented but never tested. A literal mention is
 * a weak signal, but it catches the common failure — a new method ships with no
 * test at all.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CAPABILITIES } from "../../src/server/protocol";

const ROOT = join(import.meta.dir, "..", "..");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function testText(): string {
  return walk(join(ROOT, "tests")).map((path) => readFileSync(path, "utf8")).join("\n");
}

describe("protocol capabilities", () => {
  test("every advertised capability is mentioned by a test", () => {
    const text = testText();
    const missing = CAPABILITIES.filter((capability) => !text.includes(capability));
    expect(missing).toEqual([]);
  });

  test("the advertised list has no duplicates", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });
});
