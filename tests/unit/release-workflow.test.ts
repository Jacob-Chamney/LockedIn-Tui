/**
 * The Release workflow (`docs/release.md` §3–§4).
 *
 * Two things must stay true or a release is dangerous:
 *
 * 1. the build jobs are **read-only** — a build step has no token that could
 *    publish or rewrite anything;
 * 2. publishing only ever creates a **draft**, and only when the caller asked
 *    for one, so the owner still reviews and publishes by hand.
 *
 * The matrix is asserted too: a missing target would ship a release that the
 * installer cannot use on that platform.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
const WORKFLOW_TEXT = WORKFLOW.replace(/\r\n/g, "\n");

/** The lines of one job's block, ending at the next two-space job key. */
function job(name: string): string {
  const start = WORKFLOW_TEXT.indexOf(`\n  ${name}:\n`);
  if (start === -1) throw new Error(`no job "${name}"`);
  const rest = WORKFLOW_TEXT.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("release workflow", () => {
  test("is triggered by hand, with a draft switch that defaults to off", () => {
    expect(WORKFLOW_TEXT).toContain("name: Release");
    expect(WORKFLOW_TEXT).toContain("workflow_dispatch:");
    expect(WORKFLOW_TEXT).toContain("draft_release:");
    // A dispatch without inputs must never publish.
    expect(WORKFLOW_TEXT).toMatch(/default: false/);
  });

  test("builds every target the installer can ask for", () => {
    for (const target of [
      "bun-linux-x64",
      "bun-linux-x64-musl",
      "bun-linux-arm64",
      "bun-linux-arm64-musl",
      "bun-darwin-x64",
      "bun-darwin-arm64",
      "bun-windows-x64",
    ]) {
      expect(WORKFLOW_TEXT).toContain(target);
    }
    // The asset name is what `install.sh` constructs.
    expect(WORKFLOW_TEXT).toContain("lockedin-$version-bun-${{ matrix.artifact }}");
    expect(WORKFLOW_TEXT).toContain("install.sh");
    expect(WORKFLOW_TEXT).toContain("SHA256SUMS");
  });

  test("compiles a release build with the version baked in", () => {
    expect(WORKFLOW_TEXT).toContain("bun build --compile");
    expect(WORKFLOW_TEXT).toContain("process.env.LOCKEDIN_RELEASE");
    expect(WORKFLOW_TEXT).toContain("process.env.LOCKEDIN_APP_VERSION");
    expect(WORKFLOW_TEXT).toContain("src/server/main.ts");
  });

  test("the build jobs are read-only and hold no secret", () => {
    expect(WORKFLOW_TEXT).toContain("permissions:\n  contents: read");
    for (const name of ["version", "build"]) {
      const block = job(name);
      expect(block).not.toContain("contents: write");
      expect(block).not.toContain("secrets.");
    }
    // `write` appears once, in `assemble`, for the draft only.
    const writes = WORKFLOW_TEXT.split("contents: write").length - 1;
    expect(writes).toBe(1);
    expect(job("assemble")).toContain("contents: write");
    expect(WORKFLOW_TEXT).not.toContain("secrets.");
  });

  test("publishing only ever creates a draft release", () => {
    const assemble = job("assemble");
    expect(assemble).toContain("if: inputs.draft_release");
    expect(assemble).toContain("gh release create");
    expect(assemble).toContain("--draft");
    // No step may publish a draft or delete a release.
    expect(WORKFLOW_TEXT).not.toContain("--draft=false");
    expect(WORKFLOW_TEXT).not.toContain("gh release edit");
    expect(WORKFLOW_TEXT).not.toContain("gh release delete");
  });

  test("the assembled set is verified before it is attached", () => {
    const assemble = job("assemble");
    expect(assemble).toContain("sha256sum -c SHA256SUMS");
    expect(assemble).toContain("expected 9 files");
  });
});
