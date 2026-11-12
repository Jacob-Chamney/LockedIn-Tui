/**
 * Session manager view model. Pure: it renders service rows and decides what a
 * destructive key means. It never archives, deletes, exports or writes a file —
 * every action is a named intent for the shell to route to WP-305.
 */
import {
  armPending,
  cancelPending as cancelManagerPending,
  confirmPending as confirmManagerPending,
  type PendingOutcome,
} from "../../panels/pending"
export type SessionRow = {
  id: string
  name: string
  date: string
  sources: number
  steps: { done: number; total: number }
  archived: boolean
  /** Set when the session cannot be opened; rendered instead of crashing. */
  broken?: string
  inboundLinks?: number
}

export type SortKey = "date" | "name" | "size"

export type SessionsState = {
  rows: SessionRow[]
  cursor: number
  query: string
  sort: SortKey
  /** A destructive action awaiting its second key, with the object named. */
  pending?: { kind: "archive" | "delete" | "export"; id: string; name: string }
  /** One line shown after a refused or completed action. */
  notice?: string | null
}

export const initialSessions = (rows: SessionRow[] = []): SessionsState => ({
  rows,
  cursor: 0,
  query: "",
  sort: "date",
  pending: undefined,
  notice: null,
})

/** Date, name, or size — size means source count here (bigger session first). */
export function sortRows(rows: SessionRow[], sort: SortKey): SessionRow[] {
  const copy = [...rows]
  switch (sort) {
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name))
    case "size":
      return copy.sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name))
    case "date":
    default:
      return copy.sort((a, b) => b.date.localeCompare(a.date))
  }
}

export function visibleRows(state: SessionsState): SessionRow[] {
  const query = state.query.trim().toLowerCase()
  const sorted = sortRows(state.rows, state.sort)
  if (!query) return sorted
  return sorted.filter((row) => row.name.toLowerCase().includes(query))
}

export function selected(state: SessionsState): SessionRow | undefined {
  return visibleRows(state)[state.cursor]
}

export function move(state: SessionsState, delta: number): SessionsState {
  const count = visibleRows(state).length
  const cursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, state.cursor + delta))
  return { ...state, cursor }
}

export function search(state: SessionsState, query: string): SessionsState {
  return { ...state, query, cursor: 0 }
}

export function cycleSort(state: SessionsState): SessionsState {
  const order: SortKey[] = ["date", "name", "size"]
  const next = order[(order.indexOf(state.sort) + 1) % order.length]!
  return { ...state, sort: next, cursor: 0 }
}

export function progressLabel(row: SessionRow): string {
  return `${row.steps.done} of ${row.steps.total} steps`
}

/**
 * The date column is a day, not an instant: the service stores an ISO stamp and
 * the list read `2026-11-03T09:00:00Z` until this trimmed it.
 */
export function dayOf(date: string): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(date) ? date.slice(0, 10) : date
}

/** The row's content; selection chrome belongs to the panel, not the model. */
export function rowText(row: SessionRow): string {
  const archived = row.archived ? "  [archived]" : ""
  const broken = row.broken ? `  × ${row.broken}` : ""
  return `${row.name}  ${dayOf(row.date)}  ${row.sources} src  ${progressLabel(row)}${archived}${broken}`
}

/** First press only arms the action and names its object. */
export function arm(state: SessionsState, kind: "archive" | "delete" | "export"): SessionsState {
  return armPending(state, selected(state), kind, "no session selected")
}

export const cancelPending = cancelManagerPending

export type ResolveOutcome = PendingOutcome

/**
 * The second press performs the action. A pending action on a different row is
 * refused rather than silently retargeted.
 */
export function confirm(state: SessionsState, kind: "archive" | "delete" | "export"): ResolveOutcome {
  return confirmManagerPending(state, selected(state), kind)
}

/** Delete names the object and warns about inbound links. */
export function warningFor(state: SessionsState, kind: "archive" | "delete" | "export"): string {
  const row = selected(state)
  if (!row) return "no session selected"
  switch (kind) {
    case "delete": {
      const links = row.inboundLinks ?? 0
      return links > 0
        ? `Delete “${row.name}”? ${links} note${links === 1 ? "" : "s"} link here; press d again to confirm`
        : `Delete “${row.name}”? This cannot be undone; press d again to confirm`
    }
    case "archive":
      return `Archive “${row.name}”? Chat history is not archived; press a again to confirm`
    case "export":
      return `Export “${row.name}” to a zip? press x again to confirm`
  }
}

export function emptyCopy(state: SessionsState): string {
  return state.rows.length === 0 ? "no lock-in sessions yet" : `no session matches “${state.query}”`
}

export function emptyHint(state: SessionsState): string {
  return state.rows.length === 0
    ? "n creates one: name, then sources and a goal"
    : "Esc clears the search"
}
