/**
 * Study-guide section marking (`docs/product.md` §5.2, §5.1's discipline).
 *
 * A study guide is Markdown: `## <heading>`, the question, then one
 * `- [ ] Reviewed` row per section and a single `> N of M sections reviewed`
 * line. Marking a section rewrites **one bracket character and the progress
 * line**, and every other byte stays — the same rule the assignment steps
 * follow, so a user's edits to the prose survive a toggle.
 *
 * Pure and total: a guide with no sections, an index out of range or a document
 * without a task list is a typed refusal, never a partial write.
 */

export type GuideMark = {
  /** The document after the toggle. */
  markdown: string
  /** 0-based section ordinal, in file order. */
  index: number
  /** The new state of that section. */
  checked: boolean
  /** Sections reviewed after the toggle. */
  done: number
  /** Sections in the guide. */
  total: number
}

export type GuideMarkResult =
  | { ok: true; value: GuideMark }
  | { ok: false; message: string }

const TASK_LINE = /^(\s*[-*]\s+\[)([ xX])(\]\s*Reviewed\s*)$/i
const PROGRESS_LINE = /^(\s*>\s*)\d+ of \d+( sections? reviewed\s*)$/

/** The task-list rows that mark sections reviewed, in file order. */
export function guideSections(markdown: string): { line: number; checked: boolean }[] {
  const lines = markdown.split("\n")
  const rows: { line: number; checked: boolean }[] = []
  for (const [line, text] of lines.entries()) {
    const match = TASK_LINE.exec(text)
    if (match !== null) rows.push({ line, checked: match[2] !== " " })
  }
  return rows
}

/** Toggle the section at [index]. Pure: the caller writes the result. */
export function toggleGuideSection(markdown: string, index: number): GuideMarkResult {
  const lines = markdown.split("\n")
  const rows = guideSections(markdown)
  if (rows.length === 0) {
    return { ok: false, message: "this study guide has no sections to mark" }
  }
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    return {
      ok: false,
      message: `this study guide has ${rows.length} section(s); there is no section ${index}`,
    }
  }

  const row = rows[index]!
  const match = TASK_LINE.exec(lines[row.line]!)!
  const checked = !row.checked
  lines[row.line] = `${match[1]}${checked ? "x" : " "}${match[3]}`

  const done = rows.filter((entry, at) => (at === index ? checked : entry.checked)).length
  const progress = lines.findIndex((text) => PROGRESS_LINE.test(text))
  if (progress >= 0) {
    const [whole, prefix, suffix] = PROGRESS_LINE.exec(lines[progress]!)!
    lines[progress] = `${prefix}${done} of ${rows.length}${suffix}`
    void whole
  }

  return {
    ok: true,
    value: {
      markdown: lines.join("\n"),
      index,
      checked,
      done,
      total: rows.length,
    },
  }
}
