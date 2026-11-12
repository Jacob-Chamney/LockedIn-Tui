/**
 * The anatomy every windowed surface shares: header, body, pending/notice
 * lines, footer. A feature supplies its body and copy; it does not re-invent
 * the frame.
 */
import type { ThemePalette } from "../theme"
import { FloatingWindow, WindowFooter, WindowHeader } from "./floating-window"

export function PanelWindow(props: {
  theme: ThemePalette
  width: number
  height: number
  title: string
  meta?: string
  detail?: string
  detailLines?: string[]
  detailWrap?: "word" | "none"
  hints: string[]
  /** A destructive action waiting for its second key, already named. */
  pending?: string | null
  /** One line after a refused or completed action. */
  notice?: string | null
  children?: unknown
}) {
  const palette = () => props.theme
  return (
    <FloatingWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      header={
        <WindowHeader
          theme={palette()}
          title={props.title}
          meta={props.meta}
          detail={props.detail}
          detailLines={props.detailLines}
          detailWrap={props.detailWrap}
        />
      }
      footer={<WindowFooter theme={palette()} hints={props.hints} width={props.width} />}
      pending={props.pending}
      notice={props.notice}
    >
      {props.children}
    </FloatingWindow>
  )
}
