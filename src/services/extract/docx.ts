/**
 * DOCX body XML to plain text.
 *
 * Paragraphs, tabs, breaks and XML entities only: styling is not content, and
 * tables, headers, footers and embedded objects are out of scope for a source
 * bundle (documented in the spike README).
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

export function docxToText(xml: string): string {
  const body = xml
    .replace(/\r\n?/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<w:cr\/>/g, "\n")
    .replace(/<w:p\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")

  const unescaped = body.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole: string, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[entity] ?? whole
    },
  )

  return unescaped
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
}
