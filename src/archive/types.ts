/**
 * Archive port types (WP-128, `docs/architecture.md` §4.6).
 *
 * One interface, several backends: `folder` here, `github` in its own packet.
 * A backend never deletes a live session/goal and never stores a secret, a
 * data-dir counter or an absolute source path (`docs/product.md` §9).
 */

export type ArchiveSide = "school" | "skills"
export type ArchiveKind = "session" | "goal" | "project"
export type ArchiveBackendId = "folder" | "github"

export const ARCHIVE_SIDES: readonly ArchiveSide[] = ["school", "skills"]
export const ARCHIVE_KINDS: readonly ArchiveKind[] = ["session", "goal", "project"]

/** Chat history is the one artefact an archive never carries. */
export const ARCHIVE_EXCLUDED_NAMES: readonly string[] = [
  "chat.jsonl",
  // Skill goals keep their conversations in `chats/`; archive output, not chat.
  "chats",
  // Never archive configuration or data-dir counters.
  "config.toml",
  "activity.jsonl",
  "usage.json",
  "stats.json",
]

/** Files above this size are skipped with a warning, never copied silently. */
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024

/**
 * The port's ref (architecture §4.6) plus an optional kind.
 *
 * `docs/architecture.md` gives `{side, id, backend}`; the folder layout needs a
 * kind, so it is optional here and defaults to `session` (the only kind the
 * session manager archives). Skills callers pass `goal`.
 */
export type ArchiveRef = {
  side: ArchiveSide
  id: string
  backend: ArchiveBackendId
  kind?: ArchiveKind
}

/** A fully located archive item: ref with its kind resolved. */
export type ArchiveLocation = {
  side: ArchiveSide
  kind: ArchiveKind
  id: string
}

export type ArchiveEntry = {
  id: string
  kind: ArchiveKind
  title: string
  tags: string[]
  /** ISO-8601 UTC. */
  archivedAt: string
  sizeBytes: number
  /**
   * Which adapter produced this row. Two backends share one index file, so the
   * backend is per entry, not per file (WP-144).
   */
  backend: ArchiveBackendId
}

/** Non-fatal problem: reported next to the result, never a crash. */
export type ArchiveDiagnostic = {
  code: "index-corrupt" | "index-entry-invalid" | "unreadable-folder"
  path: string
  message: string
  next: string
}

export type ArchiveWarning = {
  code: "large-file" | "symlink" | "special-file"
  path: string
  bytes?: number
  message: string
}

export type ArchiveError =
  | {
      kind: "path"
      path: string
      reason:
        | "absolute"
        | "escape"
        | "symlink"
        | "missing"
        | "not-empty"
        | "invalid-id"
        | "inside-archive"
        | "not-a-folder"
      message: string
      next: string
    }
  | { kind: "storage"; path: string; message: string; next: string }
  | { kind: "index"; path: string; message: string; next: string }
  /* Remote-backend failures. They live in the port so a GitHub adapter is an
     `ArchiveBackend` without a cast (WP-144); a local adapter never produces
     them. */
  | { kind: "auth"; repo: string; message: string; next: string }
  | { kind: "consent"; repo: string; message: string; next: string }
  | {
      kind: "privacy"
      repo: string
      state: "public" | "not-found" | "unverifiable"
      message: string
      next: string
    }
  | { kind: "config"; field: string; message: string; next: string }
  | { kind: "cancelled"; message: string; next: string }
  | { kind: "conflict"; path: string; message: string; next: string }
  | { kind: "network"; path: string; status?: number; message: string; next: string }

export type PutResult = {
  ref: ArchiveRef
  /** Folder the archived copy now lives in. */
  path: string
  files: number
  bytes: number
  /** Files that were skipped; never empty for an oversized file. */
  warnings: ArchiveWarning[]
}

export type ListResult = {
  entries: ArchiveEntry[]
  diagnostics: ArchiveDiagnostic[]
}

export type RestoreResult = {
  ref: ArchiveRef
  path: string
  files: number
}

export type EnsureResult = { root: string; created: string[] }

export type PutOptions = {
  /** Display title; defaults to the archived `meta.json` title, then the id. */
  title?: string
  tags?: string[]
  /**
   * Only the GitHub adapter needs consent; a local adapter ignores it. It is in
   * the port so both adapters share one signature.
   */
  consent?: "grant" | "decline"
}

export type RestoreOptions = {
  /** Local adapter: required to write into an existing non-empty folder. */
  overwrite?: boolean
  /** Remote adapter: what to do when the item id already exists locally. */
  onConflict?: "replace" | "keep-both" | "cancel"
}

export type RemoveOptions = {
  /** Remote adapter: deleting a remote copy needs an explicit confirmation. */
  confirm?: boolean
}

/**
 * The port. Methods return `Result` rather than throwing, matching the rest of
 * `src/storage` and `src/services`.
 */
export type ArchiveBackend = {
  readonly id: ArchiveBackendId
  readonly archiveRoot: string
  ensureReady(): Promise<import("../domain/markdown").Result<EnsureResult, ArchiveError>>
  put(
    ref: ArchiveRef,
    sourceDir: string,
    options?: PutOptions,
  ): Promise<import("../domain/markdown").Result<PutResult, ArchiveError>>
  list(side: ArchiveSide): Promise<import("../domain/markdown").Result<ListResult, ArchiveError>>
  restore(
    ref: ArchiveRef,
    destination: string,
    options?: RestoreOptions,
  ): Promise<import("../domain/markdown").Result<RestoreResult, ArchiveError>>
  remove(
    ref: ArchiveRef,
    options?: RemoveOptions,
  ): Promise<
    import("../domain/markdown").Result<
      { removed: boolean; path: string; files?: number },
      ArchiveError
    >
  >
}
