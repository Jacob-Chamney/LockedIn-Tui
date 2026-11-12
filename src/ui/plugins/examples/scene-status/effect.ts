/**
 * Example scene plugin: a status card pinned to the top-right, plus one
 * absolutely placed box.
 *
 * Copy this directory, change the manifest id and the nodes, and point
 * LOCKEDIN_PLUGINS_DIR at it. The host validates every node and paints it;
 * the plugin never receives the terminal buffer.
 */
let visible = true

type Store = { get: (key: string) => unknown; set: (key: string, value: string | number | boolean | null) => void }

export default {
  id: "example.scene-status",
  name: "Status card",

  activate(ctx: { store: Store }) {
    const saved = ctx.store.get("visible")
    if (typeof saved === "boolean") visible = saved
  },

  commands: {
    "scene-status-toggle"(ctx: { store: Store }) {
      visible = !visible
      ctx.store.set("visible", visible)
      return visible ? "status card shown" : "status card hidden"
    },
  },
  compose(ctx: { state: { mode: string; pane: string }; time: number }) {
    if (!visible) return { nodes: [] }
    const state = ctx.state
    return {
      nodes: [
        {
          kind: "box",
          anchor: "top-right",
          x: 1,
          y: 1,
          width: 22,
          height: 4,
          title: " status ",
          borderColor: "accent",
        },
        { kind: "text", anchor: "top-right", x: 3, y: 2, text: "mode  " + state.mode },
        { kind: "text", anchor: "top-right", x: 3, y: 3, text: "pane  " + state.pane },
        // Absolute placement needs "absolute": true in the manifest.
        {
          kind: "box",
          anchor: "absolute",
          x: 4,
          y: 3,
          width: 18,
          height: 3,
          title: " pinned ",
          borderColor: "warning",
        },
      ],
    }
  },
}
