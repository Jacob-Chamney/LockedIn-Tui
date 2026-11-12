/**
 * Bubble sizing.
 *
 * Content-sized, the way a message thread reads: only as wide as its text,
 * clamped per role. Two messages with the same text always get the same width,
 * and therefore the same corners.
 *
 * The rounded ends themselves are cells (see `bubble.tsx`). Terminal images
 * were tried and rejected: the terminal showed its own background through the
 * image's transparent corner, which read as a grey square outline under the
 * pill, and the `blocks` fallback drew the caps as block artefacts.
 */

export type CellSize = { width: number; height: number }

/** Word wrap, keeping an overlong word on its own line rather than splitting it. */
export function wrapBubbleText(text: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width))
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line === "") {
        line = word
        continue
      }
      if (line.length + 1 + word.length <= limit) line = `${line} ${word}`
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines.length === 0 ? [""] : lines
}

/** Content-sized width for a bubble, clamped per role. */
export function bubbleColumns(text: string, columns: number, role: "user" | "assistant"): number {
  const longest = text.split("\n").reduce((width, line) => Math.max(width, line.length), 0)
  const share = role === "assistant" ? 0.85 : 0.72
  const ceiling = Math.max(20, Math.min(columns - 2, Math.floor(columns * share)))
  return Math.max(20, Math.min(ceiling, longest + 4))
}
