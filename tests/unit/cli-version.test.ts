/**
 * The two flags `install.sh` and a person use (`src/server/main.ts`).
 *
 * `install.sh` finishes with `lockedin --version`, so the compiled binary has to
 * answer without a shell attached. The stdio sidecar must stay the default: with
 * no flag the process is a JSON-RPC server and this test never starts that
 * (it would wait on stdin).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { APP_VERSION } from "../../src/version";

const ROOT = join(import.meta.dir, "..", "..");
const ENTRY = join(ROOT, "src", "server", "main.ts");

function run(...args: string[]): { stdout: string; code: number } {
  const result = Bun.spawnSync([process.execPath, ENTRY, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: result.stdout.toString(), code: result.exitCode ?? -1 };
}

describe("the core's command line", () => {
  test("--version prints exactly the package version and exits 0", () => {
    for (const flag of ["--version", "-v"]) {
      const { stdout, code } = run(flag);
      expect(stdout.trim()).toBe(APP_VERSION);
      expect(code).toBe(0);
    }
  });

  test("--help names both modes and exits 0", () => {
    for (const flag of ["--help", "-h"]) {
      const { stdout, code } = run(flag);
      expect(stdout).toContain("usage:");
      expect(stdout).toContain("--version");
      expect(stdout).toContain("JSON-RPC");
      expect(code).toBe(0);
    }
  });

  test("the version is the one package.json carries", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as {
      version: string;
    };
    // Release assets are named from package.json and report this same string.
    expect(APP_VERSION).toBe(manifest.version);
  });
});
