/**
 * The two-column surface Settings and Models share.
 *
 * A header, a list column with an optional subtitle, a detail column, a notice
 * line and a fitted footer. The columns collapse to one on narrow terminals.
 * Feature screens supply rows and copy; they do not own padding or colour.
 */
import type { ThemePalette } from "../theme"
import { WindowFooter, WindowSurface } from "./floating-window"

export type SurfaceDetail = {
  title: string
  /** A short qualifier under the title (key required, chat completions). */
  meta?: string
  body?: string
  footer?: string
  extra?: string[]
}

export function TwoColumnSurface(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  title: string
  /** A count or context line under the title. */
  meta?: string
  children?: unknown
  detail?: SurfaceDetail
  notice?: string | null
  hints: string[]
}) {
  const palette = () => props.theme
  const withDetail = () => props.width >= 76 && props.detail !== undefined
  const listWidth = () => (withDetail() ? Math.max(40, Math.floor(props.width * 0.52)) : props.width)

  return (
    <WindowSurface theme={palette()} width={props.width} height={props.height} direction="row">
      <box width={listWidth()} height={props.height} flexShrink={0} flexDirection="column" paddingX={1}>
        <box flexShrink={0} flexDirection="column">
          <text fg={palette().foreground} wrapMode="none">
            {props.title.toUpperCase()}
          </text>
          {props.meta ? (
            <text fg={palette().secondary} wrapMode="none">
              {props.meta}
            </text>
          ) : null}
        </box>

        <box flexGrow={1} minHeight={0} flexDirection="column">
          {(props.children ?? null) as never}
          {props.notice ? (
            <text fg={palette().warning} wrapMode="none">
              {`! ${props.notice}`}
            </text>
          ) : null}
        </box>

        <WindowFooter theme={palette()} hints={props.hints} width={listWidth()} />
      </box>

      {withDetail() ? (
        <box width={props.width - listWidth()} height={props.height} flexDirection="column" paddingX={1}>
          <text fg={palette().foreground} wrapMode="word">
            {props.detail!.title}
          </text>
          {props.detail!.meta ? (
            <text fg={palette().secondary} wrapMode="none">
              {props.detail!.meta}
            </text>
          ) : null}
          {props.detail!.body ? (
            <text fg={palette().foreground} wrapMode="word">
              {props.detail!.body}
            </text>
          ) : null}
          {props.detail!.footer ? (
            <text fg={palette().secondary} wrapMode="word">
              {props.detail!.footer}
            </text>
          ) : null}
          {(props.detail!.extra ?? []).map((line) => (
            <text fg={palette().secondary} wrapMode="word">
              {line}
            </text>
          ))}
        </box>
      ) : null}
    </WindowSurface>
  )
}
