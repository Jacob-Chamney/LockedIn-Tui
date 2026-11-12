/**
 * Forward-only migration runner (WP-105).
 *
 * The index is a cache, so a migration never has to preserve data: it may drop
 * and recreate. What it must do is be safe to interrupt, refuse to run backwards
 * and record exactly what has run.
 *
 * `schema_migrations` is the version table. It is intentionally deterministic
 * (no timestamps), so two freshly migrated databases hold identical rows.
 */

import type { Database } from "bun:sqlite"

import { err, ok, type Result } from "../../domain/markdown"

export type Migration = {
  /** Strictly increasing, starting at 1. */
  version: number
  name: string
  up(db: Database): void
}

export type MigrationError =
  | {
      kind: "migration"
      version: number | null
      message: string
      next: string
    }
  | {
      /** The file was written by a newer build than this one. */
      kind: "newer-schema"
      found: number
      supported: number
      message: string
      next: string
    }

export type MigrationResult = {
  from: number
  to: number
  /** Versions applied by this call, in order. */
  applied: number[]
}

const VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name    TEXT NOT NULL
) STRICT;
`

export function versionTableExists(db: Database): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name: string } | null
  return row !== null
}

/** Highest applied version, or 0 when the database is untouched. */
export function currentVersion(db: Database): number {
  if (!versionTableExists(db)) return 0
  const row = db
    .query("SELECT max(version) AS version FROM schema_migrations")
    .get() as { version: number | null }
  return row.version ?? 0
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Apply every migration newer than the current version, each in its own
 * transaction. A failure rolls that migration back and leaves earlier ones in
 * place, which is safe because the index is rebuildable.
 */
export function migrate(
  db: Database,
  migrations: readonly Migration[],
  targetVersion?: number,
): Result<MigrationResult, MigrationError> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version)

  const seen = new Set<number>()
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      return err({
        kind: "migration",
        version: null,
        message: `Migration "${migration.name}" has an invalid version ${migration.version}.`,
        next: "Fix the migration list; the database was not changed.",
      })
    }
    if (seen.has(migration.version)) {
      return err({
        kind: "migration",
        version: migration.version,
        message: `Two migrations share version ${migration.version}.`,
        next: "Give each migration a unique version; the database was not changed.",
      })
    }
    seen.add(migration.version)
  }

  const supported = ordered.length === 0 ? 0 : (ordered[ordered.length - 1] as Migration).version
  const target = targetVersion ?? supported

  try {
    db.exec(VERSION_TABLE)
  } catch (error) {
    return err({
      kind: "migration",
      version: null,
      message: `The migration table could not be created: ${describe(error)}`,
      next: "The index is a cache: delete it and let it rebuild.",
    })
  }

  const from = currentVersion(db)
  if (from > target) {
    return err({
      kind: "newer-schema",
      found: from,
      supported: target,
      message: `This index was written by a newer build (schema ${from}; this build supports ${target}).`,
      next: "Open it with that build, or delete the index and let this build rebuild it.",
    })
  }

  const applied: number[] = []
  for (const migration of ordered) {
    if (migration.version <= from) continue
    if (migration.version > target) break

    try {
      const run = db.transaction(() => {
        migration.up(db)
        db.query("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
          migration.version,
          migration.name,
        )
      })
      run()
      applied.push(migration.version)
    } catch (error) {
      return err({
        kind: "migration",
        version: migration.version,
        message: `Migration ${migration.version} (${migration.name}) failed: ${describe(error)}`,
        next: "The index is a cache: delete it and let it rebuild; no Markdown was touched.",
      })
    }
  }

  return ok({ from, to: currentVersion(db), applied })
}
