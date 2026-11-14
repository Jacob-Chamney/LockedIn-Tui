/**
 * Status bar: where you are, what mode you are in, what it has cost, and the
 * keys that matter right now. Every hint comes from the keymap registry.
 *
 * The previous LockedIn read `CHILL  NORMAL │ read-only … 0 tok │ ~$0.00 │ day
 * ~$0.00 │ leader ? help`: a chip for the surface, a chip for the mode, a short
 * note, then usage and the leader hint on the right. This follows that shape
 * instead of the old `CHILL │ NORMAL │ chill Space a add sources …` run-on.
 */
import type { GeneratedRow } from "../keymap/registry"
import type { Mode } from "../keymap/registry"
import type { Pane, Overlay } from "./state"
import { COST_UNKNOWN, formatCost } from "../chat/model"
import type { ThemePalette } from "../theme"

const PANE_LABEL: Record<Pane, string> = {
  explorer: "EXPLORER",
  chat: "CHILL",
  reader: "READER",
  agents: "AGENTS",
}

function fit(text: string, max: number): string {
  if (max <= 0) return ""
  return text.length <= max ? text : max === 1 ? "…" : `${text.slice(0, max - 1)}…`
}

export function StatusBar(props: {
  theme: ThemePalette
  width: number
  /** The surface's own name: SETTINGS, STATS, LOCK-IN SESSIONS, … */
  paneTitle?: string
  /** A one-word note beside the mode, e.g. `read-only`. */
  note?: string
  noteTone?: "muted" | "warn" | "error"
  /** The chat's tool mode (PLAN/BUILD/LEARN), when the chat pane is active. */
  toolMode?: string
  /** A chip a plugin published with the host status service. */
  pluginStatus?: { text: string; tone?: "info" | "warn" | "error" } | null
  pane: Pane
  mode: Mode
  overlay: Overlay
  context: string
  hints: GeneratedRow[]
  tokens: number
  /** `null` when no price is known — never rendered as `$0.0000`. */
  cost: number | null
  /** Last completed response, shown with the counters. */
  durationMs?: number | null
}) {
  const palette = () => props.theme
  const surface = () => {
    if (props.overlay === "command") return "COMMAND"
    if (props.overlay === "help") return "HELP"
    if (props.overlay === "leader") return "LEADER"
    // A chat buffer names its scope (CHILL, LEARN, SKILLS, WORK), so a project
    // chat is not mislabelled CHILL; other surfaces name themselves.
    if (props.pane === "chat") return (props.context || "chill").toUpperCase()
    return PANE_LABEL[props.pane]
  }
  const note = () =>
    props.note ?? (props.pane === "chat" && (props.context || "chill") === "chill" ? "read-only" : "")

  const usage = () => {
    const parts: string[] = []
    if (props.durationMs !== undefined && props.durationMs !== null) {
      parts.push(`⏱ ${(props.durationMs / 1000).toFixed(1)}s`)
    }
    parts.push(`${props.tokens} tok`)
    parts.push(props.tokens === 0 && props.cost === null ? COST_UNKNOWN : formatCost(props.cost))
    return parts.join(" · ")
  }

  // The old bar packed three registry hints in beside the counters and read as
  // one run-on sentence; the active pane's own footer carries its keys. The
  // right side is usage and how to get help, and nothing more.
  const chipText = (text: string) => ` ${text} `
  const chips = () => {
    const out = [
      { text: chipText(surface()), fg: palette().background, bg: palette().primary },
      { text: chipText(props.mode.toUpperCase()), fg: palette().background, bg: palette().warning },
    ]
    if (props.toolMode) {
      out.push({ text: chipText(props.toolMode), fg: palette().background, bg: palette().accent })
    }
    return out
  }
  const chipWidth = () => chips().reduce((sum, chip) => sum + chip.text.length, 0)
  const tailFull = "␣ · ? help"
  const tailMid = "? help"
  const tailShort = "?"

  /**
   * Allocate the row by priority: the pane and mode chips always survive
   * whole, then the note (usually a warning), then a plugin chip, then usage
   * and the help hint. On a narrow pane the least useful piece is dropped
   * instead of letting the layout engine clip every chip mid-word.
   */
  const layout = () => {
    let budget = Math.max(0, props.width - 2 - chipWidth())
    const noteText = note() ? chipText(note()) : ""
    const showNote = noteText !== "" && noteText.length + 2 <= budget
    if (showNote) budget -= noteText.length

    const status = props.pluginStatus
    const pluginMax = status ? Math.min(16, status.text.length + 2) : 0
    const showPlugin = status !== null && status !== undefined && pluginMax >= 8 && pluginMax + 2 <= budget
    const pluginText = showPlugin ? chipText(fit(status!.text, pluginMax - 2)) : ""
    if (showPlugin) budget -= pluginText.length

    const tail =
      budget >= tailFull.length ? tailFull : budget >= tailMid.length ? tailMid : tailShort
    const roomForUsage = budget - tail.length - 3
    const usageText = roomForUsage >= 8 ? fit(usage(), roomForUsage) : ""
    return { showNote, noteText, showPlugin, pluginText, usageText, tail }
  }

  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      paddingX={1}
      backgroundColor={palette().surface}
      justifyContent="space-between"
    >
      <box flexDirection="row">
        {chips().map((chip) => (
          <text fg={chip.fg} bg={chip.bg} wrapMode="none">
            {chip.text}
          </text>
        ))}
        {layout().showPlugin ? (
          <text
            fg={palette().background}
            bg={
              props.pluginStatus!.tone === "error"
                ? palette().error
                : props.pluginStatus!.tone === "warn"
                  ? palette().warning
                  : palette().primary
            }
            wrapMode="none"
          >
            {layout().pluginText}
          </text>
        ) : null}
        {layout().showNote ? (
          <text
            fg={
              props.noteTone === "warn" || props.noteTone === "error"
                ? palette().background
                : palette().muted
            }
            bg={
              props.noteTone === "error"
                ? palette().error
                : props.noteTone === "warn"
                  ? palette().warning
                  : undefined
            }
            wrapMode="none"
          >
            {layout().noteText}
          </text>
        ) : null}
      </box>
      <box flexDirection="row">
        {layout().usageText ? (
          <>
            <text fg={palette().muted} wrapMode="none">
              {layout().usageText}
            </text>
            <text fg={palette().muted} wrapMode="none">
              {" · "}
            </text>
          </>
        ) : null}
        <text fg={palette().muted} wrapMode="none">
          {layout().tail}
        </text>
      </box>
    </box>
  )
}
