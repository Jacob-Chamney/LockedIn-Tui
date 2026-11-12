/**
 * Steps reader: `assignment-steps.md` rendered as a tickable sheet.
 *
 * Markdown is the truth; the service owns every write. This module parses for
 * display with the domain's read-only helper, emits intents, and renders the
 * `ProgressSnapshot` it is given. No file IO, no key literals.
 *
 * The reader is width- and height-aware: long steps wrap with a hanging indent,
 * the body is clipped to the pane, and the selected step is always visible.
 * Footer and notices stay pinned instead of being pushed off-screen.
 */
import { parseProgress } from "../../domain/progress"
import { bindingLabel, parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"

export type StepRow =
  | { kind: "heading"; text: string }
  | { kind: "step"; index: number; checked: boolean; text: string }

export type StepsView = {
  cursor: number
  pendingRegenerate: boolean
  notice?: string | null
}

export const initialStepsView: StepsView = { cursor: 0, pendingRegenerate: false, notice: null }

export function rowsFor(raw: string): StepRow[] {
  const parsed = parseProgress(raw)
  if (!parsed.ok) return []
  const rows: StepRow[] = []
  const lines = raw.split("\n")
  const byLine = new Map(parsed.value.items.map((item) => [item.line, item]))
  for (let i = 0; i < lines.length; i++) {
    const item = byLine.get(i)
    if (item) {
      rows.push({ kind: "step", index: item.index, checked: item.checked, text: item.text })
      continue
    }
    const line = lines[i]!
    if (/^#{1,6}\s+/.test(line)) rows.push({ kind: "heading", text: line.replace(/^#{1,6}\s+/, "") })
  }
  return rows
}

export function progressLine(snapshot: { checked: number; total: number }): string {
  return `${snapshot.checked} of ${snapshot.total} steps done`
}

export function stepIndices(rows: StepRow[]): number[] {
  return rows.map((row, i) => (row.kind === "step" ? i : -1)).filter((i) => i >= 0)
}

export function clampCursor(rows: StepRow[], cursor: number): number {
  const steps = stepIndices(rows)
  if (steps.length === 0) return 0
  return Math.max(steps[0]!, Math.min(steps[steps.length - 1]!, cursor))
}

/** Moves between step rows only; headings are never a cursor stop. */
export function move(rows: StepRow[], cursor: number, delta: number): number {
  const steps = stepIndices(rows)
  if (steps.length === 0) return 0
  const position = steps.findIndex((i) => i >= cursor)
  const at = position === -1 ? steps.length - 1 : position
  const next = Math.max(0, Math.min(steps.length - 1, at + delta))
  return steps[next]!
}

export function currentStep(rows: StepRow[], cursor: number): Extract<StepRow, { kind: "step" }> | undefined {
  const row = rows[cursor]
  return row?.kind === "step" ? row : undefined
}

/* --------------------------------- layout --------------------------------- */

export type RenderedStepLine = {
  text: string
  row: number
  kind: "heading" | "step" | "blank"
  selected: boolean
  continuation: boolean
}

export type StepsLayout = {
  lines: RenderedStepLine[]
  visible: RenderedStepLine[]
  start: number
  above: boolean
  below: boolean
}

function chars(text: string): string[] {
  return Array.from(text)
}

/**
 * Word-wrap one line to `width` cells. A token longer than the width is
 * hard-broken; an empty input still yields one empty line so a row keeps its
 * identity.
 */
export function wrapStepText(text: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width))
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter((word) => word !== "")
  if (words.length === 0) return [""]

  const out: string[] = []
  let line: string[] = []
  const flush = () => {
    if (line.length > 0) {
      out.push(line.join(""))
      line = []
    }
  }

  for (const word of words) {
    const wordChars = chars(word)
    if (wordChars.length > limit) {
      flush()
      let offset = 0
      while (offset < wordChars.length) {
        const chunk = wordChars.slice(offset, offset + limit)
        if (offset + limit < wordChars.length) out.push(chunk.join(""))
        else line = chunk
        offset += limit
      }
      continue
    }
    if (line.length === 0) {
      line = wordChars
    } else if (line.length + 1 + wordChars.length <= limit) {
      line.push(" ", ...wordChars)
    } else {
      flush()
      line = wordChars
    }
  }
  flush()
  return out.length === 0 ? [""] : out
}

/** Prefix/continuation for one step row, aligned under the step text. */
export function stepPrefix(selected: boolean, checked: boolean): string {
  return `${selected ? "▌" : " "} ${checked ? "✓" : "☐"}  `
}

/**
 * Flatten heading and step rows into terminal lines, then choose a window that
 * keeps the selected step visible.
 */
export function layoutSteps(input: {
  rows: StepRow[]
  width: number
  height: number
  cursor: number
}): StepsLayout {
  // Leave breathing room on the right instead of wrapping against the border.
  const contentWidth = Math.max(8, input.width - 4)
  const lines: RenderedStepLine[] = []

  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index]!
    if (row.kind === "heading") {
      if (index > 0) lines.push({ text: "", row: index, kind: "blank", selected: false, continuation: false })
      for (const text of wrapStepText(row.text, contentWidth)) {
        lines.push({ text, row: index, kind: "heading", selected: false, continuation: false })
      }
      continue
    }

    const prefix = stepPrefix(index === input.cursor, row.checked)
    const prefixWidth = chars(prefix).length
    const textWidth = Math.max(1, contentWidth - prefixWidth)
    const wrapped = wrapStepText(row.text, textWidth)
    for (const [lineIndex, text] of wrapped.entries()) {
      lines.push({
        text: lineIndex === 0 ? `${prefix}${text}` : `${" ".repeat(prefixWidth)}${text}`,
        row: index,
        kind: "step",
        selected: index === input.cursor,
        continuation: lineIndex > 0,
      })
    }
    if (input.rows[index + 1]?.kind === "step") {
      lines.push({ text: "", row: index, kind: "blank", selected: false, continuation: false })
    }
  }

  const selected = lines
    .map((line, index) => (line.selected ? index : -1))
    .filter((index) => index >= 0)
  const firstSelected = selected[0] ?? 0
  const lastSelected = selected[selected.length - 1] ?? 0
  const height = Math.max(0, Math.floor(input.height))
  let start = 0
  if (height > 0) {
    if (selected.length > 0) {
      start = Math.max(0, lastSelected - height + 1)
      if (lastSelected - firstSelected + 1 > height) start = firstSelected
      if (firstSelected < start) start = firstSelected
    }
    start = Math.max(0, Math.min(start, Math.max(0, lines.length - height)))
  }

  return {
    lines,
    visible: height === 0 ? [] : lines.slice(start, start + height),
    start,
    above: start > 0,
    below: height > 0 && start + height < lines.length,
  }
}

/* ---------------------------------- keys ---------------------------------- */

export type StepsIntent =
  | "down"
  | "up"
  | "half-down"
  | "half-up"
  | "top"
  | "bottom"
  | "toggle"
  | "ask"
  | "regenerate"
  | "instructions"
  | "close"

const SPECS: Array<{ intent: StepsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "half-down", key: "d", footer: "d/u page" },
  { intent: "half-up", key: "u", footer: "" },
  { intent: "top", key: "g", footer: "g/G ends" },
  { intent: "bottom", key: "shift+g", footer: "" },
  { intent: "toggle", key: "x", footer: "x toggle" },
  { intent: "ask", key: "a", footer: "a ask" },
  { intent: "regenerate", key: "shift+r", footer: "R regenerate" },
  { intent: "instructions", key: "i", footer: "i instructions" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`steps key "${key}": ${binding.message}`)
  return binding
}

export const STEPS_KEYS: Array<{ intent: StepsIntent; binding: Binding; footer: string }> = SPECS.map(
  (spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }),
)

export function intentFor(name: string, options: { shift?: boolean } = {}): StepsIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower === "enter" ? "return" : lower
  return STEPS_KEYS.find((e) => e.binding.kind === "direct" && e.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return STEPS_KEYS.filter((e) => e.footer).map((e) => e.footer).join(" · ")
}

/** Two short hint rows so a narrow reader does not truncate the keys. */
export function footerLines(hasInstructions = true): string[] {
  return [
    "j/k move · d/u page · g/G ends",
    hasInstructions
      ? "x toggle · a ask · R regenerate · i instructions · Esc back"
      : "x toggle · a ask · R regenerate · Esc back",
  ]
}

export function toggleKeyLabel(): string {
  return bindingLabel(STEPS_KEYS.find((e) => e.intent === "toggle")!.binding)
}

export function armRegenerate(view: StepsView): StepsView {
  return { ...view, pendingRegenerate: true, notice: null }
}

export function cancelRegenerate(view: StepsView): StepsView {
  return { ...view, pendingRegenerate: false, notice: null }
}

export type RegenerateOutcome = { kind: "confirm"; message: string } | { kind: "none" }

/** Nothing is rewritten until the confirmation is given. */
export function confirmRegenerate(view: StepsView): RegenerateOutcome {
  if (!view.pendingRegenerate) {
    return { kind: "confirm", message: "Press R again to regenerate; checked steps are kept by text." }
  }
  return { kind: "none" }
}

export function emptyCopy(kind: "empty" | "missing"): string {
  return kind === "missing"
    ? "assignment-steps.md is missing · press R to build the steps"
    : "no steps yet · press R to generate steps from the sources"
}

export function instructionsHint(hasInstructions: boolean): string | null {
  return hasInstructions ? "i assignment instructions" : null
}

/* -------------------------------- component ------------------------------- */

const REGENERATE_COPY =
  "Regenerate steps? Checked steps with the same text stay checked. Press R to confirm, Esc to cancel"

export function StepsReader(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  raw: string
  snapshot: { checked: number; total: number }
  view: StepsView
  missing?: boolean
  hasInstructions?: boolean
  /** The source or instruction inputs changed since this file was generated. */
  stale?: boolean
}) {
  const palette = () => props.theme
  const rows = () => rowsFor(props.raw)
  const body = () => (props.focused ? palette().foreground : palette().muted)
  const empty = () => rows().length === 0
  const innerWidth = () => Math.max(8, props.width - 2)
  const footer = () => footerLines(props.hasInstructions ?? false)
  const pending = () => (props.view.pendingRegenerate ? wrapStepText(REGENERATE_COPY, innerWidth()) : [])
  const notice = () => (props.view.notice ? wrapStepText(`! ${props.view.notice}`, innerWidth()) : [])

  /** Reserved chrome, message lines and body height, all in terminal rows. */
  const frame = () => {
    const reserved = 2 + footer().length
    const available = Math.max(0, props.height - reserved)
    const blank = available >= 2 ? 1 : 0
    const messageBudget = Math.max(0, available - blank)
    const pendingLines = pending().slice(0, messageBudget)
    const noticeLines = notice().slice(0, Math.max(0, messageBudget - pendingLines.length))
    const bodyHeight = Math.max(0, available - blank - pendingLines.length - noticeLines.length)
    return { blank, pendingLines, noticeLines, bodyHeight }
  }

  const layout = () =>
    layoutSteps({
      rows: rows(),
      width: props.width,
      height: frame().bodyHeight,
      cursor: clampCursor(rows(), props.view.cursor),
    })

  const more = () => {
    if (empty()) return ""
    const up = layout().above ? "↑" : ""
    const down = layout().below ? "↓" : ""
    return up || down ? ` · ${up}${down} more` : ""
  }

  const emptyLines = () => wrapStepText(`! ${emptyCopy(props.missing ? "missing" : "empty")}`, innerWidth())

  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={palette().panel}
      paddingX={1}
    >
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} STEPS · assignment-steps.md${props.stale ? " · stale" : ""}`}
      </text>
      <text fg={palette().secondary} wrapMode="none">
        {empty() ? "" : `${progressLine(props.snapshot)}${more()}`}
      </text>
      {frame().blank ? <text> </text> : null}

      <box flexGrow={1} minHeight={0} flexDirection="column">
        {empty() ? (
          emptyLines()
            .slice(0, frame().bodyHeight)
            .map((line, index) => (
              <text fg={index === 0 ? palette().warning : palette().muted} wrapMode="none">
                {line}
              </text>
            ))
        ) : (
          layout().visible.map((line) =>
            line.kind === "heading" ? (
              <text fg={palette().primary} wrapMode="none">
                <b>{line.text || " "}</b>
              </text>
            ) : line.kind === "blank" ? (
              <text> </text>
            ) : (
              <text fg={line.selected ? palette().primary : body()} wrapMode="none">
                {line.text}
              </text>
            ),
          )
        )}
      </box>

      {frame().pendingLines.map((line) => (
        <text fg={palette().error} wrapMode="none">
          {line}
        </text>
      ))}
      {frame().noticeLines.map((line) => (
        <text fg={palette().warning} wrapMode="none">
          {line}
        </text>
      ))}

      {footer().map((line) => (
        <text fg={palette().muted} wrapMode="none">
          {line}
        </text>
      ))}
    </box>
  )
}
