/**
 * Declarative scene nodes for sandboxed UI plugins.
 *
 * A plugin emits primitives, never terminal cells. The host validates every
 * node against the manifest and the viewport, then paints it. Anchors are
 * relative to a screen edge; absolute cell rectangles are a later grant.
 */
export const SCENE_ANCHORS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top-center",
  "bottom-center",
] as const

export type SceneAnchor = (typeof SCENE_ANCHORS)[number]

/**
 * A node is placed either from a granted edge anchor or, with the separate
 * `absolute` grant, at an exact cell. Absolute nodes are clipped by the host.
 */
export type ScenePosition = SceneAnchor | "absolute"

/** State fields a plugin may request in its manifest. */
export const SCENE_STATE_FIELDS = ["mode", "pane", "focus", "focused", "focusedWindow"] as const
export type SceneStateField = (typeof SCENE_STATE_FIELDS)[number]

/** The read-only projection handed to `compose`. */
/** Visible cell rectangle; every write is clipped to it. */
export type SceneClip = { left: number; top: number; right: number; bottom: number }

export type SceneState = {
  mode?: string
  pane?: string
  focus?: string
  /** True when the app's active pane has keyboard focus. */
  focused?: boolean
  /** The plugin window id this host is currently focused on, if any. */
  focusedWindow?: string | null
  width: number
  height: number
}

export type SceneTitleAlign = "left" | "center" | "right"
export type SceneBorderStyle = "single" | "double" | "rounded"

export type SceneBox = {
  kind: "box"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  title?: string
  titleAlign?: SceneTitleAlign
  border?: boolean
  borderStyle?: SceneBorderStyle
  fg?: string
  bg?: string
  borderColor?: string
}

export type SceneText = {
  kind: "text"
  anchor: ScenePosition
  x: number
  y: number
  text: string
  fg?: string
  bg?: string
}

export type SceneRule = {
  kind: "rule"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  vertical?: boolean
  color?: string
}

type ShapeStyle = {
  /** Rotate the shape around its box centre, in degrees. */
  rotation?: number
  /** Draw the interior. Defaults to true. */
  fill?: boolean
  /** Draw an outline; defaults to true when `fill` is false. */
  border?: boolean
  /** Outline width in cells. */
  thickness?: number
  /** Fill and outline colour: a palette role or `#rrggbb`. */
  color?: string
  bg?: string
}

export type SceneCircle = ShapeStyle & {
  kind: "circle"
  anchor: ScenePosition
  x: number
  y: number
  /** In cells; the bounding box is 2r x 2r. */
  radius: number
}

export type SceneRect = ShapeStyle & {
  kind: "rect"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  /**
   * Corner radius in cells. Zero is a square; a value of `min(width, height)/2`
   * is a pill. This is the geometry knob for rounded corners.
   */
  radius?: number
}

export type SceneTriangle = ShapeStyle & {
  kind: "triangle"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  direction?: "up" | "down" | "left" | "right"
}

export type ScenePolygon = ShapeStyle & {
  kind: "polygon"
  anchor: ScenePosition
  x: number
  y: number
  /** Bounding box for anchoring and clipping. */
  width: number
  height: number
  /** Flat [x0, y0, x1, y1, ...] in cells relative to the node's top-left. */
  points: number[]
}

export type SceneArc = ShapeStyle & {
  kind: "arc"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  /** Start angle in degrees; 0 is 3 o'clock, -90 is 12 o'clock. */
  start?: number
  /** Sweep in degrees; 360 is a ring. Ignored when `value` is set. */
  sweep?: number
  /** 0..1 progress; sets the sweep to value * 360. */
  value?: number
  /** Round the two ends instead of cutting them flat. */
  rounded?: boolean
}

export type SceneLine = ShapeStyle & {
  kind: "line"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  x1: number
  y1: number
  x2: number
  y2: number
  rounded?: boolean
}

export type ScenePath = ShapeStyle & {
  kind: "path"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  /** Flat [x0, y0, x1, y1, ...] in local cell space. */
  points: number[]
  closed?: boolean
  rounded?: boolean
}

export type SceneProgress = ShapeStyle & {
  kind: "progress"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  /** 0..1, drawn with sub-cell precision. */
  value: number
  orientation?: "horizontal" | "vertical"
  /** Corner radius of the track and fill. */
  radius?: number
  /** Track colour; the fill uses `color`. */
  track?: string
}

export type SceneShape = SceneCircle | SceneRect | SceneTriangle | ScenePolygon | SceneArc | SceneLine | ScenePath | SceneProgress

/**
 * A container with its own coordinate system.
 *
 * Children are placed relative to the group's content box (inside the border
 * and padding). A group is also a window when it sets `border`, `title`, `bg`.
 * `clip` is on by default so content cannot spill over the frame.
 */
export type SceneGroup = {
  kind: "group"
  /** Stable id for focusable windows. */
  id?: string
  /** Participate in the plugin-window focus registry. */
  focusable?: boolean
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  padding?: number
  clip?: boolean
  /** Stack the children vertically or horizontally instead of free placement. */
  layout?: "column" | "row"
  /** Cells between stacked children. */
  gap?: number
  /** Cross-axis alignment for stacked children. */
  align?: "start" | "center" | "end"
  /** Rows to scroll the content upward; clipped by the group. */
  scroll?: number
  border?: boolean
  borderStyle?: SceneBorderStyle
  borderColor?: string
  title?: string
  titleAlign?: SceneTitleAlign
  fg?: string
  bg?: string
  nodes: SceneNode[]
}

/** An invisible rectangle that reports a pointer target to the host. */
export type SceneHit = {
  kind: "hit"
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  /** Optional table coordinates for the hit. */
  row?: number
  column?: number
  /** Optional caller-defined id. */
  id?: string
}

export type SceneNode = SceneBox | SceneText | SceneRule | SceneShape | SceneGroup | SceneHit

export type SceneBudget = {
  maxNodes: number
  maxText: number
  maxWidth: number
  maxHeight: number
}

export const DEFAULT_SCENE_BUDGET: SceneBudget = {
  maxNodes: 24,
  maxText: 512,
  // The viewport still clamps these; they are only the ceiling a huge terminal
  // may not exceed.
  maxWidth: 200,
  maxHeight: 60,
}

export type SceneSanitizeResult = {
  nodes: SceneNode[]
  dropped: number
  issues: string[]
}

const KIND = new Set([
  "box",
  "text",
  "rule",
  "circle",
  "rect",
  "triangle",
  "polygon",
  "arc",
  "line",
  "path",
  "progress",
  "group",
  "hit",
])

/** Bounds for shape geometry; sampling is 8 subcells per cell. */
export const SHAPE_MAX_POINTS = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function integer(value: unknown, fallback: number): number {
  return Math.round(finite(value, fallback))
}

/**
 * Strip control characters, ANSI escapes and bidi overrides, collapse newlines
 * and cap the length. The same rule applies to titles and body text.
 */
export function sanitizeSceneText(value: unknown, max = 200): string {
  if (typeof value !== "string") return ""
  const clean = value
    // ANSI CSI/OSC sequences.
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    // Control characters other than none (newlines become spaces).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    // Bidi overrides and isolates.
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    // Collapse exotic whitespace but keep runs of plain spaces: aligned
    // text (table columns, padded labels) depends on them.
    .replace(/[^\S ]+/g, " ")
    .trim()
  return clean.slice(0, max)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Validate a plugin's node list. Nodes outside the budget or the manifest's
 * anchors are dropped, never repaired into something the plugin did not ask for.
 */
type SanitizeState = {
  count: number
  textChars: number
  dropped: number
  issues: string[]
}

/** Validate one list, recursing into groups with the same budgets. */
function sanitizeList(
  input: unknown,
  budget: SceneBudget,
  anchors: readonly SceneAnchor[],
  viewport: { width: number; height: number },
  absolute: boolean,
  depth: number,
  state: SanitizeState,
): SceneNode[] {
  const list = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.nodes)
      ? input.nodes
      : []
  if (!Array.isArray(input) && !(isRecord(input) && Array.isArray(input.nodes))) {
    state.issues.push("scene must be an array or { nodes: [...] }")
  }

  const nodes: SceneNode[] = []
  const push = (node: SceneNode): void => {
    state.count += 1
    nodes.push(node)
  }
  for (const raw of list) {
    if (state.count >= budget.maxNodes) {
      state.dropped += 1
      state.issues.push("node budget exceeded")
      break
    }
    if (!isRecord(raw) || typeof raw.kind !== "string" || !KIND.has(raw.kind)) {
      state.dropped += 1
      continue
    }
    const anchor = raw.anchor
    if (anchor === "absolute") {
      if (!absolute) {
        state.dropped += 1
        state.issues.push("absolute positioning is not granted by the manifest")
        continue
      }
    } else {
      if (typeof anchor !== "string" || !SCENE_ANCHORS.includes(anchor as SceneAnchor)) {
        state.dropped += 1
        state.issues.push(`unknown anchor: ${String(anchor)}`)
        continue
      }
      if (!anchors.includes(anchor as SceneAnchor)) {
        state.dropped += 1
        state.issues.push(`anchor ${anchor} is not granted by the manifest`)
        continue
      }
    }
    const fit = (width: number, height: number) => ({
      width: clamp(width, 1, Math.min(budget.maxWidth, viewport.width)),
      height: clamp(height, 1, Math.min(budget.maxHeight, viewport.height)),
    })

    if (raw.kind === "hit") {
      const hitId =
        typeof raw.id === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw.id)
          ? raw.id
          : undefined
      push({
        kind: "hit",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: clamp(integer(raw.width, 1), 1, budget.maxWidth),
        height: clamp(integer(raw.height, 1), 1, budget.maxHeight),
        ...(integer(raw.row, 0) > 0 || raw.row === 0 ? { row: clamp(integer(raw.row, 0), 0, 1000) } : {}),
        ...(integer(raw.column, 0) > 0 || raw.column === 0
          ? { column: clamp(integer(raw.column, 0), 0, 1000) }
          : {}),
        ...(hitId ? { id: hitId } : {}),
      })
      continue
    }

    if (raw.kind === "group") {
      const size = fit(integer(raw.width, 20), integer(raw.height, 8))
      const padding = clamp(integer(raw.padding, 0), 0, 10)
      const border = raw.border === true
      const inset = padding + (border ? 1 : 0)
      const contentWidth = Math.max(0, size.width - inset * 2)
      const contentHeight = Math.max(0, size.height - inset * 2)
      const layout = raw.layout === "row" ? "row" : raw.layout === "column" ? "column" : undefined
      const titleAlign = ["left", "center", "right"].includes(String(raw.titleAlign))
        ? (raw.titleAlign as SceneTitleAlign)
        : undefined
      const align = ["start", "center", "end"].includes(String(raw.align))
        ? (raw.align as "start" | "center" | "end")
        : undefined
      const borderStyle = ["single", "double", "rounded"].includes(String(raw.borderStyle))
        ? (raw.borderStyle as SceneBorderStyle)
        : undefined
      const id =
        typeof raw.id === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw.id)
          ? raw.id
          : undefined
      if (raw.nodes !== undefined && !Array.isArray(raw.nodes)) {
        state.dropped += 1
        state.issues.push("group nodes must be an array")
        continue
      }
      // The container counts before its children, so the shared node budget
      // cannot be consumed twice.
      state.count += 1
      const children =
        depth < 4 && contentWidth > 0 && contentHeight > 0 && Array.isArray(raw.nodes)
          ? sanitizeList(
              raw.nodes,
              budget,
              anchors,
              { width: contentWidth, height: contentHeight },
              absolute,
              depth + 1,
              state,
            )
          : []
      nodes.push({
        kind: "group",
        ...(id ? { id } : {}),
        ...(id && raw.focusable === true ? { focusable: true } : {}),
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        padding,
        clip: raw.clip !== false,
        ...(layout ? { layout } : {}),
        ...(layout ? { gap: clamp(integer(raw.gap, 0), 0, 10) } : {}),
        ...(layout && align ? { align } : {}),
        ...(raw.scroll !== undefined ? { scroll: clamp(integer(raw.scroll, 0), -1000, 1000) } : {}),
        border,
        ...(borderStyle ? { borderStyle } : {}),
        ...(typeof raw.borderColor === "string" ? { borderColor: raw.borderColor } : {}),
        title: sanitizeSceneText(raw.title, 60) || undefined,
        ...(titleAlign ? { titleAlign } : {}),
        ...(typeof raw.fg === "string" ? { fg: raw.fg } : {}),
        ...(typeof raw.bg === "string" ? { bg: raw.bg } : {}),
        nodes: children,
      })
      continue
    }
    if (raw.kind === "box") {
      const size = fit(integer(raw.width, 10), integer(raw.height, 3))
      push({
        kind: "box",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        title: sanitizeSceneText(raw.title, 60) || undefined,
        ...(["left", "center", "right"].includes(String(raw.titleAlign))
          ? { titleAlign: raw.titleAlign as SceneTitleAlign }
          : {}),
        ...(["single", "double", "rounded"].includes(String(raw.borderStyle))
          ? { borderStyle: raw.borderStyle as SceneBorderStyle }
          : {}),
        border: raw.border !== false,
        fg: typeof raw.fg === "string" ? raw.fg : undefined,
        bg: typeof raw.bg === "string" ? raw.bg : undefined,
        borderColor: typeof raw.borderColor === "string" ? raw.borderColor : undefined,
      })
      continue
    }
    if (raw.kind === "circle") {
      const radius = Math.max(
        0.5,
        Math.min(
          budget.maxWidth / 2,
          budget.maxHeight / 2,
          viewport.width / 2,
          viewport.height / 2,
          finite(raw.radius, 2),
        ),
      )
      push({
        kind: "circle",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        radius,
        ...shapeStyle(raw),
      })
      continue
    }
    if (raw.kind === "rect") {
      const size = fit(integer(raw.width, 6), integer(raw.height, 4))
      push({
        kind: "rect",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        radius: Math.max(0, Math.min(finite(raw.radius, 0), Math.min(size.width, size.height) / 2)),
        ...shapeStyle(raw),
      })
      continue
    }
    if (raw.kind === "triangle") {
      const size = fit(integer(raw.width, 6), integer(raw.height, 4))
      const direction = raw.direction
      if (direction !== undefined && !["up", "down", "left", "right"].includes(String(direction))) {
        state.dropped += 1
        state.issues.push(`unknown triangle direction: ${String(direction)}`)
        continue
      }
      push({
        kind: "triangle",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        ...(typeof direction === "string" ? { direction: direction as "up" | "down" | "left" | "right" } : {}),
        ...shapeStyle(raw),
      })
      continue
    }
    if (raw.kind === "polygon") {
      const size = fit(integer(raw.width, 6), integer(raw.height, 4))
      const points = polygonPoints(raw.points, size.width, size.height)
      if (points === null) {
        state.dropped += 1
        state.issues.push("polygon needs 3-64 finite points")
        continue
      }
      push({
        kind: "polygon",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        points,
        ...shapeStyle(raw),
      })
      continue
    }
    if (raw.kind === "arc") {
      const size = fit(integer(raw.width, 10), integer(raw.height, 10))
      const value = raw.value === undefined ? undefined : Math.max(0, Math.min(1, finite(raw.value, 0)))
      const sweep =
        value !== undefined ? value * 360 : Math.max(0, Math.min(360, finite(raw.sweep, 360)))
      if (sweep === 0) {
        state.dropped += 1
        continue
      }
      push({
        kind: "arc",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        start: finite(raw.start, -90),
        sweep,
        ...(value !== undefined ? { value } : {}),
        rounded: raw.rounded === true,
        ...shapeStyle(raw, false),
      })
      continue
    }
    if (raw.kind === "line") {
      const size = fit(integer(raw.width, 10), integer(raw.height, 10))
      push({
        kind: "line",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        x1: clamp(finite(raw.x1, 0), -1, size.width + 1),
        y1: clamp(finite(raw.y1, 0), -1, size.height + 1),
        x2: clamp(finite(raw.x2, size.width), -1, size.width + 1),
        y2: clamp(finite(raw.y2, size.height), -1, size.height + 1),
        rounded: raw.rounded !== false,
        ...shapeStyle(raw, false),
      })
      continue
    }
    if (raw.kind === "path") {
      const size = fit(integer(raw.width, 10), integer(raw.height, 10))
      const points = pathPoints(raw.points, size.width, size.height)
      if (points === null) {
        state.dropped += 1
        state.issues.push("path needs 2-64 finite points")
        continue
      }
      push({
        kind: "path",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        points,
        closed: raw.closed === true,
        rounded: raw.rounded !== false,
        ...shapeStyle(raw, false),
      })
      continue
    }
    if (raw.kind === "progress") {
      const size = fit(integer(raw.width, 12), integer(raw.height, 1))
      const orientation = raw.orientation === "vertical" ? "vertical" : "horizontal"
      push({
        kind: "progress",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width: size.width,
        height: size.height,
        value: Math.max(0, Math.min(1, finite(raw.value, 0))),
        orientation,
        radius: Math.max(0, Math.min(finite(raw.radius, 0), Math.min(size.width, size.height) / 2)),
        ...(typeof raw.track === "string" ? { track: raw.track } : {}),
        ...shapeStyle(raw, true, false),
      })
      continue
    }
    if (raw.kind === "text") {
      const text = sanitizeSceneText(raw.text, 200)
      if (text === "") {
        state.dropped += 1
        continue
      }
      if (state.textChars + text.length > budget.maxText) {
        state.dropped += 1
        state.issues.push("text budget exceeded")
        continue
      }
      state.textChars += text.length
      push({
        kind: "text",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        text,
        fg: typeof raw.fg === "string" ? raw.fg : undefined,
        bg: typeof raw.bg === "string" ? raw.bg : undefined,
      })
      continue
    }
    if (raw.kind === "rule") {
      const width = clamp(integer(raw.width, 10), 1, Math.min(budget.maxWidth, viewport.width))
      push({
        kind: "rule",
        anchor: anchor as ScenePosition,
        x: integer(raw.x, 0),
        y: integer(raw.y, 0),
        width,
        vertical: raw.vertical === true,
        color: typeof raw.color === "string" ? raw.color : undefined,
      })
    }
  }
  return nodes
}

/**
 * Validate a plugin's node tree. Nodes outside the budget or the manifest's
 * anchors are dropped, never repaired into something the plugin did not ask for.
 */
export function sanitizeScene(
  input: unknown,
  budget: SceneBudget,
  anchors: readonly SceneAnchor[],
  viewport: { width: number; height: number },
  absolute = false,
): SceneSanitizeResult {
  const state: SanitizeState = { count: 0, textChars: 0, dropped: 0, issues: [] }
  const nodes = sanitizeList(input, budget, anchors, viewport, absolute, 0, state)
  return { nodes, dropped: state.dropped, issues: state.issues.slice(0, 8) }
}

/** Shared fill/border/colour fields for shapes. */
function shapeStyle(raw: Record<string, unknown>, defaultFill = true, includeThickness = true): ShapeStyle {
  const fill = raw.fill === undefined ? defaultFill : raw.fill === true
  const border = raw.border === true || (!fill && raw.border !== false)
  return {
    fill,
    border,
    ...(typeof raw.rotation === "number" && Number.isFinite(raw.rotation)
      ? { rotation: Math.max(-360, Math.min(360, raw.rotation)) }
      : {}),
    ...(includeThickness
      ? { thickness: Math.max(0.1, Math.min(4, finite(raw.thickness, 0.5))) }
      : {}),
    ...(typeof raw.color === "string" ? { color: raw.color } : {}),
    ...(typeof raw.bg === "string" ? { bg: raw.bg } : {}),
  }
}

/** Path point list; two points make a line. */
function pathPoints(raw: unknown, width: number, height: number): number[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length < 4 || raw.length > SHAPE_MAX_POINTS * 2 || raw.length % 2 !== 0) return null
  const points: number[] = []
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    points.push(value)
  }
  for (let index = 0; index < points.length; index += 2) {
    points[index] = clamp(points[index]!, -1, width + 1)
    points[index + 1] = clamp(points[index + 1]!, -1, height + 1)
  }
  return points
}

/** Flat point list, validated and clamped into the bounding box. */
function polygonPoints(raw: unknown, width: number, height: number): number[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length < 6 || raw.length > SHAPE_MAX_POINTS * 2 || raw.length % 2 !== 0) return null
  const points: number[] = []
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    points.push(value)
  }
  // The bounding box is the clip; points may reach a little beyond it.
  for (let index = 0; index < points.length; index += 2) {
    points[index] = clamp(points[index]!, -1, width + 1)
    points[index + 1] = clamp(points[index + 1]!, -1, height + 1)
  }
  return points
}

/** Focusable window ids in a node tree, in declaration order. */
export function collectFocusIds(nodes: readonly SceneNode[]): string[] {
  const ids: string[] = []
  const visit = (list: readonly SceneNode[]): void => {
    for (const node of list) {
      if (node.kind === "group") {
        if (node.focusable && node.id) ids.push(node.id)
        visit(node.nodes)
      }
    }
  }
  visit(nodes)
  return ids
}

export function resolvePosition(
  position: ScenePosition,
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  if (position === "absolute") {
    return {
      left: clamp(x, 0, Math.max(0, viewport.width - 1)),
      top: clamp(y, 0, Math.max(0, viewport.height - 1)),
    }
  }
  return resolveAnchor(position, x, y, width, height, viewport)
}

/** Top-left cell for a node, from its anchor edge and inward offsets. */
export function resolveAnchor(
  anchor: SceneAnchor,
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left =
    anchor === "top-left" || anchor === "bottom-left"
      ? x
      : anchor === "top-right" || anchor === "bottom-right"
        ? viewport.width - width - x
        : Math.floor((viewport.width - width) / 2) + x
  const top =
    anchor === "top-left" || anchor === "top-right" || anchor === "top-center"
      ? y
      : anchor === "bottom-left" || anchor === "bottom-right" || anchor === "bottom-center"
        ? viewport.height - height - y
        : y
  return {
    left: clamp(left, 0, Math.max(0, viewport.width - width)),
    top: clamp(top, 0, Math.max(0, viewport.height - height)),
  }
}
