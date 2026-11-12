/**
 * Proposed writes and per-hunk diffs (WP-504).
 *
 * A write is a **value** here, never a side effect (`swarm/contracts.md` §4.3,
 * `docs/product.md` §8.2, `AGENTS.md` §2.9, §2.14):
 *
 * ```
 * propose → the user reads the diff → approve some hunks → apply
 * ```
 *
 * This module owns the left half: resolving a path inside the project root,
 * reading what is there now, hashing it, and producing a unified diff whose
 * hunks have stable indices. It never writes. `writes.ts` owns the approval and
 * the atomic replace.
 *
 * Three rules are enforced here rather than left to callers:
 *
 * - **Confinement.** A proposal takes a relative name and resolves it the same
 *   way WP-502's read toolbox does: `..`, absolute paths and symlink escapes
 *   are refused as shapes, not just when they happen to land outside. A path
 *   that does not exist yet (a create) is resolved through its nearest existing
 *   ancestor, so a symlinked parent cannot smuggle a write out of the root.
 * - **Base identity.** `baseHash` is `sha256:` of the bytes the diff was made
 *   against, or `null` for a file that must not exist. `writes.ts` re-checks it
 *   immediately before applying; a file that changed underneath is a typed
 *   conflict and nothing is written.
 * - **Exact bytes.** Lines keep their terminator internally, so applying every
 *   hunk reproduces `newContent` byte for byte (including a missing final
 *   newline), and applying a subset leaves every unselected region untouched.
 *
 * The diff is a small Myers implementation with a hard work cap. When a file is
 * bigger than the cap, or the edit distance is, the fallback is **one hunk that
 * replaces the whole file** — coarser to review, never wrong. There is no third
 * representation and no second diff parser (`WP-706` consumes these hunks).
 */

import { lstat, readFile, realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { isPathInside } from "../../storage/paths"

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

/** Context lines either side of a change, as `diff -u` uses. */
export const HUNK_CONTEXT = 3

/**
 * Work caps for the line diff. Beyond either one the diff degrades to a single
 * whole-file hunk: still exact, just not per-region.
 */
export const MAX_DIFF_LINES = 4_000
export const MAX_EDIT_DISTANCE = 256

/** One line of a hunk. `text` has no terminator; the exact bytes live in the hunk. */
export type DiffLine = {
  kind: "context" | "add" | "remove"
  /** Without the trailing newline, for display. */
  text: string
  /** True when the source line ended with `\n`. */
  newline: boolean
}

export type Hunk = {
  /** Stable index: the position of this hunk in the diff, from 0. */
  index: number
  /** First old line, 1-based; 0 for a hunk that only inserts at the top. */
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
  /** Old-side lines including terminators; the strict re-apply contract. */
  oldLines: string[]
  /** New-side lines including terminators. */
  newLines: string[]
}

export type DiffStats = { added: number; removed: number }

export type ProposedWrite = {
  /** Relative to the project root, `/` separators, symlink-resolved. */
  path: string
  /** `sha256:<hex>` of the bytes the proposal was made against; `null` = create. */
  baseHash: string | null
  /** The full result, or `null` for a delete. */
  newContent: string | null
  /** Unified diff text. Headers are `a/<path>` and `b/<path>`: never absolute. */
  diff: string
  hunks: Hunk[]
  stats: DiffStats
  kind: "create" | "update" | "delete"
}

export type HunkError =
  | { kind: "context"; index: number; message: string }
  | { kind: "hunk"; index: number; message: string }

export type ProposeError =
  | {
      kind: "path"
      path: string
      reason: "escape" | "missing" | "symlink"
      message: string
    }
  | { kind: "storage"; path: string; message: string }
  | { kind: "unsupported"; path: string; message: string }
  /** The file already has exactly this content; there is nothing to approve. */
  | { kind: "unchanged"; path: string; message: string }

/* -------------------------------------------------------------------------- */
/* hashing                                                                     */
/* -------------------------------------------------------------------------- */

/** `sha256:<64 hex>` over raw bytes. The only hash shape this module emits. */
export function hashBytes(bytes: Uint8Array): string {
  return `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
}

export function hashContent(text: string): string {
  return hashBytes(Buffer.from(text, "utf8"))
}

/* -------------------------------------------------------------------------- */
/* line splitting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Split into lines **keeping** each `\n`.
 *
 * `""` is no lines; `"a\n"` is `["a\n"]`; `"a"` is `["a"]`. Joining the result
 * is the identity, which is what lets a hunk apply be byte-exact about a
 * missing final newline.
 */
export function splitLines(text: string): string[] {
  if (text === "") return []
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

function display(line: string): { text: string; newline: boolean } {
  return line.endsWith("\n")
    ? { text: line.slice(0, -1), newline: true }
    : { text: line, newline: false }
}

/* -------------------------------------------------------------------------- */
/* Myers line diff                                                             */
/* -------------------------------------------------------------------------- */

type Op = { kind: "equal" | "add" | "remove"; line: string }

/**
 * Shortest edit script over lines.
 *
 * Returns `null` when the input is over a cap. The caller then falls back to a
 * whole-file hunk rather than growing an unbounded trace.
 */
function myers(a: readonly string[], b: readonly string[]): Op[] | null {
  const n = a.length
  const m = b.length
  if (n + m > MAX_DIFF_LINES) return null
  if (n === 0 && m === 0) return []

  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 1)
  const trace: Int32Array[] = []
  const limit = Math.min(max, MAX_EDIT_DISTANCE)

  for (let depth = 0; depth <= limit; depth++) {
    trace.push(v.slice())
    for (let k = -depth; k <= depth; k += 2) {
      let x: number
      if (k === -depth || (k !== depth && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]
      } else {
        x = v[offset + k - 1] + 1
      }
      let y = x - k
      while (x < n && y >= 0 && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, a, b, depth, offset)
    }
  }
  return null
}

function backtrack(
  trace: readonly Int32Array[],
  a: readonly string[],
  b: readonly string[],
  depth: number,
  offset: number,
): Op[] {
  let x = a.length
  let y = b.length
  const ops: Op[] = []

  for (let step = depth; step > 0; step--) {
    const v = trace[step]
    const k = x - y
    const prevK =
      k === -step || (k !== step && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1
    const prevX = v[offset + prevK]
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      ops.push({ kind: "equal", line: a[x - 1] })
      x--
      y--
    }
    if (x === prevX) {
      ops.push({ kind: "add", line: b[y - 1] })
      y--
    } else {
      ops.push({ kind: "remove", line: a[x - 1] })
      x--
    }
  }

  while (x > 0 && y > 0) {
    ops.push({ kind: "equal", line: a[--x] })
    y--
  }
  while (x > 0) ops.push({ kind: "remove", line: a[--x] })
  while (y > 0) ops.push({ kind: "add", line: b[--y] })

  return ops.reverse()
}

/** The over-cap fallback: one block that replaces everything with everything. */
function replaceAll(a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = []
  for (const line of a) ops.push({ kind: "remove", line })
  for (const line of b) ops.push({ kind: "add", line })
  return ops
}

/* -------------------------------------------------------------------------- */
/* hunks                                                                       */
/* -------------------------------------------------------------------------- */

function buildHunks(ops: readonly Op[], context: number): Hunk[] {
  const oldNo: number[] = new Array(ops.length)
  const newNo: number[] = new Array(ops.length)
  let oldLine = 1
  let newLine = 1
  for (let index = 0; index < ops.length; index++) {
    oldNo[index] = oldLine
    newNo[index] = newLine
    if (ops[index].kind === "equal") {
      oldLine++
      newLine++
    } else if (ops[index].kind === "remove") {
      oldLine++
    } else {
      newLine++
    }
  }

  const hunks: Hunk[] = []
  let previousEnd = 0
  let index = 0

  while (index < ops.length) {
    if (ops[index].kind === "equal") {
      index++
      continue
    }

    // Up to `context` equal lines before the first change of this hunk, but
    // never a line another hunk already owns.
    let start = index
    for (let back = 0; back < context && start > previousEnd && ops[start - 1].kind === "equal"; back++) {
      start--
    }

    // Extend across changes that are within `context` of each other: that is
    // what merges two nearby edits into one hunk instead of overlapping ones.
    let lastChange = index
    let cursor = index
    while (cursor < ops.length) {
      if (ops[cursor].kind !== "equal") lastChange = cursor
      if (ops[cursor].kind === "equal" && cursor - lastChange >= context) break
      cursor++
    }
    const end = Math.min(ops.length, lastChange + 1 + context)

    const body = ops.slice(start, end)
    const oldLines: string[] = []
    const newLines: string[] = []
    const lines: DiffLine[] = []
    for (const op of body) {
      const shown = display(op.line)
      if (op.kind === "equal") {
        oldLines.push(op.line)
        newLines.push(op.line)
        lines.push({ kind: "context", ...shown })
      } else if (op.kind === "remove") {
        oldLines.push(op.line)
        lines.push({ kind: "remove", ...shown })
      } else {
        newLines.push(op.line)
        lines.push({ kind: "add", ...shown })
      }
    }

    const oldCount = oldLines.length
    const newCount = newLines.length
    // Unified-diff convention: an empty range names the line *before* it.
    const oldStart = oldCount === 0 ? Math.max(0, oldNo[start] - 1) : oldNo[start]
    const newStart = newCount === 0 ? Math.max(0, newNo[start] - 1) : newNo[start]

    hunks.push({
      index: hunks.length,
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines,
      oldLines,
      newLines,
    })

    previousEnd = end
    index = end
  }

  return hunks
}

/**
 * Diff two strings into hunks with stable indices.
 *
 * The same inputs always produce the same hunks, which is what makes an index
 * the UI shows meaningful after a re-render.
 */
export function diffContent(
  base: string,
  next: string,
  options: { context?: number } = {},
): Hunk[] {
  if (base === next) return []
  const context = Math.max(0, Math.trunc(options.context ?? HUNK_CONTEXT))
  const a = splitLines(base)
  const b = splitLines(next)
  const ops = myers(a, b) ?? replaceAll(a, b)
  return buildHunks(ops, context)
}

export function diffStats(hunks: readonly Hunk[]): DiffStats {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added++
      else if (line.kind === "remove") removed++
    }
  }
  return { added, removed }
}

/**
 * Render hunks as a unified diff.
 *
 * The only path text is `a/<relative>` and `b/<relative>`; an absolute path
 * never enters the value the UI shows or the activity log records.
 */
export function renderDiff(path: string, hunks: readonly Hunk[]): string {
  const label = path.split(sep).join("/")
  let text = `--- a/${label}\n+++ b/${label}\n`
  for (const hunk of hunks) {
    text += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`
    for (const line of hunk.lines) {
      const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "
      text += `${prefix}${line.text}\n`
    }
  }
  return text
}

/* -------------------------------------------------------------------------- */
/* applying hunks to text                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Apply the selected hunks to `content`.
 *
 * Every chosen hunk's old-side lines must match the current text at the
 * position it claims. A mismatch is `{ kind: "context" }` and **no** partial
 * result is returned: the caller refuses the whole write rather than
 * force-applying a stale patch. Unselected regions are copied verbatim.
 */
export function applyHunks(
  content: string,
  hunks: readonly Hunk[],
  indices: readonly number[],
): Result<string, HunkError> {
  const byIndex = new Map<number, Hunk>()
  for (const hunk of hunks) byIndex.set(hunk.index, hunk)

  const chosen: Hunk[] = []
  for (const index of new Set(indices)) {
    const hunk = byIndex.get(index)
    if (!hunk) {
      return err({
        kind: "hunk",
        index,
        message: `there is no hunk ${index} in this proposal`,
      })
    }
    chosen.push(hunk)
  }
  chosen.sort((left, right) => left.index - right.index)

  const lines = splitLines(content)
  const output: string[] = []
  let cursor = 0

  for (const hunk of chosen) {
    const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1
    if (start < cursor) {
      return err({
        kind: "context",
        index: hunk.index,
        message: `hunk ${hunk.index} overlaps the previous hunk; the proposal is inconsistent`,
      })
    }
    const current = lines.slice(start, start + hunk.oldCount)
    if (
      current.length !== hunk.oldLines.length ||
      current.some((line, position) => line !== hunk.oldLines[position])
    ) {
      return err({
        kind: "context",
        index: hunk.index,
        message: `hunk ${hunk.index} no longer matches the file; re-read it and propose again`,
      })
    }
    output.push(...lines.slice(cursor, start), ...hunk.newLines)
    cursor = start + hunk.oldCount
  }

  output.push(...lines.slice(cursor))
  return ok(output.join(""))
}

/* -------------------------------------------------------------------------- */
/* path resolution for writes                                                  */
/* -------------------------------------------------------------------------- */

export type WriteTarget = {
  /** Absolute, symlink-resolved root. */
  root: string
  /** Relative to the root, `/` separators. */
  relative: string
  /** Absolute destination to write. */
  absolute: string
  exists: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

function escapeError(path: string, message: string): ProposeError {
  return { kind: "path", path, reason: "escape", message }
}

function missingError(path: string, message: string): ProposeError {
  return { kind: "path", path, reason: "missing", message }
}

/**
 * Resolve a relative name for reading **or writing**, including a file that
 * does not exist yet.
 *
 * `realpath` is used on the target when it exists, and on the nearest existing
 * ancestor when it does not. Both comparisons are against the resolved root, so
 * `root/link -> ../outside` is refused whether the final file exists or the
 * write would create it (`docs/testing.md` §6).
 */
export async function resolveWriteTarget(
  root: string,
  name: string,
): Promise<Result<WriteTarget, ProposeError>> {
  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return err(missingError(root, `“${root}” is not on disk any more`))
    }
    return err({ kind: "storage", path: root, message: messageOf(error) })
  }

  const rootInfo = await stat(rootReal).catch(() => null)
  if (!rootInfo || !rootInfo.isDirectory()) {
    return err(missingError(root, `“${root}” is not a folder`))
  }

  const requested = name.trim()
  if (requested === "") {
    return err(missingError(name, "a path relative to the project root is required"))
  }
  if (requested.includes("\u0000")) {
    return err(escapeError(name, "a path cannot contain a null byte"))
  }
  if (isAbsolute(requested) || /^[A-Za-z]:[\\/]/.test(requested)) {
    return err(
      escapeError(name, `"${name}" is absolute; tools take a path relative to the project root`),
    )
  }
  for (const segment of requested.split(/[\\/]/)) {
    if (segment === "..") {
      return err(escapeError(name, `"${name}" climbs out of the project root`))
    }
  }

  const target = resolve(rootReal, requested)
  if (!isPathInside(rootReal, target)) {
    return err(escapeError(name, `"${name}" climbs out of the project root`))
  }

  // `lstat` first: a dangling symlink must be refused, not treated as "missing"
  // and then written *through* (which would create its target outside the root).
  let linkInfo
  try {
    linkInfo = await lstat(target)
  } catch (error) {
    if (codeOf(error) !== "ENOENT" && codeOf(error) !== "ENOTDIR") {
      return err({ kind: "storage", path: name, message: messageOf(error) })
    }
    linkInfo = null
  }

  if (linkInfo) {
    if (linkInfo.isSymbolicLink()) {
      let real: string
      try {
        real = await realpath(target)
      } catch {
        return err({
          kind: "path",
          path: name,
          reason: "symlink",
          message: `"${name}" is a symbolic link that does not resolve to a file`,
        })
      }
      if (!isPathInside(rootReal, real)) {
        return err({
          kind: "path",
          path: name,
          reason: "symlink",
          message: `"${name}" is a symlink leading outside the project root`,
        })
      }
      const info = await stat(real).catch(() => null)
      if (!info || !info.isFile()) {
        return err({
          kind: "unsupported",
          path: name,
          message: `"${name}" is not a regular file`,
        })
      }
      return ok({
        root: rootReal,
        relative: relative(rootReal, real).split(sep).join("/"),
        absolute: real,
        exists: true,
      })
    }

    if (!linkInfo.isFile()) {
      return err({
        kind: "unsupported",
        path: name,
        message: `"${name}" is not a regular file`,
      })
    }
    return ok({
      root: rootReal,
      relative: relative(rootReal, target).split(sep).join("/"),
      absolute: target,
      exists: true,
    })
  }

  // Missing target: resolve the nearest existing ancestor, so `link/new.txt`
  // cannot create a file outside the root while `newdir/file.txt` can be
  // refused as missing (the app never invents directories).
  let ancestor = dirname(target)
  let realParent: string | null = null

  for (;;) {
    try {
      realParent = await realpath(ancestor)
      break
    } catch (error) {
      if (codeOf(error) !== "ENOENT" && codeOf(error) !== "ENOTDIR") {
        return err({ kind: "storage", path: name, message: messageOf(error) })
      }
    }

    const parent = dirname(ancestor)
    if (parent === ancestor || !isPathInside(rootReal, parent)) {
      return err(escapeError(name, `"${name}" climbs out of the project root`))
    }
    ancestor = parent
  }

  const parentReal = realParent as string
  if (!isPathInside(rootReal, parentReal)) {
    return err({
      kind: "path",
      path: name,
      reason: "symlink",
      message: `"${name}" leads outside the project root`,
    })
  }

  const parentInfo = await stat(parentReal).catch(() => null)
  if (!parentInfo || !parentInfo.isDirectory()) {
    return err(missingError(name, `"${name}" does not exist in this project`))
  }

  const real = join(parentReal, relative(ancestor, target))
  const relativePath = relative(rootReal, real).split(sep).join("/")
  if (relativePath.startsWith("..")) {
    return err(escapeError(name, `"${name}" climbs out of the project root`))
  }

  return ok({ root: rootReal, relative: relativePath, absolute: real, exists: false })
}

/* -------------------------------------------------------------------------- */
/* reading the current bytes                                                   */
/* -------------------------------------------------------------------------- */

/** A proposed write never targets a binary blob or a multi-megabyte file. */
export const MAX_WRITE_BYTES = 2 * 1024 * 1024

export type CurrentContent = { text: string; hash: string; bytes: number }

/**
 * Read a target as UTF-8 text, or `null` when it does not exist yet.
 *
 * Binary and non-UTF-8 files are typed refusals: a diff of a PNG is not a
 * review a human can approve. The cap keeps a proposal from loading a huge file
 * into memory just to show three changed lines.
 */
export async function readCurrentFile(
  target: WriteTarget,
): Promise<Result<CurrentContent | null, ProposeError>> {
  if (!target.exists) return ok(null)

  let info
  try {
    info = await stat(target.absolute)
  } catch (error) {
    if (codeOf(error) === "ENOENT") return ok(null)
    return err({ kind: "storage", path: target.relative, message: messageOf(error) })
  }
  if (!info.isFile()) {
    return err({
      kind: "unsupported",
      path: target.relative,
      message: `"${target.relative}" is not a regular file`,
    })
  }
  if (info.size > MAX_WRITE_BYTES) {
    return err({
      kind: "unsupported",
      path: target.relative,
      message: `"${target.relative}" is larger than ${MAX_WRITE_BYTES / (1024 * 1024)} MiB; it is not proposed for writing`,
    })
  }

  let bytes: Buffer
  try {
    bytes = await readFile(target.absolute)
  } catch (error) {
    if (codeOf(error) === "ENOENT") return ok(null)
    return err({ kind: "storage", path: target.relative, message: messageOf(error) })
  }

  if (bytes.subarray(0, Math.min(bytes.length, 8_000)).includes(0)) {
    return err({
      kind: "unsupported",
      path: target.relative,
      message: `"${target.relative}" is a binary file, so it cannot be diffed as text`,
    })
  }

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return err({
      kind: "unsupported",
      path: target.relative,
      message: `"${target.relative}" is not UTF-8 text, so it cannot be diffed`,
    })
  }

  return ok({ text, hash: hashBytes(bytes), bytes: bytes.length })
}

/* -------------------------------------------------------------------------- */
/* the proposal                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build a proposal for one file.
 *
 * `newContent === null` means delete; a file that does not exist with a non-null
 * `newContent` means create (`baseHash: null`). Anything else is an update. A
 * proposal for exactly the current bytes is refused as `unchanged` — there is
 * nothing for the user to approve.
 */
export async function proposeWrite(input: {
  root: string
  path: string
  newContent: string | null
}): Promise<Result<ProposedWrite, ProposeError>> {
  const target = await resolveWriteTarget(input.root, input.path)
  if (!target.ok) return target

  const current = await readCurrentFile(target.value)
  if (!current.ok) return current

  if (input.newContent === null && !current.value) {
    return err(
      missingError(input.path, `"${input.path}" does not exist, so there is nothing to delete`),
    )
  }
  if (input.newContent !== null && current.value && current.value.text === input.newContent) {
    return err({
      kind: "unchanged",
      path: target.value.relative,
      message: `"${target.value.relative}" already has this content; there is nothing to approve`,
    })
  }

  const baseText = current.value?.text ?? ""
  const nextText = input.newContent ?? ""
  const hunks = diffContent(baseText, nextText)

  return ok({
    path: target.value.relative,
    baseHash: current.value?.hash ?? null,
    newContent: input.newContent,
    diff: renderDiff(target.value.relative, hunks),
    hunks,
    stats: diffStats(hunks),
    kind: current.value === null ? "create" : input.newContent === null ? "delete" : "update",
  })
}
