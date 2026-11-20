/**
 * Render the public source tree.
 *
 * The private overlay holds agent files, specs, reviews and swarm tooling; none
 * of it may reach `Jacob-Chamney/LockedIn-Tui`. This script is the allowlist:
 * it copies only the paths a person needs to build, test and understand the
 * program, and it **fails** if a deny pattern appears in the result.
 *
 *   bun run scripts/public-tree.ts /tmp/public-tree          # render
 *   bun run scripts/public-tree.ts /tmp/public-tree --check  # render + verify
 *
 * The result is a directory tree; the caller commits it to the public repo. It
 * never touches git and never deletes anything in the destination, so a sync is
 * "add or update", not "mirror and prune".
 */
import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Everything the program needs, and nothing about how it was built by agents. */
const ALLOW: readonly string[] = [
  // Source, tests, build and tooling.
  "src",
  "desktop",
  "scripts",
  "tests",
  "assets",
  "plugins",
  "sdk",
  "licenses",
  // Repository metadata and licences.
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
  "install.sh",
  "LICENSE",
  "NOTICE",
  "THIRD-PARTY-NOTICES.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "TRADEMARK.md",
  ".gitattributes",
  ".gitignore",
  // CI for the program. `ci.yml` and `release.yml` belong to the public repo,
  // so they are deliberately not rendered here: a sync adds, never overwrites.
  ".github/workflows/desktop.yml",
  ".github/workflows/desktop-selfhosted.yml",
];

/** Paths inside an allowed directory that are still internal. */
const DENY: readonly string[] = [
  // Agent and orchestration material.
  "AGENTS.md",
  "GOAL.md",
  "swarm",
  "reports",
  ".opencode",
  "wiki",
  "spikes",
  "node_modules",
  "dist",
  ".dart_tool",
  // Internal specifications and reviews.
  "docs",
  // Public-owned front matter. This overlay's README describes the overlay and
  // its CONTRIBUTING is behind the public one; rendering either would overwrite
  // the public repository's own copy on the next sync.
  "README.md",
  "CONTRIBUTING.md",
  // Desktop work-in-progress material.
  "desktop/AGENTS.md",
  "desktop/PLAN.md",
  "desktop/tasks",
  // Build output: never committed, and 400 MB of it would drown the source.
  "desktop/build",
  // Flutter's generated per-platform scaffolding, and the IDE folder.
  "desktop/linux/flutter/ephemeral",
  "desktop/windows/flutter/ephemeral",
  "desktop/macos/flutter/ephemeral",
  "desktop/.idea",
  "desktop/.dart_tool",
  "desktop/.flutter-plugins",
  "desktop/.flutter-plugins-dependencies",
  "desktop/.packages",
  "desktop/docs/screenshots",
  "desktop/docs/windows-verification.md",
  "desktop/docs/conversion-status.md",
];

/** Individual files that are never published, wherever they sit. */
const DENY_NAMES: readonly string[] = [".DS_Store", "Thumbs.db"];

function normalise(path: string): string {
  return path.split("\\").join("/");
}

function denied(path: string): string | null {
  const p = normalise(path);
  for (const rule of DENY) {
    if (p === rule || p.startsWith(`${rule}/`)) return rule;
  }
  const base = p.split("/").at(-1) ?? p;
  if (DENY_NAMES.includes(base)) return base;
  if (/\.tmp-[\w-]+$/.test(base)) return "temp file";
  if (base.startsWith(".") && base.endsWith(".log")) return "log file";
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(destination: string, entry: string): Promise<{ files: number; skipped: string[] }> {
  const from = join(ROOT, entry);
  if (!(await exists(from))) return { files: 0, skipped: [] };
  let files = 0;
  const skipped: string[] = [];
  const info = await stat(from);
  if (info.isDirectory()) {
    const glob = new Bun.Glob("**/*");
    for await (const found of glob.scan({ cwd: from, onlyFiles: true, dot: true })) {
      const rel = normalise(`${entry}/${found}`);
      const rule = denied(rel);
      if (rule !== null) {
        skipped.push(`${rel} (${rule})`);
        continue;
      }
      const to = join(destination, rel);
      await mkdir(dirname(to), { recursive: true });
      await cp(join(ROOT, rel), to);
      files += 1;
    }
    return { files, skipped };
  }
  const rule = denied(entry);
  if (rule !== null) return { files: 0, skipped: [`${entry} (${rule})`] };
  const to = join(destination, entry);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
  return { files: 1, skipped };
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target === undefined || target === "") {
    console.error("usage: bun run scripts/public-tree.ts <destination> [--check]");
    process.exit(2);
  }
  // `isAbsolute`, not a leading "/": a Windows destination is `C:\…`, and
  // joining that against the cwd produced an impossible path.
  const destination = isAbsolute(target) ? target : join(process.cwd(), target);
  await mkdir(destination, { recursive: true });

  let total = 0;
  const skipped: string[] = [];
  for (const entry of ALLOW) {
    const result = await copyEntry(destination, entry);
    total += result.files;
    skipped.push(...result.skipped);
  }

  // Verify the result, not the intent: walk what actually landed.
  const glob = new Bun.Glob("**/*");
  const offenders: string[] = [];
  for await (const found of glob.scan({ cwd: destination, onlyFiles: true, dot: true })) {
    const rule = denied(found);
    if (rule !== null) offenders.push(`${found} (${rule})`);
  }

  console.log(`public tree: ${destination}`);
  console.log(`files: ${total}`);
  if (skipped.length > 0) {
    console.log(`excluded inside allowed paths: ${skipped.length}`);
    for (const entry of skipped.slice(0, 10)) console.log(`  - ${entry}`);
    if (skipped.length > 10) console.log(`  … ${skipped.length - 10} more`);
  }
  if (offenders.length > 0) {
    console.error(`refusing to publish: ${offenders.length} internal path(s) landed`);
    for (const entry of offenders.slice(0, 20)) console.error(`  - ${entry}`);
    process.exit(1);
  }
  console.log("allowlist check: clean");
}

await main();
