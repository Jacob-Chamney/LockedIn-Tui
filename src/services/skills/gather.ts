/**
 * Source gathering for skill sessions.
 *
 * This is the only way material enters a goal: a local file, pasted text or a
 * fetched URL becomes a copied source with a hash, a retrieval time, an origin
 * label and a saved excerpt. Nothing here upgrades an unverified agent claim into
 * a source — agent prose belongs in a lesson as `(agent explanation)`.
 *
 * Extraction is WP-307's job; this module never adds a second extractor.
 */

import { mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import { basename, join, resolve } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { SOURCE_DIRECTORY, isInsideSources, storedPathFor } from "../../domain/source"
import { confinedJoin, isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"
import { extract, MAX_SOURCE_BYTES } from "../extract"
import { GOAL_META_FILE, type SkillLevel } from "./create"
import { buildExcerpt, normaliseWhitespace } from "./excerpt"
import type { Excerpt } from "../../domain/note"

export type SkillSourceKind = "markdown" | "text" | "code" | "pdf" | "docx" | "web"
export type SourceOrigin = "user" | "agent-gathered"

export type SkillSource = {
  name: string
  /** Relative to the goal folder, always inside `sources/`. */
  storedPath: string
  hash: string
  kind: SkillSourceKind
  /** When the material was retrieved or added; caller-supplied (no clock here). */
  retrievedAt: string
  origin: SourceOrigin
  excerpt: Excerpt | null
  /** True when the source cannot be cited: no excerpt, or extraction failed. */
  unusable: boolean
  reason: string | null
}

export type GatherError =
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }
  | { kind: "network"; message: string; next: string }
  | { kind: "storage"; path: string; message: string }
  | { kind: "unsupported"; name: string; detected: string; message: string }

export type GatherInput =
  | { kind: "file"; path: string; origin?: SourceOrigin }
  | { kind: "text"; name: string; text: string; origin?: SourceOrigin }
  | { kind: "url"; url: string; origin?: SourceOrigin }

export type GatherOptions = {
  workspace: Workspace
  goalId: string
  /** Defaults to 400, mirroring `ui.excerpt_chars`. */
  excerptChars?: number
  /** Caller supplies the clock; this module never reads one. */
  retrievedAt: string
  /** Injected so tests never touch the network. */
  fetchText?: (url: string) => Promise<string>
  /** Checked before each item: a batch cancel keeps what has been gathered. */
  cancelled?: () => boolean
  /** Called once per `meta.json` write, so a test can count writes. */
  onMetaWrite?: () => void
}

export type GatherOutcome = {
  sources: SkillSource[]
  added: number
  duplicates: number
  cancelled: boolean
  /** Duplicate names, so the caller can say which were skipped. */
  skipped: string[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function goalFolderFor(workspace: Workspace, goalId: string): string {
  return confinedJoin(workspace.paths.goals, goalId) ?? join(workspace.paths.goals, ".invalid-goal")
}

/** Very small HTML to text: enough for a readable excerpt, no dependency. */
export function htmlToText(html: string): string {
  return normaliseWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  )
}

function kindOfWeb(): SkillSourceKind {
  return "web"
}

/* -------------------------------------------------------------------------- */
/* web fetching                                                               */
/* -------------------------------------------------------------------------- */

/** How long one URL may take, redirects included. */
const FETCH_TIMEOUT_MS = 15_000
/** More hops than this is a loop or an ambush, not a source. */
const MAX_REDIRECTS = 5

/**
 * True for loopback, link-local, private and otherwise non-public addresses.
 *
 * A URL source is fetched by the app, not by a browser: without this, a URL
 * could reach the machine's own services (or the LAN) and copy their responses
 * into a goal as if they were study material. Anything that is not a literal
 * public unicast address is refused, including documentation and benchmark
 * ranges that should never answer in production.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b] = address.split(".").map(Number)
    if (a === undefined || b === undefined) return true
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (family === 6) {
    const lower = address.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped?.[1]) return isBlockedAddress(mapped[1])
    if (lower === "::" || lower === "::1") return true
    // IPv4-compatible form, e.g. "::127.0.0.1".
    const compatible = /^::(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (compatible?.[1]) return isBlockedAddress(compatible[1])
    const first = Number.parseInt(lower.split(":")[0] ?? "", 16)
    if (!Number.isFinite(first)) return true
    // Global unicast is 2000::/3. 2001:db8::/32 is documentation, 2001::/32 is
    // Teredo and 2002::/16 is 6to4 (it embeds an IPv4 address, often private).
    if (first < 0x2000 || first > 0x3fff) return true
    if (first === 0x2001) {
      const second = Number.parseInt(lower.split(":")[1] ?? "0", 16)
      if (second === 0x0db8 || second === 0x0000) return true
    }
    if (first === 0x2002) return true
    return false
  }
  // Not an IP at all: callers only pass resolved addresses, so refuse.
  return true
}

type PinnedAddress = { address: string; family: 4 | 6 }

/**
 * Resolve a host once and return the address the request must use. Checking and
 * then letting `fetch` resolve again is a DNS-rebinding hole: the second answer
 * can be a private address. Everything after this uses the pinned address.
 */
async function publicAddress(hostname: string): Promise<PinnedAddress> {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase()
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("the URL points at this machine, not the public web")
  }
  const literal = isIP(host)
  if (literal !== 0) {
    if (isBlockedAddress(host)) {
      throw new Error("the URL points at a private or local address")
    }
    return { address: host, family: literal === 6 ? 6 : 4 }
  }
  const records = await lookup(host, { all: true, verbatim: true })
  if (records.length === 0) throw new Error(`the host ${host} did not resolve`)
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new Error(`the host ${host} resolves to a private or local address`)
    }
  }
  const first = records.find((record) => record.family === 4) ?? records[0]!
  return { address: first.address, family: first.family === 6 ? 6 : 4 }
}

type PinnedResponse = { status: number; location: string | null; text: string }

/** Request one URL through a checked address, with no second DNS lookup. */
export async function requestPinned(
  url: string,
  pinned: PinnedAddress,
  deadline: number,
): Promise<PinnedResponse> {
  const parsed = new URL(url)
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(`the fetch took longer than ${FETCH_TIMEOUT_MS} ms`)
  const secure = parsed.protocol === "https:"
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "")
  const request = secure ? httpsRequest : httpRequest

  return await new Promise<PinnedResponse>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => req.destroy(new Error("the fetch timed out")), remaining)
    const requestOptions = {
      hostname,
      port: parsed.port === "" ? (secure ? 443 : 80) : Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      lookup: (_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options.all === true) callback(null, [{ address: pinned.address, family: pinned.family }])
        else callback(null, pinned.address, pinned.family)
      },
      ...(secure ? { servername: parsed.hostname.replace(/^\[|\]$/g, "") } : {}),
    }
    const req = request(requestOptions as never, (response) => {
      const status = response.statusCode ?? 0
      const rawLocation = response.headers.location
      const location = Array.isArray(rawLocation) ? (rawLocation[0] ?? null) : (rawLocation ?? null)
      const declared = Number(response.headers["content-length"] ?? "")
      if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
        response.resume()
        finish(() => reject(new Error(`the response is larger than the ${MAX_SOURCE_BYTES / 1024 / 1024} MB source cap`)))
        return
      }
      const chunks: Uint8Array[] = []
      let total = 0
      response.on("data", (chunk: Uint8Array) => {
        total += chunk.byteLength
        if (total > MAX_SOURCE_BYTES) {
          response.destroy()
          finish(() => reject(new Error(`the response is larger than the ${MAX_SOURCE_BYTES / 1024 / 1024} MB source cap`)))
          return
        }
        chunks.push(chunk)
      })
      response.on("error", (error) => finish(() => reject(error)))
      response.on("end", () => {
        const body = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          body.set(chunk, offset)
          offset += chunk.byteLength
        }
        finish(() => resolve({ status, location, text: new TextDecoder("utf-8").decode(body) }))
      })
    })
    req.setTimeout(remaining, () => req.destroy(new Error("the fetch timed out")))
    req.on("error", (error) => finish(() => reject(error)))
    req.on("close", () => clearTimeout(timer))
    req.end()
  })
}

/**
 * Fetch a web source with the browser conveniences removed: no credentials in
 * the URL, no redirects followed blindly, no private addresses, no unbounded
 * body. Redirects are followed by hand so each hop is checked again.
 */
export async function fetchWebText(url: string): Promise<string> {
  const deadline = Date.now() + FETCH_TIMEOUT_MS
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      throw new Error("not a valid URL")
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("only http and https sources are supported")
    }
    if (parsed.username !== "" || parsed.password !== "") {
      throw new Error("URLs may not carry credentials")
    }
    const pinned = await publicAddress(parsed.hostname)
    const response = await requestPinned(current, pinned, deadline)

    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error(`HTTP ${response.status} without a Location header`)
      current = new URL(response.location, current).toString()
      continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
    return response.text
  }
  throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`)
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  return `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
}

function isSourceEntry(value: unknown): value is SkillSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.name === "string" &&
    typeof row.storedPath === "string" &&
    typeof row.hash === "string" &&
    typeof row.kind === "string"
  )
}

async function readGoalMeta(
  folder: string,
): Promise<{ sources: SkillSource[]; meta: Record<string, unknown> }> {
  const parsed: unknown = JSON.parse(await readFile(join(folder, GOAL_META_FILE), "utf8"))
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("meta.json must contain a JSON object")
  }
  const meta = parsed as Record<string, unknown>
  if (meta.sources !== undefined && !Array.isArray(meta.sources)) {
    throw new Error("meta.json sources must be a list")
  }
  const entries = Array.isArray(meta.sources) ? meta.sources : []
  if (!entries.every(isSourceEntry)) {
    throw new Error("meta.json contains an invalid source entry")
  }
  return { sources: entries, meta }
}

async function writeGoalMeta(
  folder: string,
  meta: Record<string, unknown>,
  sources: readonly SkillSource[],
  onWrite?: () => void,
): Promise<void> {
  const target = join(folder, GOAL_META_FILE)
  const temporary = join(folder, `.${GOAL_META_FILE}.tmp-${crypto.randomUUID()}`)
  await Bun.write(temporary, `${JSON.stringify({ ...meta, sources }, null, 2)}\n`)
  await rename(temporary, target)
  onWrite?.()
}

/** Copy bytes into `sources/` under a content-addressed name. */
async function storeBytes(
  folder: string,
  name: string,
  bytes: Uint8Array,
): Promise<{ storedPath: string; hash: string }> {
  const hash = await hashBytes(bytes)
  const storedPath = storedPathFor(name, hash)
  const target = join(folder, storedPath)
  await mkdir(join(folder, SOURCE_DIRECTORY), { recursive: true })
  await Bun.write(target, bytes)
  return { storedPath, hash }
}

function sourceName(input: GatherInput): string {
  if (input.kind === "file") return basename(input.path)
  if (input.kind === "text") return input.name.endsWith(".md") ? input.name : `${input.name}.md`
  let host = ""
  try {
    host = new URL(input.url).hostname
  } catch {
    // The fetch reports an invalid URL; naming still has to produce a string.
  }
  const safe = host.replace(/[^a-z0-9.-]+/gi, "-").replace(/^[.-]+|[.-]+$/g, "")
  return `${safe === "" ? "web-source" : safe}.md`
}

type Prepared = {
  name: string
  bytes: Uint8Array
  kind: SkillSourceKind
  /** Text used for the excerpt; empty when extraction failed. */
  text: string
  failure: string | null
}

async function prepare(
  input: GatherInput,
  options: GatherOptions,
): Promise<Result<Prepared, GatherError>> {
  if (input.kind === "file") {
    const path = resolve(input.path)
    let actual = path
    try {
      actual = await realpath(path)
    } catch {
      // Missing files are reported below; the lexical path is still checked.
    }
    const school: string[] = []
    for (const root of [options.workspace.paths.schoolVault, options.workspace.paths.schoolSessions]) {
      try {
        school.push(await realpath(root))
      } catch {
        school.push(resolve(root))
      }
    }
    if (school.some((root) => isPathInside(root, actual))) {
      return err({
        kind: "path",
        path,
        reason: "escape",
        message: `${path} belongs to the school side; a skill session never reads it`,
      })
    }

    let bytes: Uint8Array
    try {
      // Refuse before allocating: the same cap extraction applies later.
      const info = await stat(path)
      if (!info.isFile()) {
        return err({
          kind: "unsupported",
          name: basename(path),
          detected: "not-a-file",
          message: `${basename(path)} is not a regular file, so it cannot become a source`,
        })
      }
      if (info.size > MAX_SOURCE_BYTES) {
        return err({
          kind: "unsupported",
          name: basename(path),
          detected: "large",
          message: `${basename(path)} is ${(info.size / 1024 / 1024).toFixed(0)} MB; the source cap is ${MAX_SOURCE_BYTES / 1024 / 1024} MB`,
        })
      }
      bytes = new Uint8Array(await readFile(path))
    } catch (error) {
      return err({ kind: "path", path, reason: "missing", message: messageOf(error) })
    }

    const extracted = await extract(path)
    if (!extracted.ok) {
      // The copy is kept and marked: a source the user can see, not a silence.
      return ok({
        name: basename(path),
        bytes,
        kind: "text",
        text: "",
        failure: extracted.error.message,
      })
    }
    return ok({
      name: basename(path),
      bytes,
      kind: extracted.kind as SkillSourceKind,
      text: extracted.text,
      failure: null,
    })
  }

  if (input.kind === "text") {
    const bytes = new TextEncoder().encode(input.text)
    return ok({ name: sourceName(input), bytes, kind: "markdown", text: input.text, failure: null })
  }

  const fetchText = options.fetchText ?? fetchWebText

  try {
    const html = await fetchText(input.url)
    const text = htmlToText(html)
    const bytes = new TextEncoder().encode(text)
    return ok({ name: sourceName(input), bytes, kind: kindOfWeb(), text, failure: null })
  } catch (error) {
    return err({
      kind: "network",
      message: `could not fetch ${input.url}: ${messageOf(error)}`,
      next: "Check the URL and the connection, then add it again — other sources are untouched.",
    })
  }
}

/**
 * Gather a batch of inputs into one goal.
 *
 * Order is preserved, duplicates by hash are a no-op, and `meta.json` is written
 * exactly once at the end — including when the batch is cancelled part-way, so
 * the kept sources are recorded and nothing is half-written.
 */
export async function gatherSources(
  options: GatherOptions,
  inputs: readonly GatherInput[],
): Promise<Result<GatherOutcome, GatherError>> {
  const folder = goalFolderFor(options.workspace, options.goalId)

  let existing: SkillSource[]
  let meta: Record<string, unknown>
  try {
    const loaded = await readGoalMeta(folder)
    existing = loaded.sources
    meta = loaded.meta
  } catch (error) {
    return err({ kind: "storage", path: join(folder, GOAL_META_FILE), message: messageOf(error) })
  }

  const hashes = new Set(existing.map((source) => source.hash))
  const gathered: SkillSource[] = []
  const skipped: string[] = []
  /** Files this batch wrote; removed if the batch cannot be recorded. */
  const written: string[] = []
  const discardWritten = async (): Promise<void> => {
    for (const path of written.splice(0)) {
      await rm(join(folder, path), { force: true }).catch(() => {})
    }
  }
  let cancelled = false

  for (const input of inputs) {
    if (options.cancelled?.() === true) {
      cancelled = true
      break
    }

    const prepared = await prepare(input, options)
    if (!prepared.ok) {
      // Nothing has been recorded yet, so a partial batch must not leave
      // untracked copies behind.
      await discardWritten()
      return prepared
    }

    const hash = await hashBytes(prepared.value.bytes)
    if (hashes.has(hash)) {
      skipped.push(prepared.value.name)
      continue
    }
    hashes.add(hash)

    let stored: { storedPath: string; hash: string }
    try {
      stored = await storeBytes(folder, prepared.value.name, prepared.value.bytes)
    } catch (error) {
      await discardWritten()
      return err({ kind: "storage", path: folder, message: messageOf(error) })
    }
    written.push(stored.storedPath)
    if (!isInsideSources(stored.storedPath)) {
      await discardWritten()
      return err({
        kind: "storage",
        path: stored.storedPath,
        message: "a stored source must stay inside sources/",
      })
    }

    const outcome = buildExcerpt({
      sourceName: prepared.value.name,
      location: stored.storedPath,
      text: prepared.value.text,
      chars: options.excerptChars,
    })

    const failure = prepared.value.failure
    const excerpt = outcome.ok && failure === null ? outcome.excerpt : null
    gathered.push({
      name: prepared.value.name,
      storedPath: stored.storedPath,
      hash,
      kind: prepared.value.kind,
      retrievedAt: options.retrievedAt,
      origin: ("origin" in input ? input.origin : undefined) ?? "user",
      excerpt,
      unusable: excerpt === null,
      reason: failure ?? (outcome.ok ? null : outcome.message),
    })
  }

  const sources = [...existing, ...gathered]
  try {
    await writeGoalMeta(folder, meta, sources, options.onMetaWrite)
  } catch (error) {
    // The whole shared sources/ folder is not ours to delete: remove only the
    // files this failed batch wrote, so earlier sources stay intact.
    await discardWritten()
    return err({ kind: "storage", path: folder, message: messageOf(error) })
  }

  return ok({
    sources,
    added: gathered.length,
    duplicates: skipped.length,
    cancelled,
    skipped,
  })
}

export type { Excerpt, SkillLevel }

