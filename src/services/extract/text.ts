/**
 * Text decoding and hashing for source extraction.
 *
 * One normalisation rule for every text-bearing kind, so two extractions of the
 * same file are byte-identical and the hash means one thing.
 */

export type ExtractableTextKind = "markdown" | "text" | "code"

export function hashOf(bytes: Uint8Array): string {
  return `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
}

/** BOM dropped, CRLF/CR to LF, trailing newlines trimmed. Nothing else. */
export function normaliseText(raw: string): string {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return withoutBom.replace(/\r\n?/g, "\n").replace(/\n+$/, "")
}
