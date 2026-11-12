/**
 * Achievements as a node map.
 *
 * The same 3D scene and software rasteriser as Knowledge: categories are the
 * large nodes, each achievement is a leaf. Locked leaves are dim, unlocked
 * leaves use the success colour, and the focused node carries the primary
 * halo. The detail card underneath keeps the task, progress and share action.
 *
 * The list fallback is the same catalogue grouped by category, so a terminal
 * without image support still reaches every achievement.
 */
import { NativeImagePool, type NativeImage } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { onAnimationTick, useRenderer } from "@opentui/solid"

import {
  ACHIEVEMENTS,
  UNLOCK_ALL_ACHIEVEMENTS,
  achievementUnlocked,
  difficultyLabel,
  difficultyTier,
  progressLine,
  unlockedCount,
  type Achievement,
  type AchievementMetric,
  type AchievementMetrics,
} from "../../domain/achievements"
import type { ThemePalette } from "../theme"
import { useGraphics } from "../use-graphics"
import { FRAME_RATE } from "../frame-rate"
import { project, type Camera, type Scene } from "../knowledge/scene"
import { hexRgba, renderScene } from "../knowledge/raster"
import { drawPixelText, pixelTextWidth } from "../knowledge/pixel-text"
import {
  DEFAULT_ACHIEVEMENT_PIXELS,
  MAX_ACHIEVEMENT_PIXELS,
  cellSize,
  imageScale,
  resolveAchievementPixels,
} from "./image-budget"

export type AchievementFilter = "all" | "unlocked" | "locked"

export type AchievementView = {
  cursor: number
  filter: AchievementFilter
  notice?: string | null
}

export const initialAchievementView: AchievementView = {
  cursor: 0,
  filter: "all",
  notice: null,
}

export const DETAIL_HEIGHT = 7

const FILTERS: AchievementFilter[] = ["all", "unlocked", "locked"]

export function visibleAchievements(
  view: AchievementView,
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): Achievement[] {
  if (view.filter === "unlocked") {
    return ACHIEVEMENTS.filter((achievement) => achievementUnlocked(achievement, metrics, unlockAll))
  }
  if (view.filter === "locked") {
    return ACHIEVEMENTS.filter((achievement) => !achievementUnlocked(achievement, metrics, unlockAll))
  }
  return [...ACHIEVEMENTS]
}

function clampAt(cursor: number, count: number): number {
  return count === 0 ? 0 : Math.max(0, Math.min(count - 1, cursor))
}

export function currentAchievement(
  view: AchievementView,
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): Achievement | undefined {
  const list = visibleAchievements(view, metrics, unlockAll)
  return list[clampAt(view.cursor, list.length)]
}

/** Grid movement, kept for the list fallback and existing callers. */
export function moveAchievement(
  view: AchievementView,
  direction: "up" | "down" | "left" | "right" | "first" | "last",
  metrics: AchievementMetrics,
  columns: number,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): AchievementView {
  const list = visibleAchievements(view, metrics, unlockAll)
  if (list.length === 0) return { ...view, cursor: 0, notice: null }
  const at = clampAt(view.cursor, list.length)
  const column = at % columns
  const row = Math.floor(at / columns)
  let next = at
  if (direction === "first") next = 0
  else if (direction === "last") next = list.length - 1
  else if (direction === "left") next = column === 0 ? at : at - 1
  else if (direction === "right") next = column === columns - 1 || at + 1 >= list.length ? at : at + 1
  else if (direction === "up") next = row === 0 ? at : Math.min(list.length - 1, (row - 1) * columns + column)
  else next = row + 1 >= Math.ceil(list.length / columns) ? at : Math.min(list.length - 1, (row + 1) * columns + column)
  return { ...view, cursor: next, notice: null }
}

/** Linear movement for the list fallback; every arrow is a step. */
export function moveAchievementList(
  view: AchievementView,
  direction: "up" | "down" | "left" | "right",
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): AchievementView {
  const list = visibleAchievements(view, metrics, unlockAll)
  if (list.length === 0) return { ...view, cursor: 0, notice: null }
  const at = clampAt(view.cursor, list.length)
  const delta = direction === "up" || direction === "left" ? -1 : 1
  return { ...view, cursor: clampAt(at + delta, list.length), notice: null }
}

export function cycleFilter(
  view: AchievementView,
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): AchievementView {
  const at = FILTERS.indexOf(view.filter)
  const filter = FILTERS[(at + 1) % FILTERS.length]!
  return {
    ...view,
    filter,
    cursor: clampAt(view.cursor, visibleAchievements({ ...view, filter }, metrics, unlockAll).length),
    notice: null,
  }
}

/** Split a label at word boundaries, at most `maxLines`; overflow gets `...`. */
export function wrapLabel(text: string, maxChars: number, maxLines = 2): string[] {
  if (text.length <= maxChars) return [text]
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let index = 0
  while (index < words.length && lines.length < maxLines) {
    let line = ""
    while (index < words.length) {
      const next = line === "" ? words[index]! : `${line} ${words[index]!}`
      if (next.length <= maxChars) {
        line = next
        index += 1
      } else {
        break
      }
    }
    if (line === "") {
      line = words[index]!.slice(0, maxChars)
      index += 1
    }
    if (lines.length === maxLines - 1 && index < words.length) {
      const rest = words.slice(index).join(" ")
      line = `${line} ${rest}`.trim()
      if (line.length > maxChars) line = `${line.slice(0, Math.max(0, maxChars - 3))}...`
      index = words.length
    }
    lines.push(line)
  }
  return lines
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function nodeId(achievement: Achievement): string {
  return `achievement:${achievement.id}`
}


/**
 * Fixed camera distance for the constellation.
 *
 * It used to grow with the window width, so opening the pane small and then
 * maximising the terminal zoomed the map out dramatically. Keeping it fixed
 * means a larger terminal shows more of the map at the same star size, the way
 * more terminal rows show more text.
 */
export const ACHIEVEMENT_CAMERA_DISTANCE = 460


const METRIC_ORDER: AchievementMetric[] = [
  "messages",
  "toolCalls",
  "sessions",
  "skills",
  "projects",
  "sources",
  "lessons",
  "agents",
  "steps",
  "cardsKnown",
  "stages",
  "chapters",
]

export type AchievementBranch = {
  metric: AchievementMetric
  items: Achievement[]
}

/** One branch per metric, easiest target first. */
export function achievementBranches(
  view: AchievementView,
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): AchievementBranch[] {
  const list = visibleAchievements(view, metrics, unlockAll)
  return METRIC_ORDER.map((metric) => ({
    metric,
    items: list
      .filter((achievement) => achievement.metric === metric)
      .sort((a, b) => a.target - b.target || a.id.localeCompare(b.id)),
  })).filter((branch) => branch.items.length > 0)
}

function branchNodeId(achievement: Achievement): string {
  return nodeId(achievement)
}

/** Each metric is a skill tree rooted on a ground line; sections alternate above/below. */
export function achievementScene(
  view: AchievementView,
  metrics: AchievementMetrics,
  width: number,
  _height: number,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
  /**
   * Native surface width. The image may be rendered smaller than the terminal
   * to fit the frame budget; deriving the field of view from the native width
   * keeps that a uniform downscale instead of zooming the constellation in
   * whenever the budget shrinks the surface.
   */
  cameraWidth = width,
): { scene: Scene; byNode: Map<string, Achievement>; branches: AchievementBranch[] } {
  const branches = achievementBranches(view, metrics, unlockAll)
  const byNode = new Map<string, Achievement>()
  const positions = new Map<string, { x: number; y: number }>()
  const selected = currentAchievement(view, metrics, unlockAll)
  const selectedId = selected?.id ?? null
  const branchOf = new Map<string, number>()
  branches.forEach((branch, index) => {
    for (const achievement of branch.items) branchOf.set(achievement.id, index)
  })
  const nodes: Scene["nodes"] = []
  // Each metric is a skill tree: its easiest star is the base on one common
  // ground line, and every harder star grows away from it. Adjacent sections
  // alternate above and below the line; the slight sway makes each one a
  // constellation rather than a rule.
  const treeSpacing = 165
  const sectionSize = 3
  const sectionGap = 80
  const baseline = 0
  const count = Math.max(1, branches.length)
  const totalWidth =
    (count - 1) * treeSpacing + (Math.ceil(count / sectionSize) - 1) * sectionGap
  branches.forEach((branch, branchIndex) => {
    const seed = branch.metric
    const section = Math.floor(branchIndex / sectionSize)
    const direction = section % 2 === 0 ? -1 : 1
    const anchorX =
      -totalWidth / 2 +
      branchIndex * treeSpacing +
      section * sectionGap +
      (hash(`${seed}:x`) - 0.5) * 18
    const phase = hash(`${seed}:sway`) * Math.PI * 2
    let lift = 0
    branch.items.forEach((achievement, rank) => {
      const tier = difficultyTier(achievement.target)
      const sway = rank === 0 ? 0 : Math.sin(rank * 1.6 + phase) * 48
      const baseX = anchorX + sway + (hash(`${achievement.id}:x`) - 0.5) * 12
      const baseY = baseline + direction * lift + (hash(`${achievement.id}:y`) - 0.5) * 10
      const unlocked = achievementUnlocked(achievement, metrics, unlockAll)
      positions.set(achievement.id, { x: baseX, y: baseY })
      byNode.set(branchNodeId(achievement), achievement)
      nodes.push({
        id: branchNodeId(achievement),
        label: unlocked ? achievement.name : "???",
        kind: "note",
        // The map is a rigid translation while the camera pans. Per-node
        // drifting made the stars wobble during every move.
        x: baseX,
        y: baseY,
        z: 0,
        // The base of a tree is its root: a slightly larger star.
        radius: rank === 0 ? 8.5 : 6.2,
        shape: "star",
        tone: unlocked ? "success" : "error",
        weight: 1,
      })
      // The next star is always above this one, with a gentle side branch.
      lift += 72 + tier * 8 + hash(`${achievement.id}:step`) * 14
    })
  })

  // Branches scatter independently, so two of them can land on the same spot.
  // Relax the star positions apart deterministically instead of hand-tuning
  // seeds; the chains keep their shape because the push is local.
  const MIN_NODE_DISTANCE = 80
  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    for (let a = 0; a < nodes.length; a++) {
      const first = nodes[a]!
      if (first.kind !== "note") continue
      for (let b = a + 1; b < nodes.length; b++) {
        const second = nodes[b]!
        if (second.kind !== "note") continue
        const dx = second.x - first.x
        const dy = second.y - first.y
        const distance = Math.hypot(dx, dy)
        if (distance >= MIN_NODE_DISTANCE) continue
        const push = (MIN_NODE_DISTANCE - distance) / 2 + 0.5
        const ux = distance > 0.001 ? dx / distance : Math.cos(a + 1)
        const uy = distance > 0.001 ? dy / distance : Math.sin(a + 1)
        first.x -= ux * push
        first.y -= uy * push
        second.x += ux * push
        second.y += uy * push
        moved = true
      }
    }
    if (!moved) break
  }
  for (const node of nodes) {
    if (node.kind !== "note") continue
    const achievement = byNode.get(node.id)
    if (achievement) positions.set(achievement.id, { x: node.x, y: node.y })
  }

  const edges: Scene["edges"] = []
  const selectedBranch = selectedId ? branchOf.get(selectedId) : undefined
  branches.forEach((branch, branchIndex) => {
    const selectedRank = branchIndex === selectedBranch
      ? branch.items.findIndex((achievement) => achievement.id === selectedId)
      : -1
    // Chain each metric's stars up its tree.
    branch.items.forEach((achievement, rank) => {
      if (rank === 0) return
      const previous = branch.items[rank - 1]!
      const hot = branchIndex === selectedBranch && (selectedRank === -1 || rank <= selectedRank)
      edges.push({ from: branchNodeId(previous), to: branchNodeId(achievement), kind: "hierarchy", hot })
    })
  })
  // Ground line: join the trees' bases left to right. This is the only
  // cross-line connection, so no tree can be left except at its base.
  const selectedFirst = selectedBranch !== undefined
    ? branchNodeId(branches[selectedBranch]!.items[0]!)
    : null
  const bases = branches
    .map((branch) => branch.items[0])
    .filter((achievement): achievement is Achievement => achievement !== undefined)
  const orderedBases = [...bases].sort((a, b) => {
    const pa = positions.get(a.id) ?? { x: 0, y: 0 }
    const pb = positions.get(b.id) ?? { x: 0, y: 0 }
    return pa.x - pb.x || pa.y - pb.y || a.id.localeCompare(b.id)
  })
  // One open path through every base: the ground line tying the trees together.
  for (let index = 0; index + 1 < orderedBases.length; index++) {
    const from = branchNodeId(orderedBases[index]!)
    const to = branchNodeId(orderedBases[index + 1]!)
    edges.push({ from, to, kind: "hierarchy", hot: from === selectedFirst || to === selectedFirst })
  }

  const focusId = selected ? branchNodeId(selected) : nodes[0]?.id ?? null
  const focusBase = selected ? positions.get(selected.id) ?? { x: 0, y: 0 } : { x: 0, y: 0 }
  return {
    scene: {
      nodes,
      edges,
      camera: {
        x: focusBase.x,
        y: focusBase.y,
        z: 0,
        // Fixed local zoom: the selected node is centred and the camera pans.
        // The distance does not follow the window width, so making the
        // terminal larger reveals more of the map at the same star size
        // instead of zooming out. The field of view follows the surface width,
        // so a budget-scaled image is the native framing at fewer pixels.
        distance: ACHIEVEMENT_CAMERA_DISTANCE,
        fov: cameraWidth > 0 ? 760 * (width / cameraWidth) : 760,
        yaw: 0,
        pitch: 0,
      },
      focusId,
      near: new Set(nodes.map((node) => node.id)),
      truncated: 0,
    },
    byNode,
    branches,
  }
}

/** A held key repeats far faster than this. Only the first press of a burst
 * gets the highlight hold; otherwise every repeat postpones the movement. */
export const REPEAT_WINDOW_MS = 200

/** True when a focus change starts a new burst rather than continuing one. */
export function startsFocusBurst(now: number, lastFocusAt: number, window = REPEAT_WINDOW_MS): boolean {
  return now - lastFocusAt > window
}

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0) / 4294967295
}

function cursorOf(list: readonly Achievement[], id: string): number {
  const index = list.findIndex((achievement) => achievement.id === id)
  return index < 0 ? 0 : index
}

/** Branch navigation: up/down change difficulty, left/right change branch. */
export function moveAchievementNode(
  view: AchievementView,
  direction: "up" | "down" | "left" | "right",
  metrics: AchievementMetrics,
  columns: number,
  rows: number,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): AchievementView {
  const list = visibleAchievements(view, metrics, unlockAll)
  if (list.length === 0) return { ...view, cursor: 0, notice: null }
  const at = clampAt(view.cursor, list.length)
  const current = list[at]!
  const branches = achievementBranches(view, metrics, unlockAll)
  const branch = branches.find((candidate) =>
    candidate.items.some((achievement) => achievement.id === current.id),
  )
  const rank = branch ? branch.items.findIndex((achievement) => achievement.id === current.id) : -1

  // Directions are screen directions: up moves to a connected star above, not
  // to the next difficulty. The graph only joins other lines at their bases.
  const built = achievementScene(
    view,
    metrics,
    Math.max(160, columns * 8),
    Math.max(120, rows * 16),
    unlockAll,
  ).scene
  const points = new Map(built.nodes.map((node) => [node.id, node]))
  const here = points.get(nodeId(current))
  if (!here) return { ...view, cursor: at, notice: null }

  const inDirection = (dx: number, dy: number): boolean => {
    switch (direction) {
      case "up":
        return dy < -1 && Math.abs(dx) <= Math.abs(dy) * 1.5
      case "down":
        return dy > 1 && Math.abs(dx) <= Math.abs(dy) * 1.5
      case "left":
        return dx < -1 && Math.abs(dy) <= Math.abs(dx) * 1.5
      case "right":
        return dx > 1 && Math.abs(dy) <= Math.abs(dx) * 1.5
    }
  }
  const choose = (targets: readonly Achievement[]): Achievement | null => {
    let best: { target: Achievement; distance: number } | null = null
    for (const target of targets) {
      const point = points.get(nodeId(target))
      if (!point) continue
      const dx = point.x - here.x
      const dy = point.y - here.y
      if (!inDirection(dx, dy)) continue
      const distance = Math.hypot(dx, dy)
      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance && target.id.localeCompare(best.target.id) < 0)
      ) {
        best = { target, distance }
      }
    }
    return best?.target ?? null
  }
  if (!branch) return { ...view, cursor: at, notice: null }
  if (rank === 0) {
    // A base may enter another tree, but only at that tree's base, and only in
    // the pressed direction. Mid-tree stars are never cross-line targets.
    const otherBases = branches
      .filter((candidate) => candidate !== branch)
      .map((candidate) => candidate.items[0])
      .filter((achievement): achievement is Achievement => achievement !== undefined)
    const next = branch.items[1]
    const target = choose(next ? [next, ...otherBases] : otherBases)
    if (target) return { ...view, cursor: cursorOf(list, target.id), notice: null }
    return { ...view, cursor: at, notice: null }
  }
  // Inside a tree only the immediately adjacent stars are candidates; never
  // fall back to a farther one, which would skip a node.
  const adjacent = [branch.items[rank - 1], branch.items[rank + 1]].filter(
    (achievement): achievement is Achievement => achievement !== undefined,
  )
  const target = choose(adjacent)
  if (target) return { ...view, cursor: cursorOf(list, target.id), notice: null }
  return { ...view, cursor: at, notice: null }
}

/** Global easiest/hardest by the same target-derived difficulty. */
export function jumpAchievement(
  view: AchievementView,
  end: "first" | "last",
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): AchievementView {
  const list = visibleAchievements(view, metrics, unlockAll)
  if (list.length === 0) return { ...view, cursor: 0, notice: null }
  const sorted = [...list].sort(
    (a, b) =>
      difficultyTier(a.target) - difficultyTier(b.target) ||
      a.target - b.target ||
      a.id.localeCompare(b.id),
  )
  const target = end === "first" ? sorted[0]! : sorted[sorted.length - 1]!
  return { ...view, cursor: cursorOf(list, target.id), notice: null }
}

/**
 * The pane router recreates the component when app state changes, so camera
 * state cannot live only in the component. Keep it here across remounts; this
 * is what lets the cursor highlight first and the camera continue its exact
 * position instead of snapping back to the new target.
 */
const achievementRuntime: {
  camera: Camera | null
  lastFocus: string | null
  holdUntil: number
  pool: NativeImagePool | null
  poolWidth: number
  poolHeight: number
  owned: NativeImage | null
  pixels: Uint8Array | null
  frame: NativeImage | null
  lastFocusAt: number
  /** A frame was drawn but the pool had no free buffer to present it. */
  pending: boolean
  /** Last real terminal pixels per cell; survives a resize that clears it. */
  cell: { width: number; height: number } | null
  /** Last effective Kitty transport: raw, zlib, png or file. */
  transport: string | null
} = {
  camera: null,
  lastFocus: null,
  holdUntil: 0,
  pool: null,
  poolWidth: 0,
  poolHeight: 0,
  owned: null,
  pixels: null,
  frame: null,
  lastFocusAt: 0,
  pending: false,
  cell: null,
  transport: null,
}

export function AchievementPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  view: AchievementView
  metrics: AchievementMetrics
  awards?: Record<string, string>
  unlockAll?: boolean
  reducedMotion?: boolean
  /** Test/embed override: force the pixel renderer on or off. */
  graphics?: boolean
}) {
  const palette = () => props.theme
  const unlockAll = () => props.unlockAll ?? UNLOCK_ALL_ACHIEVEMENTS
  const graphics = useGraphics(props.graphics)
  const renderer = useRenderer()
  const animated = () => graphics() && !props.reducedMotion
  // The ticker is only needed while the camera has somewhere to go. Stopping it
  // at rest means no scene paint, no image upload and no terminal traffic when
  // the map is still. A view change restarts it through the effect below.
  const [fps, setFps] = createSignal<number | undefined>(animated() ? FRAME_RATE : undefined)
  const [frame, setFrame] = createSignal<NativeImage | null>(achievementRuntime.frame)
  const [camera, setCameraSignal] = createSignal<Camera | null>(achievementRuntime.camera)
  const setCamera = (next: Camera): void => {
    achievementRuntime.camera = next
    setCameraSignal(next)
  }

  const list = () => visibleAchievements(props.view, props.metrics, unlockAll())
  const selected = () => currentAchievement(props.view, props.metrics, unlockAll())
  const headerRows = 2
  const footerRows = 2
  const detailRows = () => Math.min(DETAIL_HEIGHT, Math.max(4, props.height - headerRows - 5))
  const bodyRows = () =>
    Math.max(3, props.height - headerRows - detailRows() - footerRows - (props.view.notice ? 1 : 0))
  const cell = () => {
    achievementRuntime.cell = cellSize(
      renderer.resolution,
      renderer.width,
      renderer.height,
      achievementRuntime.cell,
    )
    return achievementRuntime.cell
  }
  const [resolutionVersion, setResolutionVersion] = createSignal(0)
  // The native surface is what the terminal would need for 1:1 pixels. The
  // budget is the most this terminal has been seen to animate smoothly, and
  // it never changes while the camera is moving. Kitty with an effective
  // compressed or file transport can carry a native frame inside one output
  // frame; raw/PNG falls back to the measured budget.
  const fullRateKitty = () => {
    // Track capability detection and the transport measurement.
    resolutionVersion()
    if (!graphics()) return false
    const capabilities = renderer.capabilities
    if (!capabilities?.kitty_graphics || capabilities.multiplexer === "tmux") return false
    return achievementRuntime.transport === "zlib" || achievementRuntime.transport === "file"
  }
  const budget = () =>
    resolveAchievementPixels(
      process.env.LOCKEDIN_ACHIEVEMENT_PIXELS,
      fullRateKitty() ? MAX_ACHIEVEMENT_PIXELS : DEFAULT_ACHIEVEMENT_PIXELS,
    )
  const nativeWidthPx = () => Math.max(160, Math.round(props.width * cell().width))
  const nativeHeightPx = () => Math.max(120, Math.round(bodyRows() * cell().height))
  const renderScale = () => imageScale(nativeWidthPx(), nativeHeightPx(), budget())
  const widthPx = () => Math.max(160, Math.round(nativeWidthPx() * renderScale()))
  const heightPx = () => Math.max(120, Math.round(nativeHeightPx() * renderScale()))

  // Labels are pixels in the frame: terminal text can only move in whole
  // cells, which jitters against a map that scrolls in pixels. Square glyphs
  // keep a label one row tall after the budget's upscale.
  const LABEL_SCALE = 1
  // Keep a label about one terminal row tall. At native resolution that is the
  // original 8x16 shape; once the budget upscales the frame, square glyphs
  // avoid a label taking two rows.
  const labelScaleY = () => (renderScale() >= 0.75 ? 2 : 1)
  const labelLineHeight = () => 8 * labelScaleY() + 1

  // `renderer.resolution` and the Kitty transport status are not reactive: a
  // resize clears the former and the latter is known only after an upload.
  // Watch rendered frames so the first real measurements rebuild the image.
  onMount(() => {
    const measure = () => {
      let changed = false
      const resolution = renderer.resolution
      if (resolution) {
        const next = cellSize(resolution, renderer.width, renderer.height, achievementRuntime.cell)
        const previous = achievementRuntime.cell
        achievementRuntime.cell = next
        if (
          previous === null ||
          previous.width !== next.width ||
          previous.height !== next.height
        ) {
          changed = true
        }
      }
      const effective = renderer.kittyImageTransportStatus.effective
      if (achievementRuntime.transport !== effective) {
        achievementRuntime.transport = effective
        changed = true
      }
      if (changed) setResolutionVersion((value) => value + 1)
    }
    measure()
    renderer.on("frame", measure)
    onCleanup(() => renderer.off("frame", measure))
  })

  const built = () =>
    achievementScene(
      props.view,
      props.metrics,
      widthPx(),
      heightPx(),
      unlockAll(),
      nativeWidthPx(),
    )
  // Labels are anchored to the settled layout. They are only shown at rest,
  // so this plan never has to chase the camera.
  const labelLayout = () =>
    achievementScene(
      props.view,
      props.metrics,
      widthPx(),
      heightPx(),
      unlockAll(),
      nativeWidthPx(),
    )
  const baseScene = (): Scene => built().scene
  const scene = (): Scene => {
    const base = baseScene()
    const moving = camera()
    return moving ? { ...base, camera: moving } : base
  }

  /** Draw and present one frame. False means the terminal had no free buffer. */
  const publish = (): boolean => {
    if (!graphics()) return true
    const width = widthPx()
    const height = heightPx()
    if (
      !achievementRuntime.pool ||
      achievementRuntime.poolWidth !== width ||
      achievementRuntime.poolHeight !== height
    ) {
      achievementRuntime.owned?.dispose()
      achievementRuntime.owned = null
      achievementRuntime.frame = null
      achievementRuntime.pixels = null
      achievementRuntime.pool?.dispose()
      // Two buffers in the render context: one is on screen while the other is
      // being filled, so a presented frame never blocks the next one. The pool
      // returns null when both are in flight; that is the terminal's real
      // pace, and the ticker retries instead of dropping the last frame.
      achievementRuntime.pool = new NativeImagePool({
        width,
        height,
        capacity: 2,
        owner: renderer.nativeScene.resourceContext,
      })
      achievementRuntime.poolWidth = width
      achievementRuntime.poolHeight = height
      setFrame(null)
    }
    const size = width * height * 4
    if (achievementRuntime.pixels === null || achievementRuntime.pixels.length !== size) {
      achievementRuntime.pixels = new Uint8Array(size)
    }
    const framePixels = renderScene(
      scene(),
      width,
      height,
      palette(),
      achievementRuntime.pixels,
    )
    for (const label of labels()) {
      label.lines.forEach((line, index) => {
        const lineWidth = pixelTextWidth(line, LABEL_SCALE)
        drawPixelText(
          framePixels,
          width,
          height,
          label.x + (label.width - lineWidth) / 2,
          label.y + index * labelLineHeight(),
          line,
          hexRgba(label.unlocked ? palette().success : palette().error),
          LABEL_SCALE,
          labelScaleY(),
        )
      })
    }
    const image = achievementRuntime.pool.publishRgba(framePixels)
    if (!image) {
      achievementRuntime.pending = true
      return false
    }
    const previous = achievementRuntime.owned
    achievementRuntime.owned = image
    achievementRuntime.frame = image
    setFrame(image)
    previous?.dispose()
    achievementRuntime.pending = false
    return true
  }

  createEffect(() => {
    props.view
    props.metrics
    unlockAll()
    palette()
    camera()
    graphics()
    widthPx()
    heightPx()
    resolutionVersion()
    // If both buffers were in flight, keep the ticker alive for one more try
    // so the final camera position is not left undrawn.
    if (!publish() && animated()) setFps(FRAME_RATE)
  })

  const atTarget = (current: Camera, target: Camera): boolean =>
    current.x === target.x &&
    current.y === target.y &&
    current.z === target.z &&
    current.distance === target.distance &&
    current.fov === target.fov &&
    current.yaw === target.yaw &&
    current.pitch === target.pitch
  createEffect(() => {
    if (!animated()) {
      setFps(undefined)
      return
    }
    const targetScene = baseScene()
    if (achievementRuntime.lastFocus === null) achievementRuntime.lastFocus = targetScene.focusId
    const current = camera()
    // Keep ticking while a frame is still waiting for a free buffer, even when
    // the camera itself has arrived.
    setFps(
      current !== null && atTarget(current, targetScene.camera) && !achievementRuntime.pending
        ? undefined
        : FRAME_RATE,
    )
  })

  const CAMERA_HOLD_MS = 90
  try {
    onAnimationTick(
      () => fps(),
      (delta, _ticks, _time) => {
        const now = performance.now()
        const targetScene = baseScene()
        const target = targetScene.camera
        if (achievementRuntime.lastFocus === null) {
          achievementRuntime.lastFocus = targetScene.focusId
        } else if (targetScene.focusId !== achievementRuntime.lastFocus) {
          achievementRuntime.lastFocus = targetScene.focusId
          // Let the new cursor ring paint before the screen starts moving.
          if (startsFocusBurst(now, achievementRuntime.lastFocusAt)) {
            achievementRuntime.holdUntil = now + CAMERA_HOLD_MS
          }
          achievementRuntime.lastFocusAt = now
        }
        const current = camera()
        if (!current) {
          setCamera(target)
          return
        }
        if (now < achievementRuntime.holdUntil) return
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
          // Snap exactly onto the target so the last frame is not a fraction
          // of a unit off. If the terminal had no free buffer, keep ticking
          // until the final frame is actually presented, then stop.
          if (!atTarget(current, target)) setCamera(target)
          if (achievementRuntime.pending) {
            if (publish()) setFps(undefined)
            return
          }
          setFps(undefined)
          return
        }
        const amount = 1 - Math.exp(-Math.min(0.05, delta / 1000) * 4)
        setCamera({
          x: current.x + (target.x - current.x) * amount,
          y: current.y + (target.y - current.y) * amount,
          z: current.z + (target.z - current.z) * amount,
          distance: current.distance + (target.distance - current.distance) * amount,
          fov: target.fov,
          yaw: current.yaw + (target.yaw - current.yaw) * amount,
          pitch: current.pitch + (target.pitch - current.pitch) * amount,
        })
      },
    )
  } catch {
    // Headless renderer: the still frame is enough.
  }

  onCleanup(() => {
    // Keep the image cache across pane remounts; disposing it here is what
    // made a selection flash and restart the picture.
  })

  // Wrapping and above/below are chosen once from the unfloated layout. The
  // frame only moves those choices with their nodes, so the text scrolls
  // rigidly with the stars instead of hopping between cells.
  const labelPlan = createMemo(() => {
    const { scene: current, byNode } = labelLayout()
    const bigW = widthPx()
    const bigH = heightPx()
    const maxChars = Math.max(6, Math.floor((bigW - 24) / (8 * LABEL_SCALE)))
    const candidates = current.nodes
      .map((node) => {
        const point = project(node, current.camera, bigW, bigH)
        if (!point.visible) return null
        if (node.label.trim() === "") return null
        // `visible` only means in front of the camera. A node outside the
        // viewport used to get a label clamped to the edge, which read as
        // text floating with no star.
        if (point.x < 0 || point.x > bigW || point.y < 0 || point.y > bigH) return null
        return { point, node, rank: node.id === current.focusId ? 0 : 1 }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.rank - b.rank || a.point.depth - b.point.depth)
    const taken: Array<{ x1: number; x2: number; y1: number; y2: number }> = []
    const out: Array<{
      id: string
      lines: string[]
      width: number
      unlocked: boolean
      above: boolean
    }> = []
    for (const { point, node } of candidates) {
      const lines = wrapLabel(node.label, maxChars, 2)
      const width = Math.max(...lines.map((line) => pixelTextWidth(line, LABEL_SCALE)))
      const height = lines.length * labelLineHeight()
      const left = Math.max(2, Math.min(bigW - width - 2, point.x - width / 2))
      const below = point.y + node.radius * point.scale + 3
      const above = point.y - node.radius * point.scale - height - 3
      // One pixel of breathing room, so two labels never read as one word.
      const boxAt = (top: number) => ({
        x1: left - 1,
        x2: left + width + 1,
        y1: top - 1,
        y2: top + height + 1,
      })
      const collides = (box: { x1: number; x2: number; y1: number; y2: number }) =>
        taken.some((other) => box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1)
      const fits = (top: number) => top >= 0 && top + height <= bigH
      // Show fewer labels rather than overlapping ones. The focused star is
      // first, so the name that matters survives.
      let top: number | null = null
      let placedAbove = false
      if (fits(below) && !collides(boxAt(below))) {
        top = below
      } else if (fits(above) && !collides(boxAt(above))) {
        top = above
        placedAbove = true
      }
      if (top === null) continue
      taken.push(boxAt(top))
      const achievement = byNode.get(node.id)
      out.push({
        id: node.id,
        lines,
        width,
        unlocked: achievement ? achievementUnlocked(achievement, props.metrics, unlockAll()) : true,
        above: placedAbove,
      })
    }
    return out
  })

  const labels = createMemo(() => {
    if (!graphics()) return []
    const current = scene()
    const byId = new Map(current.nodes.map((node) => [node.id, node]))
    const bigW = widthPx()
    const bigH = heightPx()
    const out: Array<{
      lines: string[]
      width: number
      x: number
      y: number
      unlocked: boolean
    }> = []
    for (const plan of labelPlan()) {
      const node = byId.get(plan.id)
      if (!node) continue
      const point = project(node, current.camera, bigW, bigH)
      if (!point.visible) continue
      if (point.x < 0 || point.x > bigW || point.y < 0 || point.y > bigH) continue
      const height = plan.lines.length * labelLineHeight()
      const y = plan.above
        ? point.y - node.radius * point.scale - height - 3
        : point.y + node.radius * point.scale + 3
      out.push({
        lines: plan.lines,
        width: plan.width,
        unlocked: plan.unlocked,
        x: Math.max(2, Math.min(bigW - plan.width - 2, point.x - plan.width / 2)),
        y: Math.max(2, Math.min(bigH - height - 2, y)),
      })
    }
    return out
  })

  const awardDate = (achievement: Achievement) => props.awards?.[achievement.id] ?? null

  const rows = () => list().map((achievement) => ({ achievement }))
  const selectedRow = () => {
    const at = rows().findIndex((row) => row.achievement.id === selected()?.id)
    return at < 0 ? 0 : at
  }
  const start = () =>
    Math.max(0, Math.min(selectedRow() - Math.floor(bodyRows() / 2), Math.max(0, rows().length - bodyRows())))

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().background}>
      <box flexDirection="row" justifyContent="space-between" paddingX={1} flexShrink={0}>
        <text fg={palette().primary} wrapMode="none">
          <b>{`${props.focused ? "▌ " : "  "}ACHIEVEMENTS`}</b>
        </text>
        <text fg={palette().muted} wrapMode="none">
          {`${unlockedCount(props.metrics, unlockAll())} / ${ACHIEVEMENTS.length} unlocked · ${props.view.filter}`}
        </text>
      </box>
      <text fg={palette().muted} wrapMode="none" paddingX={1} flexShrink={0}>
        An inventory of milestones. Locked nodes stay dim until their task is complete.
      </text>

      <Show
        when={graphics()}
        fallback={
          <box flexDirection="column" height={bodyRows()} minHeight={0} flexShrink={0} paddingX={1}>
            <For each={rows().slice(start(), start() + bodyRows())}>
              {(row) => {
                const achievement = row.achievement
                const unlocked = achievementUnlocked(achievement, props.metrics, unlockAll())
                const current = selected()?.id === achievement.id
                return (
                  <box flexDirection="row" height={1} flexShrink={0} backgroundColor={current ? palette().panel : undefined}>
                    <text fg={current ? palette().primary : palette().line} wrapMode="none">
                      {current ? "▏" : " "}
                    </text>
                    <text fg={unlocked ? palette().success : palette().muted} wrapMode="none">
                      {`● ${fit(unlocked ? achievement.name : "???", props.width - 8)}`}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        }
      >
        <box width={props.width} height={bodyRows()} flexShrink={0} overflow="hidden">
          <image
            position="absolute"
            left={0}
            top={0}
            width={props.width}
            height={bodyRows()}
            source={frame() ?? undefined}
            fit="fill"
            protocol="auto"
          />
        </box>
      </Show>

      <box
        height={detailRows()}
        flexDirection="column"
        flexShrink={0}
        border={["left", "right", "top", "bottom"]}
        borderColor={palette().line}
        backgroundColor={palette().surface}
        paddingX={1}
      >
        {selected() ? (
          <>
            {(() => {
              const achievement = selected()!
              const unlocked = achievementUnlocked(achievement, props.metrics, unlockAll())
              return (
                <>
                  <text fg={palette().foreground} wrapMode="none">
                    <b>{unlocked ? achievement.name : "Locked achievement"}</b>
                  </text>
                  <text fg={palette().muted} wrapMode="word">
                    {unlocked ? achievement.task : "Finish its task to reveal the name and share card."}
                  </text>
                  <text fg={palette().muted} wrapMode="none">
                    {unlocked
                      ? awardDate(achievement)
                        ? `awarded ${awardDate(achievement)}`
                        : "not awarded yet"
                      : "not awarded yet"}
                  </text>
                  <text fg={unlocked ? palette().success : palette().muted} wrapMode="none">
                    {unlocked
                      ? `${achievement.category.toUpperCase()} · ${difficultyLabel(achievement.target)} · ${progressLine(achievement, props.metrics, unlockAll())}`
                      : "LOCKED · keep working"}
                  </text>
                  <text fg={palette().accent} wrapMode="none">
                    {unlocked ? "s share this achievement" : "finish the task to unlock"}
                  </text>
                </>
              )
            })()}
            {props.view.notice ? (
              <text fg={palette().warning} wrapMode="none">{`! ${props.view.notice}`}</text>
            ) : null}
          </>
        ) : (
          <text fg={palette().muted} wrapMode="none">no achievements match this filter</text>
        )}
      </box>

      <text fg={palette().muted} wrapMode="none" paddingX={1}>
        ↑↓←→/hjkl move · f filter · s share · Esc back
      </text>
    </box>
  )
}
