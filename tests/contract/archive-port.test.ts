/**
 * WP-144 — the archive port itself.
 *
 * The important assertions here are structural: both adapters are assigned to
 * `ArchiveBackend` **without a cast**, which is a compile-time proof that the
 * port covers their errors and options. The runtime checks then cover the
 * per-row `backend` field and the legacy index migration.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openFolderArchive } from "../../src/archive";
import type { ArchiveBackend } from "../../src/archive";
import { GITHUB_TOKEN_SECRET, openGithubArchive } from "../../src/archive/github";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { SecretStore } from "../../src/security/secret-store";
import { createFakeGithub } from "../fixtures/archive-github/fake-github";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURE = join(import.meta.dir, "..", "fixtures", "archive-port", "legacy-index.json")
const SESSION_FIXTURE = join(import.meta.dir, "..", "fixtures", "archive-github", "session")
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

function memorySecrets(token: string | null): SecretStore {
  return {
    id: "memory",
    async available() {
      return true
    },
    async get(name: string) {
      return { ok: true, value: name === GITHUB_TOKEN_SECRET ? token : null }
    },
    async set() {
      return { ok: true, value: undefined }
    },
    async delete() {
      return { ok: true, value: false }
    },
  }
}

async function harness(label: string, consent = true) {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-port-${label}-`))
  cleanup.push(parent)
  const workspace: Workspace = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  const source = join(workspace.paths.schoolSessions, ID)
  await cp(SESSION_FIXTURE, source, { recursive: true })
  await writeFileSync(
    workspace.paths.config,
    [
      "[archive.github]",
      `repo = "${REPO}"`,
      'branch = "main"',
      `consent = ${consent}`,
      'token_ref = "lockedin/github-token"',
      "",
    ].join("\n"),
    "utf8",
  )
  const transport = createFakeGithub({ repo: REPO, private: true })
  const github = unwrap(
    openGithubArchive({
      workspace,
      repo: REPO,
      branch: "main",
      secrets: memorySecrets(TOKEN),
      transport,
      maxFileBytes: 4096,
      now: () => new Date("2026-12-03T00:00:00Z"),
    }),
  )
  const folder = unwrap(
    openFolderArchive({ archiveRoot: join(parent, "archive"), workspaceRoot: workspace.paths.root }),
  )
  return { workspace, github, folder, transport, source, parent }
}

function indexFile(workspace: Workspace): string {
  return join(workspace.paths.root, "archive-index", "school.json")
}

describe("archive port", () => {
  test("both adapters satisfy ArchiveBackend in a type-checked assignment", async () => {
    const { github, folder } = await harness("port")

    // No casts: the compiler proves the port covers both adapters' errors and
    // option objects (auth/consent/privacy, consent, onConflict, confirm).
    const asPort: ArchiveBackend[] = [folder, github]
    expect(asPort.map((backend) => backend.id).sort()).toEqual(["folder", "github"])
    for (const backend of asPort) {
      expect(typeof backend.ensureReady).toBe("function")
      expect(typeof backend.put).toBe("function")
      expect(typeof backend.list).toBe("function")
      expect(typeof backend.restore).toBe("function")
      expect(typeof backend.remove).toBe("function")
    }
  })

  test("a legacy index file loads and lists its entries", async () => {
    const { workspace, github } = await harness("legacy")
    mkdirSync(join(workspace.paths.root, "archive-index"), { recursive: true })
    await cp(FIXTURE, indexFile(workspace))

    const listed = unwrap(await github.list("school"))
    expect(listed.diagnostics).toEqual([])
    expect(listed.entries).toEqual([
      {
        id: "2026-10-01-0900-chemistry",
        kind: "session",
        title: "Chemistry — Bonding",
        tags: ["chemistry"],
        archivedAt: "2026-10-01T09:10:00.000Z",
        sizeBytes: 18422,
        // inherited from the file's top-level `backend`
        backend: "github",
      },
    ])
  })

  test("a rewritten index carries backend per entry and backends[] at the top", async () => {
    const { workspace, github, source } = await harness("rewrite")
    unwrap(await github.put({ side: "school", id: ID, backend: "github" }, source))

    const index = JSON.parse(readFileSync(indexFile(workspace), "utf8"))
    expect(index.backends).toEqual(["github"])
    expect(index.entries[0].backend).toBe("github")
    expect(index.entries[0].id).toBe(ID)
    expect(index.backend).toBeUndefined()
  })

  test("mixed folder and github entries list together", async () => {
    const { workspace, folder, source } = await harness("mixed")
    unwrap(await folder.put({ side: "school", id: ID, backend: "folder" }, source))

    // A remote row in the same file, as a second backend would write it.
    const file = indexFile(workspace)
    const index = JSON.parse(readFileSync(file, "utf8"))
    index.entries.push({
      id: "remote-only",
      kind: "session",
      title: "Remote only",
      tags: [],
      archivedAt: "2026-12-04T00:00:00.000Z",
      sizeBytes: 10,
      backend: "github",
    })
    index.backends = ["folder", "github"]
    writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`, "utf8")

    const listed = unwrap(await folder.list("school"))
    expect(listed.entries.map((entry) => `${entry.backend}:${entry.id}`).sort()).toEqual([
      `folder:${ID}`,
      "github:remote-only",
    ])
    expect(listed.diagnostics).toEqual([])
  })

  test("an unknown backend in an entry produces a diagnostic", async () => {
    const { workspace, folder } = await harness("unknown-backend")
    mkdirSync(join(workspace.paths.root, "archive-index"), { recursive: true })
    writeFileSync(
      indexFile(workspace),
      `${JSON.stringify(
        {
          backends: ["folder"],
          entries: [
            {
              id: "mystery",
              kind: "session",
              title: "Mystery",
              tags: [],
              archivedAt: "2026-12-05T00:00:00.000Z",
              sizeBytes: 1,
              backend: "ftp",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const listed = unwrap(await folder.list("school"))
    expect(listed.entries).toEqual([])
    expect(listed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["index-entry-invalid"])
    expect(listed.diagnostics[0]?.message).toContain("mystery")
  })
})
