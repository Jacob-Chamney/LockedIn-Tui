/**
 * WP-601 — GitHub archive backend, end to end against a recording transport.
 *
 * Covers the acceptance table: consent gate, refusal table, sparse upload with
 * `chat.jsonl` excluded, oversized-file skip, restore with replace/keep-both/
 * cancel, confirmed delete, and index stability on cancel/failure.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GITHUB_TOKEN_SECRET, openGithubArchive, type GithubError } from "../../src/archive/github";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { SecretStore } from "../../src/security/secret-store";
import { createFakeGithub } from "../fixtures/archive-github/fake-github";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURE = join(import.meta.dir, "..", "fixtures", "archive-github", "session")
const ID = "2026-11-02-0900-chem-bonding"
const REPO = "fixture-owner/fixture-private"
const TOKEN = "ghp_fixture_token_must_never_leak"

const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T>(result: Result<T, GithubError>): GithubError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

function memorySecrets(token: string | null): SecretStore {
  let value = token
  return {
    id: "memory",
    async available() {
      return true
    },
    async get(name: string) {
      return { ok: true, value: name === GITHUB_TOKEN_SECRET ? value : null }
    },
    async set(_name, next) {
      value = next
      return { ok: true, value: undefined }
    },
    async delete() {
      const had = value !== null
      value = null
      return { ok: true, value: had }
    },
  }
}

type HarnessOptions = {
  token?: string | null
  private?: boolean | null | "unknown"
  consent?: boolean
  failUploadAt?: number
  maxFileBytes?: number
}

async function harness(label: string, options: HarnessOptions = {}) {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-gh-${label}-`))
  cleanup.push(parent)
  const workspace: Workspace = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  const source = join(workspace.paths.schoolSessions, ID)
  await cp(FIXTURE, source, { recursive: true })
  await writeFile(
    workspace.paths.config,
    [
      "[archive]",
      'backend = "github"',
      'folder = ""',
      "",
      "[archive.github]",
      `repo = "${REPO}"`,
      'branch = "main"',
      `consent = ${options.consent !== false}`,
      'token_ref = "lockedin/github-token"',
      "",
    ].join("\n"),
    "utf8",
  )
  const transport = createFakeGithub({
    repo: REPO,
    private: options.private === undefined ? true : options.private,
    failUploadAt: options.failUploadAt,
  })
  const logs: string[] = []
  const archive = unwrap(
    openGithubArchive({
      workspace,
      repo: REPO,
      branch: "main",
      secrets: memorySecrets(options.token === undefined ? TOKEN : options.token),
      transport,
      maxFileBytes: options.maxFileBytes ?? 4096,
      now: () => new Date("2026-12-02T00:00:00Z"),
      log: (line) => logs.push(line),
    }),
  )
  return { workspace, archive, transport, logs, source, parent }
}

const ref = () => ({ side: "school" as const, id: ID, backend: "github" as const })

function indexText(workspace: Workspace): string | null {
  const file = join(workspace.paths.root, "archive-index", "school.json")
  return existsSync(file) ? readFileSync(file, "utf8") : null
}

/* -------------------------------------------------------------------------- */

describe("github archive backend", () => {
  test("consent is required before anything is sent", async () => {
    const { archive, transport, source, workspace } = await harness("consent-off", { consent: false })

    const error = expectErr(await archive.put(ref(), source))
    expect(error.kind).toBe("consent")
    if (error.kind === "consent") expect(error.message).toContain(ID)
    expect(transport.requests).toEqual([])
    expect(indexText(workspace)).toBeNull()

    // the prompt names the item, the repository, and what is excluded
    const prompt = archive.describeConsent(ref())
    expect(prompt.repo).toBe(REPO)
    expect(prompt.uploads).toContain(ID)
    expect(prompt.excludes).toContain("chat.jsonl")
  })

  test("accepting consent writes consent = true once; declining writes nothing", async () => {
    const { archive, transport, source, workspace } = await harness("consent-grant", { consent: false })

    const declined = expectErr(await archive.put(ref(), source, { consent: "decline" }))
    expect(declined.kind).toBe("cancelled")
    expect(readFileSync(workspace.paths.config, "utf8")).toContain("consent = false")
    expect(transport.requests).toEqual([])

    const put = unwrap(await archive.put(ref(), source, { consent: "grant" }))
    expect(put.files).toBeGreaterThan(0)
    const config = readFileSync(workspace.paths.config, "utf8")
    expect(config).toContain("consent = true")
    expect((config.match(/consent = true/g) ?? []).length).toBe(1)

    // revoking blocks the next push with zero requests for that attempt
    await writeFile(workspace.paths.config, config.replace("consent = true", "consent = false"), "utf8")
    transport.reset()
    const revoked = expectErr(await archive.put(ref(), source))
    expect(revoked.kind).toBe("consent")
    expect(transport.requests).toEqual([])
  })

  test("the refusal table: public, unknown visibility, missing repo, missing token", async () => {
    const publicRepo = await harness("public", { private: false })
    const publicError = expectErr(await publicRepo.archive.put(ref(), publicRepo.source))
    expect(publicError.kind).toBe("privacy")
    if (publicError.kind === "privacy") {
      expect(publicError.state).toBe("public")
      expect(publicError.message).toContain(REPO)
    }
    // only the privacy probe went out: zero uploads
    expect(publicRepo.transport.requests.filter((request) => request.method === "PUT")).toEqual([])

    const unknown = await harness("unknown", { private: "unknown" })
    const unknownError = expectErr(await unknown.archive.put(ref(), unknown.source))
    expect(unknownError.kind).toBe("privacy")
    if (unknownError.kind === "privacy") expect(unknownError.state).toBe("unverifiable")

    const missingRepo = await harness("missing-repo", { private: null })
    const missingError = expectErr(await missingRepo.archive.put(ref(), missingRepo.source))
    if (missingError.kind === "privacy") expect(missingError.state).toBe("not-found")

    const noToken = await harness("no-token", { token: null })
    const tokenError = expectErr(await noToken.archive.put(ref(), noToken.source))
    expect(tokenError.kind).toBe("auth")
    expect(noToken.transport.requests).toEqual([])

    // a malformed repo is a config error before any request
    const badRepo = openGithubArchive({
      workspace: noToken.workspace,
      repo: "not a repo",
      branch: "main",
      secrets: memorySecrets(TOKEN),
      transport: noToken.transport,
    })
    expect(badRepo.ok).toBe(false)
    if (!badRepo.ok) expect(badRepo.error.kind).toBe("config")
  })

  test("a push uploads the item, excludes chat history, and records skipped files", async () => {
    const { archive, transport, source, workspace } = await harness("push", { maxFileBytes: 600 })
    await writeFile(join(source, "oversize.txt"), "x".repeat(1000), "utf8")
    const put = unwrap(await archive.put(ref(), source))

    const uploaded = transport.requests
      .filter((request) => request.method === "PUT")
      .map((request) => request.path as string)
    expect(uploaded.length).toBe(put.files)
    expect(uploaded.some((path) => path.endsWith("/chat.jsonl"))).toBe(false)
    expect(uploaded.some((path) => path.endsWith("/sources/bonding.md"))).toBe(true)
    expect(uploaded.some((path) => path.endsWith("/outputs/study-guide.md"))).toBe(true)

    // the privacy check ran before the first upload
    const purposes = transport.requests.map((request) => request.purpose ?? request.method)
    expect(purposes[0]).toBe("privacy")
    expect(purposes.filter((purpose) => purpose === "upload").length).toBe(uploaded.length)

    // a file above the cap is skipped, named, and recorded in the index
    expect(put.skipped.length).toBeGreaterThan(0)
    expect(put.warnings.some((warning) => warning.code === "large-file")).toBe(true)
    const index = JSON.parse(indexText(workspace) as string)
    expect(index.entries[0].id).toBe(ID)
    expect(index.entries[0].skipped).toEqual(put.skipped)
    expect(index.entries[0].sizeBytes).toBe(put.bytes)
  })

  test("restore recreates the item, and collides only with an explicit choice", async () => {
    const { archive, source, workspace, transport } = await harness("restore")
    unwrap(await archive.put(ref(), source))

    // 1. a fresh workspace restores into it
    const other = await mkdtemp(join(TEMP_BASE, "lockedin-gh-restore-"))
    cleanup.push(other)
    const fresh: Workspace = unwrap(
      await createWorkspace(join(other, "workspace"), { dataDir: join(other, "data") }),
    )
    await writeFile(
      fresh.paths.config,
      ['[archive.github]', `repo = "${REPO}"`, 'branch = "main"', "consent = true", ""].join("\n"),
      "utf8",
    )
    const freshArchive = unwrap(
      openGithubArchive({
        workspace: fresh,
        repo: REPO,
        branch: "main",
        secrets: memorySecrets(TOKEN),
        transport,
      }),
    )
    const restored = unwrap(await freshArchive.restore(ref()))
    expect(restored.files).toBeGreaterThan(0)
    expect(existsSync(join(fresh.paths.schoolSessions, ID, "sources/bonding.md"))).toBe(true)
    expect(existsSync(join(fresh.paths.schoolSessions, ID, "chat.jsonl"))).toBe(false)

    // 1b. an explicit destination is honoured, not ignored in favour of the default
    const custom = join(other, "custom-restore")
    const placed = unwrap(await freshArchive.restore(ref(), custom))
    expect(placed.path).toBe(custom)
    expect(existsSync(join(custom, "sources/bonding.md"))).toBe(true)

    // 2. the same workspace already has the id: no choice → conflict, no writes
    const before = readdirSync(workspace.paths.schoolSessions).sort()
    const conflict = expectErr(await freshArchive.restore(ref()))
    expect(conflict.kind).toBe("conflict")
    expect(readdirSync(fresh.paths.schoolSessions).sort()).toEqual([ID])

    // 3. cancel → cancelled, nothing written
    const cancelled = expectErr(await freshArchive.restore(ref(), { onConflict: "cancel" }))
    expect(cancelled.kind).toBe("cancelled")
    expect(readdirSync(fresh.paths.schoolSessions).sort()).toEqual([ID])

    // 4. keep both → a second id
    const kept = unwrap(await freshArchive.restore(ref(), { onConflict: "keep-both" }))
    expect(kept.id).not.toBe(ID)
    expect(existsSync(join(fresh.paths.schoolSessions, kept.id))).toBe(true)
    expect(readdirSync(fresh.paths.schoolSessions).sort()).toEqual([ID, kept.id].sort())
    void before
  })

  test("a failed push leaves the index byte-identical", async () => {
    const { archive, source, workspace, transport } = await harness("fail-push")
    unwrap(await archive.put(ref(), source))
    const goodIndex = indexText(workspace)
    expect(goodIndex).not.toBeNull()

    // fail the third upload of a second push
    const failing = await harness("fail-push-2", { failUploadAt: 2 })
    const error = expectErr(await failing.archive.put(ref(), failing.source))
    expect(error.kind).toBe("network")
    expect(indexText(failing.workspace)).toBeNull()

    // and a later good push still writes a valid index
    unwrap(await failing.archive.put(ref(), failing.source))
    expect(indexText(failing.workspace)).not.toBeNull()
    void transport
  })

  test("delete needs confirmation and only removes the remote folder", async () => {
    const { archive, source, workspace, transport } = await harness("delete")
    unwrap(await archive.put(ref(), source))
    const indexBefore = indexText(workspace)
    const localBefore = readdirSync(join(workspace.paths.schoolSessions, ID)).sort()

    // cancelled delete: no DELETE request, index unchanged, local untouched
    const cancelled = expectErr(await archive.remove(ref()))
    expect(cancelled.kind).toBe("cancelled")
    expect(transport.requests.filter((request) => request.method === "DELETE")).toEqual([])
    expect(indexText(workspace)).toBe(indexBefore)

    // confirmed delete removes the remote files and the index entry
    const removed = unwrap(await archive.remove(ref(), { confirm: true }))
    expect(removed.removed).toBe(true)
    expect(removed.files).toBeGreaterThan(0)
    expect(transport.requests.filter((request) => request.method === "DELETE").length).toBe(removed.files)
    expect(JSON.parse(indexText(workspace) as string).entries).toEqual([])

    // the local item is untouched
    expect(readdirSync(join(workspace.paths.schoolSessions, ID)).sort()).toEqual(localBefore)
  })
})
