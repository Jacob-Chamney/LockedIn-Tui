/**
 * The public tree is an allowlist, not a mirror.
 *
 * `Jacob-Chamney/LockedIn-Tui` is public and must contain only the source
 * required to build, test and run the program. This test renders the tree the
 * way the sync does and fails if any agent, task, review or internal doc path
 * lands in it — the same check the script performs before a publish.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** Paths that must never be published, whatever else changes. */
const FORBIDDEN = [
  "AGENTS.md",
  "GOAL.md",
  "desktop/AGENTS.md",
  "desktop/PLAN.md",
  "swarm",
  "reports",
  ".opencode",
  "spikes",
  "docs",
  "desktop/tasks",
  "desktop/docs/screenshots",
  "node_modules",
  "dist",
  "desktop/build",
];

/** Paths a public tree must contain, or a reader cannot build the program. */
const REQUIRED = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "LICENSE",
  "src/server/protocol.ts",
  "src/server/main.ts",
  "desktop/pubspec.yaml",
  "desktop/lib/shell/shell.dart",
  "scripts/desktop-build.sh",
  "scripts/desktop-package.sh",
];

test("an absolute destination is used as-is on every platform", async () => {
  // The first Windows run failed here: a leading-slash check joined an absolute
  // `C:\…` destination onto the working directory, which cannot exist.
  const source = await readFile(join(ROOT, "scripts", "public-tree.ts"), "utf8");
  expect(source).toContain("isAbsolute(target) ? target : join(process.cwd(), target)");
  expect(source).not.toContain('target.startsWith("/")');
});

function render(): string {
  const target = mkdtempSync(join(tmpdir(), "lockedin-public-tree-"));
  const run = Bun.spawnSync({
    // The running Bun binary, not "bun": a Windows spawn has no shell to
    // resolve a bare name through.
    cmd: [process.execPath, "run", "scripts/public-tree.ts", target],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0) {
    throw new Error(`public-tree failed: ${run.stderr.toString().slice(0, 400)}`);
  }
  expect(run.stdout.toString()).toContain("allowlist check: clean");
  return target;
}

describe("public tree", () => {
  test("renders without any internal path", () => {
    const target = render();
    try {
      for (const path of FORBIDDEN) {
        expect({ path, present: existsSync(join(target, path)) }).toEqual({ path, present: false });
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("contains the source a reader needs to build and test", () => {
    const target = render();
    try {
      for (const path of REQUIRED) {
        expect({ path, present: existsSync(join(target, path)) }).toEqual({ path, present: true });
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("keeps build output out of the tree", () => {
    const target = render();
    try {
      // A 400 MB build folder would drown the source in a diff.
      expect(existsSync(join(target, "desktop/build"))).toBe(false);
      expect(existsSync(join(target, "desktop/linux/flutter/ephemeral"))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
