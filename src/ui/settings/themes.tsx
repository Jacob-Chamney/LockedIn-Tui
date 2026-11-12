/**
 * The theme picker.
 *
 * The previous LockedIn's `lockedin-themes.png` is the reference: a bordered list
 * of palettes, each row a block of colour swatches (page, accent, secondary)
 * followed by its name, `j/k` to move, `Enter` to apply, `Esc` to cancel. The
 * palette catalogue already exists in `src/ui/theme`; this is the surface.
 */
import { paletteChoices, palettes, resolveTheme, type ThemeId, type ThemePalette } from "../theme"
import { WindowBody } from "../panels/floating-window"
import { PanelEmpty } from "../panels/panel-frame"
import { PanelWindow } from "../panels/panel-window"
import { SelectableRow, selectionMark } from "../panels/select-list"

export type ThemesState = { cursor: number }

export const initialThemesState: ThemesState = { cursor: 0 }

export function themeEntries(): Array<{ id: ThemeId; label: string; palette: ThemePalette }> {
  return paletteChoices().map(({ id, label }) => ({
    id,
    label,
    palette: palettes[id]?.palette ?? resolveTheme(id).palette,
  }))
}

export function moveTheme(cursor: number, delta: number, count: number): number {
  if (count === 0) return 0
  return Math.max(0, Math.min(count - 1, cursor + delta))
}

/** Three cells is enough to recognise a palette at a glance. */
export function swatch(palette: ThemePalette): Array<{ glyph: string; fg: string }> {
  return [
    { glyph: "██", fg: palette.background },
    { glyph: "██", fg: palette.primary },
    { glyph: "██", fg: palette.secondary },
  ]
}

/** The named middle region of the Theme window. */
export function ThemeList(props: {
  theme: ThemePalette
  height: number
  current: ThemeId
  state: ThemesState
}) {
  const palette = () => props.theme
  const entries = () => themeEntries()
  const pageSize = () => Math.max(4, props.height - 5)
  const windowStart = () =>
    Math.max(0, Math.min(entries().length - pageSize(), props.state.cursor - Math.floor(pageSize() / 2)))
  const visible = () => entries().slice(windowStart(), windowStart() + pageSize())

  if (entries().length === 0) {
    return (
      <WindowBody center>
        <PanelEmpty theme={palette()} line="no palettes available" />
      </WindowBody>
    )
  }

  return (
    <WindowBody>
      {visible().map((entry, offset) => {
        const index = windowStart() + offset
        const selected = index === props.state.cursor
        const applied = entry.id === props.current
        const mark = selectionMark(palette(), selected)
        return (
          <SelectableRow theme={palette()} selected={selected}>
            <text fg={palette().primary} wrapMode="none">
              {mark.bar}
            </text>
            {swatch(entry.palette).map((cell) => (
              <text fg={cell.fg} wrapMode="none">
                {`${cell.glyph} `}
              </text>
            ))}
            <text fg={palette().foreground} wrapMode="none">
              {selected ? <b>{entry.label}</b> : entry.label}
            </text>
            {applied ? (
              <text fg={palette().muted} wrapMode="none">
                {"  ✓"}
              </text>
            ) : null}
          </SelectableRow>
        )
      })}
    </WindowBody>
  )
}

export function ThemesPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  current: ThemeId
  state: ThemesState
}) {
  const palette = () => props.theme
  return (
    <PanelWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      title="Theme"
      meta={`${themeEntries().length} palettes`}
      detail="Every surface follows the chosen palette. Enter applies it now and saves it."
      hints={["j/k move", "Enter apply", "Esc back"]}
    >
      <ThemeList theme={palette()} height={props.height} current={props.current} state={props.state} />
    </PanelWindow>
  )
}
