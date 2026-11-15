/**
 * Code-block gutters and line fitting.
 *
 * One implementation serves the plugin SDK (`codeBlock()` draws numbered code)
 * and the app's fenced Markdown blocks. The gutter is `NN │ ` (right-aligned
 * digits, a bar and a space); the content column is whatever remains. Runs keep
 * their colours when a long line is truncated with `…`.
 */
export type CodeBlockOptions = {
  /** Number of code lines. */
  lineCount: number
  /** Available width inside the block. */
  width: number
  /** First line number; defaults to 1. */
  start?: number
  /** Show line numbers; defaults true. */
  showNumbers?: boolean
  /** Minimum digit width; defaults 2. */
  numberWidth?: number
}

export type CodeBlockLayout = {
  lineCount: number
  start: number
  showNumbers: boolean
  numberWidth: number
  /** Digits, space, bar and space. */
  gutterWidth: number
  /** Code columns after the gutter. */
  contentWidth: number
  /** Right-aligned line numbers. */
  numbers: string[]
}

export type CodeRun = {
  text: string
  color?: string
}

export function codeBlockLayout(options: CodeBlockOptions): CodeBlockLayout {
  const lineCount = Math.max(0, Math.floor(options.lineCount))
  const start = Math.max(1, Math.floor(options.start ?? 1))
  const showNumbers = options.showNumbers !== false
  const last = start + Math.max(0, lineCount - 1)
  const numberWidth = showNumbers
    ? Math.max(Math.floor(options.numberWidth ?? 0), String(last).length, 2)
    : 0
  const gutterWidth = showNumbers ? numberWidth + 3 : 0
  const contentWidth = Math.max(1, Math.floor(options.width) - gutterWidth)
  return {
    lineCount,
    start,
    showNumbers,
    numberWidth,
    gutterWidth,
    contentWidth,
    numbers: Array.from({ length: lineCount }, (_, index) =>
      String(start + index).padStart(numberWidth, " "),
    ),
  }
}

/** The gutter for one line, e.g. ` 7 │ `. */
export function codeGutter(layout: CodeBlockLayout, index: number): string {
  if (!layout.showNumbers) return ""
  return `${layout.numbers[index] ?? "".padStart(layout.numberWidth, " ")} │ `
}

/** Truncate coloured runs to `width` columns, ending with an ellipsis. */
export function fitCodeRuns(runs: readonly CodeRun[], width: number): CodeRun[] {
  if (width <= 0) return []
  const out: CodeRun[] = []
  let used = 0
  for (const run of runs) {
    const characters = Array.from(run.text)
    if (used + characters.length <= width) {
      out.push({ ...run })
      used += characters.length
      continue
    }
    const room = width - used
    if (room > 0) {
      const take = room - 1
      if (take > 0) out.push({ text: characters.slice(0, take).join(""), color: run.color })
      out.push({ text: "…", color: run.color })
    }
    return out
  }
  return out
}
