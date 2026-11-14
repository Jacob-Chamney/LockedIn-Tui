/**
 * The one floating window.
 *
 * Leader, help, prompt, choice and command all draw the same thing: a bordered
 * panel with a title, an optional note, a body and a footer. Only the placement
 * differs — the leader sits over the bottom-right corner, the rest are centred —
 * so placement is the one thing this frame varies.
 */
import { createSignal, onCleanup, onMount } from "solid-js"

import { transition } from "../../../sdk"
import { reducedMotion } from "../chat/pulse"
import type { ThemePalette } from "../theme"

export type ModalPlacement = "center" | "bottom-right"

/**
 * Fade the backdrop rather than letting it pop.
 *
 * Only the dimming layer animates. The window itself stays opaque: fading the
 * frame would make its fill translucent and let the screen underneath read
 * through the copy.
 */
function useBackdropFade(duration = 0.16) {
  const [opacity, setOpacity] = createSignal(0)
  onMount(() => {
    if (reducedMotion()) {
      setOpacity(1)
      return
    }
    const started = Date.now()
    const timer = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000
      const next = transition(elapsed, { enter: duration, hold: 0, exit: 0 })
      setOpacity(next)
      if (next >= 1) clearInterval(timer)
    }, 16)
    onCleanup(() => clearInterval(timer))
  })
  return opacity
}

export function ModalFrame(props: {
  theme: ThemePalette
  /** Screen size, for the backdrop and the corner placement. */
  width: number
  height: number
  boxWidth: number
  boxHeight: number
  placement?: ModalPlacement
  /** The leader sits over the live screen; the others dim it. */
  backdrop?: boolean
  title?: string
  meta?: string
  /** A line under the title, e.g. what the surface is for. */
  hint?: string
  /** A custom first row, for the command palette's inline prompt. */
  header?: unknown
  footer?: string
  /** Warning footers name a refusal; everything else is muted. */
  footerTone?: "muted" | "warning"
  children?: unknown
}) {
  const palette = () => props.theme
  const placement = () => props.placement ?? "center"
  const backdropFade = useBackdropFade()
  const fit = (text: string) => {
    const max = Math.max(0, props.boxWidth - 4)
    return text.length <= max ? text : max <= 1 ? "…" : `${text.slice(0, max - 1)}…`
  }

  const frame = (
    <box
      width={props.boxWidth}
      height={props.boxHeight}
      flexDirection="column"
      backgroundColor={palette().surface}
      paddingX={2}
      paddingTop={1}
    >
      {props.header !== undefined ? (
        <box flexShrink={0} flexDirection="column">
          {(props.header as never)}
        </box>
      ) : (
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text fg={palette().foreground} wrapMode="none">
            {props.title ?? ""}
          </text>
          {props.meta ? (
            <text fg={palette().muted} wrapMode="none">
              {props.meta}
            </text>
          ) : null}
        </box>
      )}
      {props.hint ? (
        <text fg={palette().muted} wrapMode="none" flexShrink={0}>
          {fit(props.hint)}
        </text>
      ) : null}
      {(props.children ?? null) as never}
      {props.footer ? (
        <box flexShrink={0} marginTop={1} backgroundColor={palette().panel} paddingX={1}>
          <text fg={props.footerTone === "warning" ? palette().warning : palette().muted} wrapMode="none">
            {fit(props.footer)}
          </text>
        </box>
      ) : null}
    </box>
  )

  if (placement() === "bottom-right") {
    return (
      <box
        position="absolute"
        left={Math.max(0, props.width - props.boxWidth - 2)}
        top={Math.max(2, props.height - props.boxHeight - 4)}
      >
        {frame}
      </box>
    )
  }

  return (
    <>
      {props.backdrop === false ? null : (
        <box
          position="absolute"
          top={0}
          left={0}
          width={props.width}
          height={props.height}
          backgroundColor={palette().background}
          opacity={0.6 * backdropFade()}
        />
      )}
      <box
        position="absolute"
        top={0}
        left={0}
        width={props.width}
        height={props.height}
        flexDirection="row"
        justifyContent="center"
        alignItems="center"
      >
        {frame}
      </box>
    </>
  )
}
