/**
 * Example: a workbench built from the layout presets.
 *
 * `kpiStrip` puts four metric cards across the top; `sidebarMain` places a
 * navigation window beside a session table. Both return ordinary windows, so
 * ids, focus cycling, tables and commands compose without extra wiring.
 */
import {
  definePlugin,
  footerActions,
  kpiStrip,
  sidebarMain,
  table,
} from "@lockedin/sdk"

const columns = [
  { label: "session", width: 16 },
  { label: "time", width: 7, align: "right" as const },
  { label: "state", width: 9, align: "center" as const },
]

const rows = [
  { cells: ["Deep work", "25:00", "running"] },
  { cells: ["Type systems", "12 cards", "queued"] },
  { cells: ["Design review", "14:30", "today"] },
  { cells: ["Compiler notes", "8 pages", "later"] },
  { cells: ["Plan tomorrow", "5 tasks", "todo"] },
  { cells: ["Inbox zero", "12 items", "todo"] },
]

const menu = [
  "Sessions",
  "Review queue",
  "Knowledge base",
  "Stats",
  "Settings",
]

let manual: number | null = null

function clamp(index: number): number {
  return Math.max(0, Math.min(rows.length - 1, Math.round(index)))
}

export default definePlugin({
  id: "example.scene-workbench",
  name: "Session workbench",
  fps: 4,

  activate(ctx) {
    const saved = ctx.store.get("selected")
    if (typeof saved === "number") manual = clamp(saved)
  },

  commands: {
    "workbench-next"(ctx) {
      manual = clamp((manual ?? 0) + 1)
      ctx.store.set("selected", manual)
      return `session ${manual}`
    },
    "workbench-prev"(ctx) {
      manual = clamp((manual ?? 0) - 1)
      ctx.store.set("selected", manual)
      return `session ${manual}`
    },
  },

  compose(ctx) {
    const time = ctx.time ?? 0
    const selected = manual ?? Math.floor(time / 2) % rows.length
    const focused = ctx.state?.focusedWindow ?? null

    const metrics = kpiStrip({
      anchor: "top-left",
      x: 2,
      y: 2,
      width: 92,
      height: 6,
      gap: 1,
      metrics: [
        { label: "focus", value: "3h 20m", detail: "today", color: "success" },
        { label: "streak", value: "12 days", detail: "best", color: "warning" },
        { label: "sessions", value: "4", detail: "2 queued", color: "accent" },
        { label: "queue", value: "8", detail: "3 due", color: "muted" },
      ],
    })

    const split = sidebarMain({
      anchor: "top-left",
      x: 2,
      y: 9,
      width: 92,
      height: 26,
      sidebarWidth: 24,
      gap: 2,
      padding: 1,
      border: true,
      title: " workbench ",
      titleAlign: "center",
      bg: "background",
      borderColor: "line",
      sidebar: {
        id: "menu",
        focusable: true,
        title: " menu ",
        padding: 1,
        gap: 0,
        bg: "surface",
        focused: focused === "menu",
        focusedColor: "accent",
        header: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "Workspace", fg: "accent" },
        ],
        body: menu.map((text, index) => ({
          kind: "text" as const,
          anchor: "top-left" as const,
          x: 0,
          y: index,
          text,
          fg: index === 0 ? "foreground" : "muted",
        })),
        footer: [footerActions([{ key: "f6", label: "focus" }])],
        footerRule: true,
      },
      main: {
        id: "sessions",
        focusable: true,
        title: " sessions ",
        padding: 1,
        gap: 1,
        bg: "surface",
        focused: focused === "sessions",
        focusedColor: "success",
        header: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "Up next", fg: "accent" },
        ],
        body: table({
          columns,
          rows,
          selected,
          height: 6,
          selectedBg: "accent",
          selectedFg: "surface",
          cursorBg: "warning",
          cursorFg: "background",
          fg: "muted",
        }),
        footer: [
          footerActions([
            { key: "ctrl+n/p", label: "select" },
            { key: "o", label: "open" },
          ]),
        ],
        footerRule: true,
      },
    })

    return { nodes: [metrics, split] }
  },
})
