/**
 * The Knowledge window.
 *
 * One keyboard model, two renderers. On a graphics terminal (Kitty, Ghostty,
 * WezTerm, foot, iTerm2) the nodes are real pixels: celestial stars, depth
 * fades and a themed halo. On a terminal without image support the same graph
 * is an indented tree, so every action still works.
 *
 * Neither renderer writes anything. A note opens in an in-window reader; the
 * vault is untouched.
 */
import { NativeImagePool, type NativeImage } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { onAnimationTick, useRenderer } from "@opentui/solid"

import type { KnowledgeGraph, KnowledgeNote } from "../../services/knowledge/graph"
import { flattenTopics, GENERAL_TOPIC, topicsFor } from "../../services/knowledge/graph"
import type { ThemePalette } from "../theme"
import { MarkdownBody } from "../reader/markdown-body"
import {
  breadcrumb,
  focusNode,
  navigationOrder,
  type KnowledgeState,
} from "./model"
import { buildScene, MAX_SCENE_NOTES, type Camera, type Scene } from "./scene"
import { labelPoints, renderScene } from "./raster"
import { useGraphics } from "../use-graphics"
import { FRAME_RATE } from "../frame-rate"

const HEADER_ROWS = 2
const FOOTER_ROWS = 2

/** Last real terminal pixels per cell; survives a resize that clears it. */
let knowledgeCell: { width: number; height: number } | null = null

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}


/** Indent level: a root topic is 0, its children 1, a note sits under its topic. */
function topicDepth(graph: KnowledgeGraph, item: { id: string; kind: string }): number {
  const node = focusNode(graph, item.id)
  if (node?.kind === "topic") return Math.max(0, node.topic.path.split("/").length - 1)
  if (node?.kind === "note") return (topicsFor(node.note.topics)[0] ?? GENERAL_TOPIC).split("/").length
  return 0
}

function kindGlyph(graph: KnowledgeGraph, item: { id: string; kind: string }): string {
  if (item.kind === "note") return "●"
  return topicDepth(graph, item) === 0 ? "◆" : "▸"
}

function noteFor(graph: KnowledgeGraph, id: string | null): KnowledgeNote | null {
  if (id === null) return null
  return graph.notes.find((note) => note.id === id) ?? null
}

function metaFor(note: KnowledgeNote): string {
  const topic = (topicsFor(note.topics)[0] ?? GENERAL_TOPIC).split("/").join(" › ")
  const when = new Date(note.updated)
  const age = Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 10)
  return `${note.section === "school" ? "School" : "Skills"} › ${topic}${age ? ` · ${age}` : ""}`
}

export function KnowledgeWindow(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  graph: KnowledgeGraph
  state: KnowledgeState
  reducedMotion?: boolean
  /** Test/embed override: force the pixel renderer on or off. */
  graphics?: boolean
}) {
  const palette = () => props.theme
  const columns = () => Math.max(20, props.width)
  const rows = () => Math.max(6, props.height)
  const diagnostic = () => props.graph.diagnostics[0] ?? null
  const diagnosticExtra = () => Math.max(0, props.graph.diagnostics.length - 1)
  const bodyRows = () =>
    Math.max(
      3,
      rows() -
        HEADER_ROWS -
        FOOTER_ROWS -
        (props.state.notice ? 1 : 0) -
        (diagnostic() ? 1 : 0),
    )
  const [cellVersion, setCellVersion] = createSignal(0)
  const cell = () => {
    const resolution = renderer.resolution
    if (resolution && renderer.width > 0 && renderer.height > 0) {
      knowledgeCell = {
        width: resolution.width / renderer.width,
        height: resolution.height / renderer.height,
      }
    }
    cellVersion()
    return knowledgeCell ?? { width: 8, height: 16 }
  }
  const widthPx = () => Math.max(160, Math.round(columns() * cell().width))
  const heightPx = () => Math.max(120, Math.round(bodyRows() * cell().height))

  const graphics = useGraphics(props.graphics)
  const renderer = useRenderer()

  onMount(() => {
    const measure = () => {
      const resolution = renderer.resolution
      if (!resolution || renderer.width <= 0 || renderer.height <= 0) return
      const next = {
        width: resolution.width / renderer.width,
        height: resolution.height / renderer.height,
      }
      if (
        !knowledgeCell ||
        knowledgeCell.width !== next.width ||
        knowledgeCell.height !== next.height
      ) {
        knowledgeCell = next
        setCellVersion((value) => value + 1)
      }
    }
    measure()
    renderer.on("frame", measure)
    onCleanup(() => renderer.off("frame", measure))
  })
  const animated = () =>
    graphics() && !props.reducedMotion && props.state.reading === null && !props.state.list

  const [frame, setFrame] = createSignal<NativeImage | null>(null)
  const [camera, setCamera] = createSignal<Camera | null>(null)

  const baseScene = (): Scene => buildScene(props.graph, props.state.focus, widthPx(), heightPx())
  const scene = (): Scene => {
    const base = baseScene()
    const moving = camera()
    return moving ? { ...base, camera: moving } : base
  }

  let pool: NativeImagePool | null = null
  let poolWidth = 0
  let poolHeight = 0
  let owned: NativeImage | null = null
  let pixels: Uint8Array | null = null

  const publish = (): void => {
    if (!graphics() || props.state.reading !== null || props.state.list) return
    const width = widthPx()
    const height = heightPx()
    if (!pool || poolWidth !== width || poolHeight !== height) {
      owned?.dispose()
      owned = null
      pool?.dispose()
      // Same render-context, double-buffered image as the achievement map. The
      // renderer's Kitty transport is zlib (src/index.tsx), so this frame is
      // compressed on the wire too.
      pool = new NativeImagePool({
        width,
        height,
        capacity: 2,
        owner: renderer.nativeScene.resourceContext,
      })
      poolWidth = width
      poolHeight = height
    }
    const size = width * height * 4
    if (pixels === null || pixels.length !== size) pixels = new Uint8Array(size)
    const framePixels = renderScene(scene(), width, height, palette(), pixels)
    const image = pool.publishRgba(framePixels)
    if (!image) return
    const previous = owned
    owned = image
    setFrame(image)
    previous?.dispose()
  }

  createEffect(() => {
    // Track everything the frame depends on. `publish` writes only `frame`.
    props.graph
    props.state.focus
    props.state.reading
    props.state.list
    palette()
    camera()
    graphics()
    widthPx()
    heightPx()
    publish()
  })

  const atTarget = (current: Camera, target: Camera): boolean =>
    current.x === target.x &&
    current.y === target.y &&
    current.z === target.z &&
    current.distance === target.distance &&
    current.fov === target.fov &&
    current.yaw === target.yaw &&
    current.pitch === target.pitch

  // Only tick while the camera has somewhere to go. This stops the image at
  // rest instead of re-rasterising and re-uploading it every frame forever.
  const [fps, setFps] = createSignal<number | undefined>(animated() ? FRAME_RATE : undefined)
  createEffect(() => {
    if (!animated()) {
      setFps(undefined)
      return
    }
    const target = baseScene().camera
    const current = camera()
    setFps(current !== null && atTarget(current, target) ? undefined : FRAME_RATE)
  })

  try {
    onAnimationTick(
      () => fps(),
      (delta) => {
        const target = baseScene().camera
        const current = camera()
        if (!current) {
          setCamera(target)
          return
        }
        const close =
          Math.abs(target.x - current.x) +
            Math.abs(target.y - current.y) +
            Math.abs(target.z - current.z) +
            Math.abs(target.distance - current.distance) +
            Math.abs(target.fov - current.fov) +
            Math.abs(target.yaw - current.yaw) +
            Math.abs(target.pitch - current.pitch) <
          0.5
        if (close) {
          if (!atTarget(current, target)) setCamera(target)
          setFps(undefined)
          return
        }
        const amount = 1 - Math.exp(-Math.min(0.05, delta / 1000) * 9)
        setCamera({
          x: lerp(current.x, target.x, amount),
          y: lerp(current.y, target.y, amount),
          z: lerp(current.z, target.z, amount),
          distance: lerp(current.distance, target.distance, amount),
          fov: target.fov,
          yaw: lerp(current.yaw, target.yaw, amount),
          pitch: lerp(current.pitch, target.pitch, amount),
        })
      },
    )
  } catch {
    // A headless renderer has no animation clock; the still frame is enough.
  }

  onCleanup(() => {
    owned?.dispose()
    pool?.dispose()
    owned = null
    pool = null
  })

  const crumbs = () => breadcrumb(props.graph, props.state.focus)
  const note = () => noteFor(props.graph, props.state.reading)

  const labels = createMemo(() => {
    if (!graphics() || props.state.list) return []
    const current = scene()
    const points = labelPoints(current, columns(), bodyRows(), widthPx(), heightPx())
    const byId = new Map(current.nodes.map((node) => [node.id, node]))
    const candidates = points
      .map((point) => {
        const node = byId.get(point.id)
        if (!node) return null
        if (node.kind === "note" && !point.focused && !current.near.has(node.id)) return null
        if (node.label.trim() === "") return null
        const rank = point.focused
          ? 0
          : node.kind === "note"
            ? 3
            : topicDepth(props.graph, node) === 0
              ? 1
              : 2
        return { point, node, rank }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      // The focused label wins a collision; root topics come next, so a far
      // note can never cover the node the user is on.
      .sort((a, b) => a.rank - b.rank || a.point.depth - b.point.depth)
    const taken = new Set<string>()
    const out: Array<{ id: string; text: string; left: number; top: number; kind: string; focused: boolean }> = []
    for (const { point, node } of candidates) {
      const maxChars = Math.max(1, columns() - 2)
      const text =
        node.label.length > maxChars
          ? `${node.label.slice(0, Math.max(0, maxChars - 1))}…`
          : node.label
      const left = clamp(point.x - Math.floor(text.length / 2), 1, Math.max(1, columns() - text.length - 1))
      const top = clamp(point.y + 1, 1, Math.max(1, bodyRows() - 2))
      const slot = `${top}:${Math.floor(left / 4)}`
      if (taken.has(slot)) continue
      taken.add(slot)
      out.push({ id: node.id, text, left, top, kind: node.kind, focused: point.focused })
    }
    return out
  })

  const order = () => navigationOrder(props.graph)
  const cursorIndex = () => Math.max(0, order().findIndex((item) => item.id === props.state.focus))
  const start = () =>
    Math.max(0, Math.min(cursorIndex() - Math.floor(bodyRows() / 2), Math.max(0, order().length - bodyRows())))

  const hints = () => {
    if (props.state.reading) return ["j/k scroll", "Esc back"]
    if (props.state.searching) return ["type to search", "Enter jump", "Esc cancel"]
    return ["↑↓←→/hjkl move", "Enter open", "Backspace up", "v list", "/ search", "Esc close"]
  }

  const headerMeta = () => {
    const topics = flattenTopics(props.graph.topics).length
    const hidden = Math.max(0, props.graph.notes.length - MAX_SCENE_NOTES)
    const extra = hidden > 0 && !props.state.list ? ` · ${hidden} not drawn` : ""
    return `${props.graph.notes.length} ${props.graph.notes.length === 1 ? "note" : "notes"} · ${topics} ${topics === 1 ? "topic" : "topics"}${extra}`
  }

  const empty = () => props.graph.notes.length === 0

  const rowColour = (item: { id: string; kind: string }, selected: boolean): string => {
    if (selected) return palette().primary
    if (item.kind === "topic") return topicDepth(props.graph, item) === 0 ? palette().foreground : palette().secondary
    return palette().muted
  }

  return (
    <box width={columns()} height={rows()} flexDirection="column" backgroundColor={palette().surface}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row">
          <text fg={palette().foreground} wrapMode="none">
            <b>KNOWLEDGE</b>
          </text>
          <text fg={palette().muted} wrapMode="none">
            {" · reference"}
          </text>
        </box>
        <text fg={palette().muted} wrapMode="none">
          {headerMeta()}
        </text>
      </box>
      <box flexDirection="row" flexShrink={0} height={1}>
        <text fg={palette().muted} wrapMode="none">
          {note()
            ? breadcrumb(props.graph, note()!.id).join(" › ")
            : crumbs().join(" › ")}
        </text>
      </box>
      <Show when={diagnostic()}>
        <text fg={palette().warning} wrapMode="none">
          {`! ${diagnostic()}${diagnosticExtra() > 0 ? ` (+${diagnosticExtra()} more)` : ""}`}
        </text>
      </Show>

      <Show
        when={note()}
        fallback={
          <Show
            when={!props.state.list && graphics()}
            fallback={
              <box flexDirection="column" height={bodyRows()} minHeight={0} flexShrink={0}>
                <Show
                  when={order().length > 0}
                  fallback={
                    <box flexDirection="column" paddingTop={1}>
                      <text fg={palette().muted} wrapMode="word">
                        {empty()
                          ? "No knowledge notes yet. Notes appear here from the school and skills vaults."
                          : "Nothing to show."}
                      </text>
                    </box>
                  }
                >
                  <For each={order().slice(start(), start() + bodyRows())}>
                    {(item) => {
                      const selected = () => item.id === props.state.focus
                      const indent = () => Math.min(14, topicDepth(props.graph, item) * 2)
                      const room = () => Math.max(1, columns() - indent() - 4)
                      const label = () =>
                        item.label.length > room()
                          ? `${item.label.slice(0, Math.max(0, room() - 1))}…`
                          : item.label
                      return (
                        <box
                          flexDirection="row"
                          height={1}
                          flexShrink={0}
                          backgroundColor={selected() ? palette().panel : undefined}
                        >
                          <text fg={selected() ? palette().primary : palette().line} wrapMode="none">
                            {selected() ? "▏" : " "}
                          </text>
                          <text fg={rowColour(item, selected())} wrapMode="none">
                            {`${" ".repeat(indent())}${kindGlyph(props.graph, item)} ${label()}`}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            }
          >
            <box width={columns()} height={bodyRows()} flexShrink={0}>
              <image
                position="absolute"
                left={0}
                top={0}
                width={columns()}
                height={bodyRows()}
                source={frame() ?? undefined}
                fit="fill"
                protocol="auto"
              />
              <For each={labels()}>
                {(label) => (
                  <text
                    position="absolute"
                    left={label.left}
                    top={label.top}
                    fg={
                      label.focused
                        ? palette().primary
                        : label.kind === "topic"
                          ? palette().secondary
                          : palette().muted
                    }
                    bg="transparent"
                    wrapMode="none"
                  >
                    {label.text}
                  </text>
                )}
              </For>
            </box>
          </Show>
        }
      >
        {(open) => (
          <box flexDirection="column" height={bodyRows()} minHeight={0} flexShrink={0} paddingX={1}>
            <text fg={palette().muted} wrapMode="none">
              {metaFor(open())}
            </text>
            <box
              flexDirection="column"
              flexGrow={1}
              minHeight={0}
              marginTop={1}
            >
              <MarkdownBody
                theme={palette()}
                text={open().body}
                width={columns() - 4}
                height={Math.max(1, bodyRows() - 3)}
                scrollable
                offset={props.state.readingOffset}
              />
            </box>
          </box>
        )}
      </Show>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0} marginTop={1}>
        <text fg={palette().muted} wrapMode="none">
          {hints().join(" · ")}
        </text>
        <Show when={props.state.query !== ""}>
          <text fg={palette().primary} wrapMode="none">
            {`/${props.state.query}`}
          </text>
        </Show>
      </box>
      <Show when={props.state.notice}>
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.state.notice}`}
        </text>
      </Show>
    </box>
  )
}

