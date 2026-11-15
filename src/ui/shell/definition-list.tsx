/**
 * Definition lists for app surfaces.
 *
 * The Solid counterpart of the SDK's `definitionList()`: the term column,
 * wrapping and tone roles come from `src/ui/definition-list.ts`.
 */
import { definitionListLayout, definitionRole, type DefinitionItem } from "../definition-list"
import type { ThemePalette } from "../theme"

export function DefinitionList(props: {
  theme: ThemePalette
  items: readonly DefinitionItem[]
  width: number
  termWidth?: number
  gap?: number
  maxLines?: number
  termFg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    definitionListLayout({
      items: props.items,
      width: props.width,
      ...(props.termWidth === undefined ? {} : { termWidth: props.termWidth }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.maxLines === undefined ? {} : { maxLines: props.maxLines }),
    })

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <box flexDirection="column" flexShrink={0}>
          <box flexDirection="row" height={1}>
            <text fg={palette()[props.termFg ?? "muted"]} wrapMode="none" width={layout().termWidth}>
              {row.term}
            </text>
            <text wrapMode="none">{" ".repeat(layout().gap)}</text>
            <text
              fg={palette()[(row.tone === "normal" ? props.fg : undefined) ?? (definitionRole(row.tone) as keyof ThemePalette)]}
              wrapMode="none"
            >
              {row.lines[0] ?? ""}
            </text>
          </box>
          {row.lines.slice(1).map((line) => (
            <box flexDirection="row" height={1}>
              <text wrapMode="none">{" ".repeat(layout().termWidth + layout().gap)}</text>
              <text
                fg={palette()[(row.tone === "normal" ? props.fg : undefined) ?? (definitionRole(row.tone) as keyof ThemePalette)]}
                wrapMode="none"
              >
                {line}
              </text>
            </box>
          ))}
        </box>
      ))}
    </box>
  )
}
