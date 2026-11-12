/**
 * Redaction at the log boundary (`docs/architecture.md` §9).
 *
 * A secret may leave this process only as the value the user asked for. It must
 * never reach a log line, an error message, an activity record, a fixture or an
 * archive index.
 *
 * Usage at every boundary:
 *
 *   const redactor = createRedactor()
 *   redactor.add(secret)
 *   logger.info(redactor.redact(`link failed for ${secret}`))
 */
export const REDACTED = "«redacted»"

/**
 * Values shorter than this are not indexed: replacing every `a` in a log line
 * would destroy the diagnostics that make an error actionable. Keychain values
 * are keys and tokens, which are far longer.
 */
export const MIN_REDACTABLE_LENGTH = 4

export type Redactor = {
  /** Register a value that must never appear in output. Returns the count. */
  add(secret: string | null | undefined): number
  /** Replace every registered value with `REDACTED`. */
  redact(text: string): string
  /** Redact one error into a single loggable line (no stack, no body). */
  redactError(error: unknown): string
  /** Redact every string value in a record, recursively. */
  redactRecord<T>(record: T): T
  /** Number of registered values; never the values themselves. */
  size(): number
}

export function createRedactor(): Redactor {
  const values = new Set<string>()

  const add = (secret: string | null | undefined): number => {
    if (typeof secret !== "string") return values.size
    if (secret.length < MIN_REDACTABLE_LENGTH) return values.size
    values.add(secret)
    return values.size
  }

  const redact = (text: string): string => {
    if (values.size === 0) return text
    // Longest first so a token that contains another token is fully replaced.
    let out = text
    for (const value of [...values].sort((a, b) => b.length - a.length)) {
      out = out.split(value).join(REDACTED)
    }
    return out
  }

  const redactError = (error: unknown): string => {
    const raw =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : typeof error === "string"
          ? error
          : safeJson(error)
    return redact(raw.split("\n")[0]!.slice(0, 300))
  }

  const redactRecord = <T>(record: T): T => {
    const walk = (value: unknown): unknown => {
      if (typeof value === "string") return redact(value)
      if (Array.isArray(value)) return value.map(walk)
      if (value && typeof value === "object") {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v)
        return out
      }
      return value
    }
    return walk(record) as T
  }

  return {
    add,
    redact,
    redactError,
    redactRecord,
    size: () => values.size,
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Guard for tests and for the config writer: returns every secret found in a
 * blob of text. An empty array is the only acceptable result for a config file,
 * a log line, an archive index or a fixture.
 */
export function findSecretLeaks(text: string, secrets: readonly string[]): string[] {
  return secrets.filter((secret) => secret.length >= MIN_REDACTABLE_LENGTH && text.includes(secret))
}

/** Convenience for the error boundary: a typed error, redacted, one line. */
export function redactSecretError(error: { kind: string; message: string }, redactor: Redactor): string {
  return redactor.redact(`${error.kind}: ${error.message}`)
}
