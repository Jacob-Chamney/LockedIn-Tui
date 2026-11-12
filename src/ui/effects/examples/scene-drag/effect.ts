/**
 * Example: a draggable window.
 *
 * `pointer.press/move/release` route the drag lifecycle to commands. The
 * plugin remembers the grab offset on press, moves the window on each drag
 * event, and persists the final position on release.
 */
import { definePlugin, footerActions, window } from "@lockedin/sdk"

const width = 46
const height = 15
let x = 8
let y = 6
let dragging = false
let offsetX = 0
let offsetY = 0

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(Math.max(0, max), Math.round(value)))
}

export default definePlugin({
  id: "example.scene-drag",
  name: "Drag card",
  fps: 4,

  activate(ctx) {
    const savedX = ctx.store.get("x")
    const savedY = ctx.store.get("y")
    if (typeof savedX === "number") x = savedX
    if (typeof savedY === "number") y = savedY
  },

  commands: {
    "drag-start"(ctx) {
      const pointer = ctx.pointer
      if (!pointer) return
      offsetX = pointer.x - x
      offsetY = pointer.y - y
      dragging = true
    },
    "drag-move"(ctx) {
      const pointer = ctx.pointer
      if (!pointer || !dragging) return
      const state = ctx.state
      x = clamp(pointer.x - offsetX, (state?.width ?? 120) - width)
      y = clamp(pointer.y - offsetY, (state?.height ?? 40) - height)
    },
    "drag-end"(ctx) {
      if (!dragging) return
      dragging = false
      ctx.store.set("x", x)
      ctx.store.set("y", y)
    },
  },

  compose(ctx) {
    return {
      nodes: [
        window({
          id: "card",
          focusable: true,
          anchor: "top-left",
          x,
          y,
          width,
          height,
          title: dragging ? " dragging " : " drag me ",
          titleAlign: "center",
          padding: 1,
          gap: 1,
          bg: "surface",
          focused: ctx.state?.focusedWindow === "card",
          focusedColor: "accent",
          header: [
            {
              kind: "text",
              anchor: "top-left",
              x: 0,
              y: 0,
              text: dragging ? "Moving…" : "Hold the mouse button and drag",
              fg: "accent",
            },
          ],
          body: [
            {
              kind: "text",
              anchor: "top-left",
              x: 0,
              y: 0,
              text: `x ${x} · y ${y}`,
              fg: "foreground",
            },
            {
              kind: "text",
              anchor: "top-left",
              x: 0,
              y: 2,
              text: "The position persists across reloads.",
              fg: "muted",
            },
          ],
          footer: [footerActions([{ key: "drag", label: "move" }])],
          footerRule: true,
        }),
      ],
    }
  },
})
