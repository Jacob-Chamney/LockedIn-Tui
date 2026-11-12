/**
 * Task centre: background work in one list, with a cancel path on every
 * running row. Never a modal — failures land here plus a toast.
 */
import type { TaskRecord, TaskRegistry } from "../../../domain/tasks"
import { isTerminal } from "../../../domain/tasks"
import type { ThemePalette } from "../../theme"
import { WindowBody } from "../../panels/floating-window"
import { PanelEmpty } from "../../panels/panel-frame"
import { PanelWindow } from "../../panels/panel-window"
import { SelectList } from "../../panels/select-list"
import { footerHints } from "./tasks-keys"

export type TaskGlyph = { glyph: string; word: string }

export function glyphFor(task: TaskRecord): TaskGlyph {
  switch (task.status) {
    case "running":
      return { glyph: "▸", word: "running" }
    case "done":
      return { glyph: "✓", word: "done" }
    case "failed":
      return { glyph: "×", word: "failed" }
    case "cancelled":
      return { glyph: "—", word: "cancelled" }
  }
}

/** Elapsed seconds, rounded down; finished tasks freeze at their finish time. */
export function elapsedSeconds(task: TaskRecord, now: number): number {
  const start = Date.parse(task.startedAt)
  const end = task.finishedAt ? Date.parse(task.finishedAt) : now
  return Math.max(0, Math.floor((end - start) / 1000))
}

export function elapsedLabel(task: TaskRecord, now: number): string {
  const seconds = elapsedSeconds(task, now)
  return isTerminal(task.status) ? glyphFor(task).word : `${seconds}s`
}

export function rowText(task: TaskRecord, now: number): string {
  const { glyph } = glyphFor(task)
  return `${glyph} ${task.label}  ${elapsedLabel(task, now)}`
}

export function emptyCopy(): string {
  return "no background work · start a chat or a generation to see it here"
}

export function cancelNotice(outcome: string, task: TaskRecord | undefined): string {
  if (outcome === "already-finished") return `${task?.label ?? "That task"} already finished; nothing to cancel.`
  if (outcome === "needs-confirmation") return "This task already produced output. Press c again to stop it."
  if (outcome === "unknown") return "That task is no longer in the list."
  return "Stopping…"
}

/** The named middle region of the Task centre window. */
export function TaskList(props: {
  theme: ThemePalette
  height: number
  registry: TaskRegistry
  cursor: number
  now: number
}) {
  const palette = () => props.theme
  const tasks = () => props.registry.list()
  const selected = () => tasks()[props.cursor]
  return (
    <>
      {tasks().length === 0 ? (
        <WindowBody center>
          <PanelEmpty theme={palette()} line={emptyCopy()} />
        </WindowBody>
      ) : (
        <WindowBody>
          <SelectList
            theme={palette()}
            cursor={props.cursor}
            visibleCount={Math.max(1, props.height - 8)}
            rows={tasks().map((task) => ({
              id: task.id,
              label: rowText(task, props.now),
              tone: task.status === "failed" ? "error" : isTerminal(task.status) ? "muted" : "normal",
            }))}
          />
        </WindowBody>
      )}
      {selected()?.error ? (
        <text fg={palette().error} wrapMode="none">
          {`× ${selected()!.error}`}
        </text>
      ) : null}
    </>
  )
}

export function TasksPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  registry: TaskRegistry
  cursor: number
  now: number
  notice?: string | null
}) {
  const palette = () => props.theme
  return (
    <PanelWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      title="Task centre"
      meta={`${props.registry.runningCount()} running`}
      detail="Chats, generations and tool runs in flight, newest first."
      hints={footerHints().split(" · ")}
      notice={props.notice}
    >
      <TaskList
        theme={palette()}
        height={props.height}
        registry={props.registry}
        cursor={props.cursor}
        now={props.now}
      />
    </PanelWindow>
  )
}
