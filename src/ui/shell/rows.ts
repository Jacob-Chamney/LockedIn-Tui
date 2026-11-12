/**
 * List content as text blocks.
 *
 * The headless reconciler cannot create new renderables from a signal write made
 * outside a component (it throws "No renderer found"), so panes render their
 * rows as one text block whose content and colour change in place. When the
 * renderer's list path is fixed upstream this can go back to per-row nodes.
 */
import { bindingLabel, type GeneratedRow } from "../keymap/registry"

export function block(rows: string[]): string {
  return rows.join("\n")
}

export function hintLine(rows: GeneratedRow[], max: number): string {
  const parts: string[] = []
  for (const row of rows) {
    const candidate = [...parts, `${row.keys} ${row.label}`].join(" · ")
    if (candidate.length > max) break
    parts.push(`${row.keys} ${row.label}`)
  }
  return parts.join(" · ")
}

export function overlayBlock(rows: GeneratedRow[], width: number): string[] {
  return rows.map((row) => {
    const text = `${row.keys}  ${row.label}`
    return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
  })
}

export { bindingLabel }
