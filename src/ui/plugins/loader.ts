/**
 * Dev-only loader for user effect files.
 *
 *   LOCKEDIN_EFFECTS_FILE=~/my-effect.ts bun run start
 *   LOCKEDIN_EFFECTS_DIR=~/effects    bun run start
 *
 * A file exports a system as its default export (or a named `system`). The
 * loader validates it with `validateParticleSystem` and re-imports it when the
 * modification time changes, so editing an effect and restarting is enough.
 * `watchPlugins` reports edits while the app is running.
 *
 * This runs the file in-process. That is acceptable for a dev harness; the
 * sandboxed host is what will run community effects.
 */
import { watch, type FSWatcher } from "node:fs"
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { validateParticleSystem, type ParticleSystem } from "./api"
import { effectDebug } from "./debug"
import { MAX_BUNDLE_BYTES } from "./sandbox/limits"
import { parseManifest, type PluginManifest } from "./sandbox/manifest"

export type LoadedSystem = {
  path: string
  system: ParticleSystem
}

export type LoadResult = {
  systems: LoadedSystem[]
  errors: string[]
}

function expand(path: string, env: Record<string, string | undefined>): string {
  return resolve(path.replace(/^~(?=\/)/, env.HOME ?? "~"))
}

/** Paths from `LOCKEDIN_EFFECTS_FILE`, expanded and made absolute. */
export function effectFilesFromEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.LOCKEDIN_EFFECTS_FILE ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => expand(path, env))
}

/** Files from `LOCKEDIN_EFFECTS_FILE`, or every `.ts` in `LOCKEDIN_EFFECTS_DIR`. */
export async function particlePathsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const files = effectFilesFromEnv(env)
  if (files.length > 0) return files
  const dir = env.LOCKEDIN_EFFECTS_DIR?.trim()
  if (!dir) return []
  const root = expand(dir, env)
  try {
    const names = await readdir(root)
    return names
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
      .sort()
      .map((name) => join(root, name))
  } catch {
    return []
  }
}

let builds = 0

/**
 * Import one file and validate its exported system.
 *
 * Bun caches modules by path, so a changed file is bundled to a fresh module and
 * imported by a unique name. Bundling also resolves the file's own relative
 * imports from its real location.
 */
export async function loadParticleFile(path: string): Promise<LoadedSystem | { error: string }> {
  try {
    await stat(path)
  } catch {
    return { error: `cannot read ${path}` }
  }
  const out = join(tmpdir(), "lockedin-effects", `${process.pid}-${builds++}`)
  try {
    await mkdir(out, { recursive: true })
    await Bun.build({
      entrypoints: [path],
      target: "bun",
      format: "esm",
      external: ["@opentui/core"],
      outdir: out,
      naming: "effect.mjs",
    })
    const file = join(out, "effect.mjs")
    const module = (await import(pathToFileURL(file).href)) as {
      default?: unknown
      system?: unknown
    }
    const exported = module.default ?? module.system
    if (exported === undefined) return { error: `${path} exports no default system` }
    const check = validateParticleSystem(exported)
    if (!check.ok) return { error: `${path}: ${check.errors.join("; ")}` }
    return { path, system: check.system }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    effectDebug(`load failed: ${path}: ${message}`)
    return { error: `${path}: ${message}` }
  } finally {
    await rm(out, { recursive: true, force: true }).catch(() => {})
  }
}

/** Load every selected file, keeping the good ones and reporting the rest. */
export async function loadParticleFiles(paths: readonly string[]): Promise<LoadResult> {
  const systems: LoadedSystem[] = []
  const errors: string[] = []
  for (const path of paths) {
    const result = await loadParticleFile(path)
    if ("error" in result) errors.push(result.error)
    else systems.push(result)
  }
  return { systems, errors }
}

/**
 * Watch the effect files, or the effect directory, and call `onChange` once the
 * writes settle. Editors commonly write a temp file and rename it into place,
 * so this watches the parent directory and filters by name.
 *
 * Returns a function that stops the watchers.
 */
export function watchPlugins(
  env: Record<string, string | undefined> = process.env,
  onChange: () => void,
  delay = 120,
  extraDirs: readonly string[] = [],
): () => void {
  const roots = new Map<string, Set<string> | null>()
  for (const dir of extraDirs) roots.set(resolve(dir), null)
  const dir = env.LOCKEDIN_EFFECTS_DIR?.trim()
  if (dir) {
    roots.set(expand(dir, env), null)
  } else {
    for (const path of effectFilesFromEnv(env)) {
      const root = dirname(path)
      const names = roots.get(root) ?? new Set<string>()
      names.add(basename(path))
      roots.set(root, names)
    }
  }
  if (roots.size === 0) return () => {}

  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const fire = (): void => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!closed) onChange()
    }, delay)
  }

  for (const [root, names] of roots) {
    try {
      const watcher = watch(root, { persistent: false }, (_event, filename) => {
        if (names && filename !== null && !names.has(String(filename))) return
        fire()
      })
      watcher.on("error", () => {
        // A removed directory stops the watch; it must not crash the app.
      })
      watchers.push(watcher)
    } catch {
      // Missing directory: nothing to watch yet.
    }
  }

  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}

/** A sandboxed plugin directory: manifest plus compiled entry bundle. */
export type PluginSource = {
  dir: string
  manifest: PluginManifest
  bundle: string
}

export type PluginLoadResult = {
  plugins: PluginSource[]
  errors: string[]
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Plugin directories from `LOCKEDIN_EFFECTS_PLUGIN` (one) or every subdirectory
 * of `LOCKEDIN_EFFECTS_DIR` that has a `manifest.json`.
 */
export async function pluginDirsFromConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const single = env.LOCKEDIN_EFFECTS_PLUGIN?.trim()
  if (single) return [expand(single, env)]
  const dir = env.LOCKEDIN_EFFECTS_DIR?.trim()
  if (!dir) return []
  const root = expand(dir, env)
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const dirs: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name)
      if (await isFile(join(candidate, "manifest.json"))) dirs.push(candidate)
    }
    return dirs.sort()
  } catch {
    return []
  }
}

/**
 * Plugin directories under each root. A root may itself be a plugin directory,
 * or a folder whose immediate children are plugin directories.
 */
export async function scanPluginDirs(
  roots: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const found = new Set<string>()
  for (const raw of roots) {
    if (!raw.trim()) continue
    const root = expand(raw, env)
    if (await isFile(join(root, "manifest.json"))) {
      found.add(root)
      continue
    }
    try {
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const candidate = join(root, entry.name)
        if (await isFile(join(candidate, "manifest.json"))) found.add(candidate)
      }
    } catch {
      // A missing root is not an error.
    }
  }
  return [...found].sort()
}

/** The SDK source, resolved into a plugin bundle during a source build. */
const SDK_ENTRY = join(import.meta.dir, "../../..", "sdk", "index.ts")

/** Plugin roots shipped beside the app and in the repository. */
export function bundledPluginRoots(
  execPath = process.execPath,
  cwd = process.cwd(),
): string[] {
  return [...new Set([join(dirname(execPath), "plugins"), join(cwd, "plugins")])]
}

/** Compile a plugin entry to one CommonJS bundle for the sandbox. */
export async function bundlePluginEntry(entry: string): Promise<string> {
  const out = join(tmpdir(), "lockedin-effect-build", `${process.pid}-${builds++}`)
  await mkdir(out, { recursive: true })
  try {
    const result = await Bun.build({
      entrypoints: [entry],
      format: "cjs",
      // QuickJS has no Node/Bun globals. Building for bun leaves Node imports
      // visible as `require(...)`, which the check below rejects, instead of
      // quietly replacing them with an empty module.
      target: "bun",
      outdir: out,
      naming: "effect.js",
      plugins: [
        {
          name: "lockedin-sdk",
          setup(build) {
            build.onResolve({ filter: /^@lockedin\/sdk$/ }, () => ({ path: SDK_ENTRY }))
          },
        },
      ],
    })
    if (!result.success || result.outputs.length === 0) {
      const reasons = result.logs.map((log) => log.message).join("; ") || "build failed"
      throw new Error(reasons)
    }
    const code = await Bun.file(result.outputs[0]!.path).text()
    // QuickJS has no `require`; anything the bundler left external (Node
    // builtins, packages) would fail inside the sandbox anyway.
    if (/\brequire\s*\(/.test(code)) {
      throw new Error("the effect must be self-contained: require() is not available in the sandbox")
    }
    return code
  } finally {
    await rm(out, { recursive: true, force: true }).catch(() => {})
  }
}

/** Read manifests and build each plugin entry. Good plugins load, bad ones report. */
export async function loadPlugins(dirs: readonly string[]): Promise<PluginLoadResult> {
  const plugins: PluginSource[] = []
  const errors: string[] = []
  for (const dir of dirs) {
    try {
      const raw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as unknown
      const check = parseManifest(raw)
      if (!check.ok) {
        errors.push(`${dir}: ${check.errors.join("; ")}`)
        continue
      }
      const root = resolve(dir)
      const entry = resolve(root, check.manifest.entry)
      if (entry !== root && !entry.startsWith(`${root}${sep}`)) {
        errors.push(`${dir}: entry must stay inside the plugin directory`)
        continue
      }
      if (!(await isFile(entry))) {
        errors.push(`${dir}: entry ${check.manifest.entry} does not exist`)
        continue
      }
      // A packaged plugin ships a pre-built `.js`; a source plugin is built now.
      const bundled = /\.(js|mjs)$/.test(entry)
      const bundle = bundled
        ? await Bun.file(entry).text()
        : await bundlePluginEntry(entry)
      if (bundled && /\brequire\s*\(/.test(bundle)) {
        errors.push(`${dir}: the packaged bundle must be self-contained`)
        continue
      }
      if (bundle.length > MAX_BUNDLE_BYTES) {
        errors.push(`${dir}: bundle is ${bundle.length} bytes; the limit is ${MAX_BUNDLE_BYTES}`)
        continue
      }
      plugins.push({ dir, manifest: check.manifest, bundle })
    } catch (error) {
      errors.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { plugins, errors }
}

/** True when a path is a plugin directory (has a manifest) or a plain effect file. */
export async function isPluginDir(path: string): Promise<boolean> {
  return (await isDirectory(path)) && (await isFile(join(path, "manifest.json")))
}
