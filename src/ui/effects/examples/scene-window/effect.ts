/**
 * Example window plugin: a focus card with live progress and keyboard scroll.
 *
 * The window preset supplies the frame and slots. `ctrl+d` / `ctrl+u` run the
 * plugin's commands and persist the scroll row in `ctx.store`, so the position
 * survives a reload. `ctx.state.focused` and a palette blend animate the frame.
 */
import { definePlugin, ease, mixHex, pingPong, window } from "@lockedin/sdk"

const sessions = [
  "Deep work · session 3",
  "Review: type systems",
  "Design review · 14:30",
  "Reading: compiler notes",
  "Break · 10 min",
  "Plan tomorrow",
  "Inbox zero",
]
const maxScroll = Math.max(0, sessions.length - 3)
let scroll = 0

function clampScroll(value: number): number {
  return Math.max(0, Math.min(maxScroll, Math.round(value)))
}

export default definePlugin({
  id: "example.scene-window",
  name: "Focus window",
  fps: 30,

  activate(ctx) {
    const saved = ctx.store.get("scroll")
    if (typeof saved === "number") scroll = clampScroll(saved)
  },

  commands: {
    "focus-scroll-down"(ctx) {
      scroll = clampScroll(scroll + 1)
      ctx.store.set("scroll", scroll)
      return `focus window · row ${scroll}`
    },
    "focus-scroll-up"(ctx) {
      scroll = clampScroll(scroll - 1)
      ctx.store.set("scroll", scroll)
      return `focus window · row ${scroll}`
    },
  },

  compose(ctx) {
    const time = ctx.time ?? 0
    const value = 0.2 + pingPong(time, 5) * 0.7
    const focusedWindow = ctx.state?.focusedWindow ?? null
    const accent = ctx.palette?.accent
    const warning = ctx.palette?.warning
    const glow =
      accent && warning ? mixHex(accent, warning, ease.pulse(time, 3)) : "accent"

    return {
      nodes: [
        window({
          id: "focus",
          focusable: true,
          anchor: "bottom-right",
          x: 3,
          y: 3,
          width: 44,
          height: 24,
          title: " focus ",
          titleAlign: "center",
          padding: 1,
          gap: 1,
          focused: focusedWindow === "focus",
          focusedColor: glow,
          bg: "surface",
          header: [
            { kind: "text", anchor: "top-left", x: 0, y: 0, text: "Deep work · session 3" },
            {
              kind: "group",
              anchor: "top-left",
              x: 0,
              y: 0,
              width: 40,
              height: 5,
              layout: "row",
              gap: 2,
              nodes: [
                {
                  kind: "progress",
                  anchor: "top-left",
                  x: 0,
                  y: 0,
                  width: 28,
                  height: 2,
                  value,
                  radius: 1,
                  color: "success",
                  track: "line",
                },
                {
                  kind: "arc",
                  anchor: "top-left",
                  x: 0,
                  y: 0,
                  width: 5,
                  height: 5,
                  thickness: 0.8,
                  start: -90,
                  value,
                  rounded: true,
                  color: glow,
                },
                {
                  kind: "text",
                  anchor: "top-left",
                  x: 0,
                  y: 1,
                  text: `${Math.round(value * 100)}%`,
                  fg: glow,
                },
              ],
            },
          ],
          body: sessions.map((text, index) => ({
            kind: "text" as const,
            anchor: "top-left" as const,
            x: 0,
            y: index,
            text,
            fg: index === scroll ? "foreground" : "muted",
          })),
          footer: [
            {
              kind: "text",
              anchor: "top-left",
              x: 0,
              y: 0,
              text: "ctrl+u / ctrl+d scroll · F6 focus",
              fg: "muted",
            },
          ],
          footerRule: true,
          scroll,
        }),
        window({
          id: "queue",
          focusable: true,
          anchor: "top-left",
          x: 3,
          y: 3,
          width: 30,
          height: 12,
          title: " queue ",
          padding: 1,
          gap: 1,
          focused: focusedWindow === "queue",
          focusedColor: "success",
          bg: "surface",
          header: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "Up next" }],
          body: sessions.slice(0, 3).map((text, index) => ({
            kind: "text" as const,
            anchor: "top-left" as const,
            x: 0,
            y: index,
            text,
            fg: index === 0 ? "foreground" : "muted",
          })),
          footer: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "F6 cycles focus", fg: "muted" }],
          footerRule: true,
        }),
      ],
    }
  },
})
