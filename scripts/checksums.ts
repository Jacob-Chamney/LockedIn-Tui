#!/usr/bin/env bun
/**
 * Release checksums, manifest and artifact scanning (WP-604).
 *
 * Every function here is pure over the filesystem so it can be unit-tested
 * against a temp directory; `scripts/release.ts` is the only caller in a build.
 *
 *   bun run scripts/checksums.ts --dir=dist --verify
 *
 * A release is only publishable when:
 *   - every artifact has a SHA-256 line in SHA256SUMS,
 *   - release.json names version, commit, targets, sizes and native versions,
 *   - no artifact contains a key, a token env var name or a home path.
 */

import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type ArtifactEntry = {
  target: string
  /** File name relative to the release directory. */
  file: string
  bytes: number
  sha256: string
}

export type Manifest = {
  schema: 1
  version: string
  commit: string
  bun: string
  builtOn: string
  targets: ArtifactEntry[]
  /** Packaged native/runtime dependency versions, `name@version` keys. */
  natives: Record<string, string>
}

export type Mismatch = { file: string; expected: string; actual: string }

export class ChecksumError extends Error {
  readonly mismatches: Mismatch[]
  constructor(mismatches: Mismatch[]) {
    const list = mismatches.map((m) => `  ${m.file}: expected ${m.expected}, got ${m.actual}`)
    super(`checksum verification failed\n${list.join("\n")}`)
    this.name = "ChecksumError"
    this.mismatches = mismatches
  }
}

export class ScanError extends Error {
  readonly findings: ScanFinding[]
  constructor(findings: ScanFinding[]) {
    super(
      `artifact scan failed\n${findings
        .map((f) => `  ${f.file}: ${f.reason} (${f.needle})`)
        .join("\n")}`,
    )
    this.name = "ScanError"
    this.findings = findings
  }
}

// --------------------------------------------------------------------- hashing

export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(await Bun.file(path).arrayBuffer())
  return hasher.digest("hex")
}

export async function describeArtifact(
  dir: string,
  target: string,
  file: string,
): Promise<ArtifactEntry> {
  const path = join(dir, file)
  if (!existsSync(path)) throw new Error(`artifact missing: ${file}`)
  const bytes = (await Bun.file(path).size) ?? 0
  return { target, file, bytes, sha256: await sha256File(path) }
}

// --------------------------------------------------------------- the scanner

export type ScanFinding = { file: string; needle: string; reason: string }

/**
 * Strings that must never reach a released artifact.
 *
 * The fake key is a fixture value, not a pattern: matching on `sk-` would hit
 * the provider SDKs' own test data. The home-path check is a prefix match on
 * the platform separators, and the token name is the env var this project is
 * most likely to leak through a copied config.
 */
export const FAKE_KEY = "sk-lockedin-fake-0000000000000000"
export const TOKEN_ENV_NAME = "LOCKEDIN_GITHUB_TOKEN"
export const HOME_PREFIXES = ["/home/", "/Users/", "C:\\Users\\"] as const

/**
 * OpenTUI's native packages are built by upstream and embed their build
 * directory. It is third-party provenance, not this project's home path, so a
 * Windows artifact would otherwise be rejected for `/Users/runner/...`.
 */
export const UPSTREAM_BUILD_PATHS = [
  "/Users/runner/_work/opentui/",
  "/home/runner/work/opentui/",
  "C:\\Users\\runneradmin\\_work\\opentui\\",
] as const

function bytesFor(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function matchesAt(haystack: Uint8Array, index: number, target: Uint8Array): boolean {
  for (let j = 0; j < target.length; j++) {
    if (haystack[index + j] !== target[j]) return false
  }
  return true
}

/** True when `needle` occurs somewhere other than inside an allowed upstream path. */
function containsOutside(
  haystack: Uint8Array,
  needle: string,
  allowed: readonly string[] = [],
): boolean {
  const target = bytesFor(needle)
  if (!target.length || target.length > haystack.length) return false
  const allowedBytes = allowed.filter((path) => path.startsWith(needle)).map(bytesFor)
  outer: for (let i = 0; i <= haystack.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (haystack[i + j] !== target[j]) continue outer
    }
    for (const path of allowedBytes) {
      if (path.length <= haystack.length - i && matchesAt(haystack, i, path)) continue outer
    }
    return true
  }
  return false
}

/** Scan already-loaded bytes. Pure, so tests can pass a fixture buffer. */
export function scanBytes(bytes: Uint8Array, file = "<bytes>"): ScanFinding[] {
  const findings: ScanFinding[] = []
  if (containsOutside(bytes, FAKE_KEY)) {
    findings.push({ file, needle: FAKE_KEY, reason: "fake key string baked into the artifact" })
  }
  if (containsOutside(bytes, TOKEN_ENV_NAME)) {
    findings.push({ file, needle: TOKEN_ENV_NAME, reason: "token env var name baked in" })
  }
  for (const prefix of HOME_PREFIXES) {
    if (containsOutside(bytes, prefix, UPSTREAM_BUILD_PATHS)) {
      findings.push({ file, needle: prefix, reason: "build machine home path baked in" })
      break
    }
  }
  return findings
}

export async function scanFile(path: string, file?: string): Promise<ScanFinding[]> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  return scanBytes(bytes, file ?? path.split("/").pop() ?? path)
}

/** Scan every listed artifact; throws ScanError naming each hit. */
export async function scanArtifacts(dir: string, entries: ArtifactEntry[]): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = []
  for (const entry of entries) findings.push(...(await scanFile(join(dir, entry.file), entry.file)))
  if (findings.length) throw new ScanError(findings)
  return findings
}

// ------------------------------------------------------------- writing output

export function formatChecksums(entries: ArtifactEntry[]): string {
  return (
    [...entries]
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((entry) => `${entry.sha256}  ${entry.file}`)
      .join("\n") + "\n"
  )
}

export async function writeChecksums(dir: string, entries: ArtifactEntry[]): Promise<string> {
  const path = join(dir, "SHA256SUMS")
  await writeFile(path, formatChecksums(entries))
  return path
}

export async function writeManifest(dir: string, manifest: Manifest): Promise<string> {
  const path = join(dir, "release.json")
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n")
  return path
}

export async function readManifest(path: string): Promise<Manifest> {
  const raw = await readFile(path, "utf8")
  const manifest = JSON.parse(raw) as Manifest
  if (manifest.schema !== 1) throw new Error(`unsupported manifest schema: ${manifest.schema}`)
  return manifest
}

// ---------------------------------------------------------------- verification

/**
 * Recompute every hash in the manifest and compare. Returns the mismatches; use
 * `verifyOrThrow` when a mismatch must stop a release.
 */
export async function verify(manifest: Manifest, dir: string): Promise<Mismatch[]> {
  const mismatches: Mismatch[] = []
  for (const entry of manifest.targets) {
    const path = join(dir, entry.file)
    if (!existsSync(path)) {
      mismatches.push({ file: entry.file, expected: entry.sha256, actual: "<missing>" })
      continue
    }
    const actual = await sha256File(path)
    if (actual !== entry.sha256) {
      mismatches.push({ file: entry.file, expected: entry.sha256, actual })
    }
  }
  return mismatches
}

export async function verifyOrThrow(manifest: Manifest, dir: string): Promise<number> {
  const mismatches = await verify(manifest, dir)
  if (mismatches.length) throw new ChecksumError(mismatches)
  return manifest.targets.length
}

/** The manifest must never carry a build-machine path. */
export function manifestLeaks(manifest: Manifest): string[] {
  const text = JSON.stringify(manifest)
  return [FAKE_KEY, TOKEN_ENV_NAME, ...HOME_PREFIXES].filter((needle) => text.includes(needle))
}

// --------------------------------------------------------------------- native

/** Package versions that end up inside the binary, for the manifest. */
export async function nativeVersions(root: string): Promise<Record<string, string>> {
  const packages = [
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
    "ai",
    "@ai-sdk/openai-compatible",
    "zod",
    "@napi-rs/keyring",
  ]
  const versions: Record<string, string> = {}
  for (const name of packages) {
    const path = join(root, "node_modules", name, "package.json")
    if (!existsSync(path)) continue
    const pkg = JSON.parse(await readFile(path, "utf8")) as { version?: string }
    if (pkg.version) versions[name] = pkg.version
  }
  return versions
}

// ------------------------------------------------------------------------ CLI

async function cli(argv: string[]) {
  const dirArg = argv.find((arg) => arg.startsWith("--dir="))
  const dir = dirArg ? dirArg.slice("--dir=".length) : "dist"
  const verifyOnly = argv.includes("--verify")
  if (!verifyOnly) {
    console.error("usage: bun run scripts/checksums.ts --dir=<dist> --verify")
    process.exit(2)
  }
  const manifestPath = join(dir, "release.json")
  if (!existsSync(manifestPath)) {
    console.error(`error: no manifest at ${manifestPath}`)
    process.exit(1)
  }
  const manifest = await readManifest(manifestPath)
  try {
    const count = await verifyOrThrow(manifest, dir)
    const leaks = manifestLeaks(manifest)
    if (leaks.length) throw new Error(`manifest leaks build-machine data: ${leaks.join(", ")}`)
    await scanArtifacts(dir, manifest.targets)
    console.log(`verified ${count} artifact(s) for ${manifest.version} @ ${manifest.commit}`)
    console.log(`scanned ${count} artifact(s): no key, token name or home path`)
  } catch (error) {
    console.error(`error: ${(error as Error).message}`)
    process.exit(1)
  }
}

if (import.meta.main) await cli(process.argv.slice(2))
