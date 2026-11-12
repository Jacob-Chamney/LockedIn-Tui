/**
 * The pane registry: one entry owns a surface's id, title, presentation, popup
 * size, routes and what Enter opens into. Adding a pane starts here; the key
 * router and shell layout read this table instead of keeping parallel lists.
 */
export type Presentation = "modal" | "full"

type PopupSize = { ratio?: number; rows?: number }

type PaneDef = {
  id: string
  title: string
  presentation: Presentation
  popup?: PopupSize
  /** Chooser destinations: Enter opens this full surface. */
  opensInto?: string
  /** Registry action ids that open this pane. */
  routes?: readonly string[]
}

export const PANE_DEFS = [
  { id: "chat", title: "Chat", presentation: "full" },
  { id: "chat-settings", title: "Chat settings", presentation: "modal", popup: { rows: 12 }, opensInto: "chat", routes: ["chat-settings"] },
  { id: "manager", title: "Lock-in sessions", presentation: "modal", popup: { rows: 26 }, opensInto: "chat", routes: ["sessions", "lock-in"] },
  { id: "skills", title: "Skill sessions", presentation: "modal", popup: { rows: 26 }, opensInto: "chat", routes: ["goals"] },
  { id: "work", title: "Work", presentation: "full", routes: ["work-sessions", "work-changes", "work-new"] },
  { id: "sources", title: "Sources", presentation: "modal", popup: { ratio: 0.8 }, opensInto: "chat", routes: ["add-sources"] },
  { id: "session-settings", title: "Session settings", presentation: "modal", popup: { rows: 24 }, opensInto: "chat", routes: ["session-settings"] },
  { id: "reader", title: "Reader", presentation: "full", routes: ["flashcards", "session-outputs"] },
  { id: "stats", title: "Stats", presentation: "full", routes: ["stats"] },
  { id: "achievements", title: "Achievements", presentation: "full", routes: ["achievements"] },
  { id: "archive", title: "Archive", presentation: "modal", popup: { rows: 26 }, opensInto: "chat", routes: ["archive", "archives"] },
  { id: "settings", title: "Settings", presentation: "modal", popup: { rows: 26 }, routes: ["settings"] },
  { id: "themes", title: "Theme", presentation: "modal", popup: { rows: 26 }, routes: ["themes"] },
  { id: "providers", title: "Providers", presentation: "modal", popup: { rows: 26 }, routes: ["providers"] },
  { id: "models", title: "Models", presentation: "modal", popup: { rows: 26 }, routes: ["models"] },
  { id: "review", title: "Review queue", presentation: "modal", popup: { ratio: 0.72 }, routes: ["review"] },
  { id: "recent", title: "Recent", presentation: "modal", popup: { rows: 26 } },
  { id: "projects", title: "Projects", presentation: "modal", popup: { rows: 26 }, routes: ["work-projects", "projects"] },
  { id: "swarms", title: "Swarms", presentation: "modal", popup: { rows: 26 }, routes: ["swarms", "work-swarms"] },
  { id: "agents", title: "Agents", presentation: "modal", popup: { rows: 26 }, routes: ["agents", "work-agents"] },
  { id: "agent-settings", title: "Agent settings", presentation: "modal", popup: { rows: 12 }, routes: ["agent-settings"] },
  { id: "buffers", title: "Buffers", presentation: "modal", popup: { ratio: 0.6 }, routes: ["buffers"] },
  { id: "plugins", title: "Plugins", presentation: "full" },
  { id: "task-centre", title: "Task centre", presentation: "modal", popup: { ratio: 0.62 }, opensInto: "chat", routes: ["tasks", "task-center"] },
  { id: "knowledge", title: "Knowledge", presentation: "full", routes: ["knowledge"] },
  { id: "activity", title: "Activity", presentation: "modal", popup: { rows: 26 }, routes: ["activity"] },
] as const satisfies readonly PaneDef[]

export type PaneId = (typeof PANE_DEFS)[number]["id"]

export const PANE_TITLES = Object.fromEntries(
  PANE_DEFS.map((pane) => [pane.id, pane.title]),
) as Record<PaneId, string>

export const PANE_PRESENTATION = Object.fromEntries(
  PANE_DEFS.map((pane) => [pane.id, pane.presentation]),
) as Record<PaneId, Presentation>

const POPUP_SIZE = Object.fromEntries(
  PANE_DEFS.filter((pane) => "popup" in pane).map((pane) => [pane.id, pane.popup]),
) as Partial<Record<PaneId, PopupSize>>

export function popupHeight(pane: PaneId, bodyHeight: number): number {
  const size = POPUP_SIZE[pane] ?? { ratio: 0.62 }
  const wanted = size.rows ?? Math.floor(bodyHeight * (size.ratio ?? 0.62))
  // Design §2.1: an overlay is at most 80% of the body, and never taller than
  // the body it sits in (the old `max(12, …)` overflowed short terminals).
  return Math.max(1, Math.min(Math.floor(bodyHeight * 0.8), bodyHeight - 2, wanted))
}

export function isModal(pane: PaneId): boolean {
  return PANE_PRESENTATION[pane] === "modal"
}

export const PANE_FOR_ACTION = Object.fromEntries(
  PANE_DEFS.flatMap((pane) => (("routes" in pane ? pane.routes : []) ?? []).map((route) => [route, pane.id])),
) as Record<string, PaneId>

export const OPENS_INTO = Object.fromEntries(
  PANE_DEFS.filter((pane) => "opensInto" in pane).map((pane) => [pane.id, pane.opensInto]),
) as Partial<Record<PaneId, PaneId>>
