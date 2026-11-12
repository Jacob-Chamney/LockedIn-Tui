/** Update checks, asset selection and verified binary replacement. */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkForUpdate,
  cleanupOldBinaries,
  compareVersions,
  installUpdate,
  parseChecksums,
  replaceBinary,
  updateAssetName,
  type UpdateInfo,
} from "../../src/services/update"
import { removeTemp } from "../helpers/cleanup"

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await removeTemp(directory)
})

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lockedin-update-"))
  directories.push(directory)
  return directory
}

type Route = () => Response

function responder(routes: Record<string, Route>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const route = routes[url]
    return route ? route() : new Response("not found", { status: 404 })
  }) as unknown as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function release(version: string, assetName = `lockedin-${version}-bun-linux-x64`): Response {
  return json({
    tag_name: `v${version}`,
    html_url: `https://github.com/Jacob-Chamney/LockedIn-Tui/releases/tag/v${version}`,
    assets: [
      {
        name: assetName,
        browser_download_url: `https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v${version}/${assetName}`,
      },
      {
        name: "SHA256SUMS",
        browser_download_url: `https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v${version}/SHA256SUMS`,
      },
    ],
  })
}

const API = "https://api.github.com/repos/Jacob-Chamney/LockedIn-Tui/releases/latest"

describe("versions and asset names", () => {
  test("compare semver numerically", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0)
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1)
    expect(compareVersions("1.0.0", "1.10.0")).toBe(-1)
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1)
  })

  test("map every released platform to its asset", () => {
    expect(updateAssetName("1.2.3", "linux", "x64")).toBe("lockedin-1.2.3-bun-linux-x64")
    expect(updateAssetName("1.2.3", "linux", "x64", "musl")).toBe(
      "lockedin-1.2.3-bun-linux-x64-musl",
    )
    expect(updateAssetName("1.2.3", "linux", "arm64", "musl")).toBe(
      "lockedin-1.2.3-bun-linux-arm64-musl",
    )
    expect(updateAssetName("1.2.3", "darwin", "arm64")).toBe("lockedin-1.2.3-bun-darwin-arm64")
    expect(updateAssetName("1.2.3", "win32", "x64")).toBe(
      "lockedin-1.2.3-bun-windows-x64.exe",
    )
    expect(updateAssetName("1.2.3", "win32", "arm64")).toBeNull()
    expect(updateAssetName("1.2.3", "freebsd", "x64")).toBeNull()
  })

  test("parse a release checksum list", () => {
    const sums = parseChecksums(
      `${"a".repeat(64)}  lockedin-1.0.0-bun-linux-x64\n` +
        `${"B".repeat(64)} *./lockedin-1.0.0-bun-windows-x64.exe\n`,
    )
    expect(sums.get("lockedin-1.0.0-bun-linux-x64")).toBe("a".repeat(64))
    expect(sums.get("lockedin-1.0.0-bun-windows-x64.exe")).toBe("b".repeat(64))
  })
})

describe("checking", () => {
  test("reports a newer release with the machine's asset", async () => {
    const result = await checkForUpdate({
      current: "1.0.0",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
      fetch: responder({ [API]: () => release("1.2.0") }),
    })
    expect(result.kind).toBe("available")
    if (result.kind !== "available") return
    expect(result.info.version).toBe("1.2.0")
    expect(result.info.asset).toBe("lockedin-1.2.0-bun-linux-x64")
    expect(result.info.releaseUrl).toContain("v1.2.0")
  })

  test("the current release needs no update", async () => {
    const result = await checkForUpdate({
      current: "1.2.0",
      platform: "linux",
      arch: "x64",
      fetch: responder({ [API]: () => release("1.2.0") }),
    })
    expect(result).toEqual({ kind: "current", current: "1.2.0", latest: "1.2.0" })
  })

  test("the old 1.6.0 release is not an update after the version reset", async () => {
    const result = await checkForUpdate({
      current: "1.0.0",
      platform: "linux",
      arch: "x64",
      fetch: responder({ [API]: () => release("1.6.0") }),
    })
    expect(result).toEqual({ kind: "current", current: "1.0.0", latest: "1.6.0" })
  })

  test("a missing release, server error or missing asset is unavailable, not a failure", async () => {
    const missing = await checkForUpdate({
      current: "1.0.0",
      fetch: responder({}),
    })
    expect(missing.kind).toBe("unavailable")
    if (missing.kind === "unavailable") expect(missing.message).toContain("no published release")

    const failed = await checkForUpdate({
      current: "1.0.0",
      fetch: responder({ [API]: () => json({ message: "boom" }, 500) }),
    })
    expect(failed.kind).toBe("unavailable")

    const wrongAsset = await checkForUpdate({
      current: "1.0.0",
      platform: "linux",
      arch: "x64",
      fetch: responder({ [API]: () => release("1.2.0", "lockedin-1.2.0-bun-darwin-arm64") }),
    })
    expect(wrongAsset.kind).toBe("unavailable")
  })
})

describe("installing", () => {
  test("verifies the checksum and replaces the binary", async () => {
    const directory = await temporary()
    const target = join(directory, "lockedin")
    await writeFile(target, "old binary")
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const hash = new Bun.CryptoHasher("sha256").update(payload).digest("hex")
    const asset = "lockedin-1.2.0-bun-linux-x64"
    const sumsUrl = "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v1.2.0/SHA256SUMS"
    const assetUrl = `https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v1.2.0/${asset}`
    const info: UpdateInfo = {
      version: "1.2.0",
      asset,
      assetUrl,
      checksumUrl: sumsUrl,
      releaseUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/tag/v1.2.0",
    }
    const result = await installUpdate(info, {
      current: "1.0.0",
      platform: "linux",
      arch: "x64",
      execPath: target,
      fetch: responder({
        [sumsUrl]: () => new Response(`${hash}  ${asset}\n`),
        [assetUrl]: () => new Response(payload),
      }),
    })
    expect(result).toEqual({ kind: "updated", version: "1.2.0" })
    expect(new Uint8Array(await readFile(target))).toEqual(payload)
    // Windows has no POSIX mode bits; chmod only toggles the read-only flag.
    if (process.platform !== "win32") {
      expect((await stat(target)).mode & 0o777).toBe(0o755)
    }
    expect((await readdir(directory)).filter((name) => name.includes(".new-"))).toEqual([])
  })

  test("a bad checksum leaves the running binary alone", async () => {
    const directory = await temporary()
    const target = join(directory, "lockedin")
    await writeFile(target, "old binary")
    const asset = "lockedin-1.2.0-bun-linux-x64"
    const info: UpdateInfo = {
      version: "1.2.0",
      asset,
      assetUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v1.2.0/a",
      checksumUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v1.2.0/SHA256SUMS",
      releaseUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/tag/v1.2.0",
    }
    const result = await installUpdate(info, {
      current: "1.0.0",
      platform: "linux",
      execPath: target,
      fetch: responder({
        [info.checksumUrl]: () => new Response(`${"0".repeat(64)}  ${asset}\n`),
        [info.assetUrl]: () => new Response(new Uint8Array([9, 9, 9])),
      }),
    })
    expect(result.kind).toBe("error")
    if (result.kind === "error") expect(result.message).toContain("checksum mismatch")
    expect(await readFile(target, "utf8")).toBe("old binary")
    expect((await readdir(directory)).filter((name) => name.includes(".new-"))).toEqual([])
  })
})

describe("replacement", () => {
  test("Windows renames the locked image aside and cleanup removes it next launch", async () => {
    const directory = await temporary()
    const target = join(directory, "lockedin.exe")
    const next = join(directory, "next.exe")
    await writeFile(target, "old")
    await writeFile(next, "new")
    await replaceBinary(target, next, "win32")
    expect(await readFile(target, "utf8")).toBe("new")
    expect(await readdir(directory)).toContain(`lockedin.exe.old-${process.pid}`)
    await cleanupOldBinaries(target)
    expect(await readdir(directory)).not.toContain(`lockedin.exe.old-${process.pid}`)
  })

  test("POSIX replaces atomically and leaves no previous file", async () => {
    const directory = await temporary()
    const target = join(directory, "lockedin")
    const next = join(directory, "next")
    await writeFile(target, "old")
    await writeFile(next, "new")
    await replaceBinary(target, next, "linux")
    expect(await readFile(target, "utf8")).toBe("new")
    expect(await readdir(directory)).toEqual(["lockedin"])
  })
})
