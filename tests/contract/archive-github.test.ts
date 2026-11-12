/**
 * WP-601 — GitHub archive backend, contract level.
 *
 * The backend must satisfy the same `ArchiveBackend` port as WP-128's folder
 * backend without redeclaring it, work offline for `list()`, and never emit a
 * force flag or leak the token.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GITHUB_TOKEN_NAME, GITHUB_TOKEN_SECRET, openGithubArchive, type GithubError } from "../../src/archive/github";
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

/**
 * A store that behaves like the real one: it namespaces names itself and
 * refuses a name that already repeats `lockedin/` (WP-157).
 */
function memorySecrets(token: string | null, strict = true): SecretStore {
  let value = token
  return {
    id: "memory",
    async available() {
      return true
    },
    async get(name: string) {
      if (strict && name.startsWith("lockedin/")) {
        return {
          ok: false,
          error: {
            kind: "invalid-name",
            backend: "memory",
            message: "Secret name must not repeat the 'lockedin/' namespace.",
            hint: "Pass the bare name; the store adds the namespace.",
          },
        }
      }
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

async function harness(
  label: string,
  overrides: { token?: string | null; private?: boolean | null | "unknown"; strict?: boolean } = {},
) {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-gh-${label}-`))
  cleanup.push(parent)
  const workspace: Workspace = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  const source = join(workspace.paths.schoolSessions, ID)
  await cp(FIXTURE, source, { recursive: true })
  // Seed a config with consent already granted and the repo/branch set.
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
      "consent = true",
      'token_ref = "lockedin/github-token"',
      "",
    ].join("\n"),
    "utf8",
  )
  const transport = createFakeGithub({ repo: REPO, private: overrides.private ?? true })
  const logs: string[] = []
  const archive = unwrap(
    openGithubArchive({
      workspace,
      repo: REPO,
      branch: "main",
      secrets: memorySecrets(overrides.token === undefined ? TOKEN : overrides.token, overrides.strict !== false),
      transport,
      maxFileBytes: 64,
      now: () => new Date("2026-12-02T00:00:00Z"),
      log: (line) => logs.push(line),
    }),
  )
  return { workspace, archive, transport, logs, source }
}

describe("github archive contract", () => {
  test("satisfies the ArchiveBackend port", async () => {
    const { archive } = await harness("port")

    // Surface conformance with `docs/architecture.md` §4.6. A type-level
    // `ArchiveBackend` assignment is not possible yet because WP-128's
    // `ArchiveError` union has no `auth` / `consent` / `privacy` kinds; the port
    // needs those before a GitHub adapter can be a subtype. Tracked in the
    // packet report.
    expect(archive.id).toBe("github")
    expect(typeof archive.ensureReady).toBe("function")
    expect(typeof archive.put).toBe("function")
    expect(typeof archive.list).toBe("function")
    expect(typeof archive.restore).toBe("function")
    expect(typeof archive.remove).toBe("function")
    expect(archive.archiveRoot).toContain(REPO)

    const ready = await archive.ensureReady()
    expect(ready.ok).toBe(true)
  })

  test("a missing branch is a typed config error with no request", async () => {
    const { workspace, transport } = await harness("branch")
    const archive = unwrap(
      openGithubArchive({
        workspace,
        repo: REPO,
        branch: "",
        secrets: memorySecrets(TOKEN),
        transport,
      }),
    )
    const ready = await archive.ensureReady()
    expect(ready.ok).toBe(false)
    if (!ready.ok) {
      const typed: GithubError = ready.error
      expect(typed.kind).toBe("config")
    }
    expect(transport.requests).toEqual([])
  })

  test("reads the token with the store's own namespace", async () => {
    const { archive, transport, source, logs } = await harness("token-name", { strict: true })
    const put = unwrap(await archive.put({ side: "school", id: ID, backend: "github" }, source))

    expect(put.files).toBeGreaterThan(0)
    // the bare name is what the store receives; the reference form is unchanged
    expect(GITHUB_TOKEN_SECRET).toBe("github-token")
    expect(GITHUB_TOKEN_NAME).toBe("lockedin/github-token")
    expect(transport.requests.length).toBeGreaterThan(0)
    for (const request of transport.requests) expect(JSON.stringify(request)).not.toContain(TOKEN)
    for (const line of logs) expect(line).not.toContain(TOKEN)
  })

  test("a public repo fails privacy, not auth", async () => {
    const { archive, transport, source } = await harness("public-after-token", {
      strict: true,
      private: false,
    })
    const result = await archive.put({ side: "school", id: ID, backend: "github" }, source)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("privacy")
    if (result.error.kind === "privacy") {
      expect(result.error.state).toBe("public")
      expect(result.error.message).toContain(REPO)
    }
    // the probe ran; nothing was uploaded
    expect(transport.requests.filter((request) => request.method === "PUT")).toEqual([])
  })

  test("a missing token is auth with a Settings next step and no upload", async () => {
    const { archive, transport, source } = await harness("no-token-after-fix", {
      strict: true,
      token: null,
    })
    const result = await archive.put({ side: "school", id: ID, backend: "github" }, source)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("auth")
    expect(result.error.next).toContain("Settings")
    expect(transport.requests).toEqual([])
  })

  test("list() is offline and needs no token", async () => {
    const { archive, transport } = await harness("offline", { token: null })
    const listed = unwrap(await archive.list("school"))
    expect(listed.entries).toEqual([])
    expect(transport.requests).toEqual([])
  })

  test("no request ever carries a force flag, and the token never leaks", async () => {
    const { archive, transport, logs, workspace, source } = await harness("leak")
    unwrap(await archive.put({ side: "school", id: ID, backend: "github" }, source))

    expect(transport.requests.length).toBeGreaterThan(0)
    for (const request of transport.requests) {
      const serialised = JSON.stringify(request)
      expect(serialised).not.toContain(TOKEN)
      expect(serialised.toLowerCase()).not.toContain("force")
    }
    for (const line of logs) expect(line).not.toContain(TOKEN)

    const index = readFileSync(join(workspace.paths.root, "archive-index", "school.json"), "utf8")
    expect(index).not.toContain(TOKEN)
    const config = readFileSync(workspace.paths.config, "utf8")
    expect(config).not.toContain(TOKEN)
  })
})
