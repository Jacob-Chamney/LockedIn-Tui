/** Space d on the project chat opens the real git summary. */
import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { register } = await import("../../src/services/work/register")

const git = Bun.which("git")
const changesTest = git ? test : test.skip

function run(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

changesTest("the project chat opens the changes summary", async () => {
  const base = await mkdtemp(join(tmpdir(), "work-changes-"))
  const root = join(base, "atlas")
  await mkdir(root, { recursive: true })
  run(root, ["init"])
  run(root, ["config", "user.email", "test@example.com"])
  run(root, ["config", "user.name", "Test"])
  await writeFile(join(root, "a.ts"), "const a = 1\n")
  run(root, ["add", "a.ts"])
  run(root, ["commit", "-m", "initial"])
  await writeFile(join(root, "a.ts"), "const a = 2\n")

  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const registered = await register({ workspace: made.value, root, name: "Atlas" })
  if (!registered.ok) throw new Error(registered.error.message)

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={made.value} initial={{ pane: "projects" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Atlas"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Ask anything"))
    await ui.press("space")
    await ui.press("d")
    await ui.waitUntil(() => ui.frame().includes("Changes"))
    const frame = ui.frame()
    expect(frame).toContain("Changes")
    expect(frame).toContain("a.ts")
    expect(frame).toContain("modified")
  } finally {
    await ui.dispose()
  }
}, 30_000)
