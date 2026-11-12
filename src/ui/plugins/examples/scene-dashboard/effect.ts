/**
 * Example: a two-panel dashboard.
 *
 * `dashboard` puts the windows in a shared grid; each panel keeps its own id,
 * focus state and slots. The left panel is a selectable table, the right one a
 * live detail card. `F6` cycles the focus registry, `ctrl+n`/`ctrl+p` select a
 * row, `o` is a primary action and `p` a secondary pin toggle.
 */
import {
  dashboard,
  definePlugin,
  footerActions,
  pingPong,
  table,
} from "@lockedin/sdk"

const columns = [
  { label: "session", width: 14 },
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
  { cells: ["Weekly review", "4 notes", "fri"] },
  { cells: ["Ship notes", "3 files", "draft"] },
]

const visibleRows = 5

let manual: number | null = null
let column = 0
let pinned: string | null = null
let hover: string | null = null
let scroll = 0

function clamp(index: number): number {
  return Math.max(0, Math.min(rows.length - 1, Math.round(index)))
}

function label(index: number): string {
  return rows[index]!.cells[0] ?? ""
}

function clampColumn(index: number): number {
  return Math.max(0, Math.min(columns.length - 1, Math.round(index)))
}

export default definePlugin({
  id: "example.scene-dashboard",
  name: "Session dashboard",
  fps: 10,

  activate(ctx) {
    const saved = ctx.store.get("selected")
    if (typeof saved === "number") manual = clamp(saved)
    const savedPin = ctx.store.get("pinned")
    if (typeof savedPin === "string") pinned = savedPin
    const savedColumn = ctx.store.get("column")
    if (typeof savedColumn === "number") column = clampColumn(savedColumn)
    const savedScroll = ctx.store.get("scroll")
    if (typeof savedScroll === "number") {
      scroll = Math.max(0, Math.min(rows.length - visibleRows, Math.round(savedScroll)))
    }
  },

  commands: {
    "dashboard-next"(ctx) {
      manual = clamp((manual ?? 0) + 1)
      ctx.store.set("selected", manual)
      return `session ${manual}`
    },
    "dashboard-prev"(ctx) {
      manual = clamp((manual ?? 0) - 1)
      ctx.store.set("selected", manual)
      return `session ${manual}`
    },
    "dashboard-open"(ctx) {
      const index = manual ?? 0
      ctx.store.set("selected", index)
      return `${label(index)} · ${rows[index]!.cells[2] ?? ""}`
    },
    "dashboard-pin"(ctx) {
      const index = manual ?? 0
      ctx.store.set("selected", index)
      pinned = pinned === label(index) ? null : label(index)
      ctx.store.set("pinned", pinned)
      return pinned ? `pinned ${pinned}` : "unpinned"
    },
    "dashboard-click"(ctx) {
      const pointer = ctx.pointer
      if (!pointer || pointer.row === undefined || pointer.column === undefined) return
      manual = clamp(pointer.row)
      column = clampColumn(pointer.column)
      hover = `${manual}:${column}`
      ctx.store.set("selected", manual)
      ctx.store.set("column", column)
      return `cell ${manual}:${column} · ${rows[manual]!.cells[column] ?? ""}`
    },
    "dashboard-hover"(ctx) {
      const pointer = ctx.pointer
      if (!pointer || pointer.row === undefined || pointer.column === undefined) return
      hover = `${pointer.row}:${pointer.column}`
    },
    "dashboard-wheel"(ctx) {
      const info = ctx.pointer?.scroll
      if (!info) return
      const step = info.direction === "up" ? -1 : info.direction === "down" ? 1 : 0
      if (step === 0) return
      scroll = Math.max(0, Math.min(rows.length - visibleRows, scroll + step))
      ctx.store.set("scroll", scroll)
    },
    "dashboard-copy"(ctx) {
      const index = manual ?? 0
      ctx.store.set("selected", index)
      const row = rows[index]!
      return {
        message: `copied ${label(index)}`,
        copy: `${label(index)} · ${row.cells[1] ?? ""} · ${row.cells[2] ?? ""}`,
      }
    },
  },

  compose(ctx) {
    const time = ctx.time ?? 0
    const selected = manual ?? Math.floor(time / 1.8) % rows.length
    const focused = ctx.state?.focusedWindow ?? null
    const value = 0.15 + pingPong(time, 4) * 0.8

    const board = dashboard({
      anchor: "top-left",
      x: 2,
      y: 2,
      width: 84,
      height: 28,
      columns: 2,
      gap: 2,
      padding: 1,
      border: true,
      title: " workspace ",
      titleAlign: "center",
      bg: "background",
      borderColor: "line",
      panels: [
        {
          window: {
            id: "sessions",
            focusable: true,
            title: " sessions ",
            padding: 1,
            gap: 1,
            bg: "surface",
            focused: focused === "sessions",
            focusedColor: "accent",
            header: [
              { kind: "text", anchor: "top-left", x: 0, y: 0, text: "Up next", fg: "accent" },
            ],
            body: table({
              columns,
              rows,
              selected,
              column,
              hit: true,
              height: visibleRows,
              scroll,
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
              footerActions([
                { key: "p", label: "pin" },
                { key: "y", label: "copy" },
              ]),
            ],
            footerRule: true,
          },
        },
        {
          window: {
            id: "detail",
            focusable: true,
            title: " detail ",
            padding: 1,
            gap: 1,
            bg: "surface",
            focused: focused === "detail",
            focusedColor: "success",
            header: [
              {
                kind: "text",
                anchor: "top-left",
                x: 0,
                y: 0,
                text: label(selected),
                fg: "foreground",
              },
              {
                kind: "text",
                anchor: "top-left",
                x: 0,
                y: 1,
                text: `${rows[selected]!.cells[1] ?? ""} · ${rows[selected]!.cells[2] ?? ""}`,
                fg: "muted",
              },
            ],
            body: [
              {
                kind: "progress",
                anchor: "top-left",
                x: 0,
                y: 0,
                width: 32,
                height: 2,
                value,
                radius: 1,
                color: "success",
                track: "line",
              },
              {
                kind: "text",
                anchor: "top-left",
                x: 0,
                y: 2,
                text: `${Math.round(value * 100)}% through the session`,
                fg: "success",
              },
              {
                kind: "text",
                anchor: "top-left",
                x: 0,
                y: 4,
                text: pinned ? `pinned · ${pinned}` : "pinned · none",
                fg: pinned ? "warning" : "muted",
              },
              {
                kind: "text",
                anchor: "top-left",
                x: 0,
                y: 5,
                text: `hover · ${hover ?? "none"} · scroll ${scroll}`,
                fg: "muted",
              },
            ],
            footer: [
              footerActions([
                { key: "f6", label: "focus" },
                { key: "o", label: "open" },
              ]),
            ],
            footerRule: true,
          },
        },
      ],
    })

    return { nodes: [board] }
  },
})
