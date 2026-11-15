/**
 * Menus for app surfaces.
 *
 * The Solid counterpart of the SDK's `menuList()`: section rows, key/label/meta
 * columns and selection come from `src/ui/menu.ts`.
 */
import { menuLayout, menuRole, type MenuSection } from "../menu"
import type { ThemePalette } from "../theme"

export function MenuList(props: {
  theme: ThemePalette
  sections: readonly MenuSection[]
  width: number
  selectable?: boolean
  selected?: number
  marker?: string
  keyPrefix?: string
  keyWidth?: number
  gap?: number
  maxRows?: number
  keyFg?: keyof ThemePalette
  fg?: keyof ThemePalette
  headingFg?: keyof ThemePalette
  metaFg?: keyof ThemePalette
  separatorFg?: keyof ThemePalette
  disabledFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    menuLayout({
      sections: props.sections,
      width: props.width,
      ...(props.selectable === undefined ? {} : { selectable: props.selectable }),
      ...(props.selected === undefined ? {} : { selected: props.selected }),
      ...(props.marker === undefined ? {} : { marker: props.marker }),
      ...(props.keyPrefix === undefined ? {} : { keyPrefix: props.keyPrefix }),
      ...(props.keyWidth === undefined ? {} : { keyWidth: props.keyWidth }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.maxRows === undefined ? {} : { maxRows: props.maxRows }),
    })
  const ink = (kind: "marker" | "key" | "label" | "meta" | "heading" | "separator", row: ReturnType<typeof layout>["rows"][number]) =>
    kind === "heading"
      ? palette()[props.headingFg ?? "muted"]
      : kind === "separator"
        ? palette()[props.separatorFg ?? "line"]
        : kind === "key" || kind === "marker"
          ? palette()[props.keyFg ?? "secondary"]
          : kind === "meta"
            ? palette()[props.metaFg ?? "muted"]
            : row.disabled
              ? palette()[props.disabledFg ?? "muted"]
              : palette()[(row.tone === "normal" ? (props.fg ?? menuRole(row.tone)) : menuRole(row.tone)) as keyof ThemePalette]

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <box flexDirection="row" height={1}>
          {row.parts.map((part) => (
            <text fg={ink(part.kind, row)} wrapMode="none" width={part.width}>
              {part.text}
            </text>
          ))}
        </box>
      ))}
    </box>
  )
}
