/**
 * The desktop startup budget has one number.
 *
 * The row in `desktop/docs/packaging.md` is the promise, the fixture is what
 * the measuring script reads, and CI passes the host factor. This test keeps
 * the three in step, so a budget change is a deliberate edit to all of them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

const budget = JSON.parse(
  read("tests/fixtures/desktop-perf-budget.json"),
) as { maxMs?: unknown };
const doc = read("desktop/docs/packaging.md");
const script = read("scripts/desktop-perf.sh");
const workflow = read(".github/workflows/desktop.yml");

describe("desktop startup budget", () => {
  test("the documented row and the fixture agree", () => {
    expect(budget.maxMs).toBe(2000);
    expect(doc).toContain(`≤ ${budget.maxMs} ms`);
  });

  test("the measuring script reads the fixture and accepts a host factor", () => {
    expect(script).toContain("tests/fixtures/desktop-perf-budget.json");
    expect(script).toContain("--host-factor");
    expect(script).toContain("skip: no packaged build");
  });

  test("CI builds the bundle, installs a display and measures it", () => {
    expect(workflow).toContain("scripts/desktop-perf.sh");
    expect(workflow).toContain("--host-factor=1.9");
    expect(workflow).toContain("xvfb");
    expect(workflow).toContain("imagemagick");
  });
});
