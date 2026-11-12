/**
 * Release updates.
 *
 * The only network calls are an optional check and a user-triggered download
 * from the public GitHub release. There is no background service, no automatic
 * install and no retry. The download must match the release's `SHA256SUMS`
 * before anything replaces the running binary.
 */
import { chmod, readdir, rename, rm } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** Production repository; `LOCKEDIN_UPDATE_REPO` is a staging/verification override. */
export const UPDATE_REPO =
  (process.env.LOCKEDIN_UPDATE_REPO ?? "").trim() || "Jacob-Chamney/LockedIn-Tui"
export const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
export const CHECKSUMS_ASSET = "SHA256SUMS"

const CHECK_TIMEOUT_MS = 5_000
const CHECKSUM_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 300_000
const USER_AGENT = "lockedin-updater"

export type Libc = "glibc" | "musl"

export type UpdateInfo = {
  /** Version without the leading `v`. */
  version: string
  /** The exact release asset for this machine. */
  asset: string
  assetUrl: string
  checksumUrl: string
  releaseUrl: string
}

export type UpdateCheck =
  | { kind: "available"; current: string; info: UpdateInfo }
  | { kind: "current"; current: string; latest: string }
  | { kind: "unavailable"; current: string; message: string }

export type UpdateResult =
  | { kind: "updated"; version: string }
  | { kind: "current"; version: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string }

export type UpdateService = {
  check: () => Promise<UpdateCheck>
  install: (info: UpdateInfo) => Promise<UpdateResult>
}

type Options = {
  current: string
  platform?: NodeJS.Platform
  arch?: string
  libc?: Libc
  execPath?: string
  fetch?: typeof fetch
}

type Resolved = {
  current: string
  platform: NodeJS.Platform
  arch: string
  /** Resolved lazily, after the first frame, so startup does no /lib scan. */
  libc?: Libc
  execPath: string
  fetch: typeof fetch
}

function resolve(options: Options): Resolved {
  const platform = options.platform ?? process.platform
  return {
    current: options.current,
    platform,
    arch: options.arch ?? process.arch,
    ...(options.libc !== undefined
      ? { libc: options.libc }
      : platform === "linux"
        ? {}
        : { libc: "glibc" as const }),
    execPath: options.execPath ?? process.execPath,
    fetch: options.fetch ?? fetch,
  }
}

export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (let index = 0; index < 3; index++) {
    if (left[index]! !== right[index]!) return left[index]! < right[index]! ? -1 : 1
  }
  return 0
}

/** Release names are fixed by `scripts/release.ts`. */
export function updateAssetName(
  version: string,
  platform: NodeJS.Platform,
  arch: string,
  libc: Libc = "glibc",
): string | null {
  const os = platform === "win32" ? "windows" : platform
  if (os !== "linux" && os !== "darwin" && os !== "windows") return null
  if (arch !== "x64" && arch !== "arm64") return null
  if (os === "windows" && arch !== "x64") return null
  const suffix = os === "linux" && libc === "musl" ? "-musl" : ""
  const extension = os === "windows" ? ".exe" : ""
  return `lockedin-${version}-bun-${os}-${arch}${suffix}${extension}`
}

/** Alpine and musl distributions keep their loader under /lib. */
export function detectLibc(): Libc {
  if (existsSync("/etc/alpine-release")) return "musl"
  try {
    // Synchronous only during service construction, before the first frame.
    if (readdirSync("/lib").some((name) => name.startsWith("ld-musl-"))) return "musl"
  } catch {
    // Not Linux, or /lib is unreadable; the glibc name is the common default.
  }
  return "glibc"
}

export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split("\n")) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line.trim())
    // Accept both `name` and `./name`; release tooling has emitted both.
    if (match) out.set(match[2]!.replace(/^\.\//, ""), match[1]!.toLowerCase())
  }
  return out
}

function trusted(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === "https:" &&
      ["github.com", "api.github.com", "objects.githubusercontent.com"].includes(parsed.hostname)
    )
  } catch {
    return false
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "the request timed out"
    return error.message
  }
  return String(error)
}

type ReleaseAsset = { name?: unknown; browser_download_url?: unknown }
type LatestRelease = {
  tag_name?: unknown
  html_url?: unknown
  assets?: unknown
}

export async function checkForUpdate(options: Options): Promise<UpdateCheck> {
  const resolved = resolve(options)
  try {
    const response = await resolved.fetch(UPDATE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (response.status === 404) {
      return { kind: "unavailable", current: resolved.current, message: "no published release yet" }
    }
    if (!response.ok) {
      return {
        kind: "unavailable",
        current: resolved.current,
        message: `GitHub returned ${response.status} while checking for updates`,
      }
    }
    const latest = (await response.json()) as LatestRelease
    const version = typeof latest.tag_name === "string" ? latest.tag_name.replace(/^v/, "") : ""
    if (!parseVersion(version)) {
      return {
        kind: "unavailable",
        current: resolved.current,
        message: "the latest release has an unreadable version",
      }
    }
    if (compareVersions(version, resolved.current) <= 0) {
      return { kind: "current", current: resolved.current, latest: version }
    }

    const libc = resolved.libc ?? detectLibc()
    const assetName = updateAssetName(version, resolved.platform, resolved.arch, libc)
    if (!assetName) {
      return {
        kind: "unavailable",
        current: resolved.current,
        message: `no update build for ${resolved.platform}-${resolved.arch}`,
      }
    }
    const assets = Array.isArray(latest.assets) ? (latest.assets as ReleaseAsset[]) : []
    const asset = assets.find((entry) => entry.name === assetName)
    const checksums = assets.find((entry) => entry.name === CHECKSUMS_ASSET)
    const assetUrl = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : ""
    const checksumUrl =
      typeof checksums?.browser_download_url === "string" ? checksums.browser_download_url : ""
    if (!assetUrl || !checksumUrl) {
      return {
        kind: "unavailable",
        current: resolved.current,
        message: `release ${version} has no ${assetName} or ${CHECKSUMS_ASSET}`,
      }
    }
    if (!trusted(assetUrl) || !trusted(checksumUrl)) {
      return {
        kind: "unavailable",
        current: resolved.current,
        message: "the release download URL is not GitHub over HTTPS",
      }
    }
    const releaseUrl =
      typeof latest.html_url === "string" && trusted(latest.html_url)
        ? latest.html_url
        : `https://github.com/${UPDATE_REPO}/releases/tag/v${version}`
    return {
      kind: "available",
      current: resolved.current,
      info: { version, asset: assetName, assetUrl, checksumUrl, releaseUrl },
    }
  } catch (error) {
    return {
      kind: "unavailable",
      current: resolved.current,
      message: `could not check for updates: ${reasonOf(error)}`,
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

/**
 * Replace the running executable. Windows cannot overwrite a locked image, so
 * the current file is renamed aside and removed on the next launch; POSIX uses
 * one atomic rename.
 */
export async function replaceBinary(
  target: string,
  next: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") {
    const previous = `${target}.old-${process.pid}`
    await rename(target, previous)
    try {
      await rename(next, target)
    } catch (error) {
      await rename(previous, target).catch(() => {})
      throw error
    }
    return
  }
  await rename(next, target)
}

/** Remove Windows' renamed predecessor and any abandoned partial download. */
export async function cleanupOldBinaries(execPath = process.execPath): Promise<void> {
  const dir = dirname(execPath)
  const base = basename(execPath)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (name.startsWith(`${base}.old-`) || name.startsWith(`.${base}.new-`)) {
      await rm(join(dir, name), { force: true }).catch(() => {})
    }
  }
}

export async function installUpdate(info: UpdateInfo, options: Options): Promise<UpdateResult> {
  const resolved = resolve(options)
  const target = resolved.execPath
  const temporary = join(dirname(target), `.${basename(target)}.new-${process.pid}`)
  try {
    const checksumResponse = await resolved.fetch(info.checksumUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(CHECKSUM_TIMEOUT_MS),
    })
    if (!checksumResponse.ok) {
      throw new Error(`checksum download returned ${checksumResponse.status}`)
    }
    const expected = parseChecksums(await checksumResponse.text()).get(info.asset)
    if (!expected) throw new Error(`${CHECKSUMS_ASSET} has no entry for ${info.asset}`)

    const assetResponse = await resolved.fetch(info.assetUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!assetResponse.ok) throw new Error(`download returned ${assetResponse.status}`)
    await Bun.write(temporary, assetResponse)

    const actual = await hashFile(temporary)
    if (actual !== expected) {
      throw new Error("checksum mismatch; the downloaded file was discarded")
    }
    await chmod(temporary, 0o755)
    await replaceBinary(target, temporary, resolved.platform)
    return { kind: "updated", version: info.version }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    const message = reasonOf(error)
    if (/EACCES|EPERM|permission|read-only/i.test(message)) {
      return {
        kind: "error",
        message:
          `could not replace ${target} (${message}). Download ${info.asset} from ` +
          `${info.releaseUrl} and install it manually.`,
      }
    }
    return { kind: "error", message: `could not install ${info.version}: ${message}` }
  }
}

/**
 * Production service. The App only creates it in a compiled release build;
 * source runs and tests pass their own implementation or none at all.
 */
export function createUpdateService(
  options: { current: string } & Omit<Partial<Options>, "current">,
): UpdateService {
  const resolved = resolve({ ...options, current: options.current })
  void cleanupOldBinaries(resolved.execPath)
  return {
    check: () => checkForUpdate(resolved),
    install: (info) => installUpdate(info, resolved),
  }
}
