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

  // The left side is fixed; hints take whatever room is left, then usage.
  /**
   * The right side is usage and how to get help — not a hint catalogue. The
   * old bar packed three registry hints in beside the counters and read as one
   * run-on sentence; the active pane's own footer carries its keys.
   */
  // Each chip carries its own padding; the note carries one leading space.
  const leftWidth = () =>
    surface().length +
    props.mode.length +
    (props.toolMode?.length ?? 0) +
    (props.pluginStatus ? Math.min(24, props.pluginStatus.text.length) + 2 : 0) +
    note().length +
    7
  const tail = "␣ · ? help"
  const right = () => fit(usage(), Math.max(0, props.width - leftWidth() - tail.length - 6))

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
        <text fg={palette().background} bg={palette().primary} wrapMode="none">
          {` ${surface()} `}
        </text>
        <text fg={palette().background} bg={palette().warning} wrapMode="none">
          {` ${props.mode.toUpperCase()} `}
        </text>
        {props.toolMode ? (
          <text fg={palette().background} bg={palette().accent} wrapMode="none">
            {` ${props.toolMode} `}
          </text>
        ) : null}
        {props.pluginStatus ? (
          <text
            fg={palette().background}
            bg={
              props.pluginStatus.tone === "error"
                ? palette().error
                : props.pluginStatus.tone === "warn"
                  ? palette().warning
                  : palette().primary
            }
            wrapMode="none"
          >
            {` ${fit(props.pluginStatus.text, 24)} `}
          </text>
        ) : null}
        {note() ? (
          <text fg={palette().muted} wrapMode="none">
            {` ${note()}`}
          </text>
        ) : null}
      </box>
      <box flexDirection="row">
        <text fg={palette().muted} wrapMode="none">
          {right()}
        </text>
        <text fg={palette().muted} wrapMode="none">
          {" · "}
        </text>
        <text fg={palette().muted} wrapMode="none">
          {tail}
        </text>
      </box>
    </box>
  )
}
