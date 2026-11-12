#!/usr/bin/env bun
/**
 * Production build — compiles LockedIn-Tui into a standalone binary.
 *
 *   bun run scripts/build.ts --target=bun-linux-x64
 *   bun run scripts/build.ts --target=bun-darwin-arm64 --outdir=out
 *   bun run scripts/build.ts --skip-install          # offline / pre-warmed CI
 *
 * Recipe, all of it measured in S4 (spikes/s4-packaging/README.md):
 *
 *   1. OpenTUI resolves its Zig library through eight static `import()` calls,
 *      one per platform. Bun's bundler tries to resolve every one of them, so a
 *      plain `bun build --compile` fails on the seven packages this machine did
 *      not install.
 *   2. Pin all eight imports to the package matching the requested target with
 *      an `onResolve` plugin. Exactly one native library is embedded and the
 *      other seven do not have to exist.
 *   3. Compile `src/index.tsx` with the Solid transform plugin. Without it the
 *      UI mounts nothing (see docs/stack.md §8, S1 note L1).
 *
 * Marking the natives `external` is not an option: it builds a 115 MB binary
 * that dies at launch with "Cannot find package '@opentui/core-linux-x64'".
 */

import { existsSync, rmSync, statSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"

import solidPlugin from "@opentui/solid/bun-plugin"

import { scanBytes } from "./checksums"

const ROOT = resolve(import.meta.dir, "..")
const ENTRY = join(ROOT, "src", "index.tsx")

/** Makes `bun install` materialise every optional platform variant. */
const INSTALL_FLAGS = ["--os=*", "--cpu=*", "--libc=*"]

type Target = {
  /** Compile triple accepted by `Bun.build({ compile: { target } })`. */
  name: Bun.Build.CompileTarget
  /** Package carrying the prebuilt native library for this target. */
  pkg: string
  ext: string
}

const TARGETS: Target[] = [
  { name: "bun-linux-x64", pkg: "@opentui/core-linux-x64", ext: "" },
  { name: "bun-linux-x64-musl", pkg: "@opentui/core-linux-x64-musl", ext: "" },
  { name: "bun-linux-arm64", pkg: "@opentui/core-linux-arm64", ext: "" },
  { name: "bun-linux-arm64-musl", pkg: "@opentui/core-linux-arm64-musl", ext: "" },
  { name: "bun-darwin-x64", pkg: "@opentui/core-darwin-x64", ext: "" },
  { name: "bun-darwin-arm64", pkg: "@opentui/core-darwin-arm64", ext: "" },
  { name: "bun-windows-x64", pkg: "@opentui/core-win32-x64", ext: ".exe" },
]

function hostTarget(): string {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `bun-${os}-${process.arch}`
}

function parseArgs(argv: string[]) {
  const options: {
    target: string
    outdir: string
    skipInstall: boolean
    help: boolean
    version?: string
  } = {
    target: hostTarget(),
    outdir: "dist",
    skipInstall: false,
    help: false,
  }
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--skip-install") options.skipInstall = true
    else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length)
    else if (arg.startsWith("--outdir=")) options.outdir = arg.slice("--outdir=".length)
    else if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length)
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function usage() {
  console.log(
    [
      "usage: bun run scripts/build.ts [--target=<triple>] [--outdir=dist] [--version=<v>] [--skip-install]",
      "",
      "targets:",
      ...TARGETS.map((target) => `  ${target.name.padEnd(22)} → ${target.pkg}`),
      "",
      `default target: ${hostTarget()} (this machine)`,
      "",
      "the artifact is written to <outdir>/lockedin-<target>[.exe] and is never",
      "executed for a target other than this machine.",
    ].join("\n"),
  )
}

/** True when the npm package holding the native library is on disk. */
function hasPackage(pkg: string): boolean {
  return existsSync(join(ROOT, "node_modules", pkg, "package.json"))
}

function installPlatformPackages() {
  console.log(`installing OpenTUI platform variants (bun install ${INSTALL_FLAGS.join(" ")})`)
  const result = Bun.spawnSync(["bun", "install", ...INSTALL_FLAGS], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `bun install ${INSTALL_FLAGS.join(" ")} failed:\n` +
        result.stderr.toString().trim().slice(0, 800),
    )
  }
}

/**
 * Rewrite OpenTUI's eight platform imports to the single package this artifact
 * should carry. Runs before module resolution, so the seven packages for other
 * platforms never need to be installed.
 */
function pinPlatform(pkg: string): Bun.BunPlugin {
  return {
    name: "lockedin-opentui-platform-pin",
    setup(build) {
      build.onResolve({ filter: /^@opentui\/core-(linux|darwin|win32)-/ }, () => ({
        path: Bun.resolveSync(pkg, ROOT),
      }))
    },
  }
}

/** Turn Bun's generic "Bundle failed" into the module that actually broke. */
function explainBuildFailure(logs: readonly unknown[]): string {
  const messages = logs
    .map((log) => String((log as { message?: unknown }).message ?? log))
    .join("\n")
  const unresolved = messages.match(/Could not resolve: "([^"]+)"/)
  if (unresolved) {
    return (
      `could not resolve ${unresolved[1]} — it is not installed for this target.\n` +
      `       re-run without --skip-install, or install it with: bun install ${INSTALL_FLAGS.join(" ")}`
    )
  }
  const missing = messages.match(/Cannot find (?:module|package) '([^']+)'/)
  if (missing) return `missing module ${missing[1]}`
  return messages.trim() || "build failed with no diagnostic"
}

async function main() {
  let options: ReturnType<typeof parseArgs>
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`error: ${(error as Error).message}`)
    usage()
    process.exit(2)
  }

  if (options.help) {
    usage()
    return
  }

  const target = TARGETS.find((candidate) => candidate.name === options.target)
  if (!target) {
    console.error(`error: unsupported target "${options.target}"`)
    usage()
    process.exit(2)
  }

  if (!existsSync(ENTRY)) {
    console.error(`error: entry point missing: ${ENTRY}`)
    process.exit(1)
  }

  // The pinned package is the only native dependency that must be present.
  if (!hasPackage(target.pkg)) {
    if (options.skipInstall) {
      console.error(
        `error: ${target.pkg} is not installed and --skip-install was given.\n` +
          `       install it with: bun install ${INSTALL_FLAGS.join(" ")}`,
      )
      process.exit(1)
    }
    installPlatformPackages()
    if (!hasPackage(target.pkg)) {
      console.error(`error: ${target.pkg} is still missing after bun install`)
      process.exit(1)
    }
  }

  const outdir = resolve(ROOT, options.outdir)
  await mkdir(outdir, { recursive: true })
  const outfile = join(outdir, `lockedin-${target.name}${target.ext}`)
  // Never let a previous artifact be mistaken for this run's output.
  if (existsSync(outfile)) rmSync(outfile)

  console.log(`building ${target.name} → ${outfile}`)
  console.log(`  native:  ${target.pkg}`)
  const started = performance.now()
  const packageVersion = (
    JSON.parse(await Bun.file(join(ROOT, "package.json")).text()) as { version: string }
  ).version
  const version = options.version ?? packageVersion

  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    minify: true,
    sourcemap: "none",
    plugins: [pinPlatform(target.pkg), solidPlugin],
    // A compiled artifact is a release build: achievements start locked and
    // --version reports the release version, not the package fallback.
    define: {
      "process.env.LOCKEDIN_RELEASE": JSON.stringify("1"),
      "process.env.LOCKEDIN_APP_VERSION": JSON.stringify(version),
    },
    compile: { target: target.name, outfile },
  })

  if (!result.success || !existsSync(outfile)) {
    console.error(`error: build failed for ${target.name}`)
    console.error(`       ${explainBuildFailure(result.logs)}`)
    process.exit(1)
  }

  const bytes = statSync(outfile).size
  const mib = (bytes / 1024 / 1024).toFixed(1)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)

  // A release artifact must not carry this build machine inside it. Upstream
  // OpenTUI build paths are allowed; a key, token name or our own root is not.
  const artifact = Buffer.from(await Bun.file(outfile).arrayBuffer())
  const localLeaks = [ROOT, "spikes/s4-packaging"].filter((needle) => artifact.includes(needle))
  const findings = scanBytes(artifact, outfile)
  if (localLeaks.length || findings.length) {
    const details = [...localLeaks, ...findings.map((finding) => finding.needle)]
    console.error(`error: artifact scan failed: ${details.join(", ")}`)
    process.exit(1)
  }

  console.log(`built ${outfile}`)
  console.log(`  size:    ${bytes.toLocaleString("en-US")} bytes (${mib} MiB)`)
  console.log(`  elapsed: ${seconds}s`)
  if (target.name !== hostTarget()) {
    console.log(
      `  note:    built for ${target.name} on ${hostTarget()}; ` +
        "the artifact is produced but not executed or verified here",
    )
  }
}

await main()
