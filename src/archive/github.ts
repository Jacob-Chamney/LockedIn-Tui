/**
 * GitHub archive backend (WP-601) — the second `ArchiveBackend` adapter.
 *
 * Order of a push, every time:
 *
 *   1. consent  — `[archive.github] consent` must be true in `config.toml`;
 *   2. config   — a branch must be configured;
 *   3. token    — from `SecretStore.get("lockedin/github-token")` only;
 *   4. privacy  — `GET /repos/<repo>` must answer 200 with `private: true`;
 *   5. upload   — the selected item only, sparse, `chat.jsonl` excluded;
 *   6. index    — `archive-index/<side>.json` written atomically.
 *
 * A refusal at 1–4 sends no upload and writes no index. Force-push is never used
 * and never appears in a request body. The transport is injected, so a test can
 * assert the exact request log.
 */

import { randomUUID } from "node:crypto"
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs"
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path"

import { err, ok, type Result } from "../domain/markdown"
import { createRedactor } from "../security/redaction"
import type { SecretStore } from "../security/secret-store"
import { loadConfig, patchConfig } from "../storage/config"
import { isPathInside, type WorkspacePaths } from "../storage/paths"
import type { Workspace } from "../storage/workspace"
import {
  ARCHIVE_EXCLUDED_NAMES,
  ARCHIVE_KINDS,
  type ArchiveBackend,
  type ArchiveError,
  type PutOptions,
  type RemoveOptions,
  type RestoreOptions,
  DEFAULT_MAX_FILE_BYTES,
  type ArchiveEntry,
  type ArchiveKind,
  type ArchiveRef,
  type ArchiveSide,
  type ArchiveWarning,
  type ListResult,
  type PutResult,
  type RestoreResult,
} from "./types"
import { interpretRepoProbe, parseRepoSlug, repoPath, type PrivacyVerdict } from "./privacy"

/**
 * The documented reference, as it appears in config `token_ref`.
 * `SecretStore.get()` namespaces every name itself and refuses one that already
 * repeats `lockedin/`, so the getter must use the bare segment below.
 */
export const GITHUB_TOKEN_NAME = "lockedin/github-token"

/** What `SecretStore.get()` actually receives (`github-token`). */
export const GITHUB_TOKEN_SECRET = GITHUB_TOKEN_NAME.replace(/^lockedin\//, "")

export type GithubRequest = {
  method: "GET" | "PUT" | "DELETE"
  path: string
  body?: Record<string, unknown>
  /** Recorded for the request log; never sent as a header by the fake transport. */
  purpose?: "privacy" | "upload" | "list" | "download" | "delete"
}

export type GithubResponse = { status: number; json?: unknown; text?: string }

/** Injected so tests can assert the request log and run offline. */
export interface GithubTransport {
  send(request: GithubRequest): Promise<GithubResponse>
}

/**
 * The port's error union (WP-144 put the remote kinds there), so this adapter
 * is an `ArchiveBackend` at the type level and not just by shape.
 */
export type GithubError = ArchiveError

export type GithubEntry = ArchiveEntry & { skipped?: string[] }

export type ConsentPrompt = {
  item: { side: ArchiveSide; kind: ArchiveKind; id: string }
  repo: string
  branch: string
  /** Exactly what is uploaded. */
  uploads: string
  /** Exactly what is not. */
  excludes: string[]
}

export type GithubArchiveOptions = {
  workspace: Workspace
  repo: string
  branch: string
  secrets: SecretStore
  transport: GithubTransport
  /** Overridable for tests; production uses 50 MB. */
  maxFileBytes?: number
  now?: () => Date
  /** Receives redacted log lines (tests assert the token never appears). */
  log?: (line: string) => void
}

/**
 * The port, with the GitHub adapter's concrete (narrower) return types. Omit
 * rather than intersect so a call resolves to these signatures, not the port's
 * wider ones; the assignment in the contract test still proves conformance.
 */
export type GithubArchive = Omit<
  ArchiveBackend,
  "id" | "put" | "list" | "restore" | "remove"
> & {
  readonly id: "github"
  /** The port requires a locator; for a remote backend it is `repo@branch`. */
  readonly archiveRoot: string
  readonly repo: string
  readonly branch: string
  /** Validates config only: no network, no token read. */
  ensureReady(): Promise<Result<{ root: string; created: string[] }, GithubError>>
  describeConsent(ref: ArchiveRef): ConsentPrompt
  grantConsent(): Promise<Result<void, GithubError>>
  put(
    ref: ArchiveRef,
    sourceDir: string,
    options?: PutOptions,
  ): Promise<Result<PutResult & { skipped: string[] }, GithubError>>
  /** Local index only: works offline (`docs/product.md` §9). */
  list(side: ArchiveSide): Promise<Result<ListResult, GithubError>>
  /** Port form: an explicit destination is honoured. */
  restore(
    ref: ArchiveRef,
    destination: string,
    options?: RestoreOptions,
  ): Promise<Result<RestoreResult & { id: string }, GithubError>>
  /** Convenience form: restore into the workspace location for the item. */
  restore(
    ref: ArchiveRef,
    options?: RestoreOptions,
  ): Promise<Result<RestoreResult & { id: string }, GithubError>>
  remove(
    ref: ArchiveRef,
    options?: RemoveOptions,
  ): Promise<Result<{ removed: boolean; files: number; path: string }, GithubError>>
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

async function writeFileAtomic(file: string, text: string): Promise<void> {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const temp = join(dir, `.${basename(file)}.tmp-${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, "w")
    await handle.writeFile(text, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, file)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // ignore
    }
    rmSync(temp, { force: true })
    throw error
  }
}

type CollectedFile = { relative: string; bytes: number; content: Uint8Array }

async function collectFiles(
  root: string,
  options: { maxFileBytes: number; excludes: readonly string[]; warnings: ArchiveWarning[]; skipped: string[] },
): Promise<CollectedFile[]> {
  const out: CollectedFile[] = []

  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue
      if (options.excludes.includes(entry.name)) continue
      const abs = join(dir, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        options.warnings.push({ code: "symlink", path: relative, message: `${relative} is a symlink and was not archived.` })
        continue
      }
      if (entry.isDirectory()) {
        await walk(abs, relative)
        continue
      }
      if (!entry.isFile()) {
        options.warnings.push({
          code: "special-file",
          path: relative,
          message: `${relative} is not a regular file and was not archived.`,
        })
        options.skipped.push(relative)
        continue
      }
      const size = lstatSync(abs).size
      if (size > options.maxFileBytes) {
        options.warnings.push({
          code: "large-file",
          path: relative,
          bytes: size,
          message: `${relative} is ${(size / 1024 / 1024).toFixed(1)} MB and was skipped; the item is archived without it.`,
        })
        options.skipped.push(relative)
        continue
      }
      out.push({ relative, bytes: size, content: await readFile(abs) })
    }
  }

  await walk(root, "")
  out.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0))
  return out
}

/* -------------------------------------------------------------------------- */
/* backend                                                                     */
/* -------------------------------------------------------------------------- */

export function openGithubArchive(options: GithubArchiveOptions): Result<GithubArchive, GithubError> {
  const parsed = parseRepoSlug(options.repo)
  if (!parsed) {
    return err({
      kind: "config",
      field: "archive.github.repo",
      message: `“${options.repo}” is not a repository (expected owner/name).`,
      next: "Set archive.github.repo to owner/name in Settings → Storage and archive.",
    })
  }
  const repo = parsed.repo
  const { workspace, transport, secrets } = options
  const paths: WorkspacePaths = workspace.paths
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const now = options.now ?? (() => new Date())
  const redactor = createRedactor()
  const log = (line: string): void => options.log?.(redactor.redact(line))

  const indexFile = (side: ArchiveSide): string => join(paths.root, "archive-index", `${side}.json`)

  function readIndex(side: ArchiveSide): Result<GithubEntry[], GithubError> {
    const file = indexFile(side)
    if (!existsSync(file)) return ok([])
    try {
      const parsedIndex = JSON.parse(readFileSync(file, "utf8")) as {
        entries?: unknown
        backend?: unknown
        backends?: unknown
      }
      if (!Array.isArray(parsedIndex.entries)) return ok([])
      const fileBackend =
        parsedIndex.backend === "folder" ? "folder" : parsedIndex.backend === "github" ? "github" : "github"
      const entries: GithubEntry[] = []
      for (const raw of parsedIndex.entries) {
        if (typeof raw !== "object" || raw === null) continue
        const entry = raw as GithubEntry & { backend?: unknown }
        const backend =
          entry.backend === "folder" || entry.backend === "github" ? entry.backend : fileBackend
        // An entry naming an unknown backend is skipped, never a crash.
        if (entry.backend !== undefined && backend !== entry.backend) continue
        entries.push({ ...(entry as GithubEntry), backend })
      }
      return ok(entries)
    } catch (error) {
      return err({
        kind: "index",
        path: file,
        message: `The ${side} archive index is unreadable: ${describe(error)}`,
        next: "The archive folders are unaffected; the index is rewritten on the next successful push.",
      })
    }
  }

  async function writeIndex(side: ArchiveSide, entries: GithubEntry[]): Promise<void> {
    const backends = [...new Set(entries.map((entry) => entry.backend))].sort()
    const payload = {
      backends,
      entries: [...entries].sort((a, b) =>
        a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : a.id < b.id ? -1 : 1,
      ),
    }
    await writeFileAtomic(indexFile(side), `${JSON.stringify(payload, null, 2)}\n`)
  }

  async function grantConsent(): Promise<Result<void, GithubError>> {
    const written = await patchConfig(paths, { archive: { github: { consent: true } } })
    if (!written.ok) {
      return err({
        kind: "config",
        field: "archive.github.consent",
        message: written.error.message,
        next: written.error.next,
      })
    }
    return ok(undefined)
  }

  async function consentEnabled(): Promise<Result<boolean, GithubError>> {
    const loaded = await loadConfig(paths)
    if (!loaded.ok) {
      return err({
        kind: "config",
        field: "archive.github.consent",
        message: loaded.error.message,
        next: loaded.error.next,
      })
    }
    const archive = loaded.value.document.archive as Record<string, unknown> | undefined
    const github = archive?.github as Record<string, unknown> | undefined
    return ok(github?.consent === true)
  }

  async function token(): Promise<Result<string, GithubError>> {
    const read = await secrets.get(GITHUB_TOKEN_SECRET)
    if (!read.ok) {
      return err({
        kind: "auth",
        repo,
        message: `The keychain could not be read (${read.error.kind}); the push did not start.`,
        next: "Unlock the keychain and relink the token in Settings → Providers.",
      })
    }
    if (typeof read.value !== "string" || read.value.trim() === "") {
      return err({
        kind: "auth",
        repo,
        message: "No GitHub token is linked, so the push did not start.",
        next: "Link a token with repository access in Settings → Providers.",
      })
    }
    redactor.add(read.value)
    return ok(read.value)
  }

  async function privacyCheck(branch: string): Promise<Result<PrivacyVerdict & { ok: true }, GithubError>> {
    let response: GithubResponse
    try {
      response = await transport.send({ method: "GET", path: repoPath(repo), purpose: "privacy" })
    } catch (error) {
      return err({
        kind: "network",
        path: repoPath(repo),
        message: `GitHub could not be reached to verify “${repo}”: ${describe(error)}`,
        next: "Try again when online; nothing was uploaded.",
      })
    }
    log(`GET ${repoPath(repo)} → ${response.status} (privacy, branch ${branch})`)
    const verdict = interpretRepoProbe(repo, { status: response.status, json: response.json })
    if (!verdict.ok) {
      return err({
        kind: "privacy",
        repo,
        state: verdict.state,
        message: verdict.message,
        next: verdict.next,
      })
    }
    return ok(verdict)
  }

  function validateRef(ref: ArchiveRef): GithubError | null {
    if (ref.side !== "school" && ref.side !== "skills") {
      return { kind: "config", field: "side", message: "Unknown archive side.", next: "Use school or skills." }
    }
    if (ref.kind !== undefined && !ARCHIVE_KINDS.includes(ref.kind)) {
      return { kind: "config", field: "kind", message: "Unknown archive kind.", next: "Use session, goal or project." }
    }
    if (typeof ref.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref.id)) {
      return { kind: "config", field: "id", message: `“${ref.id}” is not a safe archive id.`, next: "Use the item id." }
    }
    return null
  }

  const kindOf = (ref: ArchiveRef): ArchiveKind => ref.kind ?? "session"

  /* ------------------------------------------------------------------------ */
  /* remote listing                                                           */
  /* ------------------------------------------------------------------------ */

  async function listRemote(
    prefix: string,
  ): Promise<Result<Array<{ path: string; sha: string }>, GithubError>> {
    const out: Array<{ path: string; sha: string }> = []

    const walk = async (path: string): Promise<Result<void, GithubError>> => {
      let response: GithubResponse
      try {
        response = await transport.send({ method: "GET", path: `/repos/${repo}/contents/${path}`, purpose: "list" })
      } catch (error) {
        return err({
          kind: "network",
          path,
          message: `GitHub could not be reached for ${path}: ${describe(error)}`,
          next: "Try again when online; nothing was written locally.",
        })
      }
      if (response.status === 404) return ok(undefined)
      if (response.status !== 200) {
        return err({
          kind: "network",
          path,
          status: response.status,
          message: `GitHub returned ${response.status} for ${path}.`,
          next: "Check the token and branch; nothing was written locally.",
        })
      }
      const entries = Array.isArray(response.json) ? (response.json as Array<Record<string, unknown>>) : []
      for (const entry of entries) {
        const entryPath = typeof entry.path === "string" ? entry.path : ""
        if (!entryPath) continue
        if (entry.type === "dir") {
          const nested = await walk(entryPath)
          if (!nested.ok) return nested
          continue
        }
        if (typeof entry.sha === "string") out.push({ path: entryPath, sha: entry.sha })
      }
      return ok(undefined)
    }

    const walked = await walk(prefix)
    if (!walked.ok) return walked
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return ok(out)
  }

  async function uniqueId(id: string, kind: ArchiveKind): Promise<string> {
    for (let suffix = 2; suffix < 100; suffix++) {
      const candidate = `${id}-restored-${suffix}`
      const folder = kind === "session" ? join(paths.schoolSessions, candidate) : join(paths.goals, candidate)
      if (!existsSync(folder)) return candidate
    }
    return `${id}-restored-${Date.now()}`
  }

  /** Keep-both for an explicit destination: append `-restored-2`, `-3`, … */
  async function uniquePath(base: string): Promise<string> {
    for (let suffix = 2; suffix < 100; suffix++) {
      const candidate = `${base}-restored-${suffix}`
      if (!existsSync(candidate)) return candidate
    }
    return `${base}-restored-${Date.now()}`
  }

  return ok({
    id: "github",
    archiveRoot: `${repo}@${options.branch || "(no branch)"}`,
    repo,
    branch: options.branch,

    async ensureReady() {
      if (!options.branch || options.branch.trim() === "") {
        return err({
          kind: "config",
          field: "archive.github.branch",
          message: "No branch is configured for the archive repository.",
          next: "Set archive.github.branch in Settings → Storage and archive.",
        })
      }
      return ok({ root: `${repo}@${options.branch}`, created: [] })
    },

    describeConsent(ref: ArchiveRef): ConsentPrompt {
      return {
        item: { side: ref.side, kind: kindOf(ref), id: ref.id },
        repo,
        branch: options.branch || "(no branch configured)",
        uploads: `the ${ref.side} ${kindOf(ref)} “${ref.id}” only`,
        excludes: [...ARCHIVE_EXCLUDED_NAMES],
      }
    },

    async grantConsent() {
      return grantConsent()
    },

    async put(ref, sourceDir, putOptions: PutOptions = {}) {
      const invalid = validateRef(ref)
      if (invalid) return err(invalid)

      if (putOptions.consent === "decline") {
        return err({
          kind: "cancelled",
          message: "Archiving to GitHub was declined, so nothing was uploaded and consent was not stored.",
          next: "Archive to a local folder, or accept the prompt next time.",
        })
      }
      if (putOptions.consent === "grant") {
        const granted = await grantConsent()
        if (!granted.ok) return granted
      }

      const consented = await consentEnabled()
      if (!consented.ok) return consented
      if (!consented.value) {
        return err({
          kind: "consent",
          repo,
          message: `“${ref.id}” was not sent: archiving to GitHub needs consent.`,
          next: "Accept the archive prompt once (it lists the files and the repository), or archive locally.",
        })
      }

      if (!options.branch || options.branch.trim() === "") {
        return err({
          kind: "config",
          field: "archive.github.branch",
          message: "No branch is configured for the archive repository.",
          next: "Set archive.github.branch in Settings → Storage and archive.",
        })
      }

      const secret = await token()
      if (!secret.ok) return secret

      const privacy = await privacyCheck(options.branch)
      if (!privacy.ok) return privacy

      const source = resolvePath(sourceDir)
      if (!isPathInside(paths.root, source) || !existsSync(source)) {
        return err({
          kind: "storage",
          path: source,
          message: "The source folder is not inside this workspace.",
          next: "Archive from the workspace that owns the item; nothing was uploaded.",
        })
      }

      const warnings: ArchiveWarning[] = []
      const skipped: string[] = []
      const files = await collectFiles(source, {
        maxFileBytes,
        excludes: ARCHIVE_EXCLUDED_NAMES,
        warnings,
        skipped,
      })

      const prefix = `${ref.side}/${kindOf(ref)}/${ref.id}`
      let bytes = 0
      for (const file of files) {
        const path = `${prefix}/${file.relative}`
        let response: GithubResponse
        try {
          response = await transport.send({
            method: "PUT",
            path: `/repos/${repo}/contents/${path}`,
            purpose: "upload",
            body: {
              message: `archive: ${ref.id} (${file.relative})`,
              branch: options.branch,
              content: base64(file.content),
            },
          })
        } catch (error) {
          return err({
            kind: "network",
            path,
            message: `Uploading ${file.relative} failed: ${describe(error)}`,
            next: "Nothing was indexed; the remote tree is unchanged for this item.",
          })
        }
        if (response.status < 200 || response.status >= 300) {
          return err({
            kind: "network",
            path,
            status: response.status,
            message: `GitHub refused to store ${file.relative} (${response.status}).`,
            next: "Check the token has contents:write on this repository; nothing was indexed.",
          })
        }
        bytes += file.bytes
        log(`PUT ${path} → ${response.status} (${file.bytes} B)`)
      }

      const entry: GithubEntry = {
        id: ref.id,
        kind: kindOf(ref),
        title: ref.id,
        tags: [],
        archivedAt: now().toISOString(),
        sizeBytes: bytes,
        backend: "github",
        ...(skipped.length > 0 ? { skipped } : {}),
      }

      try {
        const existing = readIndex(ref.side)
        if (!existing.ok) return existing
        const next = existing.value.filter((item) => item.id !== ref.id)
        next.push(entry)
        await writeIndex(ref.side, next)
        log(`PATCH archive-index/${ref.side}.json (${next.length} entries)`)
      } catch (error) {
        return err({
          kind: "index",
          path: indexFile(ref.side),
          message: `The item was uploaded but the index could not be written: ${describe(error)}`,
          next: "Re-run the archive for this item; the index is a cache.",
        })
      }

      return ok({
        ref,
        path: `${repo}@${options.branch}:${prefix}`,
        files: files.length,
        bytes,
        warnings,
        skipped,
      })
    },

    async list(side: ArchiveSide): Promise<Result<ListResult, GithubError>> {
      // Offline by design: the index is local, the network is never touched.
      const index = readIndex(side)
      if (!index.ok) {
        return ok({
          entries: [],
          diagnostics: [
            {
              code: "index-corrupt",
              path: index.error.kind === "index" ? index.error.path : indexFile(side),
              message: index.error.message,
              next: index.error.next,
            },
          ],
        })
      }
      const entries = index.value.map(({ skipped: _skipped, ...entry }) => entry)
      return ok({ entries, diagnostics: [] })
    },

    async restore(
      ref: ArchiveRef,
      destinationOrOptions: string | RestoreOptions = {},
      maybeOptions: RestoreOptions = {},
    ) {
      const invalid = validateRef(ref)
      if (invalid) return err(invalid)

      const destinationOverride =
        typeof destinationOrOptions === "string" ? destinationOrOptions : undefined
      const restoreOptions: RestoreOptions =
        typeof destinationOrOptions === "string" ? maybeOptions : destinationOrOptions

      const kind = kindOf(ref)
      const prefix = `${ref.side}/${kind}/${ref.id}`
      const destination = resolvePath(
        destinationOverride ??
          (kind === "session"
            ? join(paths.schoolSessions, ref.id)
            : join(paths.goals, ref.id)),
      )
      const collides = existsSync(destination)

      const choice = restoreOptions.onConflict
      if (collides && !choice) {
        return err({
          kind: "conflict",
          path: destination,
          message: `“${ref.id}” already exists in this workspace, so nothing was restored.`,
          next: "Choose replace, keep both or cancel before restoring.",
        })
      }
      if (collides && choice === "cancel") {
        return err({
          kind: "cancelled",
          message: `Restoring “${ref.id}” was cancelled; nothing was written.`,
          next: "Restore again when you want to replace or keep both.",
        })
      }

      const secret = await token()
      if (!secret.ok) return secret

      const privacy = await privacyCheck(options.branch)
      if (!privacy.ok) return privacy

      let targetId = ref.id
      let targetFolder = destination
      if (collides && choice === "keep-both") {
        if (destinationOverride) {
          targetFolder = await uniquePath(destination)
          targetId = basename(targetFolder)
        } else {
          targetId = await uniqueId(ref.id, kind)
          targetFolder = resolvePath(
            kind === "session" ? join(paths.schoolSessions, targetId) : join(paths.goals, targetId),
          )
        }
      }

      const files = await listRemote(prefix)
      if (!files.ok) return files
      if (files.value.length === 0) {
        return err({
          kind: "storage",
          path: prefix,
          message: `There is no archived “${ref.id}” on the ${ref.side} side.`,
          next: "Push the item first, or pick another entry.",
        })
      }

      const temp = `${targetFolder}.restore-${randomUUID()}`
      let placed = false
      try {
        await mkdir(temp, { recursive: true })
        for (const remote of files.value) {
          const relative = remote.path.slice(`${prefix}/`.length)
          if (relative === "chat.jsonl" || relative.startsWith("chats/")) continue
          const segments = relative.split("/")
          // A remote response is untrusted: a `..` segment would write outside
          // the restore folder under the user's account.
          if (
            relative === "" ||
            relative.includes("\0") ||
            isAbsolute(relative) ||
            segments.some((segment) => segment === "" || segment === "." || segment === "..")
          ) {
            return err({
              kind: "path",
              path: remote.path,
              reason: "escape",
              message: `GitHub returned a path outside the archive item: ${remote.path}`,
              next: "Nothing was written into the workspace.",
            })
          }
          const response = await transport.send({ method: "GET", path: `/repos/${repo}/contents/${remote.path}`, purpose: "download" })
          if (response.status !== 200) {
            return err({
              kind: "network",
              path: remote.path,
              status: response.status,
              message: `GitHub refused to return ${remote.path} (${response.status}).`,
              next: "Nothing was written into the workspace.",
            })
          }
          const payload = response.json as { content?: string; encoding?: string } | undefined
          if (typeof payload?.content !== "string") {
            return err({
              kind: "network",
              path: remote.path,
              message: `GitHub returned no content for ${remote.path}.`,
              next: "Nothing was written into the workspace.",
            })
          }
          const file = join(temp, ...segments)
          if (!isPathInside(temp, file)) {
            return err({
              kind: "path",
              path: remote.path,
              reason: "escape",
              message: `GitHub returned a path outside the archive item: ${remote.path}`,
              next: "Nothing was written into the workspace.",
            })
          }
          if (payload.content.length > Math.ceil((maxFileBytes * 4) / 3) + 4) {
            return err({
              kind: "network",
              path: remote.path,
              message: `GitHub returned ${remote.path} larger than the ${(maxFileBytes / 1024 / 1024).toFixed(0)} MB restore cap.`,
              next: "Nothing was written into the workspace.",
            })
          }
          const data = Buffer.from(payload.content, "base64")
          if (data.byteLength > maxFileBytes) {
            return err({
              kind: "network",
              path: remote.path,
              message: `GitHub returned ${remote.path} larger than the ${(maxFileBytes / 1024 / 1024).toFixed(0)} MB restore cap.`,
              next: "Nothing was written into the workspace.",
            })
          }
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, data)
          log(`GET ${remote.path} → 200 (restore)`)
        }

        // The same safe swap the folder backend uses: the live copy is moved
        // aside first and put back if the rename fails.
        if (collides && choice === "replace") {
          const previous = `${targetFolder}.previous-${randomUUID()}`
          await rename(targetFolder, previous)
          try {
            await rename(temp, targetFolder)
          } catch (error) {
            await rename(previous, targetFolder).catch(() => {})
            throw error
          }
          await rm(previous, { recursive: true, force: true }).catch(() => {})
        } else {
          await rename(temp, targetFolder)
        }
        placed = true
      } catch (error) {
        return err({
          kind: "storage",
          path: targetFolder,
          message: `The item could not be restored: ${describe(error)}`,
          next: "Nothing was replaced in the workspace.",
        })
      } finally {
        // Every early `return err` above bypasses the catch; clean the partial
        // download here so it can never appear as a phantom session.
        if (!placed) await rm(temp, { recursive: true, force: true })
      }

      return ok({ ref, id: targetId, path: targetFolder, files: files.value.length })
    },

    async remove(ref, removeOptions: RemoveOptions = {}) {
      const invalid = validateRef(ref)
      if (invalid) return err(invalid)

      if (removeOptions.confirm !== true) {
        return err({
          kind: "cancelled",
          message: `Deleting the archived “${ref.id}” from the github backend needs confirmation; nothing was removed.`,
          next: "Confirm the delete (it names the item and the backend) to remove only the remote copy.",
        })
      }

      const secret = await token()
      if (!secret.ok) return secret

      const privacy = await privacyCheck(options.branch)
      if (!privacy.ok) return privacy

      const prefix = `${ref.side}/${kindOf(ref)}/${ref.id}`
      const files = await listRemote(prefix)
      if (!files.ok) return files
      if (files.value.length === 0) return ok({ removed: false, files: 0, path: prefix })

      for (const remote of files.value) {
        let response
        try {
          response = await transport.send({
            method: "DELETE",
            path: `/repos/${repo}/contents/${remote.path}`,
            purpose: "delete",
            body: { message: `archive: remove ${ref.id}`, branch: options.branch, sha: remote.sha },
          })
        } catch (error) {
          return err({
            kind: "network",
            path: remote.path,
            message: `Deleting ${remote.path} failed: ${describe(error)}`,
            next: "The index was not changed; try again when GitHub is reachable.",
          })
        }
        if (response.status < 200 || response.status >= 300) {
          return err({
            kind: "network",
            path: remote.path,
            status: response.status,
            message: `GitHub refused to delete ${remote.path} (${response.status}).`,
            next: "The index was not changed; try again when GitHub is reachable.",
          })
        }
        log(`DELETE ${remote.path} → ${response.status}`)
      }

      const existing = readIndex(ref.side)
      if (!existing.ok) return existing
      const next = existing.value.filter((entry) => entry.id !== ref.id)
      try {
        await writeIndex(ref.side, next)
      } catch (error) {
        return err({
          kind: "index",
          path: indexFile(ref.side),
          message: `The remote copy was deleted but the index could not be updated: ${describe(error)}`,
          next: "Re-run the archive; the index is a cache.",
        })
      }

      return ok({ removed: true, files: files.value.length, path: prefix })
    },
  })

}

/**
 * The production transport: GitHub's contents API over `fetch`.
 *
 * The token is captured once by the caller and never logged; the adapter owns
 * consent/privacy checks before it ever calls this transport.
 */
export function createGithubFetchTransport(token: string): GithubTransport {
  return {
    async send(request) {
      const response = await fetch(`https://api.github.com${request.path}`, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(request.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      })
      let json: unknown
      try {
        json = await response.json()
      } catch {
        json = undefined
      }
      return { status: response.status, ...(json === undefined ? {} : { json }) }
    },
  }
}
