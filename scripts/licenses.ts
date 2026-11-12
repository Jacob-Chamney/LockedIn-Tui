#!/usr/bin/env bun
/**
 * Third-party notices for the compiled artifacts.
 *
 * The release ships one binary per target that embeds the Bun runtime, every
 * production JavaScript package it imports and the native OpenTUI/keyring
 * package for that platform. MIT and the bundled native libraries require
 * their notices to travel with the binary, so this script renders one
 * `THIRD-PARTY-NOTICES.md` from the lockfile's production closure and copies
 * it into the release directory.
 *
 *   bun run scripts/licenses.ts            # write THIRD-PARTY-NOTICES.md
 *   bun run scripts/licenses.ts --check    # verify the committed file
 *
 * Generation reads the installed packages, so run `bun install --os='*'
 * --cpu='*' --libc='*'` before refreshing. The check is environment-free: it
 * reads `bun.lock`, so CI can verify the file without every platform package.
 */
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.md"
const BUN_LICENSE = join(ROOT, "licenses", "BUN-LICENSE.md")

type Lock = {
  workspaces: Record<string, { dependencies?: Record<string, string> }>
  packages: Record<string, unknown[]>
}

type Installed = {
  name: string
  version: string
  license: string
  files: { name: string; text: string }[]
}

/** bun.lock is JSON with trailing commas, which JSON.parse rejects. */
export function parseLock(text: string): Lock {
  let out = ""
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === ",") {
      let ahead = index + 1
      while (ahead < text.length && /\s/.test(text[ahead]!)) ahead++
      if (text[ahead] === "}" || text[ahead] === "]") continue
    }
    out += char
  }
  return JSON.parse(out) as Lock
}

/**
 * Native packages embedded by the release matrix in `scripts/release.ts`.
 * The lockfile also resolves optional packages for architectures no artifact
 * targets (for example keyring's riscv64 build); those are not shipped and
 * their license files are not required here.
 */
const NATIVE_PACKAGES = new Set([
  "@opentui/core-linux-x64",
  "@opentui/core-linux-x64-musl",
  "@opentui/core-linux-arm64",
  "@opentui/core-linux-arm64-musl",
  "@opentui/core-darwin-x64",
  "@opentui/core-darwin-arm64",
  "@opentui/core-win32-x64",
  "@napi-rs/keyring-linux-x64-gnu",
  "@napi-rs/keyring-linux-x64-musl",
  "@napi-rs/keyring-linux-arm64-gnu",
  "@napi-rs/keyring-linux-arm64-musl",
  "@napi-rs/keyring-darwin-x64",
  "@napi-rs/keyring-darwin-arm64",
  "@napi-rs/keyring-win32-x64-msvc",
])

function shippedNative(name: string): boolean {
  return !/^(@opentui\/core-|@napi-rs\/keyring-)/.test(name) || NATIVE_PACKAGES.has(name)
}

/** Every production package the lockfile resolves, including shipped natives. */
export function lockClosure(lock: Lock): Map<string, string> {
  const deps = lock.workspaces[""]?.dependencies ?? {}
  const found = new Map<string, string>()
  const stack = Object.keys(deps)
  while (stack.length > 0) {
    const name = stack.pop()!
    if (found.has(name)) continue
    if (!shippedNative(name)) continue
    const entry = lock.packages[name]
    if (entry === undefined) continue
    const spec = String(entry[0])
    found.set(name, spec.slice(spec.lastIndexOf("@") + 1))
    const info = (entry[2] ?? {}) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    for (const field of ["dependencies", "optionalDependencies"] as const) {
      for (const child of Object.keys(info[field] ?? {})) stack.push(child)
    }
  }
  return found
}

function licenseFiles(dir: string): string[] {
  const wildcard = new Bun.Glob("{LICEN[CS]E*,COPYING*,NOTICE*}")
  return [...wildcard.scanSync({ cwd: dir })]
    .filter((name) => !name.includes("/") && !name.includes("\\"))
    .sort()
}

async function installed(root: string, name: string, fallbackVersion: string): Promise<Installed | null> {
  let manifest: string
  try {
    manifest = Bun.resolveSync(`${name}/package.json`, root)
  } catch {
    return null
  }
  const dir = dirname(manifest)
  const parsed = (await Bun.file(manifest).json()) as {
    name?: string
    version?: string
    license?: string | { type?: string }
  }
  const license =
    typeof parsed.license === "string"
      ? parsed.license
      : typeof parsed.license?.type === "string"
        ? parsed.license.type
        : "see license files"
  const files: Installed["files"] = []
  for (const file of licenseFiles(dir)) {
    files.push({ name: file, text: (await readFile(join(dir, file), "utf8")).trim() })
  }
  return {
    name: parsed.name ?? name,
    version: parsed.version ?? fallbackVersion,
    license,
    files,
  }
}

function hash(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex")
}

export type NoticeInput = {
  packages: Installed[]
  bunLicense: string
}

export function renderNotices(input: NoticeInput): string {
  const groups = new Map<string, { source: string; text: string; packages: Installed[] }>()
  const declaredOnly: Installed[] = []
  for (const pkg of [...input.packages].sort((a, b) => a.name.localeCompare(b.name))) {
    if (pkg.files.length === 0) {
      declaredOnly.push(pkg)
      continue
    }
    const source = pkg.files.map((file) => file.name).join(", ")
    const text = pkg.files.map((file) => `${file.name}\n${"-".repeat(file.name.length)}\n\n${file.text}`).join("\n\n")
    const key = hash(text)
    const group = groups.get(key)
    if (group) group.packages.push(pkg)
    else groups.set(key, { source, text, packages: [pkg] })
  }

  const lines: string[] = []
  lines.push("# Third-party notices")
  lines.push("")
  lines.push("LockedIn-Tui is released under the GNU Affero General Public License v3.0; see `LICENSE` in this")
  lines.push("directory. The compiled artifact embeds the Bun runtime, the")
  lines.push("production JavaScript packages below, and the native OpenTUI and keyring")
  lines.push("packages for its platform. Their notices are reproduced here.")
  lines.push("")
  lines.push("Generated by `bun run scripts/licenses.ts`; `--check` verifies it against")
  lines.push("`bun.lock`. Do not edit this file by hand.")
  lines.push("")

  lines.push("## Bun runtime")
  lines.push("")
  lines.push("The artifact contains the Bun runtime, which also statically links")
  lines.push("JavaScriptCore, WebKit, BoringSSL, libuv, zlib-ng and other libraries.")
  lines.push("The upstream notice follows.")
  lines.push("")
  lines.push(input.bunLicense.trim())
  lines.push("")

  lines.push("## Bundled npm packages")
  lines.push("")
  lines.push(`The lockfile's production closure has ${input.packages.length} packages.`)
  lines.push("Identical license texts are reproduced once and list every package they")
  lines.push("cover.")
  lines.push("")

  let index = 0
  for (const group of [...groups.values()].sort((a, b) =>
    a.packages[0]!.name.localeCompare(b.packages[0]!.name),
  )) {
    index += 1
    lines.push(`### ${index}. ${group.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}`)
    lines.push("")
    for (const pkg of group.packages) lines.push(`- \`${pkg.name}@${pkg.version}\` — ${pkg.license}`)
    lines.push("")
    lines.push(`License files: ${group.source}`)
    lines.push("")
    lines.push("```text")
    lines.push(group.text)
    lines.push("```")
    lines.push("")
  }

  if (declaredOnly.length > 0) {
    lines.push("### Packages with a declared license but no license file")
    lines.push("")
    lines.push("These packages declare an SPDX license in `package.json` and ship no")
    lines.push("license file in the published tarball. The declared identifier is recorded")
    lines.push("here so the notice is explicit rather than silently missing.")
    lines.push("")
    for (const pkg of declaredOnly) lines.push(`- \`${pkg.name}@${pkg.version}\` — ${pkg.license}`)
    lines.push("")
  }

  return `${lines.join("\n")}\n`
}

async function collect(): Promise<NoticeInput> {
  const lock = parseLock(await readFile(join(ROOT, "bun.lock"), "utf8"))
  const closure = lockClosure(lock)
  const packages: Installed[] = []
  const missing: string[] = []
  for (const [name, version] of [...closure.entries()].sort()) {
    const found = await installed(ROOT, name, version)
    if (found) packages.push(found)
    else missing.push(`${name}@${version}`)
  }
  if (missing.length > 0) {
    console.error(
      `error: ${missing.length} package(s) are not installed, so their license text cannot be read:\n` +
        missing.map((entry) => `  ${entry}`).join("\n") +
        `\nrun: bun install --os='*' --cpu='*' --libc='*'`,
    )
    process.exit(1)
  }
  return { packages, bunLicense: await readFile(BUN_LICENSE, "utf8") }
}

/** Every way the committed notices can be missing or stale. Empty means clean. */
export async function noticesProblems(root = ROOT): Promise<string[]> {
  const path = join(root, NOTICES_FILE)
  if (!existsSync(path)) return [`${NOTICES_FILE} is missing`]
  const text = await readFile(path, "utf8")
  const lock = parseLock(await readFile(join(root, "bun.lock"), "utf8"))
  const closure = lockClosure(lock)
  const missing = [...closure.entries()]
    .sort()
    .filter(([name, version]) => !text.includes(`${name}@${version}`))
  const problems: string[] = []
  if (missing.length > 0) {
    problems.push(
      `missing ${missing.length} package(s): ${missing
        .slice(0, 8)
        .map(([name, version]) => `${name}@${version}`)
        .join(", ")}${missing.length > 8 ? ", ..." : ""}`,
    )
  }
  if (!text.includes("## Bun runtime")) problems.push("no Bun runtime notice")
  if (!text.includes("## Bundled npm packages")) problems.push("no npm package notices")
  if (!text.includes("LockedIn-Tui is released under the GNU Affero General Public License v3.0")) {
    problems.push("no project license reference")
  }
  return problems
}

async function audit(): Promise<void> {
  const problems = await noticesProblems()
  if (problems.length > 0) {
    console.error(
      `error: ${NOTICES_FILE} is stale:\n${problems.map((line) => `  ${line}`).join("\n")}\n` +
        "run: bun run scripts/licenses.ts",
    )
    process.exit(1)
  }
  const closure = lockClosure(parseLock(await readFile(join(ROOT, "bun.lock"), "utf8")))
  console.log(
    `${NOTICES_FILE} covers ${closure.size} lockfile packages and the Bun runtime`,
  )
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    await audit()
  } else {
    const notices = renderNotices(await collect())
    await Bun.write(join(ROOT, NOTICES_FILE), notices)
    const bytes = Buffer.byteLength(notices)
    console.log(`wrote ${NOTICES_FILE} (${bytes} bytes)`)
  }
}
