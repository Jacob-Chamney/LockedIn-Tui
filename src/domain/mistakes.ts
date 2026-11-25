/**
 * The misconception ledger and its graduation into a knowledge note.
 *
 * A lock-in session records what the learner got wrong in
 * `misconceptions.md` (one `- text` bullet, optionally followed by a two-space
 * `step:` line). Those entries are **session process history**, not sources.
 * This module is the pure half of "promote a mistake": it parses the ledger,
 * names the promoted note and writes its labelled body. File IO and the note
 * store live in `src/services/lockin/mistakes.ts`.
 *
 * No file IO, no UI, no provider code.
 */

/** A recorded misconception, in file order. */
export type MistakeEntry = {
  /** 0-based position in the ledger; the promotion key. */
  index: number
  text: string
  /** The assignment step the mistake was recorded against, when named. */
  step: string | null
}

/** The ledger is a short list; a paragraph is a prompt, not a mistake. */
export const MAX_MISTAKE_CHARS = 500

/** The correction is the learner's own prose; allow a little more room. */
export const MAX_CORRECTION_CHARS = 1000

/** Topic group the promoted note joins in the knowledge tree. */
export const MISTAKE_TOPIC = "Session mistakes"

/** Frontmatter label: this note came from a session's mistake ledger. */
export const MISTAKE_ORIGIN = "session-mistake"

/** The tag every promoted note carries. */
export const MISTAKE_TAG = "mistake"

const ENTRY = /^-\s+(.*)$/
const STEP = /^\s{2,}step:\s*(.*)$/

/**
 * One line, no leading bullet. A recorded mistake is a sentence the learner
 * can promote and revisit; newlines and runs of spaces carry no meaning.
 */
export function normaliseMistake(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-\s*/, "")
    .trim()
}

/**
 * Parse `misconceptions.md`.
 *
 * Only bullet lines are entries. A heading, a blank line and any other prose
 * are skipped, so a file the learner edited by hand still parses. A `step:`
 * line belongs to the entry above it.
 */
export function parseMistakes(markdown: string): MistakeEntry[] {
  const entries: MistakeEntry[] = []
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const stepped = STEP.exec(raw)
    if (stepped !== null) {
      const step = normaliseMistake(stepped[1] ?? "")
      const last = entries.at(-1)
      if (last !== undefined && step !== "") last.step = step
      continue
    }
    const entry = ENTRY.exec(raw)
    if (entry === null) continue
    const text = normaliseMistake(entry[1] ?? "")
    if (text === "") continue
    entries.push({ index: entries.length, text, step: null })
  }
  return entries
}

/** A note title: the mistake itself, cut on a word boundary when it is long. */
export function mistakeTitle(text: string, maxLength = 80): string {
  const flat = normaliseMistake(text)
  if (flat.length <= maxLength) return flat
  const cut = flat.slice(0, maxLength - 1)
  const space = cut.lastIndexOf(" ")
  const head = space > maxLength * 0.6 ? cut.slice(0, space) : cut
  return `${head.trimEnd()}…`
}

export type MistakeBodyInput = {
  sessionName: string
  sessionId: string
  index: number
  text: string
  correction?: string
  step?: string | null
}

/**
 * The promoted note's Markdown body.
 *
 * The label is part of the note, not a UI convention: whoever reads the note in
 * the app or in a text editor can tell that it came from the learner's own
 * mistake record and is **not** one of the session's sources.
 */
export function mistakeBody(input: MistakeBodyInput): string {
  const title = mistakeTitle(input.text)
  const correction = normaliseMistake(input.correction ?? "")
  const provenance = `Promoted from \`misconceptions.md\` in session \`${input.sessionId}\`, entry ${
    input.index + 1
  }.`
  const step = normaliseMistake(input.step ?? "")
  return [
    `# ${title}`,
    "",
    `> Promoted from a remembered mistake in “${input.sessionName}”. Your own record — not one of the session's sources.`,
    "",
    "## Mistake",
    "",
    input.text,
    "",
    "## Corrected understanding",
    "",
    correction === ""
      ? "Not written yet. Say what is right here the next time you revisit this mistake."
      : correction,
    "",
    step === "" ? provenance : `${provenance} Step: ${step}.`,
    "",
  ].join("\n")
}
