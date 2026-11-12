/**
 * `@lockedin/sdk` — the typed surface for UI plugins.
 *
 * Imports are type-only, so a bundled plugin carries only the identity
 * helpers below. The host still validates manifests and every node at load.
 */
import type {
  ParticleBuffer,
  ParticleEvent,
  ParticleSpawnTrigger,
  ParticleStyle,
} from "../src/ui/plugins/api"
import type { TextLayer } from "../src/ui/plugins/paint"
import type {
  SceneClip,
  SceneGroup,
  SceneNode,
  ScenePosition,
  SceneState,
  SceneText,
} from "../src/ui/plugins/scene/model"
import type {
  CommandPermission,
  EffectManifest,
  ParticlePermission,
  PluginManifest,
  ScenePermission,
} from "../src/ui/plugins/sandbox/manifest"
import type { ThemePalette } from "../src/ui/theme"

export type {
  CommandPermission,
  EffectManifest,
  PluginManifest,
  ParticleBuffer,
  ParticleEvent,
  ParticlePermission,
  ParticleSpawnTrigger,
  ParticleStyle,
  SceneClip,
  SceneGroup,
  SceneNode,
  ScenePermission,
  ScenePosition,
  SceneText,
  SceneState,
  TextLayer,
  ThemePalette,
}

/** Flat persistent or session state; primitives only. */
export type PluginStore = {
  get(key: string): string | number | boolean | null | undefined
  set(key: string, value: string | number | boolean | null): void
  remove(key: string): void
  keys(): string[]
  all(): Record<string, string | number | boolean | null>
}

/** A click or hover target routed to a plugin command. */
export type PluginPointer = {
  type: "click" | "hover" | "wheel" | "press" | "move" | "release"
  /** Terminal cell coordinates. */
  x: number
  y: number
  /** Enclosing focusable window id, when known. */
  window?: string
  /** Table row and column, when the target is a cell hit. */
  row?: number
  column?: number
  /** Present for wheel events. */
  scroll?: { direction: "up" | "down" | "left" | "right"; delta: number }
}

/** The context every hook receives; fields depend on the hook. */
export type PluginContext = {
  /** Seconds since the previous compose/frame. */
  dt?: number
  /** Seconds since the plugin loaded. */
  time?: number
  width?: number
  height?: number
  cursor?: { x: number; y: number }
  palette?: ThemePalette
  events?: readonly ParticleEvent[]
  pointer?: PluginPointer
  state?: SceneState
  store: PluginStore
  session: PluginStore
}

export type PluginCommandContext = PluginContext & { id: string }

/**
 * A command may return a notice, text to copy (requires the manifest's
 * `clipboard` grant), or both.
 */
export type NoticeLevel = "info" | "warn" | "error"

export type PluginCommandResult =
  | string
  | void
  | { message?: string; level?: NoticeLevel; copy?: string }

/**
 * A one-line notice. The host owns the bubble, fade and lifetime.
 *
 *   return notice("saved", "warn")
 */
export function notice(message: string, level: NoticeLevel = "info") {
  return { message, level }
}

/**
 * A plugin exports one object. Particle hooks, `compose`, lifecycle hooks and
 * commands are all optional; the manifest grants which ones may run.
 */
export type PluginDefinition = {
  id: string
  name?: string
  apiVersion?: "1.0"

  // particles
  maxParticles?: number
  textLayer?: TextLayer
  spawnRate?: number
  spawnOn?: readonly ParticleSpawnTrigger[]
  spawnBurst?: number
  spawn?: (ctx: PluginContext, out: ParticleBuffer, index: number) => boolean
  step?: (ctx: PluginContext, out: ParticleBuffer, count: number) => void
  style?: (ctx: PluginContext, out: ParticleBuffer, index: number) => ParticleStyle

  // scene
  compose?: (ctx: PluginContext) => { nodes: SceneNode[] } | SceneNode[]

  // lifecycle
  activate?: (ctx: PluginContext) => void
  deactivate?: (ctx: PluginContext) => void

  // commands, granted by the manifest
  commands?: Record<string, (ctx: PluginCommandContext) => PluginCommandResult>
}

/** Height a node occupies in a stack. */
export function sceneHeight(node: SceneNode): number {
  if (node.kind === "text") return 1
  if (node.kind === "circle") return node.radius * 2
  if (node.kind === "rule") return node.vertical ? node.width : 1
  return node.height
}

/** Width a node occupies in a row. */
export function sceneWidth(node: SceneNode): number {
  if (node.kind === "text") return node.text.length
  if (node.kind === "circle") return node.radius * 2
  if (node.kind === "rule") return node.vertical ? 1 : node.width
  return node.width
}

export type WindowSlots = SceneNode | readonly SceneNode[]

export type WindowOptions = {
  /** Stable id when the window participates in focus cycling. */
  id?: string
  focusable?: boolean
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  title?: string
  titleAlign?: "left" | "center" | "right"
  borderStyle?: "rounded" | "single" | "double"
  bg?: string
  fg?: string
  borderColor?: string
  /** Highlight the frame while the app's pane is focused. */
  focused?: boolean
  focusedColor?: string
  padding?: number
  gap?: number
  header?: WindowSlots
  body?: WindowSlots
  footer?: WindowSlots
  /** Body scroll offset in rows; clipped to the body. */
  scroll?: number
  footerRule?: boolean
  footerRuleColor?: string
}

function slotNodes(value: WindowSlots | undefined): SceneNode[] {
  if (value === undefined) return []
  return Array.isArray(value) ? [...value] : [value as SceneNode]
}

function stackHeight(nodes: readonly SceneNode[], gap: number): number {
  if (nodes.length === 0) return 0
  return nodes.reduce((total, node, index) => total + sceneHeight(node) + (index > 0 ? gap : 0), 0)
}

/**
 * A window preset: border, title, padding and three slots.
 *
 * The header and footer stack their children; the body is clipped and shifted
 * by `scroll`. Returns an ordinary group, so it composes with everything else
 * and works through the same manifest grants.
 */
export function window(options: WindowOptions): SceneGroup {
  const padding = Math.max(0, options.padding ?? 1)
  const gap = Math.max(0, options.gap ?? 1)
  const inset = 1 + padding
  const contentWidth = Math.max(0, options.width - inset * 2)
  const contentHeight = Math.max(0, options.height - inset * 2)
  const header = slotNodes(options.header)
  const body = slotNodes(options.body)
  const footer = slotNodes(options.footer)
  const headerHeight = stackHeight(header, gap)
  const footerContent = stackHeight(footer, gap)
  const ruleHeight = footer.length > 0 && options.footerRule ? 1 : 0
  const footerHeight = footerContent + ruleHeight
  const headerGap = header.length > 0 && (body.length > 0 || footer.length > 0) ? gap : 0
  const footerGap = footer.length > 0 && body.length > 0 ? gap : 0
  const bodyHeight = Math.max(
    0,
    contentHeight - headerHeight - footerHeight - headerGap - footerGap,
  )
  const scroll = Math.round(options.scroll ?? 0)

  const nodes: SceneNode[] = []
  if (header.length > 0) {
    nodes.push({
      kind: "group",
      anchor: "top-left",
      x: 0,
      y: 0,
      width: contentWidth,
      height: Math.max(1, headerHeight),
      layout: "column",
      gap,
      clip: true,
      nodes: header,
    })
  }
  if (body.length > 0 && bodyHeight > 0) {
    nodes.push({
      kind: "group",
      anchor: "top-left",
      x: 0,
      y: headerHeight + headerGap,
      width: contentWidth,
      height: bodyHeight,
      clip: true,
      scroll,
      nodes: body,
    })
  }
  if (footer.length > 0) {
    const top = contentHeight - footerHeight
    if (ruleHeight > 0) {
      nodes.push({
        kind: "rule",
        anchor: "top-left",
        x: 0,
        y: top,
        width: contentWidth,
        color: options.footerRuleColor ?? "line",
      })
    }
    nodes.push({
      kind: "group",
      anchor: "top-left",
      x: 0,
      y: top + ruleHeight,
      width: contentWidth,
      height: Math.max(1, footerContent),
      layout: "column",
      gap,
      clip: true,
      nodes: footer,
    })
  }

  return {
    kind: "group",
    ...(options.id ? { id: options.id } : {}),
    ...(options.id && options.focusable !== false ? { focusable: true } : {}),
    anchor: options.anchor,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    padding,
    clip: true,
    border: true,
    borderStyle: options.borderStyle,
    title: options.title,
    titleAlign: options.titleAlign,
    borderColor: options.focused
      ? (options.focusedColor ?? "accent")
      : (options.borderColor ?? "line"),
    fg: options.fg,
    bg: options.bg,
    nodes,
  }
}

export type DashboardPanel = {
  /** The window contents; the grid owns its anchor, position and size. */
  window: Omit<WindowOptions, "anchor" | "x" | "y" | "width" | "height">
}

export type DashboardOptions = {
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  /** Column count or relative widths. Defaults to 2 columns. */
  columns?: number | readonly number[]
  /** Row count or relative heights. Defaults to fit the panels. */
  rows?: number | readonly number[]
  /** Exact column widths in cells; overrides `columns` when present. */
  columnWidths?: readonly number[]
  /** Exact row heights in cells; overrides `rows` when present. */
  rowHeights?: readonly number[]
  /** Cells between panels. Defaults to 1. */
  gap?: number
  /** Padding inside the shared frame. Defaults to 1. */
  padding?: number
  border?: boolean
  borderStyle?: "rounded" | "single" | "double"
  title?: string
  titleAlign?: "left" | "center" | "right"
  bg?: string
  fg?: string
  borderColor?: string
  /** Panels fill the grid row by row. */
  panels: readonly DashboardPanel[]
}

function gridWeights(
  spec: number | readonly number[] | undefined,
  fallback: number,
): number[] {
  if (typeof spec === "number") {
    return Array.from({ length: Math.max(1, Math.round(spec)) }, () => 1)
  }
  if (Array.isArray(spec) && spec.length > 0) {
    return spec.map((weight) => Math.max(0.1, Number(weight) || 1))
  }
  return Array.from({ length: Math.max(1, fallback) }, () => 1)
}

function exactTracks(widths: readonly number[], total: number, gap: number): number[] {
  const usable = Math.max(0, total - gap * Math.max(0, widths.length - 1))
  let consumed = 0
  return widths.map((width, index) => {
    const room = Math.max(0, usable - consumed)
    const size =
      index === widths.length - 1
        ? room
        : Math.min(Math.max(0, Math.round(width)), room)
    consumed += size
    return size
  })
}

function trackSizes(weights: readonly number[], total: number, gap: number): number[] {
  const usable = Math.max(0, total - gap * Math.max(0, weights.length - 1))
  const sum = weights.reduce((value, weight) => value + weight, 0)
  let consumed = 0
  return weights.map((weight, index) => {
    const size =
      index === weights.length - 1
        ? Math.max(0, usable - consumed)
        : Math.floor((usable * weight) / sum)
    consumed += size
    return size
  })
}

/**
 * A composable dashboard: windows laid out in a shared grid.
 *
 * The dashboard is one group; the panels are ordinary windows, so they keep
 * their ids, `focusable` flag, slots and commands. Panels fill the grid row by
 * row; `columns`/`rows` may be a count or relative sizes.
 */
export function dashboard(options: DashboardOptions): SceneGroup {
  const gap = Math.max(0, Math.round(options.gap ?? 1))
  const padding = Math.max(0, Math.round(options.padding ?? 1))
  const inset = padding + (options.border ? 1 : 0)
  const contentWidth = Math.max(0, options.width - inset * 2)
  const contentHeight = Math.max(0, options.height - inset * 2)
  const columnWeights = gridWeights(options.columns, 2)
  const widths =
    options.columnWidths && options.columnWidths.length > 0
      ? exactTracks(options.columnWidths, contentWidth, gap)
      : trackSizes(columnWeights, contentWidth, gap)
  const columnCount = Math.max(1, widths.length)
  const rowCount = Math.max(
    1,
    Math.ceil(Math.max(1, options.panels.length) / columnCount),
  )
  const rowWeights = gridWeights(options.rows, rowCount)
  const heights =
    options.rowHeights && options.rowHeights.length > 0
      ? exactTracks(options.rowHeights, contentHeight, gap)
      : trackSizes(rowWeights, contentHeight, gap)
  const yAt = (row: number): number =>
    heights.slice(0, row).reduce((total, height) => total + height + gap, 0)
  const xAt = (column: number): number =>
    widths.slice(0, column).reduce((total, width) => total + width + gap, 0)

  const nodes: SceneNode[] = options.panels.map((panel, index) => {
    const column = index % columnCount
    const row = Math.floor(index / columnCount)
    return window({
      ...panel.window,
      anchor: "top-left",
      x: xAt(column),
      y: yAt(row),
      width: widths[column] ?? 0,
      height: heights[Math.min(row, heights.length - 1)] ?? 0,
    })
  })

  return {
    kind: "group",
    anchor: options.anchor,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    padding,
    clip: true,
    border: options.border === true,
    borderStyle: options.borderStyle,
    title: options.title,
    titleAlign: options.titleAlign,
    borderColor: options.borderColor,
    bg: options.bg,
    fg: options.fg,
    nodes,
  }
}

export type LayoutFrame = {
  anchor: ScenePosition
  x: number
  y: number
  width: number
  height: number
  gap?: number
  padding?: number
  border?: boolean
  borderStyle?: "rounded" | "single" | "double"
  title?: string
  titleAlign?: "left" | "center" | "right"
  bg?: string
  fg?: string
  borderColor?: string
}

export type SidebarMainOptions = LayoutFrame & {
  sidebar: DashboardPanel["window"]
  main: DashboardPanel["window"]
  /** Sidebar width in cells. Defaults to about 30% of the content. */
  sidebarWidth?: number
}

/**
 * Sidebar + main split, built on the dashboard grid.
 *
 * Both panels are ordinary windows, so ids, focus cycling, slots and tables
 * work as usual. The sidebar keeps a fixed cell width; the main panel takes
 * the rest.
 */
export function sidebarMain(options: SidebarMainOptions): SceneGroup {
  const gap = Math.max(0, Math.round(options.gap ?? 1))
  const padding = Math.max(0, Math.round(options.padding ?? 1))
  const inset = padding + (options.border ? 1 : 0)
  const contentWidth = Math.max(0, options.width - inset * 2)
  const requested = Math.round(options.sidebarWidth ?? contentWidth * 0.3)
  const sidebarWidth = Math.max(
    1,
    Math.min(requested, Math.max(1, contentWidth - gap - 1)),
  )
  const mainWidth = Math.max(1, contentWidth - gap - sidebarWidth)
  return dashboard({
    anchor: options.anchor,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    columnWidths: [sidebarWidth, mainWidth],
    rowHeights: [Math.max(1, options.height - inset * 2)],
    gap,
    padding,
    border: options.border,
    borderStyle: options.borderStyle,
    title: options.title,
    titleAlign: options.titleAlign,
    bg: options.bg,
    fg: options.fg,
    borderColor: options.borderColor,
    panels: [{ window: options.sidebar }, { window: options.main }],
  })
}

export type KpiMetric = {
  label: string
  value: string
  detail?: string
  /** Value colour, a palette role or `#rrggbb`. */
  color?: string
  /** Optional focus id; without one the card is not focusable. */
  id?: string
  focusable?: boolean
}

export type KpiStripOptions = {
  anchor: ScenePosition
  x: number
  y: number
  width: number
  /** Card height in cells. Defaults to 6 (two content rows). */
  height?: number
  metrics: readonly KpiMetric[]
  gap?: number
  padding?: number
  bg?: string
  fg?: string
  borderColor?: string
  focusedColor?: string
}

/**
 * A row of metric cards built on the dashboard grid.
 *
 * Each card is a window: the metric label is the title and the value (plus an
 * optional detail line) is the body. Cards join the focus registry only when
 * they declare an id.
 */
export function kpiStrip(options: KpiStripOptions): SceneGroup {
  const gap = Math.max(0, Math.round(options.gap ?? 1))
  const padding = Math.max(0, Math.round(options.padding ?? 0))
  const height = Math.max(3, Math.round(options.height ?? 6))
  const metrics = options.metrics
  return dashboard({
    anchor: options.anchor,
    x: options.x,
    y: options.y,
    width: options.width,
    height,
    ...(metrics.length > 0 ? { columns: metrics.length } : {}),
    gap,
    padding,
    bg: options.bg,
    panels: metrics.map((metric) => ({
      window: {
        ...(metric.id ? { id: metric.id } : {}),
        ...(metric.id ? { focusable: metric.focusable !== false } : {}),
        title: metric.label,
        padding: 1,
        gap: 0,
        bg: options.bg,
        fg: options.fg,
        borderColor: options.borderColor,
        ...(metric.id ? { focusedColor: options.focusedColor } : {}),
        body: [
          {
            kind: "text",
            anchor: "top-left",
            x: 0,
            y: 0,
            text: metric.value,
            fg: metric.color ?? options.fg ?? "foreground",
          },
          ...(metric.detail
            ? [
                {
                  kind: "text" as const,
                  anchor: "top-left" as const,
                  x: 0,
                  y: 1,
                  text: metric.detail,
                  fg: "muted",
                },
              ]
            : []),
        ],
      },
    })),
  })
}

export type ListRow = {
  label: string
  detail?: string
  disabled?: boolean
}

export type ListOptions = {
  rows: readonly ListRow[]
  /** Index of the highlighted row. */
  selected: number
  /** Row width in cells; the highlight bar spans it. */
  width: number
  /** Visible row count; defaults to every row. */
  height?: number
  /** First visible row. Defaults to keeping `selected` in view. */
  scroll?: number
  pointer?: string
  fg?: string
  selectedFg?: string
  selectedBg?: string
  /** Colour for disabled rows. */
  disabledFg?: string
}

/**
 * A selectable list: one highlight bar and one text row per visible entry.
 *
 * The result is an ordinary node array, so it can go straight into a window's
 * `body`. Selection is visual only; change it from a command or from
 * `ctx.time`-driven state.
 */
export function list(options: ListOptions): SceneNode[] {
  const rows = options.rows
  if (rows.length === 0) return []
  const height = Math.max(1, Math.min(rows.length, Math.round(options.height ?? rows.length)))
  const selected = Math.max(0, Math.min(rows.length - 1, Math.round(options.selected)))
  const maxScroll = Math.max(0, rows.length - height)
  const scroll =
    options.scroll === undefined
      ? Math.max(0, Math.min(maxScroll, selected - height + 1))
      : Math.max(0, Math.min(maxScroll, Math.round(options.scroll)))
  const width = Math.max(1, Math.round(options.width))
  const pointer = options.pointer ?? "▸"
  const nodes: SceneNode[] = []
  for (let line = 0; line < height; line++) {
    const index = scroll + line
    const row = rows[index]
    if (!row) break
    const current = index === selected
    if (current) {
      nodes.push({
        kind: "rect",
        anchor: "top-left",
        x: 0,
        y: line,
        width,
        height: 1,
        fill: true,
        color: options.selectedBg ?? "line",
      })
    }
    const prefix = current ? `${pointer} ` : "  "
    const detail = row.detail ? `  ·  ${row.detail}` : ""
    nodes.push({
      kind: "text",
      anchor: "top-left",
      x: 0,
      y: line,
      text: `${prefix}${row.label}${detail}`,
      fg: row.disabled
        ? (options.disabledFg ?? "line")
        : current
          ? (options.selectedFg ?? "foreground")
          : (options.fg ?? "muted"),
      // The bar is a filled rect; the text paints the same colour behind its
      // own cells so the highlight stays continuous under the label.
      ...(current ? { bg: options.selectedBg ?? "line" } : {}),
    })
  }
  return nodes
}

export type TableAlign = "left" | "center" | "right"

export type TableColumn = {
  label: string
  /** Content width in cells. */
  width: number
  align?: TableAlign
}

export type TableRow = {
  cells: readonly string[]
  fg?: string
}

export type TableOptions = {
  columns: readonly TableColumn[]
  rows: readonly TableRow[]
  /** Highlighted row; omit for a read-only table. */
  selected?: number
  /** Visible body rows; defaults to every row. */
  height?: number
  /** First visible body row. Defaults to keeping `selected` in view. */
  scroll?: number
  /** Cells between columns. Defaults to 1. */
  gap?: number
  /** Bar width; defaults to the natural column width. */
  width?: number
  /** Draw the column labels. Defaults to true. */
  header?: boolean
  headerFg?: string
  /** Draw a rule under the header. Defaults to true. */
  headerRule?: boolean
  headerRuleColor?: string
  fg?: string
  selectedFg?: string
  selectedBg?: string
  /** Highlight one cell of the selected row (0-based column). */
  column?: number
  cursorFg?: string
  cursorBg?: string
  /** Emit per-cell pointer hits (`row`/`column`) for hover and click. */
  hit?: boolean
  /** Drag selection between two cells (anchor and moving head). */
  selection?: { anchor: TableCell; head: TableCell }
  selectionBg?: string
  selectionFg?: string
}

export type TableCell = { row: number; column: number }

function fitTableCell(text: string, width: number, align: TableAlign = "left"): string {
  const room = Math.max(0, Math.floor(width))
  if (room === 0) return ""
  const value = text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text
  const pad = room - value.length
  if (align === "right") return " ".repeat(pad) + value
  if (align === "center") {
    const left = Math.floor(pad / 2)
    return " ".repeat(left) + value + " ".repeat(pad - left)
  }
  return value + " ".repeat(pad)
}

/**
 * A multi-column table body: aligned, truncated cells with a header row and
 * an optional selectable bar. Columns are fixed-width; the last column is not
 * stretched. The result is an ordinary node array for a window's `body`.
 */
export function table(options: TableOptions): SceneNode[] {
  const columns = options.columns
  if (columns.length === 0) return []
  const gap = " ".repeat(Math.max(0, Math.round(options.gap ?? 1)))
  const natural =
    columns.reduce((total, column) => total + Math.max(0, Math.round(column.width)), 0) +
    Math.max(0, columns.length - 1) * gap.length
  const width = Math.max(1, Math.round(options.width ?? natural))
  const headerHeight = options.header === false ? 0 : 1 + (options.headerRule === false ? 0 : 1)
  const nodes: SceneNode[] = []

  if (options.header !== false) {
    nodes.push({
      kind: "text",
      anchor: "top-left",
      x: 0,
      y: 0,
      text: columns
        .map((column) => fitTableCell(column.label, column.width, column.align))
        .join(gap)
        .trimEnd(),
      fg: options.headerFg ?? "muted",
    })
    if (options.headerRule !== false) {
      nodes.push({
        kind: "rule",
        anchor: "top-left",
        x: 0,
        y: 1,
        width: natural,
        color: options.headerRuleColor ?? "line",
      })
    }
  }

  const rows = options.rows
  if (rows.length === 0) return nodes
  const height = Math.max(1, Math.min(rows.length, Math.round(options.height ?? rows.length)))
  const selected = Math.max(0, Math.min(rows.length - 1, Math.round(options.selected ?? -1)))
  const hasSelection = options.selected !== undefined
  const column =
    options.column === undefined
      ? undefined
      : Math.max(0, Math.min(columns.length - 1, Math.round(options.column)))
  const selection = options.selection
  const startRow = selection ? Math.min(selection.anchor.row, selection.head.row) : 0
  const endRow = selection ? Math.max(selection.anchor.row, selection.head.row) : -1
  const startColumn = selection
    ? Math.max(0, Math.min(selection.anchor.column, selection.head.column))
    : 0
  const endColumn = selection
    ? Math.min(columns.length - 1, Math.max(selection.anchor.column, selection.head.column))
    : -1
  const maxScroll = Math.max(0, rows.length - height)
  const scroll =
    options.scroll === undefined
      ? Math.max(0, Math.min(maxScroll, selected - height + 1))
      : Math.max(0, Math.min(maxScroll, Math.round(options.scroll)))

  for (let line = 0; line < height; line++) {
    const index = scroll + line
    const row = rows[index]
    if (!row) break
    const current = hasSelection && index === selected
    const y = headerHeight + line
    if (current) {
      nodes.push({
        kind: "rect",
        anchor: "top-left",
        x: 0,
        y,
        width,
        height: 1,
        fill: true,
        color: options.selectedBg ?? "line",
      })
    }
    const rowFg = current ? (options.selectedFg ?? "foreground") : (row.fg ?? options.fg ?? "muted")
    const rowBg = current ? (options.selectedBg ?? "line") : undefined
    const pushHits = (): void => {
      if (!options.hit) return
      let cellX = 0
      for (let cell = 0; cell < columns.length; cell++) {
        const width = Math.max(0, Math.round(columns[cell]!.width))
        nodes.push({
          kind: "hit",
          anchor: "top-left",
          x: cellX,
          y,
          width: Math.max(1, width),
          height: 1,
          row: index,
          column: cell,
        })
        cellX += width + gap.length
      }
    }
    if (selection) {
      // Cell-level overlays: drag range, then the cursor cell on top.
      if (current) {
        nodes.push({
          kind: "rect",
          anchor: "top-left",
          x: 0,
          y,
          width,
          height: 1,
          fill: true,
          color: rowBg ?? "line",
        })
      }
      let cellX = 0
      for (let cell = 0; cell < columns.length; cell++) {
        const entry = columns[cell]!
        const cellWidth = Math.max(0, Math.round(entry.width))
        const inRows = index >= startRow && index <= endRow
        const inRange = inRows && cell >= startColumn && cell <= endColumn
        const isCursor = current && column !== undefined && column === cell
        const cursorBg = options.cursorBg ?? "foreground"
        if (isCursor) {
          nodes.push({
            kind: "text",
            anchor: "top-left",
            x: cellX,
            y,
            text: fitTableCell(row.cells[cell] ?? "", cellWidth, entry.align),
            fg: options.cursorFg ?? "background",
            bg: cursorBg,
          })
        } else if (inRange) {
          nodes.push({
            kind: "text",
            anchor: "top-left",
            x: cellX,
            y,
            text: fitTableCell(row.cells[cell] ?? "", cellWidth, entry.align),
            fg: options.selectionFg ?? "background",
            bg: options.selectionBg ?? "primary",
          })
        } else {
          const text = fitTableCell(row.cells[cell] ?? "", cellWidth, entry.align)
          if (current || text.trim() !== "") {
            nodes.push({
              kind: "text",
              anchor: "top-left",
              x: cellX,
              y,
              text,
              fg: rowFg,
              ...(current ? { bg: rowBg ?? "line" } : {}),
            })
          }
        }
        cellX += cellWidth + gap.length
      }
      pushHits()
      continue
    }
    if (current && column !== undefined) {
      // Split the row so the cursor cell can paint its own background without
      // the row text overwriting it.
      const widths = columns.map((entry) => Math.max(0, Math.round(entry.width)))
      const cellX = widths
        .slice(0, column)
        .reduce((total, width) => total + width + gap.length, 0)
      const cellWidth = widths[column] ?? 0
      const before = columns
        .slice(0, column)
        .map((entry, cell) => fitTableCell(row.cells[cell] ?? "", entry.width, entry.align))
        .join(gap)
      if (before.trimEnd().length > 0) {
        nodes.push({
          kind: "text",
          anchor: "top-left",
          x: 0,
          y,
          text: before,
          fg: rowFg,
          ...(rowBg ? { bg: rowBg } : {}),
        })
      }
      const cursorBg = options.cursorBg ?? "foreground"
      nodes.push({
        kind: "rect",
        anchor: "top-left",
        x: cellX,
        y,
        width: cellWidth,
        height: 1,
        fill: true,
        color: cursorBg,
      })
      nodes.push({
        kind: "text",
        anchor: "top-left",
        x: cellX,
        y,
        text: fitTableCell(row.cells[column] ?? "", cellWidth, columns[column]!.align),
        fg: options.cursorFg ?? "background",
        bg: cursorBg,
      })
      const after = columns
        .slice(column + 1)
        .map((entry, index) =>
          fitTableCell(row.cells[column! + 1 + index] ?? "", entry.width, entry.align),
        )
        .join(gap)
      if (after.trimEnd().length > 0) {
        nodes.push({
          kind: "text",
          anchor: "top-left",
          x: cellX + cellWidth + gap.length,
          y,
          text: after,
          fg: rowFg,
          ...(rowBg ? { bg: rowBg } : {}),
        })
      }
      pushHits()
      continue
    }
    nodes.push({
      kind: "text",
      anchor: "top-left",
      x: 0,
      y,
      text: columns
        .map((entry, cell) => fitTableCell(row.cells[cell] ?? "", entry.width, entry.align))
        .join(gap)
        .trimEnd(),
      fg: rowFg,
      ...(rowBg ? { bg: rowBg } : {}),
    })
    pushHits()
  }
  return nodes
}

export type FooterAction = {
  key: string
  label: string
  disabled?: boolean
}

/** A single footer hint line: `enter open · esc close`. */
export function footerActions(
  actions: readonly FooterAction[],
  options: { separator?: string; fg?: string } = {},
): SceneText {
  const separator = options.separator ?? "  ·  "
  const text = actions
    .map((action) =>
      action.disabled ? `${action.key} ${action.label}` : `${action.key} ${action.label}`,
    )
    .join(separator)
  return {
    kind: "text",
    anchor: "top-left",
    x: 0,
    y: 0,
    text,
    fg: options.fg ?? "muted",
  }
}

/**
 * Blend two `#rrggbb` colours. Use it with `ctx.palette` roles to move between
 * the theme's own colours, e.g. a focus glow.
 */
export function mixHex(from: string, to: string, amount: number): string {
  const parse = (value: string): [number, number, number] | null => {
    const match = /^#([0-9a-fA-F]{6})$/.exec(value)
    if (!match) return null
    const hex = match[1]!
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ]
  }
  const a = parse(from)
  const b = parse(to)
  if (!a || !b) return from
  const t = Math.max(0, Math.min(1, amount))
  const channel = (index: number) =>
    Math.round(a[index]! + (b[index]! - a[index]!) * t)
      .toString(16)
      .padStart(2, "0")
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

/**
 * A colour at `opacity` over `background`.
 *
 * Terminal cells are opaque, so fading out means blending toward the panel
 * colour the node sits on. Pass `ctx.palette` to resolve role names like
 * `"accent"` and `"surface"`; unknown roles pass through unchanged.
 */
/** Palette roles as hex strings, e.g. `ctx.palette`. */
export type FadePalette = Readonly<Record<string, string | undefined>>

const HEX = /^#[0-9a-fA-F]{6}$/

function resolveFadeHex(value: string, palette: FadePalette | undefined): string | null {
  if (HEX.test(value)) return value
  const role = palette?.[value]
  return typeof role === "string" && HEX.test(role) ? role : null
}

export function fadeColor(
  color: string,
  opacity: number,
  background: string,
  palette?: FadePalette,
): string {
  const from = resolveFadeHex(background, palette)
  const to = resolveFadeHex(color, palette)
  // Without a resolved pair there is nothing meaningful to interpolate, so the
  // role name is left for the host to interpret as usual.
  if (!from || !to) return color
  return mixHex(from, to, Math.max(0, Math.min(1, opacity)))
}

function fadeValue(
  value: string | undefined,
  opacity: number,
  background: string,
  palette: FadePalette | undefined,
): string | undefined {
  return typeof value === "string"
    ? fadeColor(value, opacity, background, palette)
    : undefined
}

/**
 * Fade a node tree toward `background`.
 *
 * Every explicit `fg`, `bg`, `color` and `borderColor` is blended, recursively
 * through groups. Use it for enter/exit transitions: render the node only while
 * the returned opacity is above zero.
 */
export function fadeNode(
  node: SceneNode,
  opacity: number,
  background: string,
  palette?: FadePalette,
): SceneNode {
  if (opacity >= 1) return node
  const amount = Math.max(0, opacity)
  if (node.kind === "group") {
    return {
      ...node,
      fg: fadeValue(node.fg, amount, background, palette),
      bg: fadeValue(node.bg, amount, background, palette),
      borderColor: fadeValue(node.borderColor, amount, background, palette),
      nodes: node.nodes.map((child) => fadeNode(child, amount, background, palette)),
    }
  }
  if (node.kind === "text" || node.kind === "box") {
    return {
      ...node,
      fg: fadeValue(node.fg, amount, background, palette),
      bg: fadeValue(node.bg, amount, background, palette),
      ...(node.kind === "box"
        ? { borderColor: fadeValue(node.borderColor, amount, background, palette) }
        : {}),
    }
  }
  if (node.kind === "hit") return node
  if (node.kind === "rule") {
    return { ...node, color: fadeValue(node.color, amount, background, palette) }
  }
  return {
    ...node,
    color: fadeValue(node.color, amount, background, palette),
    bg: fadeValue(node.bg, amount, background, palette),
  }
}

export function fadeNodes(
  nodes: readonly SceneNode[],
  opacity: number,
  background: string,
  palette?: FadePalette,
): SceneNode[] {
  return nodes.map((node) => fadeNode(node, opacity, background, palette))
}

/** Common easing curves for `ctx.time`-driven animation. */
export const ease = {
  linear: (t: number): number => Math.max(0, Math.min(1, t)),
  inCubic: (t: number): number => t * t * t,
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number): number => {
    const c = 1.70158
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
  },
  /** A 0..1 sine pulse; `period` is in seconds. */
  pulse: (time: number, period = 2): number => 0.5 + 0.5 * Math.sin((time / Math.max(0.001, period)) * Math.PI * 2),
}

/** Normalised 0..1 progress through a loop of `duration` seconds. */
export function loop(time: number, duration: number): number {
  const span = Math.max(0.001, duration)
  return ((time % span) + span) % span / span
}

/** 0..1 up and back down over `duration` seconds. */
export function pingPong(time: number, duration: number): number {
  const t = loop(time, duration)
  return t < 0.5 ? t * 2 : 2 - t * 2
}

/** 0..1 opacity after `elapsed` seconds, easing into visibility. */
export function fadeIn(
  elapsed: number,
  duration = 0.3,
  curve: (t: number) => number = ease.outCubic,
): number {
  if (duration <= 0) return 1
  return Math.max(0, Math.min(1, curve(elapsed / duration)))
}

/** 0..1 opacity after `elapsed` seconds, easing out of visibility. */
export function fadeOut(
  elapsed: number,
  duration = 0.3,
  curve: (t: number) => number = ease.outCubic,
): number {
  return 1 - fadeIn(elapsed, duration, curve)
}

/** Identity helper for editor completion and future validation. */
export function definePlugin<T extends PluginDefinition>(plugin: T): T {
  return plugin
}

/** Particle-only shorthand. */
export function defineParticleSystem<T extends PluginDefinition>(system: T): T {
  return system
}

/** Identity helper for manifest files. */
export function defineManifest<T extends PluginManifest>(manifest: T): T {
  return manifest
}
