/**
 * The parts every pane shares.
 *
 * Panes used to each invent a heading, a hint line and an empty state, which is
 * why they read as printouts: a title, one line of copy, a stray footer, then a
 * large blank column. These three pieces give every surface the same anatomy —
 * a `▌ TITLE` header strip with its metadata on the right, a body that fills the
 * column (centring its empty state), and a footer pinned to the bottom — so a
 * pane only has to say what is different about it.
 */
import type { ThemePalette } from "../theme"

export function PanelHeader(props: {
  theme: ThemePalette
  title: string
  /** Right-aligned metadata: counts, sort order, scope. */
  meta?: string
  /** A line under the header: what this surface is for. */
  detail?: string
  /** Several fixed lines instead of one wrapping detail. */
  detailLines?: string[]
  /** Long status lines can be clipped instead of wrapped. */
  detailWrap?: "word" | "none"
}) {
  const palette = () => props.theme
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={palette().primary} wrapMode="none">
          <b>{`▌ ${props.title.toUpperCase()}`}</b>
        </text>
        {props.meta ? (
          <text fg={palette().muted} wrapMode="none">
            {props.meta}
          </text>
        ) : null}
      </box>
      {props.detailLines
        ? props.detailLines.map((line) => (
            <text fg={palette().muted} wrapMode="none">
              {line}
            </text>
          ))
        : props.detail
          ? (
              <text fg={palette().muted} wrapMode={props.detailWrap ?? "word"}>
                {props.detail}
              </text>
            )
          : null}
    </box>
  )
}

export function PanelBody(props: { children?: unknown; center?: boolean }) {
  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      justifyContent={props.center ? "center" : "flex-start"}
      alignItems={props.center ? "center" : "flex-start"}
    >
      {(props.children ?? null) as never}
    </box>
  )
}

/**
 * The empty state: a sentence, then the key that creates the first item.
 * Never a fragment and never colour alone — the hint is primary text.
 */
export function PanelEmpty(props: { theme: ThemePalette; line: string; hint?: string; width?: number }) {
  const palette = () => props.theme
  return (
    <box flexDirection="column" alignItems="center">
      <text fg={palette().muted} wrapMode="word">
        {props.line}
      </text>
      {props.hint ? (
        <text fg={palette().primary} wrapMode="none">
          {props.hint}
        </text>
      ) : null}
    </box>
  )
}

/**
 * Footer hints, pinned to the bottom of the pane.
 *
 * A popup is narrower than the page, so the line is fitted to the space it
 * actually has: truncating with an ellipsis beats a hint sliced by the border.
 */
export function PanelFooter(props: { theme: ThemePalette; hints: string[]; width?: number }) {
  const palette = () => props.theme
  if (props.hints.length === 0) return null
  const line = () => {
    const text = props.hints.join(" · ")
    // The pane pads by one cell on each side, so the footer has two less.
    const max = props.width === undefined ? undefined : Math.max(0, props.width - 2)
    if (!max || max <= 0 || text.length <= max) return text
    return max === 1 ? "…" : `${text.slice(0, max - 1)}…`
  }
  return (
    <box flexShrink={0} marginTop={0}>
      <text fg={palette().muted} wrapMode="none">
        {line()}
      </text>
    </box>
  )
}

