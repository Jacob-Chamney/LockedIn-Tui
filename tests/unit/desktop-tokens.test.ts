/**
 * The shell's design tokens are the only radius scale.
 *
 * `desktop/docs/redesign.md` §3.3: radius `0` chrome, `2` controls, `6` floating
 * layers. Raw `BorderRadius.circular(8)` values were why two surfaces side by
 * side looked like different apps. This guard is the executable half of that
 * rule; a new raw radius fails here instead of surviving review.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LIB = join(import.meta.dir, "..", "..", "desktop", "lib");

async function dartFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await dartFiles(path)));
    else if (entry.name.endsWith(".dart")) files.push(path);
  }
  return files;
}

describe("desktop design tokens", () => {
  test("no surface hard-codes a corner radius", async () => {
    const files = (await dartFiles(LIB)).filter(
      (file) => !file.includes(`${join("lib", "theme")}`),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/(BorderRadius|Radius)\.circular\(\s*\d/.test(source)) {
        offenders.push(file.slice(LIB.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no surface hard-codes a font size", async () => {
    const files = (await dartFiles(LIB)).filter(
      (file) => !file.includes(`${join("lib", "theme")}`),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/fontSize:\s*\d/.test(source)) {
        offenders.push(file.slice(LIB.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
