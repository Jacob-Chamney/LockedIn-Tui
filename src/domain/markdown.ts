/**
 * Pure Markdown rules for the vault.
 *
 * This module owns frontmatter, wikilinks and the document split. It performs
 * no file IO, imports no UI and no provider code, and never silently repairs
 * malformed input: every failure is a typed `MarkdownError`.
 *
 * Design rules taken from `docs/data-model.md` §3 and `docs/architecture.md`
 * §4.2:
 * - unknown frontmatter keys survive a round-trip;
 * - a document is `frontmatter` (raw, possibly absent) plus `body` (verbatim);
 * - edits touch only the keys they own, so user formatting is not normalised.
 */

export type Side = "school" | "skills"

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export type MarkdownError =
  | { kind: "frontmatter-unterminated"; line: number; message: string }
  | { kind: "frontmatter-invalid"; line: number; message: string }
  | { kind: "frontmatter-duplicate-key"; line: number; key: string; message: string }
  | { kind: "frontmatter-missing"; path: string; message: string }
  | { kind: "cross-side-link"; from: Side; to: Side; target: string; message: string }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

// ------------------------------------------------------------------ values

export type Scalar = string | number | boolean | null
export type FrontmatterValue = Scalar | Scalar[] | { [key: string]: FrontmatterValue }
export type Frontmatter = { [key: string]: FrontmatterValue }

const KEY = /^([A-Za-z0-9_.-]+)\s*:(?:\s+(.*))?$/
const NUMERIC = /^-?\d+(?:\.\d+)?$/
const BOOLEANISH = /^(?:true|false|null|~|yes|no|on|off)$/i

function indentOf(line: string): number {
  let count = 0
  while (count < line.length && line[count] === " ") count++
  return count
}

function isSkippable(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === "" || trimmed.startsWith("#")
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === "string") return parsed
    } catch {
      return raw.slice(1, -1)
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'")
  }
  return raw
}

export function parseScalar(raw: string): Scalar {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return unquote(trimmed)
  if (trimmed === "null" || trimmed === "~") return null
  if (/^true$/i.test(trimmed)) return true
  if (/^false$/i.test(trimmed)) return false
  if (NUMERIC.test(trimmed)) return Number(trimmed)
  return trimmed
}

export function needsQuoting(value: string): boolean {
  if (value === "") return true
  if (value !== value.trim()) return true
  if (BOOLEANISH.test(value)) return true
  if (NUMERIC.test(value)) return true
  // Only syntax-significant characters force quotes. A plain `:` inside a
  // value (an ISO timestamp, a URL path) is legal YAML and must not be quoted,
  // or a one-field save would rewrite lines it does not own.
  if (/^[[\]{},&*!|>'"%@`]/.test(value)) return true
  if (/(^|\s)#/.test(value)) return true
  if (/:\s|:$/.test(value)) return true
  if (value.startsWith("- ") || value.startsWith("? ")) return true
  return false
}

/**
 * Serialize one `key: value` entry as frontmatter lines.
 * Order is preserved, so a round-trip is byte-stable for the same input.
 */
export function serializeEntry(key: string, value: FrontmatterValue): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}:`]
    return [`${key}:`, ...value.map((item) => `  - ${serializeScalar(item)}`)]
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
    if (entries.length === 0) return [`${key}:`]
    const children = entries.flatMap(([childKey, child]) => serializeEntry(childKey, child))
    return [`${key}:`, ...children.map((line) => `  ${line}`)]
  }
  return [`${key}: ${serializeScalar(value)}`]
}

function serializeScalar(value: Scalar): string {
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  return needsQuoting(value) ? JSON.stringify(value) : value
}

/** Canonical frontmatter block for a record. Keys keep their insertion order. */
export function serializeFrontmatter(data: Frontmatter): string {
  const lines: string[] = ["---"]
  for (const [key, value] of Object.entries(data)) lines.push(...serializeEntry(key, value))
  lines.push("---")
  return `${lines.join("\n")}\n`
}

// ------------------------------------------------------------------ document

export type Document = {
  /** Raw frontmatter block without the delimiters, or null when absent. */
  frontmatter: string | null
  /** Markdown body, byte-exact, including its leading newline if any. */
  body: string
  /** False only when the file starts with a `---` line that never closes. */
  closed: boolean
  /** The file's dominant line ending; serialising preserves it. */
  eol: "\n" | "\r\n"
}

/**
 * Split a document into frontmatter and body without interpreting anything.
 * `closed: false` is the unterminated-block case; callers must treat it as an
 * error rather than guessing where the body starts.
 */
export function splitDocument(text: string): Document {
  const eol: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n"
  const normalised = text.replace(/\r\n?/g, "\n")
  if (!normalised.startsWith("---\n") && normalised !== "---") {
    return { frontmatter: null, body: normalised, closed: true, eol }
  }
  const lines = normalised.split("\n")
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] === "---") {
      return {
        frontmatter: lines.slice(1, index).join("\n"),
        body: lines.slice(index + 1).join("\n"),
        closed: true,
        eol,
      }
    }
  }
  return { frontmatter: null, body: normalised, closed: false, eol }
}

function parseMap(
  lines: string[],
  start: number,
  indent: number,
  lineOffset: number,
): Result<[Frontmatter, number], MarkdownError> {
  const out: Frontmatter = {}
  let index = start

  while (index < lines.length) {
    const line = lines[index]!
    if (isSkippable(line)) {
      index++
      continue
    }
    const lineIndent = indentOf(line)
    if (lineIndent < indent) break
    if (lineIndent > indent) {
      return err({
        kind: "frontmatter-invalid",
        line: lineOffset + index + 1,
        message: `unexpected indentation in frontmatter: "${line.trim()}"`,
      })
    }

    const match = KEY.exec(line.trim())
    if (!match) {
      return err({
        kind: "frontmatter-invalid",
        line: lineOffset + index + 1,
        message: `frontmatter line is not "key: value": "${line.trim()}"`,
      })
    }
    const key = match[1]!
    const rest = (match[2] ?? "").trim()
    if (Object.hasOwn(out, key)) {
      return err({
        kind: "frontmatter-duplicate-key",
        line: lineOffset + index + 1,
        key,
        message: `duplicate frontmatter key "${key}"`,
      })
    }

    if (rest !== "") {
      out[key] = parseScalar(rest)
      index++
      continue
    }

    const next = lines[index + 1]
    if (next !== undefined && !isSkippable(next) && indentOf(next) > indent) {
      if (next.trimStart().startsWith("- ")) {
        const [items, nextIndex] = parseArray(lines, index + 1, indent + 2)
        out[key] = items
        index = nextIndex
      } else {
        const nested = parseMap(lines, index + 1, indent + 2, lineOffset)
        if (!nested.ok) return nested
        out[key] = nested.value[0]
        index = nested.value[1]
      }
    } else {
      out[key] = null
      index++
    }
  }

  return ok([out, index])
}

function parseArray(lines: string[], start: number, indent: number): [Scalar[], number] {
  const items: Scalar[] = []
  let index = start
  while (index < lines.length) {
    const line = lines[index]!
    if (isSkippable(line)) {
      index++
      continue
    }
    if (indentOf(line) < indent || !line.trimStart().startsWith("- ")) break
    items.push(parseScalar(line.trimStart().slice(2)))
    index++
  }
  return [items, index]
}

/**
 * Parse a frontmatter block body (without the `---` delimiters).
 * Unknown keys are kept verbatim as data; comments are dropped, because they
 * are not part of any value and this module never claims to own them.
 */
export function parseFrontmatter(raw: string): Result<Frontmatter, MarkdownError> {
  const lines = raw.split("\n")
  const parsed = parseMap(lines, 0, 0, 0)
  if (!parsed.ok) return parsed
  return ok(parsed.value[0])
}

export type ParsedNote = {
  data: Frontmatter
  body: string
  /** The document as read, so a caller can rewrite only what it owns. */
  raw: Document
}

/** Parse a whole document: frontmatter (optional) plus body. */
export function parseDocument(text: string): Result<ParsedNote, MarkdownError> {
  const document = splitDocument(text)
  if (!document.closed) {
    return err({
      kind: "frontmatter-unterminated",
      line: 1,
      message: "frontmatter opens with --- but never closes with ---",
    })
  }
  if (document.frontmatter === null) {
    return ok({ data: {}, body: document.body, raw: document })
  }
  const data = parseFrontmatter(document.frontmatter)
  if (!data.ok) return data
  return ok({ data: data.value, body: document.body, raw: document })
}

/** Rebuild a document from data and a verbatim body. */
export function serializeDocument(data: Frontmatter, body: string, eol: "\n" | "\r\n" = "\n"): string {
  const text = `${serializeFrontmatter(data)}${body}`
  return eol === "\n" ? text : text.replace(/\n/g, eol)
}

/**
 * Replace only the named top-level keys, leaving every other line byte-exact.
 * This is what keeps unknown keys and user formatting intact on a save that
 * owns one field.
 */
export function patchFrontmatter(
  text: string,
  patch: Frontmatter,
): Result<string, MarkdownError> {
  const document = splitDocument(text)
  if (!document.closed) {
    return err({
      kind: "frontmatter-unterminated",
      line: 1,
      message: "frontmatter opens with --- but never closes with ---",
    })
  }

  const keys = Object.keys(patch)
  if (document.frontmatter === null) {
    if (keys.length === 0) return ok(text)
    const block = keys.flatMap((key) => serializeEntry(key, patch[key]!))
    return ok(withEol(`---\n${block.join("\n")}\n---\n${document.body}`, document.eol))
  }

  const lines = document.frontmatter.split("\n")
  for (const key of keys) {
    const at = lines.findIndex((line) => {
      const match = KEY.exec(line)
      return indentOf(line) === 0 && match !== null && match[1] === key
    })
    const replacement = serializeEntry(key, patch[key]!)
    if (at === -1) {
      lines.push(...replacement)
      continue
    }
    let end = at + 1
    while (end < lines.length && lines[end] !== "" && indentOf(lines[end]!) > 0) end++
    lines.splice(at, end - at, ...replacement)
  }

  return ok(withEol(`---\n${lines.join("\n")}\n---\n${document.body}`, document.eol))
}

function withEol(text: string, eol: "\n" | "\r\n"): string {
  return eol === "\n" ? text : text.replace(/\n/g, eol)
}

// ------------------------------------------------------------------ wikilinks

export type Wikilink = {
  /** Link target as written, without alias or heading. */
  target: string
  heading: string | null
  alias: string | null
  /** Raw text between the brackets. */
  raw: string
  /** Index of the opening bracket in the body. */
  index: number
}

const WIKILINK = /\[\[([^\[\]\n]+)\]\]/g

/** True while the line opens or closes a fenced code block. */
function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line)
}

/**
 * Extract `[[target]]`, `[[target|alias]]` and `[[target#heading]]` links.
 * Links inside fenced code blocks are not links, so they are skipped.
 */
export function extractWikilinks(body: string): Wikilink[] {
  const links: Wikilink[] = []
  let fenced = false
  let offset = 0

  for (const line of body.split("\n")) {
    if (isFence(line)) {
      fenced = !fenced
      offset += line.length + 1
      continue
    }
    if (!fenced) {
      WIKILINK.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = WIKILINK.exec(line)) !== null) {
        const raw = match[1]!.trim()
        const [beforeAlias, ...aliasParts] = raw.split("|")
        const alias = aliasParts.length > 0 ? aliasParts.join("|").trim() : null
        const [targetPart, ...headingParts] = beforeAlias!.split("#")
        const target = targetPart!.trim()
        if (target === "") continue
        links.push({
          target,
          heading: headingParts.length > 0 ? headingParts.join("#").trim() : null,
          alias,
          raw,
          index: offset + match.index,
        })
      }
    }
    offset += line.length + 1
  }

  return links
}

/** Deterministic key for de-duplicating link references. */
export function wikilinkKey(link: Wikilink): string {
  return `${link.target}#${link.heading ?? ""}`
}

// ------------------------------------------------------------------ frontmatter helpers

export function readString(data: Frontmatter, key: string): string | null {
  const value = data[key]
  return typeof value === "string" ? value : null
}

export function readStringArray(data: Frontmatter, key: string): string[] {
  const value = data[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}
