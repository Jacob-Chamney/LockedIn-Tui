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
import { mixHex } from "../theme/mix"

export type NoticeLevel = "info" | "warn" | "error"

export type Notice = {
  id: string
  text: string
  level: NoticeLevel
  /** Epoch ms when it appeared. */
  at: number
  /** Lifetime in ms; defaults to NOTICE_MS. */
  duration?: number
}

/** How long a notice lives, and how long its fade lasts. */
export const NOTICE_MS = 10_000
export const NOTICE_FADE_MS = 1_000
/** Repaint cadence while a bubble is fading; the shell slows down outside it. */
export const NOTICE_TICK_MS = 50

/** Widest a bubble grows before the text wraps. */
export const NOTICE_MAX_WIDTH = 52
/** Narrowest a bubble grows; shorter messages stay compact. */
export const NOTICE_MIN_WIDTH = 20

export function noticeDuration(notice: Notice): number {
  return notice.duration ?? NOTICE_MS
}

/** Dismiss the newest bubble; repeated calls clear the stack. */
export function dismissLatestNotice(notices: Notice[]): Notice[] {
  return notices.slice(0, -1)
}

export function pruneNotices(notices: Notice[], now: number): Notice[] {
  return notices.filter((notice) => now - notice.at < noticeDuration(notice))
}

/** 1 while solid, sliding to 0 over the last second. */
export function noticeOpacity(notice: Notice, now: number): number {
  const duration = noticeDuration(notice)
  const age = now - notice.at
  if (age >= duration) return 0
  const remaining = duration - age
  return remaining >= NOTICE_FADE_MS ? 1 : Math.max(0, remaining / NOTICE_FADE_MS)
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

/**
 * Colours for a bubble at `opacity`.
 *
 * Fading by colour, not by a parent opacity, keeps the opaque image caps and
 * the cell body on the same curve. Alpha compositing treated them differently
 * and left the body as a rectangle while the caps faded.
 */
export function noticeColors(
  level: NoticeLevel,
  palette: ThemePalette,
  opacity: number,
): { fill: string; ink: string } {
  const amount = Math.max(0, Math.min(1, opacity))
  return {
    fill: mixHex(palette.background, noticeFill(level, palette), amount),
    ink: mixHex(palette.background, noticeInk(level, palette), amount),
  }
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
      {props.notices.slice(-4).map((notice) => {
        const colors = noticeColors(
          notice.level,
          palette(),
          noticeOpacity(notice, props.now),
        )
        return (
          <Bubble
            width={noticeWidth(notice.text, available())}
            fill={colors.fill}
            background={palette().background}
            cell={cell()}
            ready={ready()}
          >
            <box flexDirection="row" gap={1}>
              <text fg={colors.ink}>{noticeGlyph(notice.level)}</text>
              <text fg={colors.ink} wrapMode="word" flexGrow={1}>
                {notice.text}
              </text>
            </box>
          </Bubble>
        )
      })}
    </box>
  )
}
