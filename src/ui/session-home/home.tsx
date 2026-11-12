/**
 * Session home and coverage panel.
 *
 * A session with no chat must never look empty (product §4.3, AGENTS §2.13).
 * Coverage comes from `computeCoverage()`/`coverageGaps()` — no second counting
 * path. The pane performs no IO and holds no key literal.
 */
import { parseBinding } from "../keymap/registry";
import type { ThemePalette } from "../theme";
import { computeCoverage } from "../../domain/coverage";
import { coverageFor, coverageRow, coverageSummary, gapRows, homeRows, showHome, sourceSummary, stepsLine, outputsLine, type HomeBlockId, type HomeRow, type OutputState, type SessionHome } from "../../domain/session-home";
import type { Binding } from "../keymap/registry";
export {
  computeCoverage,
  coverageFor,
  coverageRow,
  coverageSummary,
  gapRows,
  homeRows,
  showHome,
  sourceSummary,
  stepsLine,
  outputsLine,
}
export type { HomeBlockId, HomeRow, OutputState, SessionHome }

// ---------------------------------------------------------------- keys

export type HomeIntent = "down" | "up" | "open" | "close"

const SPECS: Array<{ intent: HomeIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "open", key: "return", footer: "Enter open" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`home key "${key}": ${binding.message}`)
  return binding
}

export const HOME_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): HomeIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return HOME_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return HOME_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function move(cursor: number, delta: number, count = 4): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), cursor + delta))
}

// ---------------------------------------------------------------- render

export function SessionHomePane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  home: SessionHome
  cursor: number
  coverage: boolean
}) {
  const palette = () => props.theme
  const rows = () => homeRows(props.home)
  const report = () => coverageFor(props.home)

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
        {`${props.focused ? "▸" : " "} ${props.home.name}`}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {`created ${props.home.created}`}
      </text>

      {props.coverage ? (
        <box flexDirection="column">
          <text fg={palette().secondary} wrapMode="none">
            {`COVERAGE · ${coverageSummary(report())}`}
          </text>
          {report().sources.map((entry) => (
            <text
              fg={entry.referenced ? palette().foreground : palette().warning}
              wrapMode="none"
            >
              {`${entry.referenced ? "✓" : "!"} ${coverageRow(entry)}`}
            </text>
          ))}
          {gapRows(report()).map((line) => (
            <text fg={palette().warning} wrapMode="none">
              {`  ${line}`}
            </text>
          ))}
        </box>
      ) : (
        <box flexDirection="column">
          {rows().map((row, index) => (
            <text fg={index === props.cursor ? palette().primary : palette().foreground} wrapMode="none">
              {`${index === props.cursor ? "▸" : " "} ${row.label}  ${row.detail}${row.offers ? `  [${row.action}]` : ""}`}
            </text>
          ))}
        </box>
      )}

      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
