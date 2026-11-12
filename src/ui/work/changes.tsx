/**
 * Change review: the overlay that stands between a proposed write and the
 * user's files.
 *
 * The overlay only decides *which hunks* — applying belongs to WP-504. It never
 * touches a file, never decides on Esc, and names the path and hunk count in
 * both the header and the confirmation.
 */
import { parseBinding, type Binding } from "../keymap/registry"
import type { Hunk, ProposedWrite } from "../../services/work/diff"
import type { WriteError } from "../../services/work/writes"
import type { ThemePalette } from "../theme"

export type ReviewState = {
  open: boolean
  /** Hunk indices selected for apply. */
  selected: number[]
  /** Set after a decision or a refusal; rendered as one result line. */
  result?: string | null
  error?: string | null
}

export const initialReview: ReviewState = { open: false, selected: [], result: null, error: null }

export function openReview(write: ProposedWrite): ReviewState {
  // Every hunk starts selected: `Y` applies the whole proposal unless changed.
  return { open: true, selected: write.hunks.map((hunk) => hunk.index), result: null, error: null }
}

/** `src/a.ts · 3 hunks · +4 −1` — the exact path, never a basename. */
export function reviewHeader(write: ProposedWrite): string {
  const hunks = `${write.hunks.length} hunk${write.hunks.length === 1 ? "" : "s"}`
  return `${write.path} · ${hunks} · +${write.stats.added} −${write.stats.removed}`
}

export function toggleHunk(state: ReviewState, index: number): ReviewState {
  const selected = state.selected.includes(index)
    ? state.selected.filter((value) => value !== index)
    : [...state.selected, index].sort((a, b) => a - b)
  return { ...state, selected, error: null }
}

export function selectAll(write: ProposedWrite): ReviewState {
  return { open: true, selected: write.hunks.map((hunk) => hunk.index), result: null, error: null }
}

export function selectedCount(state: ReviewState): number {
  return state.selected.length
}

/** The confirmation names the file and how many hunks will change. */
export function applyCopy(write: ProposedWrite, state: ReviewState): string {
  const count = selectedCount(state)
  return `apply ${count} hunk${count === 1 ? "" : "s"} to ${write.path}? press y again to confirm`
}

export type ReviewDecision =
  | { kind: "approve"; hunks: number[] }
  | { kind: "reject" }
  | { kind: "refused"; reason: string }

/** `Y` needs a selection; `N` always works. Nothing happens on Esc. */
export function decide(write: ProposedWrite, state: ReviewState, decision: "approve" | "reject"): ReviewDecision {
  if (decision === "reject") return { kind: "reject" }
  if (state.selected.length === 0) {
    return { kind: "refused", reason: `select at least one hunk of ${write.path} with Space` }
  }
  return { kind: "approve", hunks: [...state.selected].sort((a, b) => a - b) }
}

/** A stale proposal is reported and applies nothing. */
export function applyError(error: WriteError, write: ProposedWrite): string {
  switch (error.kind) {
    case "conflict":
      return `${write.path} changed since this proposal · nothing was applied; ask for it again`
    case "blocked":
      return error.reason === "opt-in-off"
        ? "writes are off · nothing was applied; enable writes in Settings"
        : "this agent may not write · nothing was applied"
    case "selection":
      return error.message
    default:
      return "the write could not be applied; nothing changed"
  }
}

export function resultLine(decision: "approve" | "reject", write: ProposedWrite, hunks: number): string {
  return decision === "approve"
    ? `applied ${hunks} hunk${hunks === 1 ? "" : "s"} to ${write.path}`
    : `rejected the change to ${write.path} · nothing was written`
}

/** Esc decides nothing and writes nothing. */
export function closeReview(): ReviewState {
  return { open: false, selected: [], result: null, error: null }
}

export function hunkHeader(hunk: Hunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
}

export function hunkLines(hunk: Hunk): string[] {
  return hunk.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`)
}

export function sideBySide(write: ProposedWrite, width: number): boolean {
  return width >= 160 && write.hunks.length > 0
}

export type ReviewIntent = "down" | "up" | "toggle" | "all" | "apply" | "reject" | "diff" | "close"

const SPECS: Array<{ intent: ReviewIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k hunk" },
  { intent: "up", key: "k", footer: "" },
  { intent: "diff", key: "shift+d", footer: "D diff" },
  { intent: "toggle", key: "tab", footer: "Tab select" },
  { intent: "all", key: "shift+a", footer: "A all" },
  { intent: "apply", key: "y", footer: "y apply" },
  { intent: "reject", key: "n", footer: "n reject" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`review key "${key}": ${binding.message}`)
  return binding
}

export const REVIEW_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean } = {}): ReviewIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower
  return REVIEW_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return REVIEW_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function ReviewOverlay(props: {
  theme: ThemePalette
  width: number
  height: number
  write: ProposedWrite
  state: ReviewState
  cursor: number
}) {
  const palette = () => props.theme
  const boxWidth = () => Math.min(120, Math.max(40, Math.floor(props.width * 0.9)))
  const stacked = !sideBySide(props.write, props.width)

  return (
    <box
      position="absolute"
      top={1}
      left={Math.floor((props.width - boxWidth()) / 2)}
      width={boxWidth()}
      height={Math.max(8, props.height - 2)}
      flexDirection="column"
      backgroundColor={palette().panel}
      paddingX={1}
    >
      {/* Header is pinned: it is the first row and never scrolls away. */}
      <text fg={palette().primary} wrapMode="none">
        {`${reviewHeader(props.write)} · ${selectedCount(props.state)} selected`}
      </text>

      {props.write.hunks.map((hunk, index) => (
        <box flexDirection="column">
          <text fg={index === props.cursor ? palette().primary : palette().muted} wrapMode="none">
            {`${props.state.selected.includes(hunk.index) ? "◉" : "○"} ${hunkHeader(hunk)}`}
          </text>
          {hunkLines(hunk).map((line) => (
            <text
              fg={line.startsWith("+") ? palette().success : line.startsWith("-") ? palette().error : palette().muted}
              wrapMode="none"
            >
              {stacked ? `  ${line}` : `  ${line}`}
            </text>
          ))}
        </box>
      ))}

      {props.state.error ? (
        <text fg={palette().error} wrapMode="none">
          {`× ${props.state.error}`}
        </text>
      ) : null}
      {props.state.result ? (
        <text fg={palette().success} wrapMode="none">
          {`${props.state.result}`}
        </text>
      ) : null}
      <text fg={palette().muted} wrapMode="none">
        {applyCopy(props.write, props.state)}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
