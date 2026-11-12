/**
 * End-to-end acceptance pass over the plugin customization API.
 *
 * For every shipped scene example and every scaffold template: package it into
 * `.lockedin`, load the package through the normal loader, create a sandboxed
 * effect, compose a scene, run every granted command, and report the result.
 *
 *   bun run acceptance
 *
 * Exit code 1 if anything fails.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildPlugin } from "./plugin-build"
import { scaffoldPlugin, SCAFFOLD_TEMPLATES } from "./plugin-new"
import { loadPlugins } from "../src/ui/plugins/loader"
import { SandboxedPlugin } from "../src/ui/plugins/sandbox/plugin"
import { collectFocusIds, type SceneNode } from "../src/ui/plugins/scene/model"

type Row = { name: string; ok: boolean; detail: string }

const rows: Row[] = []
const root = await mkdtemp(join(tmpdir(), "lockedin-acceptance-"))
const state = { width: 110, height: 40 }

async function inspect(name: string, source: string): Promise<void> {
  const built = await buildPlugin(source, join(root, "packages"))
  if (!built.ok) {
    rows.push({ name, ok: false, detail: `package: ${built.error}` })
    return
  }
  const manifestFile = Bun.file(join(built.dir, "manifest.json"))
  const packaged = (await manifestFile.json()) as { entry?: string }
  if (packaged.entry !== "plugin.js") {
    rows.push({ name, ok: false, detail: "package entry is not plugin.js" })
    return
  }
  const loaded = await loadPlugins([built.dir])
  if (loaded.errors.length > 0 || !loaded.plugins[0]) {
    rows.push({ name, ok: false, detail: loaded.errors[0] ?? "package did not load" })
    return
  }
  const plugin = loaded.plugins[0]
  const effect = await SandboxedPlugin.create(plugin.bundle, plugin.manifest)
  const problems: string[] = []
  try {
    const scene = effect.compose({
      state: { ...state, focusedWindow: null },
      time: 1,
      dt: 0.25,
    }) as { nodes: SceneNode[] }
    const focus = collectFocusIds(scene.nodes)
    const commands = plugin.manifest.permissions.commands ?? []
    for (const command of commands) {
      const result = effect.runCommand(command.id, {
        state,
        time: 2,
        pointer: {
          type: "click",
          x: 2,
          y: 2,
          ...(focus[0] ? { window: focus[0] } : {}),
          row: 0,
          column: 0,
        },
      })
      if (!result.ok) problems.push(`${command.id}: ${result.message ?? "failed"}`)
    }
    rows.push({
      name,
      ok: problems.length === 0,
      detail:
        problems.length > 0
          ? problems.join("; ")
          : `${scene.nodes.length} node(s) · ${focus.length} focus id(s) · ${commands.length} command(s)`,
    })
  } catch (error) {
    rows.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    effect.dispose()
  }
}

try {
  const examplesDir = join(import.meta.dir, "..", "src", "ui", "plugins", "examples")
  const examples = (await readdir(examplesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("scene-"))
    .map((entry) => entry.name)
    .sort()
  for (const dir of examples) {
    await inspect(dir, join(examplesDir, dir))
  }

  for (const template of SCAFFOLD_TEMPLATES) {
    const id = `accept.${template}`
    const created = await scaffoldPlugin({
      id,
      template,
      out: join(root, "scaffolds"),
      force: true,
    })
    if (!created.ok) {
      rows.push({ name: `scaffold:${template}`, ok: false, detail: created.error })
      continue
    }
    await inspect(`scaffold:${template}`, created.dir)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

const width = Math.max(...rows.map((row) => row.name.length))
for (const row of rows) {
  console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name.padEnd(width)}  ${row.detail}`)
}
const failures = rows.filter((row) => !row.ok)
console.log(
  `\nacceptance: ${rows.length - failures.length}/${rows.length} passed` +
    (failures.length > 0 ? ` · ${failures.length} failed` : " · all green"),
)
if (failures.length > 0) process.exit(1)
