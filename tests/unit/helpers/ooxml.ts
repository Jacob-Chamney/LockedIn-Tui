/**
 * Deterministic fixture generators for the extraction tests.
 *
 * Ported from the S7 spike (`spikes/s7-clipboard-pdf/build-fixtures.ts`), which
 * is throwaway code. Every byte derives from constants — no clock, no
 * randomness — so a regenerated fixture is identical and the expected text can
 * be asserted exactly instead of fuzzily.
 *
 * These live under `tests/unit/helpers/` rather than `tests/fixtures/` because
 * ZIP and PNG payloads need compression at build time; writing the generators
 * beside the tests keeps the committed tree free of opaque binaries.
 */

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`

const DOCX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

/**
 * A minimal valid `word/document.xml`.
 *
 * It exercises a bold run (styling must not become text), an `&amp;` entity and
 * a `<w:tab/>`, plus an empty paragraph.
 */
export function buildDocumentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>LockedIn source pipeline</w:t></w:r></w:p><w:p><w:r><w:t>Energy balance &amp; limits</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Step one</w:t></w:r><w:r><w:tab/><w:t>detail</w:t></w:r></w:p><w:p/></w:body></w:document>`
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate-raw")
  const writer = stream.writable.getWriter()
  void writer.write(new Uint8Array(data))
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

/**
 * Build a DOCX. `documentXml` is written to `word/document.xml`; pass `null` to
 * omit that part, which is the "zip that is not a DOCX" case.
 *
 * ZIP timestamps are pinned to 1980-01-01 so two builds are byte-identical.
 */
export async function buildZip(documentXml: string | null): Promise<Uint8Array> {
  const parts: Array<{ name: string; body: string }> = [
    { name: "[Content_Types].xml", body: DOCX_CONTENT_TYPES },
    { name: "_rels/.rels", body: DOCX_ROOT_RELS },
  ]
  if (documentXml !== null) parts.push({ name: "word/document.xml", body: documentXml })

  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = 0x0021

  for (const part of parts) {
    const name = encoder.encode(part.name)
    const body = encoder.encode(part.body)
    const packed = await deflateRaw(body)
    const crc = crc32(body)

    const local = new Uint8Array(30 + name.length + packed.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(8, 8, true)
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, packed.length, true)
    lv.setUint32(22, body.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(packed, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(10, 8, true)
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, packed.length, true)
    cv.setUint32(24, body.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const cdSize = centrals.reduce((total, item) => total + item.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, parts.length, true)
  ev.setUint16(10, parts.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + cdSize + eocd.length)
  let at = 0
  for (const chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function stream(content: string): string {
  return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
}

function textContent(lines: string[]): string {
  return [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    ...lines.map((line) => `(${line}) Tj 0 -20 Td`),
    "ET",
  ].join("\n")
}

/** Assemble a PDF 1.4 file with a correct xref table from object bodies. */
function assemble(objects: string[]): Uint8Array {
  const chunks: string[] = ["%PDF-1.4\n"]
  const offsets: number[] = []
  let cursor = chunks[0]!.length

  for (const [index, object] of objects.entries()) {
    offsets.push(cursor)
    const body = `${index + 1} 0 obj\n${object}\nendobj\n`
    chunks.push(body)
    cursor += body.length
  }

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`
  chunks.push(xref)
  return new TextEncoder().encode(chunks.join(""))
}

/**
 * A small PDF.
 *
 * - `buildPdf()` — two pages with a text layer;
 * - `buildPdf({ text: [] })` — one page with an empty content stream, which is
 *   the scanned-document case (`no-text`, never empty text).
 */
export function buildPdf(options: { text?: string[] } = {}): Uint8Array {
  if (options.text !== undefined && options.text.length === 0) {
    return assemble([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
      stream(""),
    ])
  }

  const pageOne = options.text ?? [
    "LockedIn source pipeline",
    "Boundary conditions decide the integral limits.",
    "Sources are copied at create time.",
  ]
  // A single-page PDF for an explicit text list: the caller supplied the lines.
  if (options.text !== undefined) {
    return assemble([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      stream(textContent(pageOne)),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ])
  }

  return assemble([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    stream(textContent(pageOne)),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream(textContent(["Page two: energy balance."])),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ])
}

/** A 1x1 truecolour PNG: enough to prove images are recognised and refused. */
export async function buildPng(): Promise<Uint8Array> {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBytes = new TextEncoder().encode(type)
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length, true)
    out.set(typeBytes, 4)
    out.set(data, 8)
    const crcInput = new Uint8Array(4 + data.length)
    crcInput.set(typeBytes, 0)
    crcInput.set(data, 4)
    view.setUint32(8 + data.length, crc32(crcInput), true)
    return out
  }

  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, 1, true)
  ihdrView.setUint32(4, 1, true)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rawPixels = new Uint8Array([0x00, 0xd6, 0x3f, 0x4b])
  const deflate = new CompressionStream("deflate")
  const writer = deflate.writable.getWriter()
  void writer.write(rawPixels)
  void writer.close()
  const idat = new Uint8Array(await new Response(deflate.readable).arrayBuffer())

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
