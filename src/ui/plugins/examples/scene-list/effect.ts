/**
 * Example: a selectable list window and a fading detail panel.
 *
 * The list uses the SDK `list` preset inside the `window` body and the footer
 * shows the actions. The selection advances on its own so the animation is
 * visible, and `ctrl+n` / `ctrl+p` take over. Whenever the selection changes
 * between even and odd rows the detail panel enters or fades out; `fadeNodes`
 * blends its colours toward the panel background at 30 fps.
 */
import {
  definePlugin,
  type SceneNode,
  fadeIn,
  fadeNodes,
  fadeOut,
  footerActions,
  list,
  window,
} from "@lockedin/sdk"

const rows = [
  { label: "Deep work", detail: "25:00" },
  { label: "Review: type systems", detail: "12 cards" },
  { label: "Design review", detail: "14:30" },
  { label: "Reading: compiler notes", detail: "8 pages" },
  { label: "Plan tomorrow", detail: "5 tasks" },
]

let manual: number | null = null
let wantedDetail = false
let changedAt = 0

function clamp(index: number): number {
  return Math.max(0, Math.min(rows.length - 1, Math.round(index)))
}

function select(ctx: { store: { set(key: string, value: number): void } }, next: number): void {
  manual = clamp(next)
  ctx.store.set("selected", manual)
}

export default definePlugin({
  id: "example.scene-list",
  name: "Selectable list",
  fps: 30,

  activate(ctx) {
    const saved = ctx.store.get("selected")
    if (typeof saved === "number") manual = clamp(saved)
  },

  commands: {
    "list-next"(ctx) {
      select(ctx, (manual ?? 0) + 1)
      return `session ${manual}`
    },
    "list-prev"(ctx) {
      select(ctx, (manual ?? 0) - 1)
      return `session ${manual}`
    },
  },

  compose(ctx) {
    const time = ctx.time ?? 0
    // Advance automatically until a key takes over.
    const selected = manual ?? Math.floor(time / 1.6) % rows.length
    const wantsDetail = selected % 2 === 1
    const wasWanted = wantedDetail
    if (wantsDetail !== wantedDetail) {
      wantedDetail = wantsDetail
      changedAt = time
    }
    const elapsed = Math.max(0, time - changedAt)
    // Enter over 0.5 s; leave over 0.35 s. A panel that was never shown has
    // nothing to fade, so its opacity stays zero.
    const opacity = wantsDetail
      ? fadeIn(elapsed, 0.5)
      : wasWanted
        ? fadeOut(elapsed, 0.35)
        : 0

    const nodes: SceneNode[] = [
      window({
        id: "list",
        focusable: true,
        anchor: "top-left",
        x: 4,
        y: 4,
        width: 48,
        height: 17,
        title: " sessions ",
        titleAlign: "center",
        padding: 1,
        gap: 1,
        focused: ctx.state?.focusedWindow === "list",
        focusedColor: "accent",
        bg: "surface",
        header: [
          {
            kind: "text",
            anchor: "top-left",
            x: 0,
            y: 0,
            text: "Up next",
            fg: "accent",
          },
        ],
        body: list({
          rows,
          selected,
          width: 42,
          height: 5,
          selectedBg: "accent",
          selectedFg: "surface",
          fg: "muted",
        }),
        footer: [
          footerActions([
            { key: "ctrl+n/p", label: "select" },
            { key: "f6", label: "focus" },
          ]),
        ],
        footerRule: true,
      }),
    ]

    if (opacity > 0.02) {
      const detail = window({
        id: "detail",
        anchor: "bottom-right",
        x: 4,
        y: 4,
        width: 36,
        height: 10,
        title: " detail ",
        padding: 1,
        gap: 1,
        bg: "surface",
        fg: "foreground",
        borderColor: "accent",
        header: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: rows[selected]!.label, fg: "foreground" },
        ],
        body: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: rows[selected]!.detail ?? "", fg: "muted" },
          { kind: "rule", anchor: "top-left", x: 0, y: 2, width: 30, color: "accent" },
          {
            kind: "text",
            anchor: "top-left",
            x: 0,
            y: 3,
            text: `fade ${Math.round(opacity * 100)}%`,
            fg: "accent",
          },
        ],
      })
      // Role names are enough: fadeNodes resolves them through the palette.
      nodes.push(...fadeNodes([detail], opacity, "surface", ctx.palette))
    }

    return { nodes }
  },
})
