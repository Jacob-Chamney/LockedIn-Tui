/** The part of a scrollbox the shell drives from NORMAL mode. */
export type ScrollApi = {
  /** Positive scrolls down, negative up; one unit is one cell. */
  scrollBy: (delta: number) => void
  /** Jump to the end, used when the reader or chat opens. */
  scrollToBottom: () => void
  /** True when the viewport is following the end. */
  atBottom: () => boolean
}
