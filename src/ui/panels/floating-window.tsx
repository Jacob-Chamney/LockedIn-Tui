/**
 * The parent every windowed surface uses.
 *
 * A floating window is the frame: **Header**, body, **Footer**. Feature screens
 * supply the header copy, one named body region (a Session List, a Model List,
 * …) and the footer hints. The frame owns padding, the panel fill and the
 * pending/notice lines.
 */
import type { ThemePalette } from "../theme"
import { PanelBody, PanelFooter } from "./panel-frame"

/**
 * The fill every windowed surface shares.
 *
 * Settings, Models and the source picker used to paint their own background
 * token, which is why one window looked black while another used the panel.
 * They all start here now; only the contents differ.
 */
export function WindowSurface(props: {
  theme: ThemePalette
  width: number
  height: number
  direction?: "row" | "column"
  paddingX?: number
  children?: unknown
}) {
  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection={props.direction ?? "column"}
      backgroundColor={props.theme.surface}
      paddingX={props.paddingX ?? 0}
    >
      {(props.children ?? null) as never}
    </box>
  )
}

export function WindowHeader(props: {
  theme: ThemePalette
  title: string
  meta?: string
  detail?: string
  detailLines?: string[]
  detailWrap?: "word" | "none"
}) {
  const palette = () => props.theme
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={palette().foreground} wrapMode="none">
          {props.title.toUpperCase()}
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

export function WindowBody(props: { center?: boolean; children?: unknown }) {
  return <PanelBody center={props.center}>{props.children}</PanelBody>
}

export function WindowFooter(props: { theme: ThemePalette; hints: string[]; width?: number }) {
  return (
    <box
      flexShrink={0}
      marginTop={1}
      backgroundColor={props.theme.panel}
      paddingX={1}
    >
      <PanelFooter theme={props.theme} hints={props.hints} width={props.width} />
    </box>
  )
}

export function FloatingWindow(props: {
  theme: ThemePalette
  width: number
  height: number
  header?: unknown
  /** The named middle region: SessionList, ModelList, SettingsList, … */
  children?: unknown
  footer?: unknown
  pending?: string | null
  notice?: string | null
}) {
  const palette = () => props.theme
  return (
    <WindowSurface theme={palette()} width={props.width} height={props.height} paddingX={1}>
      {(props.header ?? null) as never}
      <box flexGrow={1} minHeight={0} flexDirection="column">
        {(props.children ?? null) as never}
      </box>
      {props.pending ? (
        <text fg={palette().error} wrapMode="none">
          {`! ${props.pending}`}
        </text>
      ) : null}
      {props.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.notice}`}
        </text>
      ) : null}
      {(props.footer ?? null) as never}
    </WindowSurface>
  )
}
