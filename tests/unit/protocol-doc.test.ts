/**
 * `desktop/docs/protocol.md` is the wire contract, so its handshake example must
 * name exactly the capabilities the core advertises. Drift here is how a shell
 * author ends up implementing a method the core does not have (or missing one it
 * does); the six `teach.*` methods were missing for exactly that reason.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CAPABILITIES } from "../../src/server/protocol";

const DOC = join(import.meta.dir, "../../desktop/docs/protocol.md");

function documented(): string[] {
  const line = readFileSync(DOC, "utf8")
    .split("\n")
    .find((entry) => entry.includes('"capabilities":[') && entry.includes('"protocol":1'));
  if (line === undefined) throw new Error("the handshake example has no capabilities list");
  const list = /"capabilities":\[(.*?)\]/.exec(line);
  if (list === null) throw new Error("the capabilities list is not an array");
  return [...list[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

describe("protocol.md", () => {
  test("the handshake lists exactly the advertised capabilities", () => {
    const listed = documented();
    expect([...listed].sort()).toEqual([...CAPABILITIES].sort());
  });

  test("every teaching method is documented in its own section", () => {
    const text = readFileSync(DOC, "utf8");
    for (const method of [
      "teach.state",
      "teach.measure",
      "teach.step",
      "teach.check",
      "teach.practice",
      "teach.practice.result",
    ]) {
      expect(text).toContain(`- \`${method}\``);
    }
  });
});
