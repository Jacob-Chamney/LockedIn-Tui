/**
 * Swarm plan view.
 *
 * Shows the coordinator's plan before anything runs, and states the parallel
 * cap before it can be hit. Workers are read-only here by construction: no
 * control on this screen grants write or command access.
 */
import type { SwarmPlanTask } from "../../services/work/swarm"
import { parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"

export const MAX_PARALLEL = 4

export type PlanRow = { title: string; agent: string; assignment: string; readOnly: true }

/** `agentId: ""` means the project default agent. */
export function planRows(
  plan: readonly SwarmPlanTask[],
  agentName: (id: string) => string,
  defaultAgent: string,
): PlanRow[] {
  return plan.map((task) => ({
    title: task.title,
    agent: task.agentId ? agentName(task.agentId) : defaultAgent,
    assignment: task.assignment,
    readOnly: true,
  }))
}

export function modeLabel(parallel: number): string {
  return parallel <= 1 ? "sequential" : `parallel · ${parallel} of ${MAX_PARALLEL}`
}

/** Above the cap the request is refused by name and no run is created. */
export function startRefusal(parallel: number): string | null {
  if (!Number.isInteger(parallel) || parallel < 1) return `parallel must be 1–${MAX_PARALLEL}; got ${parallel}`
  if (parallel > MAX_PARALLEL) return `parallel ${parallel} exceeds the cap of ${MAX_PARALLEL} · choose 1–${MAX_PARALLEL}`
  return null
}

export function emptyCopy(): string {
  return "no swarms yet · press n to plan one from the project objective"
}

export function readOnlyNote(): string {
  return "every worker is read-only · nothing on this screen grants write or command access"
}

export function laneReadOnly(): string {
  return "read-only"
}

export type SwarmIntent = "new" | "start" | "cancel" | "board" | "retry" | "open-report" | "close"

const SPECS: Array<{ intent: SwarmIntent; key: string; footer: string }> = [
  { intent: "new", key: "n", footer: "n new swarm" },
  { intent: "start", key: "return", footer: "Enter start" },
  { intent: "board", key: "b", footer: "b board" },
  { intent: "retry", key: "shift+r", footer: "R retry" },
  { intent: "open-report", key: "o", footer: "o report" },
  { intent: "cancel", key: "c", footer: "c cancel" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`swarm key "${key}": ${binding.message}`)
  return binding
}

export const SWARM_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean } = {}): SwarmIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower === "enter" ? "return" : lower
  return SWARM_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return SWARM_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function SwarmPlanPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  objective: string
  parallel: number
  rows: PlanRow[]
  cursor: number
}) {
  const palette = () => props.theme
  const refusal = () => startRefusal(props.parallel)

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} SWARM PLAN · ${modeLabel(props.parallel)}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {`objective  ${props.objective}`}
      </text>

      {props.rows.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {emptyCopy()}
        </text>
      ) : (
        props.rows.map((row, index) => (
          <text fg={index === props.cursor ? palette().primary : palette().foreground} wrapMode="none">
            {`${index === props.cursor ? "▸" : " "} ${row.title}  ${row.agent}  ${row.assignment}  ${laneReadOnly()}`}
          </text>
        ))
      )}

      {refusal() ? (
        <text fg={palette().error} wrapMode="none">
          {`! ${refusal()}`}
        </text>
      ) : null}
      <text fg={palette().muted} wrapMode="none">
        {readOnlyNote()}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
