/**
 * Index schema, version 1 (WP-105, derived from the S3 spike).
 *
 * `notes_fts` is an FTS5 external-content table: the index holds only the
 * searchable index, never a second copy of the body. There are no triggers —
 * the store issues explicit `'delete'`/insert commands for exactly the rows it
 * rewrites, which is what makes "a refresh touches only changed notes"
 * observable.
 *
 * `links.broken = 1` covers both a target that does not exist and a link that
 * points at the other side. A cross-side target is never resolved: the row is
 * recorded and the wall holds (`AGENTS.md` §2.5).
 */

import type { Database } from "bun:sqlite"

import type { Migration } from "./runner"

export const INDEX_SCHEMA_VERSION = 2

export const INDEX_SCHEMA_SQL = `
CREATE TABLE index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE notes (
  rowid INTEGER PRIMARY KEY,          -- FTS content_rowid
  path  TEXT NOT NULL UNIQUE,         -- vault-relative, the logical key
  mtime INTEGER NOT NULL,             -- ms since epoch, from stat
  size  INTEGER NOT NULL,
  title TEXT NOT NULL,
  tags  TEXT NOT NULL DEFAULT '[]',   -- canonical JSON array, sorted
  type  TEXT NOT NULL DEFAULT 'concept',
  body  TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title,
  body,
  content = 'notes',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE links (
  from_path TEXT NOT NULL,
  to_path   TEXT NOT NULL,
  broken    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_path, to_path)
) STRICT, WITHOUT ROWID;

CREATE TABLE headings (
  path  TEXT NOT NULL,
  level INTEGER NOT NULL,
  text  TEXT NOT NULL,
  line  INTEGER NOT NULL
) STRICT;

CREATE INDEX headings_by_path ON headings(path, line);
CREATE INDEX links_broken ON links(broken, from_path);
`

export const INDEX_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create-note-index",
    up(db: Database): void {
      db.exec(INDEX_SCHEMA_SQL)
      db.query("INSERT INTO index_meta (key, value) VALUES (?, ?)").run(
        "schema_version",
        "1",
      )
    },
  },
  {
    version: 2,
    name: "add-note-topics",
    up(db: Database): void {
      // Topics are declared in note frontmatter; the index is a cache, so the
      // column is additive and a rebuild fills it from the Markdown.
      db.exec("ALTER TABLE notes ADD COLUMN topics TEXT NOT NULL DEFAULT '[]'")
      db.query("UPDATE index_meta SET value = ? WHERE key = 'schema_version'").run(
        String(INDEX_SCHEMA_VERSION),
      )
    },
  },
]

/** FTS5 must be present before any FTS virtual table is created. */
export function hasFts5(db: Database): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE __fts5_probe USING fts5(body)")
    db.exec("DROP TABLE __fts5_probe")
    return true
  } catch {
    return false
  }
}

export function sqliteVersion(db: Database): string {
  return (db.query("SELECT sqlite_version() AS v").get() as { v: string }).v
}
