/**
 * Activity log viewer.
 *
 * Read-only, by construction: the record shape carries no body, prompt, diff or
 * command output, and nothing here can write, prune or rotate the log. The pane
 * renders the fields WP-507 writes and nothing else.
 */
import { ACTIVITY_KINDS, type ActivityKind, type ActivityRecord } from "../../services/work/activity"
import type { CommandDecisionEvent } from "../../services/work/commands"
import type { SwarmActivityEvent } from "../../services/work/swarm"
import type { WriteDecisionEvent } from "../../services/work/writes"
import { parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"
import { FloatingWindow, WindowBody, WindowFooter, WindowHeader } from "../panels/floating-window"
import { PanelEmpty } from "../panels/panel-frame"
import { windowStart } from "../panels/select-list"

export type Filter = { kind: ActivityKind | null; project: string | null }

export type ActivityView = {
  filter: Filter
  cursor: number
  /** One line when a write decision's target no longer exists. */
  notice?: string | null
}

export const initialActivity: ActivityView = { filter: { kind: null, project: null }, cursor: 0, notice: null }

/** Newest first; equal timestamps keep file order. */
export function sortRecords(records: readonly ActivityRecord[]): ActivityRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => (b.record.at.localeCompare(a.record.at) || a.index - b.index))
    .map((entry) => entry.record)
}

export function visibleRecords(
  records: readonly ActivityRecord[],
  filter: Filter,
): ActivityRecord[] {
  return sortRecords(records).filter(
    (record) =>
      (filter.kind === null || record.kind === filter.kind) &&
      (filter.project === null || record.project === filter.project),
  )
}

/** `k` cycles through every kind and back to all. */
export function cycleKind(view: ActivityView): ActivityView {
  const order: Array<ActivityKind | null> = [null, ...ACTIVITY_KINDS]
  const at = order.indexOf(view.filter.kind)
  const kind = order[(at + 1) % order.length]!
  return { ...view, filter: { ...view.filter, kind }, cursor: 0, notice: null }
}

export function filterProject(view: ActivityView, project: string): ActivityView {
  const next = view.filter.project === project ? null : project
  return { ...view, filter: { ...view.filter, project: next }, cursor: 0, notice: null }
}

export function clearFilters(view: ActivityView): ActivityView {
  return { ...view, filter: { kind: null, project: null }, cursor: 0, notice: null }
}

export function headerLine(view: ActivityView, visible: number, skipped: number): string {
  const kind = view.filter.kind ?? "all kinds"
  const project = view.filter.project ?? "all projects"
  return `ACTIVITY · ${kind} · ${project} · ${visible} shown${skipped > 0 ? ` · ${skipped} skipped` : ""}`
}

/** A decision is a word plus a glyph, so colour is never the only signal. */
export function decisionLabel(decision: "approve" | "reject" | "deny"): string {
  if (decision === "approve") return "approved ✓"
  return decision === "reject" ? "rejected ×" : "denied ×"
}

/** The one-line summary: path, argv, or run + event. Never a body. */
export function summaryOf(record: ActivityRecord): string {
  switch (record.kind) {
    case "write-decision": {
      const write = record as WriteDecisionEvent
      return `${write.path} · ${decisionLabel(write.decision)}`
    }
    case "command-decision": {
      const command = record as CommandDecisionEvent
      return `${command.argv.join(" ")} · ${decisionLabel(command.decision)}`
    }
    case "swarm": {
      const event = record as SwarmActivityEvent
      return `${event.run} · ${event.event}${event.task ? ` · ${event.task}` : ""}`
    }
  }
}

export function rowText(record: ActivityRecord): string {
  return `${record.at}  ${record.kind}  ${record.project}  ${summaryOf(record)}`
}

export function emptyCopy(): string {
  return "no activity yet"
}

export function filteredEmptyCopy(view: ActivityView): string {
  return `no ${view.filter.kind ?? "matching"} records for this project · c to clear`
}

export type ActivityIntent = "down" | "up" | "kind" | "project" | "clear" | "open" | "close"

const SPECS: Array<{ intent: ActivityIntent; key: string; footer: string }> = [
  // The packet assigns k/p/c to the filters, so movement is j and shifted k.
  { intent: "down", key: "j", footer: "j/K move" },
  { intent: "up", key: "shift+k", footer: "" },
  { intent: "kind", key: "k", footer: "k kind" },
  { intent: "project", key: "p", footer: "p project" },
  { intent: "clear", key: "c", footer: "c clear" },
  { intent: "open", key: "return", footer: "Enter open" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`activity key "${key}": ${binding.message}`)
  return binding
}

export const ACTIVITY_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean } = {}): ActivityIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower === "enter" ? "return" : lower
  return ACTIVITY_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return ACTIVITY_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

/** `Enter` only opens a write decision, and only when the change still exists. */
export type OpenResult =
  | { kind: "open"; path: string }
  | { kind: "refused"; reason: string }

export function openSelected(record: ActivityRecord | undefined): OpenResult {
  if (!record) return { kind: "refused", reason: "select a record first" }
  if (record.kind !== "write-decision") {
    return { kind: "refused", reason: `${record.kind} records have nothing to open` }
  }
  return { kind: "open", path: (record as WriteDecisionEvent).path }
}

export function missingTargetCopy(path: string): string {
  return `${path} no longer exists · the decision is still logged`
}

export function fitRow(text: string, width: number): string {
  const room = Math.max(8, width - 2)
  return text.length <= room ? text : `${text.slice(0, room - 1)}…`
}

export function ActivityPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  view: ActivityView
  records: readonly ActivityRecord[]
  skipped: number
}) {
  const palette = () => props.theme
  const rows = () => visibleRecords(props.records, props.view.filter)
  const size = () => Math.max(1, props.height - 4)
  const start = () => windowStart(props.view.cursor, rows().length, size())
  const windowed = () => rows().slice(start(), start() + size())
  const empty = () => rows().length === 0
  const deepEmpty = () => props.records.length === 0

  return (
    <FloatingWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      header={
        <WindowHeader
          theme={palette()}
          title="Activity"
          meta={`${rows().length} shown`}
          detail={headerLine(props.view, rows().length, props.skipped)}
          detailWrap="none"
        />
      }
      footer={<WindowFooter theme={palette()} hints={["Esc back"]} width={props.width} />}
      notice={props.view.notice}
    >
      {deepEmpty() ? (
        <WindowBody center>
          <PanelEmpty theme={palette()} line={emptyCopy()} />
        </WindowBody>
      ) : empty() ? (
        <WindowBody center>
          <PanelEmpty theme={palette()} line={filteredEmptyCopy(props.view)} />
        </WindowBody>
      ) : (
        <WindowBody>
          {windowed().map((record, offset) => {
            const index = start() + offset
            return (
              <text
                fg={
                  record.kind === "write-decision" && record.decision !== "approve"
                    ? palette().error
                    : record.kind === "command-decision" && record.decision === "deny"
                      ? palette().error
                      : index === props.view.cursor
                        ? palette().primary
                        : palette().foreground
                }
                wrapMode="none"
              >
                {`${index === props.view.cursor ? "▸" : " "} ${fitRow(rowText(record), props.width - 2)}`}
              </text>
            )
          })}
        </WindowBody>
      )}
    </FloatingWindow>
  )
}
