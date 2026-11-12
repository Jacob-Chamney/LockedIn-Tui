/**
 * Messages, the way an editor shows them.
 *
 * A notice floats in the top-right for ten seconds and fades out in its last
 * second. It never takes focus, never blocks the keyboard and never grows into a
 * dialog: errors and confirmations you should read and can ignore.
 *
 * Each notice is its own rounded bubble so an error reads as one object, not a
 * row in a shared panel.
 */
import type { ThemePalette } from "../theme"
import { Bubble, useAfterFirstFrame, useCellSize } from "../chat/bubble"

export type NoticeLevel = "info" | "warn" | "error"

export type Notice = {
  id: string
  text: string
  level: NoticeLevel
  /** Epoch ms when it appeared. */
  at: number
}

/** How long a notice lives, and how long its fade lasts. */
export const NOTICE_MS = 10_000
export const NOTICE_FADE_MS = 1_000

/** Widest a bubble grows before the text wraps. */
export const NOTICE_MAX_WIDTH = 52
/** Narrowest a bubble grows; shorter messages stay compact. */
export const NOTICE_MIN_WIDTH = 20

export function pruneNotices(notices: Notice[], now: number): Notice[] {
  return notices.filter((notice) => now - notice.at < NOTICE_MS)
}

/** 1 while solid, sliding to 0 over the last second. */
export function noticeOpacity(notice: Notice, now: number): number {
  const age = now - notice.at
  if (age >= NOTICE_MS) return 0
  const remaining = NOTICE_MS - age
  return remaining >= NOTICE_FADE_MS ? 1 : Math.max(0.1, remaining / NOTICE_FADE_MS)
}

export function noticeGlyph(level: NoticeLevel): string {
  return level === "error" ? "×" : level === "warn" ? "!" : "·"
}

/** Bubble width: icon + gap + padding, clamped to the available column. */
export function noticeWidth(text: string, available: number): number {
  const max = Math.max(1, Math.min(NOTICE_MAX_WIDTH, available))
  const min = Math.min(NOTICE_MIN_WIDTH, max)
  const wanted = text.length + 4
  return Math.max(min, Math.min(max, wanted))
}

/** The fill of the bubble: saturated for error/warn, panel for info. */
export function noticeFill(level: NoticeLevel, palette: ThemePalette): string {
  return level === "error"
    ? palette.error
    : level === "warn"
      ? palette.warning
      : palette.panel
}

/** Text on the fill; saturated fills use the background as ink. */
export function noticeInk(level: NoticeLevel, palette: ThemePalette): string {
  return level === "info" ? palette.foreground : palette.background
}

export function NoticeStack(props: { theme: ThemePalette; width: number; notices: Notice[]; now: number; rightOffset?: number }) {
  const palette = () => props.theme
  const cell = useCellSize()
  const ready = useAfterFirstFrame()
  const available = () => Math.max(1, Math.min(NOTICE_MAX_WIDTH, Math.floor(props.width * 0.5)))
  const left = () =>
    Math.max(1, props.width - available() - 2 - (props.rightOffset ?? 0))

  return (
    <box
      position="absolute"
      top={2}
      left={left()}
      width={available()}
      flexDirection="column"
      alignItems="flex-end"
      gap={1}
    >
      {props.notices.slice(-4).map((notice) => (
        <box opacity={noticeOpacity(notice, props.now)}>
          <Bubble
            width={noticeWidth(notice.text, available())}
            fill={noticeFill(notice.level, palette())}
            background={palette().background}
            cell={cell()}
            ready={ready()}
          >
            <box flexDirection="row" gap={1}>
              <text fg={noticeInk(notice.level, palette())}>{noticeGlyph(notice.level)}</text>
              <text
                fg={noticeInk(notice.level, palette())}
                wrapMode="word"
                flexGrow={1}
              >
                {notice.text}
              </text>
            </box>
          </Bubble>
        </box>
      ))}
    </box>
  )
}
