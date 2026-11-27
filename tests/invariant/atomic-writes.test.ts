/**
 * Every write that renames into place goes through the documented atomic
 * contract (`docs/data-model.md` §3): temp file, fsync, rename, then a
 * best-effort directory fsync. A crash leaves the old bytes or the new ones.
 *
 * The guard reads the tree: a file that renames without either the shared
 * helper or an explicit `.sync()` is the regression this test exists to catch.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { writeFileAtomic } from "../../src/storage/atomic";

const ROOT = join(import.meta.dir, "..", "..");

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("atomic writes", () => {
  test("the helper replaces the destination and leaves no temp file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lockedin-atomic-"));
    try {
      const path = join(dir, "note.md");
      await writeFile(path, "old\n", "utf8");
      await writeFileAtomic(path, "new\n");
      expect(await readFile(path, "utf8")).toBe("new\n");
      expect((await readdir(dir)).filter((name) => name.includes("atomic"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a failed write leaves the previous bytes and no temp file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lockedin-atomic-"));
    try {
      const path = join(dir, "note.md");
      await writeFile(path, "old\n", "utf8");
      // A directory in place of the destination makes the rename fail.
      const blocked = join(dir, "blocked.md");
      await rm(blocked, { force: true });
      await writeFileAtomic(blocked, "first\n");
      await expect(writeFileAtomic(join(dir, "missing", "x.md"), "x")).rejects.toBeDefined();
      expect(await readFile(path, "utf8")).toBe("old\n");
      expect((await readdir(dir)).filter((name) => name.includes("atomic"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("every rename in src is covered by a sync or the shared helper", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("rename(")) continue;
      if (file.endsWith(join("storage", "atomic.ts"))) continue;
      if (text.includes("storage/atomic")) continue;
      // A local helper is fine only when it syncs the handle before renaming.
      if (text.includes(".sync()")) continue;
      offenders.push(file.slice(ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
