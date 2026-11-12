/**
 * Swarm lanes and board.
 *
 * One lane per worker, with a glyph *and* a word for every status, so colour is
 * never the only signal. Live updates are batched by the caller; this module
 * refuses to let a finished lane regress.
 */
import type { SwarmBoard, SwarmTask, SwarmTaskStatus } from "../../services/work/swarm"
import { parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"

const GLYPH: Record<SwarmTaskStatus, string> = {
  pending: "…",
  running: "▸",
  done: "✓",
  failed: "×",
  cancelled: "—",
  blocked: "·",
}

const WORD: Record<SwarmTaskStatus, string> = {
  pending: "pending",
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
  blocked: "blocked",
}

const TERMINAL: SwarmTaskStatus[] = ["done", "failed", "cancelled"]

export function statusLabel(status: SwarmTaskStatus): string {
  return `${GLYPH[status]} ${WORD[status]}`
}

/** `▸ running · Reviewer · add pagination · read-only` */
export function laneLine(task: SwarmTask, agent: string): string {
  return `${statusLabel(task.status)} · ${agent} · ${task.title} · read-only`
}

export function isTerminal(status: SwarmTaskStatus): boolean {
  return TERMINAL.includes(status)
}

/** A lane never regresses from a finished state back to running or pending. */
export function applyUpdate(task: SwarmTask, next: Partial<SwarmTask>): SwarmTask {
  if (next.status && isTerminal(task.status) && !isTerminal(next.status)) return task
  return { ...task, ...next }
}

export function applyBatch(board: SwarmBoard, updates: Array<{ id: string } & Partial<SwarmTask>>): SwarmBoard {
  const byId = new Map(updates.map((update) => [update.id, update]))
  return {
    ...board,
    tasks: board.tasks.map((task) => {
      const update = byId.get(task.id)
      return update ? applyUpdate(task, update) : task
    }),
  }
}

export function hasOutput(task: SwarmTask): boolean {
  return typeof task.summary === "string" && task.summary.length > 0
}

export const CANCEL_COPY = "this task already produced output · press c again to stop it"

export type CancelTask =
  | { kind: "cancel"; taskId: string }
  | { kind: "confirm"; taskId: string; reason: string }
  | { kind: "refused"; reason: string }

export function cancelTask(board: SwarmBoard, taskId: string, confirmed = false): CancelTask {
  const task = board.tasks.find((entry) => entry.id === taskId)
  if (!task) return { kind: "refused", reason: "no task selected" }
  if (isTerminal(task.status)) return { kind: "refused", reason: `${task.title} already ${WORD[task.status]}` }
  if (hasOutput(task) && !confirmed) return { kind: "confirm", taskId, reason: CANCEL_COPY }
  return { kind: "cancel", taskId }
}

export type CancelRun = { board: SwarmBoard; stopped: number }

/** Cancelling the run cancels the remainder and reports how many were stopped. */
export function cancelRun(board: SwarmBoard): CancelRun {
  let stopped = 0
  const tasks = board.tasks.map((task) => {
    if (isTerminal(task.status)) return task
    stopped += 1
    return { ...task, status: "cancelled" as const }
  })
  return { board: { ...board, tasks, status: "cancelled", live: false }, stopped }
}

export function cancelRunCopy(stopped: number): string {
  return `cancelled the run · ${stopped} task${stopped === 1 ? "" : "s"} stopped`
}

/** A retry is a new, single-agent, read-only run beside the original. */
export type RetryRequest = { kind: "retry"; runId: string; taskId: string; parallel: 1; parallelLabel: string; readOnly: true }

export function retryRequest(board: SwarmBoard, taskId: string): RetryRequest | { kind: "refused"; reason: string } {
  const task = board.tasks.find((entry) => entry.id === taskId)
  if (!task) return { kind: "refused", reason: "no task selected" }
  if (task.status !== "failed") return { kind: "refused", reason: `only a failed task can be retried; ${task.title} is ${WORD[task.status]}` }
  return { kind: "retry", runId: board.runId, taskId, parallel: 1, parallelLabel: "one agent", readOnly: true }
}

export function reportHeader(board: SwarmBoard): string {
  return `${board.objective} · ${board.status} · ${board.tasks.length} task${board.tasks.length === 1 ? "" : "s"}`
}

export function retryBadge(board: SwarmBoard): string | null {
  return board.retryOf ? `retry of ${board.retryOf.runId} · one agent · read-only` : null
}

export function layoutFor(width: number): "columns" | "rows" {
  return width >= 160 ? "columns" : "rows"
}

export type BoardIntent = "down" | "up" | "open" | "cancel" | "cancel-run" | "retry" | "report" | "close"

const SPECS: Array<{ intent: BoardIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k lane" },
  { intent: "up", key: "k", footer: "" },
  { intent: "open", key: "return", footer: "Enter result" },
  { intent: "cancel", key: "c", footer: "c cancel task" },
  { intent: "retry", key: "shift+r", footer: "R retry" },
  { intent: "report", key: "o", footer: "o report" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`board key "${key}": ${binding.message}`)
  return binding
}

export const BOARD_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean } = {}): BoardIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower === "enter" ? "return" : lower
  return BOARD_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return BOARD_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function SwarmBoardPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  board: SwarmBoard
  agents: Record<string, string>
  cursor: number
  notice?: string | null
}) {
  const palette = () => props.theme
  const columns = layoutFor(props.width) === "columns"
  const badge = retryBadge(props.board)

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} SWARM · ${props.board.status} · ${props.board.parallel > 1 ? `parallel · ${props.board.parallel} of 4` : "sequential"}`}
      </text>
      {badge ? (
        <text fg={palette().secondary} wrapMode="none">
          {badge}
        </text>
      ) : null}

      {props.board.tasks.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {"no tasks in this run · press n to plan one"}
        </text>
      ) : (
        <box flexDirection={columns ? "row" : "column"}>
          {props.board.tasks.map((task, index) => (
            <text
              fg={
                task.status === "failed"
                  ? palette().error
                  : task.status === "cancelled"
                    ? palette().muted
                    : index === props.cursor
                      ? palette().primary
                      : palette().foreground
              }
              wrapMode="none"
            >
              {`${index === props.cursor ? ">" : " "} ${laneLine(task, props.agents[task.agentId] ?? task.agentId)}`}
            </text>
          ))}
        </box>
      )}

      <text fg={palette().muted} wrapMode="none">
        {"every worker is read-only · nothing here grants write or command access"}
      </text>
      {props.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.notice}`}
        </text>
      ) : null}
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
