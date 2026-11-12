/**
 * Minimal ZIP reader for DOCX extraction.
 *
 * Question this answers: can we read a `.docx` without adding a dependency?
 * Bun ships `DecompressionStream("deflate-raw")`, so the whole reader is
 * central-directory parsing plus one inflate call. No dependency, no bundle
 * cost, no native module.
 *
 * Scope: stored (0) and deflated (8) entries, no zip64, no encryption. A DOCX
 * produced by Word/LibreOffice/Pages always fits. Anything else is a typed
 * error, never a partial read.
 */

export type ZipEntry = {
  name: string
  method: 0 | 8
  compressedSize: number
  uncompressedSize: number
  crc32: number
  /** Offset of the entry payload inside the archive. */
  dataOffset: number
}

/** One inflated entry above this is refused before inflating it. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024

export class ZipError extends Error {
  readonly kind = "zip" as const

  constructor(message: string) {
    super(message)
    this.name = "ZipError"
  }
}

const EOCD_SIG = 0x06054b50
const CDIR_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8)
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
  )
}

/** Locate the End Of Central Directory record, scanning backwards over a comment. */
function findEocd(bytes: Uint8Array): number {
  if (bytes.length < EOCD_MIN) {
    throw new ZipError(`not a zip archive: ${bytes.length} bytes is shorter than an empty archive`)
  }
  const lowest = Math.max(0, bytes.length - EOCD_MIN - MAX_COMMENT)
  for (let at = bytes.length - EOCD_MIN; at >= lowest; at--) {
    if (u32(bytes, at) === EOCD_SIG) return at
  }
  throw new ZipError("not a zip archive: no end-of-central-directory record")
}

/** Read the archive directory. Does not inflate anything yet. */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const eocd = findEocd(bytes)
  const total = u16(bytes, eocd + 10)
  const cdSize = u32(bytes, eocd + 12)
  const cdOffset = u32(bytes, eocd + 16)
  if (cdOffset + cdSize > bytes.length) {
    throw new ZipError("corrupt zip: central directory points outside the archive")
  }

  const entries: ZipEntry[] = []
  let at = cdOffset
  for (let index = 0; index < total; index++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== CDIR_SIG) {
      throw new ZipError(`corrupt zip: bad central directory entry ${index}`)
    }
    const method = u16(bytes, at + 10)
    const crc32 = u32(bytes, at + 16)
    const compressedSize = u32(bytes, at + 20)
    const uncompressedSize = u32(bytes, at + 24)
    const nameLen = u16(bytes, at + 28)
    const extraLen = u16(bytes, at + 30)
    const commentLen = u16(bytes, at + 32)
    const localOffset = u32(bytes, at + 42)
    const name = new TextDecoder("utf-8").decode(bytes.subarray(at + 46, at + 46 + nameLen))

    if (method !== 0 && method !== 8) {
      throw new ZipError(`unsupported zip compression method ${method} for "${name}"`)
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ZipError(`zip64 archives are not supported (entry "${name}")`)
    }
    if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== LOCAL_SIG) {
      throw new ZipError(`corrupt zip: bad local header for "${name}"`)
    }
    const localNameLen = u16(bytes, localOffset + 26)
    const localExtraLen = u16(bytes, localOffset + 28)
    entries.push({
      name,
      method: method as 0 | 8,
      compressedSize,
      uncompressedSize,
      crc32,
      dataOffset: localOffset + 30 + localNameLen + localExtraLen,
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw")
  const writer = stream.writable.getWriter()
  // Copy into a fresh buffer: `write` needs an ArrayBuffer-backed view.
  void writer.write(new Uint8Array(data)).catch(() => {})
  void writer.close().catch(() => {})
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      // The declared size is attacker-controlled, so the real output is
      // bounded too: a small entry may not inflate without limit.
      if (total > cap) {
        await reader.cancel().catch(() => {})
        throw new ZipError(`entry inflates past the ${cap}-byte cap`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index++) {
    crc ^= bytes[index]!
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Inflate one entry and verify its size and CRC. */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  cap = MAX_ENTRY_BYTES,
): Promise<Uint8Array> {
  if (entry.uncompressedSize > cap) {
    throw new ZipError(
      `"${entry.name}" declares ${entry.uncompressedSize} bytes; the cap is ${cap}`,
    )
  }
  const payload = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
  const data = entry.method === 0 ? payload : await inflateRaw(payload, cap)
  if (data.length !== entry.uncompressedSize) {
    throw new ZipError(
      `corrupt zip: "${entry.name}" inflated to ${data.length} bytes, expected ${entry.uncompressedSize}`,
    )
  }
  if (crc32(data) !== entry.crc32) {
    throw new ZipError(`corrupt zip: "${entry.name}" failed the CRC check`)
  }
  return data
}

/** Read a named UTF-8 entry, or return null when the archive does not contain it. */
export async function readZipText(bytes: Uint8Array, name: string): Promise<string | null> {
  const entry = readZipDirectory(bytes).find((item) => item.name === name)
  if (!entry) return null
  return new TextDecoder("utf-8", { fatal: true }).decode(await readZipEntry(bytes, entry))
}
