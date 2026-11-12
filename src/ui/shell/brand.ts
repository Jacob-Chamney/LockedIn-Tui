/**
 * The LockedIn wordmark.
 *
 * Lifted from the previous LockedIn's `ui/logo.py` — it is the product's visual
 * identity, not implementation, and the welcome screen and Stats page both use
 * it. `LOCKED_IN_LOGO_COMPACT` is for terminals too narrow for the full mark.
 */
export const LOCKED_IN_LOGO = [
  "██╗      ██████╗  ██████╗██╗  ██╗███████╗██████╗     ██╗███╗   ██╗",
  "██║     ██╔═══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗    ██║████╗  ██║",
  "██║     ██║   ██║██║     █████╔╝ █████╗  ██║  ██║    ██║██╔██╗ ██║",
  "██║     ██║   ██║██║     ██╔═██╗ ██╔══╝  ██║  ██║    ██║██║╚██╗██║",
  "███████╗╚██████╔╝╚██████╗██║  ██╗███████╗██████╔╝    ██║██║ ╚████║",
  "╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝     ╚═╝╚═╝  ╚═══╝",
] as const

export const LOCKED_IN_LOGO_COMPACT = [
  "╦  ╔═╗╔═╗╦╔═╔═╗╔╦╗  ╦╔╗╔",
  "║  ║ ║║  ╠╩╗║╣  ║║  ║║║║",
  "╩═╝╚═╝╚═╝╩ ╩╚═╝═╩╝  ╩╝╚╝",
] as const

export const LOCKED_IN_TAGLINE = "a terminal workspace for learning & focused work"

/**
 * The full mark needs 61 columns. Below that the welcome screen prints the name
 * in bold instead: the compact block glyphs read as corruption at this size,
 * especially when the reader narrows the chat column.
 */
export const LOGO_MIN_WIDTH = 66

export function logoFor(width: number): readonly string[] {
  return width >= LOGO_MIN_WIDTH ? LOCKED_IN_LOGO : LOCKED_IN_LOGO_COMPACT
}
