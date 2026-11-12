/**
 * Example: reorder dashboard panels by dragging one onto another.
 *
 * press picks up the panel under the pointer, move tracks the panel underneath,
 * and release swaps their grid slots. The order is persisted in `ctx.store`, so
 * a reload keeps the arrangement.
 */
import { dashboard, definePlugin, footerActions } from "@lockedin/sdk"

const panels = [
  {
    id: "alpha",
    title: " alpha ",
    lines: ["Drag this panel onto the", "other one to swap slots."],
    color: "accent" as const,
  },
  {
    id: "beta",
    title: " beta ",
    lines: ["The order is persisted", "in the plugin store."],
    color: "success" as const,
  },
]

let order = ["alpha", "beta"]
let dragging: string | null = null
let over: string | null = null

function known(id: string | undefined): boolean {
  return typeof id === "string" && panels.some((panel) => panel.id === id)
}

export default definePlugin({
  id: "example.scene-reorder",
  name: "Reorder panels",
  fps: 4,

  activate(ctx) {
    const saved = ctx.store.get("order")
    if (typeof saved !== "string") return
    const parts = saved.split(",").filter((id) => known(id))
    if (parts.length === panels.length) order = parts
  },

  commands: {
    "reorder-start"(ctx) {
      const id = ctx.pointer?.window
      if (!known(id) || !order.includes(id!)) return
      dragging = id!
      over = null
    },
    "reorder-move"(ctx) {
      if (!dragging) return
      const id = ctx.pointer?.window
      over = known(id) && id !== dragging ? id! : null
    },
    "reorder-end"(ctx) {
      if (!dragging) return
      const moved = dragging
      const target = over
      if (target) {
        const from = order.indexOf(moved)
        const to = order.indexOf(target)
        if (from >= 0 && to >= 0) {
          ;[order[from], order[to]] = [order[to]!, order[from]!]
        }
      }
      dragging = null
      over = null
      ctx.store.set("order", order.join(","))
      return target ? `${moved} ⇄ ${target}` : undefined
    },
  },

  compose(ctx) {
    const focused = ctx.state?.focusedWindow ?? null
    return {
      nodes: [
        dashboard({
          anchor: "top-left",
          x: 2,
          y: 2,
          width: 84,
          height: 22,
          columns: 2,
          gap: 2,
          padding: 1,
          border: true,
          title: " reorder ",
          titleAlign: "center",
          bg: "background",
          borderColor: "line",
          panels: order.map((id) => {
            const panel = panels.find((entry) => entry.id === id)!
            return {
              window: {
                id: panel.id,
                focusable: true,
                title: dragging === panel.id ? " moving " : panel.title,
                padding: 1,
                gap: 1,
                bg: "surface",
                focused: focused === panel.id,
                focusedColor: panel.color,
                borderColor:
                  dragging === panel.id
                    ? "warning"
                    : over === panel.id
                      ? "success"
                      : "line",
                body: [
                  {
                    kind: "text",
                    anchor: "top-left",
                    x: 0,
                    y: 0,
                    text: dragging === panel.id ? "Moving…" : panel.lines[0]!,
                    fg: panel.color,
                  },
                  {
                    kind: "text",
                    anchor: "top-left",
                    x: 0,
                    y: 2,
                    text: panel.lines[1]!,
                    fg: "muted",
                  },
                  {
                    kind: "text",
                    anchor: "top-left",
                    x: 0,
                    y: 4,
                    text: `slot ${order.indexOf(panel.id) + 1}`,
                    fg: "foreground",
                  },
                ],
                footer: [footerActions([{ key: "drag", label: "swap" }, { key: "f6", label: "focus" }])],
                footerRule: true,
              },
            }
          }),
        }),
      ],
    }
  },
})
