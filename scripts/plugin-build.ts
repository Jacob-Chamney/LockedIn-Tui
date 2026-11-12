/**
 * Package a source plugin as a `.lockedin` directory.
 *
 *   bun run plugin:build src/ui/effects/examples/scene-window
 *   bun run plugin:build path/to/plugin --out plugins
 *
 * The output is `<out>/<manifest id>.lockedin/` with a normalised
 * `manifest.json` and one `plugin.js`. The bundle is validated in a sandbox
 * before it is written, so a package that cannot load is never produced.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

import { bundleEffectEntry } from "../src/ui/effects/loader"
import { MAX_BUNDLE_BYTES } from "../src/ui/effects/sandbox/limits"
import { SandboxedEffect } from "../src/ui/effects/sandbox/effect"
import { parseManifest, type EffectManifest } from "../src/ui/effects/sandbox/manifest"

export type PluginBuildResult =
  | { ok: true; dir: string; manifest: EffectManifest; bytes: number }
  | { ok: false; error: string }

export async function buildPlugin(sourceDir: string, outRoot = "plugins"): Promise<PluginBuildResult> {
  try {
    const root = resolve(sourceDir)
    const raw = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as unknown
    const check = parseManifest(raw)
    if (!check.ok) return { ok: false, error: check.errors.join("; ") }
    const manifest = check.manifest

    const entry = resolve(root, manifest.entry)
    if (entry !== root && !entry.startsWith(`${root}${sep}`)) {
      return { ok: false, error: "entry must stay inside the plugin directory" }
    }
    const prebuilt = /\.(js|mjs)$/.test(entry)
    const bundle = prebuilt ? await Bun.file(entry).text() : await bundleEffectEntry(entry)
    if (/\brequire\s*\(/.test(bundle)) {
      return { ok: false, error: "the bundle must be self-contained: require() is not available" }
    }
    if (bundle.length > MAX_BUNDLE_BYTES) {
      return {
        ok: false,
        error: `bundle is ${bundle.length} bytes; the limit is ${MAX_BUNDLE_BYTES}`,
      }
    }

    // Prove the package loads under the same limits the app uses.
    const effect = await SandboxedEffect.create(bundle, manifest)
    effect.dispose()

    const output = join(resolve(outRoot), `${manifest.id}.lockedin`)
    await rm(output, { recursive: true, force: true })
    await mkdir(output, { recursive: true })
    await writeFile(
      join(output, "manifest.json"),
      `${JSON.stringify({ ...manifest, entry: "plugin.js" }, null, 2)}\n`,
      "utf8",
    )
    await writeFile(join(output, "plugin.js"), bundle, "utf8")
    return { ok: true, dir: output, manifest, bytes: bundle.length }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf("--out")
  const source = args.find((arg, index) => !arg.startsWith("--") && index !== outIndex + 1)
  const outRoot = outIndex >= 0 ? (args[outIndex + 1] ?? "plugins") : "plugins"
  if (!source) {
    console.error("usage: bun run plugin:build <plugin-dir> [--out <dir>]")
    process.exit(1)
  }
  const result = await buildPlugin(source, outRoot)
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }
  console.log(`built ${result.manifest.id} -> ${result.dir} (${result.bytes} bytes)`)
}
