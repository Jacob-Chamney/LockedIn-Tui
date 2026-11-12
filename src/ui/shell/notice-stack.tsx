/**
 * Messages, the way an editor shows them.
 *
 * A notice floats in the top-right for ten seconds and fades out in its last
 * second. It never takes focus, never blocks the keyboard and never grows into a
 * dialog: errors and confirmations you should read and can ignore.
 */
import type { ThemePalette } from "../theme"

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

export function NoticeStack(props: { theme: ThemePalette; width: number; notices: Notice[]; now: number; rightOffset?: number }) {
  const palette = () => props.theme
  const width = () => Math.max(24, Math.min(52, Math.floor(props.width * 0.42)))
  const colour = (level: NoticeLevel) =>
    level === "error" ? palette().error : level === "warn" ? palette().warning : palette().primary
  const glyph = (level: NoticeLevel) => (level === "error" ? "×" : level === "warn" ? "!" : "·")

  return (
    <box
      position="absolute"
      top={2}
      left={Math.max(0, props.width - width() - 2 - (props.rightOffset ?? 0))}
      width={width()}
      flexDirection="column"
      backgroundColor={palette().panel}
      border={["left", "right", "top", "bottom"]}
      borderColor={palette().line}
      paddingX={1}
    >
      {props.notices.slice(-4).map((notice) => (
        <text
          fg={colour(notice.level)}
          wrapMode="word"
          opacity={noticeOpacity(notice, props.now)}
        >
          {`${glyph(notice.level)} ${notice.text}`}
        </text>
      ))}
    </box>
  )
}
