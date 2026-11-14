/**
 * Accordion section rows.
 *
 * One implementation serves the plugin SDK (`accordion()` places scene nodes)
 * and the app's Settings page. A section is a header with a caret; its items
 * follow only while the section is expanded. Collapsed ids hide their items and
 * turn `▾` into `▸`.
 */
export type AccordionItem = {
  id: string
  label: string
}

export type AccordionSection = {
  id: string
  title: string
  items: readonly AccordionItem[]
  /** Optional trailing text, e.g. a row count. */
  meta?: string
}

export type AccordionHeaderRow = {
  kind: "header"
  id: string
  sectionId: string
  title: string
  meta?: string
  expanded: boolean
  caret: string
  index: number
}

export type AccordionItemRow = {
  kind: "item"
  id: string
  sectionId: string
  sectionTitle: string
  label: string
  index: number
  itemIndex: number
}

export type AccordionRow = AccordionHeaderRow | AccordionItemRow

export type AccordionGlyphs = {
  expanded: string
  collapsed: string
}

export const ACCORDION_GLYPHS: Readonly<AccordionGlyphs> = {
  expanded: "▾",
  collapsed: "▸",
}

export type AccordionOptions = {
  sections: readonly AccordionSection[]
  /** Ids whose items are hidden. */
  collapsed?: readonly string[]
  /** Draw a caret on every header; defaults true. */
  carets?: boolean
  glyphs?: Partial<AccordionGlyphs>
}

export function accordionRows(options: AccordionOptions): AccordionRow[] {
  const closed = new Set(options.collapsed ?? [])
  const glyphs = { ...ACCORDION_GLYPHS, ...options.glyphs }
  const carets = options.carets !== false
  const out: AccordionRow[] = []

  for (const section of options.sections) {
    const expanded = !closed.has(section.id)
    out.push({
      kind: "header",
      id: `header:${section.id}`,
      sectionId: section.id,
      title: section.title,
      ...(section.meta === undefined ? {} : { meta: section.meta }),
      expanded,
      caret: carets ? (expanded ? glyphs.expanded : glyphs.collapsed) : "",
      index: out.length,
    })
    if (!expanded) continue
    for (const [itemIndex, item] of section.items.entries()) {
      out.push({
        kind: "item",
        id: item.id,
        sectionId: section.id,
        sectionTitle: section.title,
        label: item.label,
        index: out.length,
        itemIndex,
      })
    }
  }
  return out
}
