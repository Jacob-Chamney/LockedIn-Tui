/**
 * UI copy is plain text, not Markdown.
 *
 * The archive empty state shipped `archive one from Sessions or Skills with
 * `a``, so the backticks rendered literally and the surface was still called
 * "Skills" after every other page had moved to "Teaching". Keys are rendered as
 * keycaps (or as the pressed key in a hint), never as Markdown code.
 *
 * The two chat lexers are exempt: they parse backticks because that is their
 * job. Every other feature file may use a backtick only in a comment.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const FEATURES = join(ROOT, "desktop", "lib", "features");

/** Files that read a backtick as syntax, not as copy. */
const LEXERS = new Set(["markdown.dart", "code_highlight.dart"]);

function dartFiles(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...dartFiles(path));
    else if (name.endsWith(".dart") && !LEXERS.has(name)) found.push(path);
  }
  return found;
}

function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("///");
}

describe("feature copy", () => {
  test("no user-facing string renders a Markdown backtick", () => {
    const offenders: string[] = [];
    for (const path of dartFiles(FEATURES)) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (isComment(line) || !line.includes("`")) return;
        offenders.push(`${path.replace(ROOT + "/", "")}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test("the removed surface name is not in copy", () => {
    // The id `skills` stays on the protocol and in paths; a capitalised
    // "Skills" in a sentence is the old surface name.
    const offenders: string[] = [];
    for (const path of dartFiles(FEATURES)) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (isComment(line)) return;
        if (/['"][^'"]*Skills[^'"]*['"]/.test(line)) {
          offenders.push(
            `${path.replace(ROOT + "/", "")}:${index + 1}: ${line.trim()}`,
          );
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
