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
import { tabLayout, type TabSpec as TabSpecInput } from "../src/ui/tabs"
import {
  flattenTree,
  treeRows,
  type TreeGlyphs as TreeGlyphsInput,
  type TreeNode as TreeNodeInput,
} from "../src/ui/tree"
import {
  STEPPER_PREFIX_WIDTH,
  stepPrefix,
  stepRail,
  stepStatus,
  stepperGlyphs,
  type StepperGlyphs as StepperGlyphsInput,
} from "../src/ui/stepper"
import {
  timelineRole,
  timelineRows,
  type TimelineEntry as TimelineEntryInput,
  type TimelineTone as TimelineToneInput,
} from "../src/ui/timeline"
import {
  accordionRows,
  type AccordionSection as AccordionSectionInput,
  type AccordionItem as AccordionItemInput,
} from "../src/ui/accordion"
import { barRows, type BarItem as BarItemInput } from "../src/ui/bars"
import { gaugeLayout, type GaugeLayout as GaugeLayoutInput } from "../src/ui/gauge"
import { toggleLayout, type ToggleLayout as ToggleLayoutInput } from "../src/ui/toggle"
import {
  calendarLayout,
  type CalendarCell as CalendarCellInput,
} from "../src/ui/calendar"
import {
  kanbanLayout,
  type KanbanCard as KanbanCardInput,
  type KanbanColumn as KanbanColumnInput,
} from "../src/ui/kanban"
import {
  diffRows,
  type DiffLine as DiffLineInput,
  type DiffOptions as DiffLayoutOptions,
} from "../src/ui/diff"
import {
  distributionSegments,
  type DistributionItem as DistributionItemInput,
  type DistributionSegment as DistributionSegmentInput,
} from "../src/ui/distribution"
import { legendLayout, type LegendItem as LegendItemInput } from "../src/ui/legend"
import { keycapLayout, type KeycapToken as KeycapTokenInput } from "../src/ui/keycaps"
import { skeletonLines, type SkeletonLine as SkeletonLineInput } from "../src/ui/skeleton"
import {
  radioRows,
  type RadioGlyphs as RadioGlyphsInput,
  type RadioItem as RadioItemInput,
} from "../src/ui/radio"
import {
  tooltipLayout,
  tooltipPosition,
  type TooltipTarget as TooltipTargetInput,
} from "../src/ui/tooltip"
import {
  breadcrumbs as breadcrumbLayout,
  type BreadcrumbSegment as BreadcrumbSegmentInput,
} from "../src/ui/breadcrumbs"
import {
  checklistRows,
  type ChecklistGlyphs as ChecklistGlyphsInput,
  type ChecklistItem as ChecklistItemInput,
} from "../src/ui/checklist"
import {
  heatmapLayout,
  type HeatmapDay as HeatmapDayInput,
} from "../src/ui/heatmap"
import {
  emptyStateRows,
  emptyStateX,
  type EmptyStateRow as EmptyStateRowInput,
} from "../src/ui/empty-state"
import {
  badgeLayout,
  badgeStyle,
  type BadgeSpec as BadgeSpecInput,
  type BadgeTone as BadgeToneInput,
} from "../src/ui/badges"
import {
  CALLOUT_GLYPH,
  calloutLines,
  calloutRole,
  type CalloutTone as CalloutToneInput,
} from "../src/ui/callout"
import {
  sparklineText as renderSparkline,
  type SparklineOptions as SparklineInput,
  type SparklineReduce as SparklineReduceInput,
} from "../src/ui/sparkline"

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
  /** Text submitted by a host prompt or menu, when the command came from one. */
  input?: string
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

export type ConfirmRequest = {
  message: string
  /** Command to run when the user confirms. */
  command: string
  confirmLabel?: string
  cancelLabel?: string
}

export type PromptRequest = {
  message: string
  /** Command to run with the entered text in `ctx.input`. */
  command: string
  placeholder?: string
}

export type MenuRequest = {
  title: string
  options: readonly string[]
  /** Command to run with the chosen option in `ctx.input`. */
  command: string
}

export type StatusRequest = {
  text: string
  tone?: NoticeLevel
}

export type PluginCommandResult =
  | string
  | void
  | {
      message?: string
      level?: NoticeLevel
      duration?: number
      copy?: string
      confirm?: ConfirmRequest
      prompt?: PromptRequest
      menu?: MenuRequest
      /** Set a status-bar chip; `null` clears it. */
      status?: StatusRequest | null
    }

/** Ask the host for a yes/no confirmation, then run `command`. */
export function confirm(
  message: string,
  command: string,
  options: { confirmLabel?: string; cancelLabel?: string } = {},
) {
  return { confirm: { message, command, ...options } }
}

/** Ask the host for one line of text, then run `command` with `ctx.input`. */
export function prompt(
  message: string,
  command: string,
  options: { placeholder?: string } = {},
) {
  return { prompt: { message, command, ...options } }
}

/** Ask the host to pick from a list, then run `command` with `ctx.input`. */
export function menu(title: string, options: readonly string[], command: string) {
  return { menu: { title, options, command } }
}

/** Publish a status-bar chip; `status(null)` clears it. */
export function status(text: string | null, tone: NoticeLevel = "info") {
  return { status: text === null ? null : { text, tone } }
}

/**
 * A one-line notice. The host owns the bubble, fade and lifetime.
 *
 *   return notice("saved", "warn")
 */
export function notice(
  message: string,
  level: NoticeLevel = "info",
  duration?: number,
) {
  return { message, level, ...(duration === undefined ? {} : { duration }) }
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

export type CardTone = "info" | "success" | "warning" | "error" | "neutral"

export type CardOptions = {
  /** Stable id when the card is focusable. */
  id?: string
  focusable?: boolean
  focused?: boolean
  focusedColor?: string
  anchor: ScenePosition
  x: number
  y: number
  width: number
  title?: string
  titleAlign?: "left" | "center" | "right"
  borderStyle?: "rounded" | "single" | "double"
  /** One row per string. */
  lines?: readonly string[]
  /** Extra nodes; their heights are measured too. */
  body?: WindowSlots
  footer?: WindowSlots
  tone?: CardTone
  padding?: number
  gap?: number
  bg?: string
  fg?: string
}

/**
 * A compact message card: framed window, optional title and a stack of lines.
 *
 * Height is computed from the content, so callers do not do layout arithmetic:
 *
 *   card({ anchor: "top-right", x: 2, y: 2, width: 32,
 *          title: "saved", lines: ["3 notes updated"], tone: "success" })
 */
export function card(options: CardOptions): SceneGroup {
  const padding = Math.max(0, options.padding ?? 1)
  const gap = Math.max(0, options.gap ?? 1)
  const lines = options.lines ?? []
  const body = slotNodes(options.body)
  const footer = slotNodes(options.footer)
  const textRows = lines.map<SceneNode>((text, index) => ({
    kind: "text",
    anchor: "top-left",
    x: 0,
    y: index,
    text,
    fg: options.fg ?? "foreground",
  }))
  const bodyRows = Math.max(
    lines.length,
    ...body.map((node) => node.y + sceneHeight(node)),
    0,
  )
  const footerRows = footer.reduce(
    (total, node, index) => total + sceneHeight(node) + (index > 0 ? gap : 0),
    0,
  )
  const height =
    2 +
    padding * 2 +
    bodyRows +
    (footer.length > 0 ? gap + footerRows : 0)
  const tone: CardTone = options.tone ?? "info"
  const borderColor =
    tone === "neutral" || tone === "info" ? "line" : tone

  return window({
    ...(options.id ? { id: options.id } : {}),
    ...(options.id && options.focusable !== false ? { focusable: true } : {}),
    ...(options.focused === undefined ? {} : { focused: options.focused }),
    ...(options.focusedColor ? { focusedColor: options.focusedColor } : {}),
    anchor: options.anchor,
    x: options.x,
    y: options.y,
    width: options.width,
    height: Math.max(3, height),
    title: options.title,
    titleAlign: options.titleAlign,
    borderStyle: options.borderStyle,
    borderColor,
    padding,
    gap,
    bg: options.bg,
    fg: options.fg,
    body: [...textRows, ...body],
    footer: footer.length > 0 ? footer : undefined,
  })
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

export type TransitionOptions = {
  /** Seconds to enter; defaults to 0.3. */
  enter?: number
  /** Seconds to stay fully visible; defaults to 0. */
  hold?: number
  /** Seconds to leave; defaults to 0.3. Set 0 to stay visible. */
  exit?: number
  curve?: (t: number) => number
}

/**
 * One enter → hold → exit visibility envelope.
 *
 *   const opacity = transition(time - changedAt, { enter: 0.4, hold: 2, exit: 0.4 })
 *
 * Returns 0..1; once the full cycle has passed it stays 0. A zero `exit`
 * keeps the value at 1 after the hold.
 */
export function transition(elapsed: number, options: TransitionOptions = {}): number {
  const enter = Math.max(0, options.enter ?? 0.3)
  const hold = Math.max(0, options.hold ?? 0)
  const exit = Math.max(0, options.exit ?? 0.3)
  const curve = options.curve ?? ease.outCubic
  const t = Math.max(0, elapsed)
  if (enter > 0 && t < enter) return curve(t / enter)
  const afterEnter = Math.max(0, t - enter)
  if (afterEnter < hold) return 1
  if (exit <= 0) return 1
  return 1 - curve(Math.min(1, (afterEnter - hold) / exit))
}

export type CursorOptions = {
  /** Initial selection; defaults to 0. */
  index?: number
  /** Wrap at the ends instead of clamping. */
  wrap?: boolean
}

export type Cursor = {
  readonly index: number
  readonly count: number
  readonly fraction: number
  set(index: number): number
  next(step?: number): number
  prev(step?: number): number
}

/**
 * A small selection cursor for lists and tables.
 *
 *   const cursor = createCursor(rows.length, { index: ctx.store.get("row") ?? 0 })
 *   commands: {
 *     next: () => { ctx.store.set("row", cursor.next()) },
 *   }
 *
 * It clamps by default; pass `{ wrap: true }` to cycle.
 */
export function createCursor(count: number, options: CursorOptions = {}): Cursor {
  const size = Math.max(0, Math.round(count))
  const wrap = options.wrap === true
  const place = (value: number): number => {
    if (size === 0) return 0
    const rounded = Math.round(value)
    if (wrap) return ((rounded % size) + size) % size
    return Math.max(0, Math.min(size - 1, rounded))
  }
  let index = place(options.index ?? 0)
  return {
    get index() {
      return index
    },
    get count() {
      return size
    },
    get fraction() {
      return size <= 1 ? 0 : index / (size - 1)
    },
    set(value: number) {
      index = place(value)
      return index
    },
    next(step = 1) {
      index = place(index + step)
      return index
    },
    prev(step = 1) {
      index = place(index - step)
      return index
    },
  }
}

export type FieldRow = {
  label: string
  value?: string
  /** Value colour override, a palette role or `#rrggbb`. */
  tone?: string
}

export type FieldsOptions = {
  rows: readonly FieldRow[]
  /** Full row width in cells. */
  width: number
  selected?: number
  height?: number
  scroll?: number
  labelWidth?: number
  gap?: number
  selectedBg?: string
  selectedFg?: string
  fg?: string
  valueFg?: string
}

function fitFieldText(text: string, width: number): string {
  const room = Math.max(0, Math.floor(width))
  if (room === 0) return ""
  return text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text
}

/** Label/value rows for a settings or detail panel. */
export function fields(options: FieldsOptions): SceneNode[] {
  const rows = options.rows
  if (rows.length === 0) return []
  const width = Math.max(1, Math.round(options.width))
  const labelWidth = Math.max(
    1,
    Math.min(width - 1, Math.round(options.labelWidth ?? Math.min(14, Math.floor(width / 3)))),
  )
  const gap = " ".repeat(Math.max(0, Math.round(options.gap ?? 1)))
  const selected = Math.max(0, Math.min(rows.length - 1, Math.round(options.selected ?? -1)))
  const height = Math.max(1, Math.min(rows.length, Math.round(options.height ?? rows.length)))
  const maxScroll = Math.max(0, rows.length - height)
  const scroll =
    options.scroll === undefined
      ? Math.max(0, Math.min(maxScroll, selected - height + 1))
      : Math.max(0, Math.min(maxScroll, Math.round(options.scroll)))
  const nodes: SceneNode[] = []

  for (let line = 0; line < height; line++) {
    const index = scroll + line
    const row = rows[index]
    if (!row) break
    const current = options.selected !== undefined && index === selected
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
    const label = fitFieldText(row.label, labelWidth).padEnd(labelWidth)
    const valueWidth = width - labelWidth - gap.length
    const value = valueWidth > 0 ? fitFieldText(row.value ?? "", valueWidth) : ""
    nodes.push({
      kind: "text",
      anchor: "top-left",
      x: 0,
      y: line,
      text: `${label}${gap}${value}`.trimEnd(),
      fg: current
        ? (options.selectedFg ?? "foreground")
        : row.tone ?? (row.value ? (options.valueFg ?? "foreground") : (options.fg ?? "muted")),
      ...(current ? { bg: options.selectedBg ?? "line" } : {}),
    })
  }
  return nodes
}

export type LogOptions = {
  lines: readonly string[]
  /** Truncate each line to this width. */
  width?: number
  /** Visible rows; defaults to all lines. */
  height?: number
  /** First visible line; defaults to the tail. */
  scroll?: number
  fg?: string
  /** Lines before `scroll` can use a quieter colour. */
  muted?: string
  /** Lines at or after this index use `tone`. */
  toneFrom?: number
  tone?: string
}

/** A tailing text stream: build output, events, logs. */
export function log(options: LogOptions): SceneNode[] {
  const lines = options.lines
  if (lines.length === 0) return []
  const height = Math.max(1, Math.min(lines.length, Math.round(options.height ?? lines.length)))
  const maxScroll = Math.max(0, lines.length - height)
  const scroll =
    options.scroll === undefined
      ? maxScroll
      : Math.max(0, Math.min(maxScroll, Math.round(options.scroll)))
  const nodes: SceneNode[] = []
  for (let line = 0; line < height; line++) {
    const index = scroll + line
    const text = lines[index]
    if (text === undefined) break
    const value =
      options.width === undefined
        ? text
        : text.length > options.width
          ? `${text.slice(0, Math.max(0, options.width - 1))}…`
          : text
    const tone = options.tone && options.toneFrom !== undefined && index >= options.toneFrom
    nodes.push({
      kind: "text",
      anchor: "top-left",
      x: 0,
      y: line,
      text: value,
      fg: tone ? options.tone : options.fg ?? options.muted ?? "muted",
    })
  }
  return nodes
}

export type StatItem = {
  label: string
  value: string
  detail?: string
  /** Value colour, a palette role or `#rrggbb`. */
  tone?: string
}

export type StatsOptions = {
  items: readonly StatItem[]
  width: number
  labelFg?: string
  valueFg?: string
  detailFg?: string
}

/** Compact label/value stats: a value on the right, optional detail below. */
export function stats(options: StatsOptions): SceneNode[] {
  const width = Math.max(1, Math.round(options.width))
  const nodes: SceneNode[] = []
  let y = 0
  for (const item of options.items) {
    const label = fitFieldText(item.label, width)
    const value = fitFieldText(item.value, Math.max(1, width - label.length - 1))
    const pad = Math.max(1, width - label.length - value.length)
    nodes.push({
      kind: "text",
      anchor: "top-left",
      x: 0,
      y,
      text: `${label}${" ".repeat(pad)}${value}`,
      fg: item.tone ?? options.valueFg ?? "foreground",
    })
    y += 1
    if (item.detail) {
      nodes.push({
        kind: "text",
        anchor: "top-left",
        x: 0,
        y,
        text: fitFieldText(item.detail, width),
        fg: options.detailFg ?? "muted",
      })
      y += 1
    }
  }
  return nodes
}

/** A label row above a progress track, with a tone and optional custom text. */
export type MeterOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Track width in cells. */
  width: number
  /** Fill, 0..1. */
  value: number
  /** A row above the track, left-aligned. */
  label?: string
  /** A row above the track, right-aligned. Defaults to the percentage. */
  text?: string
  /** Track height in cells; defaults to 1. */
  height?: number
  /** Corner radius of the track and fill; defaults to 0. */
  radius?: number
  /** Fill colour: a palette role or `#rrggbb`. Defaults to `primary`. */
  tone?: string
  /** Track colour. Defaults to `line`. */
  track?: string
  labelFg?: string
  textFg?: string
  /** Hide the percentage when `text` is omitted; defaults to false. */
  showPercent?: boolean
}

/**
 * A labelled progress track: label and percentage above a filled bar.
 *
 *   meter({ anchor: "top-left", x: 0, y: 6, width: 32,
 *           label: "queue", value: 0.62, tone: "accent" })
 *
 * Returns one text row (when a label or text is given) and one `progress`
 * node. The value is clamped to 0..1.
 */
export function meter(options: MeterOptions): SceneNode[] {
  const width = Math.max(1, Math.round(options.width))
  const value = Math.max(0, Math.min(1, Number.isFinite(options.value) ? options.value : 0))
  const height = Math.max(1, Math.round(options.height ?? 1))
  const label = options.label ?? ""
  const text =
    options.text ??
    (label !== "" && options.showPercent !== false ? `${Math.round(value * 100)}%` : "")
  const nodes: SceneNode[] = []
  const labelled = label !== "" || text !== ""
  if (labelled) {
    const pad = Math.max(1, width - label.length - text.length)
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y: options.y,
      text: `${label}${" ".repeat(pad)}${text}`.trimEnd(),
      fg: options.labelFg ?? "muted",
    })
  }
  nodes.push({
    kind: "progress",
    anchor: options.anchor,
    x: options.x,
    y: options.y + (labelled ? 1 : 0),
    width,
    height,
    value,
    radius: Math.max(0, Math.min(options.radius ?? 0, Math.floor(width / 2))),
    color: options.tone ?? "primary",
    track: options.track ?? "line",
  })
  return nodes
}

/** How a series collapses into a column: the sum, peak or mean of the bucket. */
export type SparklineReduce = SparklineReduceInput

/** Values, scale, ramp and bucketing for a sparkline. */
export type SparklineOptions = SparklineInput

/** A sparkline plus its scene placement and glyph colour. */
export type SparklineNodeOptions = SparklineOptions & {
  anchor: ScenePosition
  x: number
  y: number
  /** Glyph colour: a palette role or `#rrggbb`. Defaults to `primary`. */
  fg?: string
}

/**
 * A block-glyph trend line placed as a scene text node.
 *
 *   sparkline({ anchor: "top-left", x: 0, y: 4, values: [2, 5, 3, 9] })
 *
 * `sparklineText` returns the same line without placing it, which is handy for
 * a window title or a footer. More values than `width` are bucketed; fewer are
 * left as they are rather than stretched.
 */
export function sparkline(options: SparklineNodeOptions): SceneText {
  return {
    kind: "text",
    anchor: options.anchor,
    x: options.x,
    y: options.y,
    text: renderSparkline(options),
    fg: options.fg ?? "primary",
  }
}

/**
 * The glyph line for a series, without placement.
 *
 *   sparklineText({ values: [1, 4, 2, 9, 3] }) // "▁▄▂█▃"
 */
export function sparklineText(options: SparklineOptions): string {
  return renderSparkline(options)
}

export type TabItem = {
  label: string
  /** Optional trailing count, e.g. `work 3`. */
  count?: number
}

/** A tab label with an optional trailing count. */
export type TabSpec = TabSpecInput

export type TabsOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Available columns for the whole strip. */
  width: number
  tabs: readonly TabItem[]
  /** Index of the active tab; clamped to the list. */
  selected: number
  /** Spaces on each side of a label; defaults to 1. */
  padding?: number
  /** Spaces between chips; defaults to 0. */
  gap?: number
  /** Unselected label colour. Defaults to `muted`. */
  fg?: string
  /** Selected label colour. Defaults to `background`. */
  selectedFg?: string
  /** Selected chip fill. Defaults to `accent`. */
  selectedBg?: string
  /** Optional fill behind every chip; selected keeps `selectedBg`. */
  bg?: string
}

/**
 * A horizontal tab strip with the active chip filled.
 *
 *   tabs({ anchor: "top-left", x: 2, y: 2, width: 40,
 *          tabs: [{ label: "7d" }, { label: "30d" }, { label: "all" }],
 *          selected: 1 })
 *
 * Chips are measured left to right; the first one that does not fit ends the
 * strip rather than being cut in half. A lone too-wide chip is truncated.
 */
export function tabs(options: TabsOptions): SceneNode[] {
  const segments = tabLayout({
    tabs: options.tabs,
    selected: options.selected,
    width: options.width,
    ...(options.padding === undefined ? {} : { padding: options.padding }),
    ...(options.gap === undefined ? {} : { gap: options.gap }),
  })
  const nodes: SceneNode[] = []
  for (const segment of segments) {
    if (segment.selected || options.bg) {
      nodes.push({
        kind: "rect",
        anchor: options.anchor,
        x: options.x + segment.x,
        y: options.y,
        width: segment.width,
        height: 1,
        fill: true,
        color: segment.selected ? (options.selectedBg ?? "accent") : (options.bg ?? "surface"),
      })
    }
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + segment.x,
      y: options.y,
      text: segment.text,
      fg: segment.selected ? (options.selectedFg ?? "background") : (options.fg ?? "muted"),
    })
  }
  return nodes
}

/** The tone a callout uses; `info` follows the secondary ink. */
export type CalloutTone = CalloutToneInput

export type CalloutOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total block width, including the bar and its space. */
  width: number
  message: string
  /** One title line above the message, in the same tone. */
  title?: string
  tone?: CalloutTone
  /** Optional fill behind the whole block. */
  bg?: string
  /** Text colour override; defaults to the tone's palette role. */
  fg?: string
}

/** The widest a single line can be, given the bar prefix. */
function fitCallout(text: string, width: number): string {
  if (text.length <= width) return text
  return width <= 1 ? "…" : `${text.slice(0, width - 1)}…`
}

/**
 * A tone-coded warning or notice: a `▌` bar and a wrapped message.
 *
 *   callout({ anchor: "top-left", x: 0, y: 10, width: 40,
 *             tone: "warning", message: "the budget is nearly spent" })
 *
 * The message wraps to the block width; a word longer than a line hard-breaks.
 * `title` adds a heading line, and `bg` fills the block for a louder notice.
 */
export function callout(options: CalloutOptions): SceneNode[] {
  const role = options.fg ?? calloutRole(options.tone ?? "info")
  const inner = Math.max(1, Math.round(options.width) - 2)
  const body = calloutLines(options.message, inner)
  const lines = options.title ? [fitCallout(options.title, inner), ...body] : body
  const nodes: SceneNode[] = []
  if (options.bg && lines.length > 0) {
    nodes.push({
      kind: "rect",
      anchor: options.anchor,
      x: options.x,
      y: options.y,
      width: Math.max(1, Math.round(options.width)),
      height: lines.length,
      fill: true,
      color: options.bg,
    })
  }
  for (let index = 0; index < lines.length; index++) {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y: options.y + index,
      text: `${CALLOUT_GLYPH} ${lines[index]}`.trimEnd(),
      fg: role,
    })
  }
  return nodes
}

/** A badge's tone: the fill and ink pair it selects. */
export type BadgeTone = BadgeToneInput

/** A label and tone in a badge row. */
export type BadgeSpec = BadgeSpecInput

export type BadgesOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Available columns for the whole row. */
  width: number
  badges: readonly BadgeSpec[]
  /** Spaces on each side of a label; defaults to 1. */
  padding?: number
  /** Spaces between badges; defaults to 1. */
  gap?: number
  /** Fill override for every badge; otherwise the tone decides. */
  bg?: string
  /** Label-colour override for every badge. */
  fg?: string
}

/**
 * A row of filled status chips.
 *
 *   badges({ anchor: "top-left", x: 2, y: 2, width: 40,
 *            badges: [{ label: "linked", tone: "success" },
 *                     { label: "3 models", tone: "neutral" }] })
 *
 * Tones are `info`, `success`, `warning`, `error` and `neutral`. Badges are
 * measured left to right; the first one that does not fit ends the row, and a
 * lone too-wide badge truncates with `…`.
 */
export function badges(options: BadgesOptions): SceneNode[] {
  const segments = badgeLayout({
    badges: options.badges,
    width: options.width,
    ...(options.padding === undefined ? {} : { padding: options.padding }),
    ...(options.gap === undefined ? {} : { gap: options.gap }),
  })
  const nodes: SceneNode[] = []
  for (const segment of segments) {
    const style = badgeStyle(segment.tone)
    nodes.push({
      kind: "rect",
      anchor: options.anchor,
      x: options.x + segment.x,
      y: options.y,
      width: segment.width,
      height: 1,
      fill: true,
      color: options.bg ?? style.bg,
    })
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + segment.x,
      y: options.y,
      text: segment.text,
      fg: options.fg ?? style.fg,
    })
  }
  return nodes
}

/** One row in a `bars()` chart. */
export type BarItem = BarItemInput

export type BarsOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total row width in cells. */
  width: number
  items: readonly BarItem[]
  labelWidth?: number
  /** Right-hand column; 0 hides it. Defaults to the widest text. */
  valueWidth?: number
  barWidth?: number
  /** Spaces between columns; defaults to 1. */
  gap?: number
  /** Scale top; defaults to the largest value. */
  max?: number
  /** Cells kept filled for any non-zero value; defaults to 1. */
  minBar?: number
  /** Label colour. Defaults to `foreground`. */
  fg?: string
  /** Value colour. Defaults to `muted`. */
  valueFg?: string
  /** Bar fill. Defaults to `primary`. */
  tone?: string
  /** Bar track. Defaults to `line`. */
  track?: string
}

/**
 * A proportional bar chart: one labelled row per item.
 *
 *   bars({ anchor: "top-left", x: 2, y: 4, width: 48,
 *          labelWidth: 20, valueWidth: 4,
 *          items: [{ label: "gpt-4.1", value: 62, text: "62%" },
 *                  { label: "claude", value: 38, text: "38%" }] })
 *
 * Every row shares the label and value columns, so the bars line up. The bar
 * width is whatever remains; a non-zero value always keeps one cell. The fill
 * is a `progress` node with sub-cell precision.
 */
export function bars(options: BarsOptions): SceneNode[] {
  const rows = barRows(options)
  const nodes: SceneNode[] = []
  for (const row of rows) {
    const barX = options.x + row.labelWidth + row.gap
    const valueX = barX + row.barWidth + row.gap
    const y = options.y + row.index
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y,
      text: row.label,
      fg: options.fg ?? "foreground",
    })
    nodes.push({
      kind: "progress",
      anchor: options.anchor,
      x: barX,
      y,
      width: row.barWidth,
      height: 1,
      value: row.fraction,
      radius: 0,
      color: options.tone ?? "primary",
      track: options.track ?? "line",
    })
    if (row.valueWidth > 0) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: valueX,
        y,
        text: row.text.padStart(row.valueWidth),
        fg: options.valueFg ?? "muted",
      })
    }
  }
  return nodes
}

/** A timeline entry's tone: the glyph and rail colour. */
export type TimelineTone = TimelineToneInput

/** One event in a `timeline()`. */
export type TimelineEntry = TimelineEntryInput

export type TimelineOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total row width in cells. */
  width: number
  entries: readonly TimelineEntry[]
  /** Time column width; defaults to the longest time. */
  timeWidth?: number
  /** Glyph column width; defaults to the widest glyph. */
  glyphWidth?: number
  /** Spaces between columns; defaults to 1. */
  gap?: number
  /** Render detail rows; defaults to true. */
  details?: boolean
  /** Label colour. Defaults to `foreground`. */
  fg?: string
  /** Time colour. Defaults to `muted`. */
  timeFg?: string
  /** Detail text and rail colour. Defaults to `muted`. */
  detailFg?: string
}

/**
 * A vertical timeline: time, status glyph and label, with an optional detail
 * line connected by a rail.
 *
 *   timeline({ anchor: "top-left", x: 2, y: 2, width: 60,
 *              entries: [
 *                { time: "14:03", glyph: "✓", tone: "success",
 *                  label: "src/a.ts · approved", detail: "write-decision · my-app" },
 *                { time: "14:05", glyph: "×", tone: "error",
 *                  label: "bun test · denied", detail: "command-decision · my-app" },
 *              ] })
 *
 * Entries with a `detail` take two rows; the rail glyph (`│`) connects them.
 * Long labels fit to the row and truncate with `…`.
 */
export function timeline(options: TimelineOptions): SceneNode[] {
  const rows = timelineRows(options)
  const nodes: SceneNode[] = []
  for (const row of rows) {
    const timeX = options.x
    const glyphX = timeX + row.timeWidth + (row.timeWidth > 0 ? row.gap : 0)
    const labelX = glyphX + row.glyphWidth + row.gap
    if (row.timeWidth > 0) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: timeX,
        y: options.y + row.y,
        text: row.time,
        fg: options.timeFg ?? "muted",
      })
    }
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: glyphX,
      y: options.y + row.y,
      text: row.glyph,
      fg: timelineRole(row.tone),
    })
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: labelX,
      y: options.y + row.y,
      text: row.label,
      fg: options.fg ?? "foreground",
    })
    if (row.detail) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: glyphX,
        y: options.y + row.y + 1,
        text: `${"│"}`.padEnd(row.glyphWidth),
        fg: options.detailFg ?? "muted",
      })
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: labelX,
        y: options.y + row.y + 1,
        text: row.detail,
        fg: options.detailFg ?? "muted",
      })
    }
  }
  return nodes
}

/** One row of an `emptyState()`. */
export type EmptyStateRow = EmptyStateRowInput

export type EmptyStateOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Text columns available; titles and hints wrap to it. */
  width: number
  title: string
  hint?: string
  /** A glyph above the title; omit for a text-only empty state. */
  glyph?: string
  /** Optional box height; content is centred vertically inside it. */
  height?: number
  /** Title colour. Defaults to `muted`. */
  titleFg?: string
  /** Hint colour. Defaults to `primary`. */
  hintFg?: string
  /** Glyph colour. Defaults to `primary`. */
  glyphFg?: string
}

/**
 * A centred empty-state placeholder: glyph, title and hint.
 *
 *   emptyState({ anchor: "top-left", x: 4, y: 6, width: 40, glyph: "○",
 *                title: "no activity yet",
 *                hint: "run an agent to see events" })
 *
 * Rows are centred horizontally in `width` and stacked in order. Pass `height`
 * to centre the block vertically inside a box; long titles and hints wrap, and
 * a word wider than the line hard-breaks.
 */
export function emptyState(options: EmptyStateOptions): SceneNode[] {
  const rows = emptyStateRows(options)
  if (rows.length === 0) return []
  const top =
    options.height === undefined
      ? 0
      : Math.max(0, Math.floor((options.height - rows.length) / 2))
  return rows.map((row, index) => ({
    kind: "text" as const,
    anchor: options.anchor,
    x: options.x + emptyStateX(row, options.width),
    y: options.y + top + index,
    text: row.text,
    fg:
      row.kind === "hint"
        ? (options.hintFg ?? "primary")
        : row.kind === "glyph"
          ? (options.glyphFg ?? "primary")
          : (options.titleFg ?? "muted"),
  }))
}

/** One day in a `heatmap()`; `null` is a day outside the period. */
export type HeatmapDay = HeatmapDayInput

export type HeatmapOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Columns, one per week; each holds seven days (Monday first). */
  weeks: readonly (readonly HeatmapDay[])[]
  months?: readonly { week: number; label: string }[]
  /** Columns per week; 1 or 2. Defaults to 1. */
  cellWidth?: 1 | 2
  dayLabels?: readonly string[]
  /** Glyph ramp from level 0 to 4. */
  ramp?: readonly string[]
  /** Tokens that fill the top level; defaults to the busiest day. */
  max?: number
  /** Draw the month line and weekday labels; defaults true. */
  labels?: boolean
  /** Active cell colour. Defaults to `primary`. */
  tone?: string
  /** Rest colour. Defaults to `muted`. */
  muted?: string
}

/**
 * A contribution-style heatmap: weekdays down, weeks across.
 *
 *   heatmap({ anchor: "top-left", x: 2, y: 4,
 *             weeks: [[{ runs: 1, tokens: 400 }, ...seven days], ...],
 *             months: [{ week: 0, label: "Jan" }] })
 *
 * Busy days use a denser ramp glyph, so intensity reads without relying on
 * colour alone. Adjacent cells with the same tone become one text node to keep
 * the node count down. Pass `labels: false` for a bare grid.
 */
export function heatmap(options: HeatmapOptions): SceneNode[] {
  const grid = heatmapLayout(options)
  const labels = options.labels !== false
  const labelWidth = labels ? (grid.days[0]?.length ?? 1) + 1 : 0
  const nodes: SceneNode[] = []
  let y = options.y
  if (labels) {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y,
      text: `${" ".repeat(labelWidth)}${grid.months}`,
      fg: options.muted ?? "muted",
    })
    y += 1
  }
  grid.cells.forEach((row, index) => {
    if (labels) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x,
        y: y + index,
        text: `${grid.days[index]} `.padEnd(labelWidth),
        fg: options.muted ?? "muted",
      })
    }
    let start = 0
    for (let week = 1; week <= row.length; week++) {
      if (week < row.length && row[week]!.tone === row[start]!.tone) continue
      const text = row
        .slice(start, week)
        .map((cell) => cell.glyph.repeat(grid.cellWidth))
        .join("")
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x + labelWidth + start * grid.cellWidth,
        y: y + index,
        text,
        fg:
          row[start]!.tone === "muted"
            ? (options.muted ?? "muted")
            : (options.tone ?? "primary"),
      })
      start = week
    }
  })
  return nodes
}

/** The glyphs a `stepper()` uses. */
export type StepperGlyphs = StepperGlyphsInput

/** One entry in a `stepper()`. */
export type StepperEntry = {
  label: string
  /** Completed/ticked; takes precedence over `current`. */
  done?: boolean
  /** The entry the cursor is on. */
  current?: boolean
  /** An optional second line under the label. */
  detail?: string
}

export type StepperOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total row width in cells. */
  width: number
  entries: readonly StepperEntry[]
  glyphs?: Partial<StepperGlyphs>
  /** Rail rows between entries; defaults true. */
  rails?: boolean
  /** Completed label colour. Defaults to `success`. */
  doneFg?: string
  /** Current label colour. Defaults to `primary`. */
  currentFg?: string
  /** Pending label colour. Defaults to `foreground`. */
  pendingFg?: string
  /** Rail colour. Defaults to `muted`. */
  railFg?: string
  /** Detail colour. Defaults to `muted`. */
  detailFg?: string
}

/**
 * A vertical stepper: done, current and pending entries joined by a rail.
 *
 *   stepper({ anchor: "top-left", x: 2, y: 2, width: 48,
 *             entries: [
 *               { label: "read the brief", done: true },
 *               { label: "derive the balance", current: true,
 *                 detail: "about 12 minutes" },
 *               { label: "write the answer" },
 *             ] })
 *
 * The prefix is the selection bar, the status glyph and two spaces. A checked
 * entry reads done even when it is current; the bar still marks the cursor.
 * Rails and details can be turned off.
 */
export function stepper(options: StepperOptions): SceneNode[] {
  const glyphs = stepperGlyphs(options.glyphs)
  const width = Math.max(1, Math.floor(options.width))
  const labelWidth = Math.max(1, width - STEPPER_PREFIX_WIDTH)
  const fit = (text: string) =>
    text.length <= labelWidth ? text : labelWidth === 1 ? "…" : `${text.slice(0, labelWidth - 1)}…`
  const nodes: SceneNode[] = []
  let y = options.y

  options.entries.forEach((entry, index) => {
    const status = stepStatus(entry.done === true, entry.current === true)
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y,
      text: `${stepPrefix(status, entry.current === true, glyphs)}${fit(entry.label)}`,
      fg:
        status === "done"
          ? (options.doneFg ?? "success")
          : status === "current"
            ? (options.currentFg ?? "primary")
            : (options.pendingFg ?? "foreground"),
    })
    y += 1
    if (entry.detail) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x,
        y,
        text: `${stepRail(glyphs)}${fit(entry.detail)}`,
        fg: options.detailFg ?? "muted",
      })
      y += 1
    }
    if (options.rails !== false && index < options.entries.length - 1) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x,
        y,
        text: stepRail(glyphs),
        fg: options.railFg ?? "muted",
      })
      y += 1
    }
  })
  return nodes
}

/** The guide and caret glyphs a `tree()` uses. */
export type TreeGlyphs = TreeGlyphsInput

/** A node in a `tree()`; children nest under it. */
export type TreeNode = TreeNodeInput

export type TreeOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total row width in cells. */
  width: number
  nodes: readonly TreeNode[]
  /** Ids whose children are hidden and whose caret points right. */
  collapsed?: readonly string[]
  /** Draw a marker column and mark this visible row. */
  selected?: number
  glyphs?: Partial<TreeGlyphs>
  /** Draw expand/collapse carets; defaults true. */
  carets?: boolean
  /** Leaf label colour. Defaults to `foreground`. */
  fg?: string
  /** Root label colour. Defaults to `primary`. */
  rootFg?: string
  /** Detail colour. Defaults to `muted`. */
  detailFg?: string
  /** Marker colour. Defaults to `primary`. */
  markerFg?: string
  /** Guide, branch and caret colour. Defaults to `line`. */
  guideFg?: string
}

/**
 * A tree with guide glyphs, expand/collapse carets and a selection marker.
 *
 *   tree({ anchor: "top-left", x: 2, y: 2, width: 48, collapsed: ["b"],
 *          nodes: [
 *            { id: "a", label: "project", children: [
 *              { id: "a1", label: "src", children: [{ id: "a2", label: "index.ts" }] },
 *            ] },
 *            { id: "b", label: "archive", children: [{ id: "b1", label: "old.ts" }] },
 *          ] })
 *
 * Collapsed ids hide their children; the caret turns from `▾` to `▸`. Guides
 * mark ancestors that still have siblings below, and `├─`/`└─` mark the branch.
 * Pass `carets: false` for a static tree. A node's `detail` is a muted second
 * line.
 */
export function tree(options: TreeOptions): SceneNode[] {
  const items = flattenTree(options.nodes, options.collapsed ?? [])
  const rows = treeRows({
    items,
    width: options.width,
    ...(options.selected === undefined ? {} : { selected: options.selected }),
    ...(options.glyphs === undefined ? {} : { glyphs: options.glyphs }),
    ...(options.carets === undefined ? {} : { carets: options.carets }),
  })
  const nodes: SceneNode[] = []
  let y = options.y
  for (const row of rows) {
    const guideX = options.x + row.marker.length
    const caretX = guideX + row.guides.length + row.branch.length
    const labelX = options.x + row.prefixWidth
    if (row.marker !== "") {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x,
        y,
        text: row.marker,
        fg: options.markerFg ?? "primary",
      })
    }
    if (row.guides !== "" || row.branch !== "") {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: guideX,
        y,
        text: `${row.guides}${row.branch}`,
        fg: options.guideFg ?? "line",
      })
    }
    if (row.caret !== " " && row.caret !== "") {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: caretX,
        y,
        text: `${row.caret} `,
        fg: options.guideFg ?? "line",
      })
    }
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: labelX,
      y,
      text: row.label,
      fg: row.depth === 0 ? (options.rootFg ?? "primary") : (options.fg ?? "foreground"),
    })
    if (row.detail) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: labelX,
        y: y + 1,
        text: row.detail,
        fg: options.detailFg ?? "muted",
      })
      y += 2
    } else {
      y += 1
    }
  }
  return nodes
}

/** Clamped level, percentage and text for a gauge. */
export type GaugeLayout = GaugeLayoutInput

export type GaugeOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Ring bounding box in cells; defaults to 10. */
  size?: number
  value: number
  /** Limit; 0 means no meaningful level. Defaults to `value`. */
  max?: number
  /** A caption under the ring. */
  label?: string
  /** Show the percentage in the centre; defaults true. */
  showPercent?: boolean
  /** Ring thickness in cells; defaults to 1. */
  thickness?: number
  /** Filled arc colour. Defaults to `primary`. */
  tone?: string
  /** Track arc colour. Defaults to `line`. */
  track?: string
  /** Label colour. Defaults to `muted`. */
  labelFg?: string
  /** Centre text colour. Defaults to `foreground`. */
  percentFg?: string
}

/**
 * A ring gauge with an optional centre percentage and a caption.
 *
 *   gauge({ anchor: "top-left", x: 2, y: 2, size: 12, value: 3, max: 10,
 *           label: "3 / 10" })
 *
 * A full track arc is drawn first, then the filled arc from 12 o'clock. The
 * value is clamped to 0..max; `max: 0` draws an empty ring. `showPercent: false`
 * hides the centre text.
 */
export function gauge(options: GaugeOptions): SceneNode[] {
  const layout = gaugeLayout(options)
  const size = Math.max(3, Math.round(options.size ?? 10))
  const thickness = options.thickness ?? 1
  const nodes: SceneNode[] = [
    {
      kind: "arc",
      anchor: options.anchor,
      x: options.x,
      y: options.y,
      width: size,
      height: size,
      thickness,
      start: -90,
      value: 1,
      rounded: true,
      color: options.track ?? "line",
    },
    {
      kind: "arc",
      anchor: options.anchor,
      x: options.x,
      y: options.y,
      width: size,
      height: size,
      thickness,
      start: -90,
      value: layout.fraction,
      rounded: true,
      color: options.tone ?? "primary",
    },
  ]
  if (options.showPercent !== false) {
    const text = layout.percentText
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + Math.max(0, Math.floor((size - text.length) / 2)),
      y: options.y + Math.floor(size / 2),
      text,
      fg: options.percentFg ?? "foreground",
    })
  }
  if (layout.label !== "") {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y: options.y + size,
      text: layout.label,
      fg: options.labelFg ?? "muted",
    })
  }
  return nodes
}

/** One row inside an `accordion()` section. */
export type AccordionItem = AccordionItemInput

/** A titled group of items in an `accordion()`. */
export type AccordionSection = AccordionSectionInput

export type AccordionOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total row width in cells. */
  width: number
  sections: readonly AccordionSection[]
  /** Ids whose items are hidden and whose caret points right. */
  collapsed?: readonly string[]
  /** Highlight an item by section and item id. */
  selected?: { section: string; item: string }
  /** Draw a caret on every header; defaults true. */
  carets?: boolean
  /** Header colour. Defaults to `primary`. */
  titleFg?: string
  /** Item label colour. Defaults to `foreground`. */
  itemFg?: string
  /** Selected item colour. Defaults to `primary`. */
  selectedFg?: string
  /** Header meta colour. Defaults to `muted`. */
  metaFg?: string
  /** Marker column for items: selected and rest strings. */
  marker?: { selected?: string; rest?: string }
}

/**
 * A collapsible section list: headers with carets and indented items.
 *
 *   accordion({ anchor: "top-left", x: 2, y: 2, width: 48, collapsed: ["models"],
 *               sections: [
 *                 { id: "user", title: "USER", items: [
 *                   { id: "name", label: "Username" },
 *                 ] },
 *                 { id: "models", title: "MODELS", items: [
 *                   { id: "provider", label: "Providers" },
 *                 ] },
 *               ] })
 *
 * Collapsed ids hide their items and turn `▾` into `▸`. `selected` adds a
 * marker column to item rows; headers are never selected. A section `meta` is
 * right-aligned when it fits.
 */
export function accordion(options: AccordionOptions): SceneNode[] {
  const rows = accordionRows(options)
  const width = Math.max(1, Math.floor(options.width))
  const fit = (text: string, room: number) =>
    text.length <= room ? text : room <= 1 ? "…" : `${text.slice(0, room - 1)}…`
  const markerSelected = options.marker?.selected ?? "▌ "
  const markerRest = options.marker?.rest ?? "  "
  const nodes: SceneNode[] = []
  let y = options.y

  for (const row of rows) {
    if (row.kind === "header") {
      const prefix = row.caret === "" ? "" : `${row.caret} `
      const title = `${prefix}${row.title}`
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x,
        y,
        text: title,
        fg: options.titleFg ?? "primary",
      })
      if (row.meta !== undefined && title.length + row.meta.length + 2 <= width) {
        nodes.push({
          kind: "text",
          anchor: options.anchor,
          x: options.x + width - row.meta.length,
          y,
          text: row.meta,
          fg: options.metaFg ?? "muted",
        })
      }
      y += 1
      continue
    }
    const selected =
      options.selected !== undefined &&
      options.selected.section === row.sectionId &&
      options.selected.item === row.id
    const marker = selected ? markerSelected : markerRest
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y,
      text: `${marker}${fit(row.label, Math.max(1, width - marker.length))}`,
      fg: selected ? (options.selectedFg ?? "primary") : (options.itemFg ?? "foreground"),
    })
    y += 1
  }
  return nodes
}

/** The boxes a `checklist()` uses. */
export type ChecklistGlyphs = ChecklistGlyphsInput

/** One line in a `checklist()`. */
export type ChecklistItem = ChecklistItemInput

export type ChecklistOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total row width in cells. */
  width: number
  items: readonly ChecklistItem[]
  /** Draw a marker column and mark this row. */
  selected?: number
  glyphs?: Partial<ChecklistGlyphs>
  /** Marker colour. Defaults to `primary`. */
  markerFg?: string
  /** Checked box colour. Defaults to `success`. */
  checkedFg?: string
  /** Unchecked box colour. Defaults to `muted`. */
  uncheckedFg?: string
  /** Disabled box colour. Defaults to `muted`. */
  disabledFg?: string
  /** Label colour. Defaults to `foreground`. */
  fg?: string
  /** Selected label colour. Defaults to `primary`. */
  selectedFg?: string
}

/**
 * A checklist: three-cell boxes with aligned labels and a cursor marker.
 *
 *   checklist({ anchor: "top-left", x: 2, y: 2, width: 40, selected: 0,
 *               items: [
 *                 { id: "a", label: "notes", checked: true },
 *                 { id: "b", label: "filesystem", checked: false },
 *                 { id: "c", label: "legacy", checked: false, disabled: true },
 *               ] })
 *
 * Disabled items render `[-]` and keep their checked state. `selected` adds a
 * marker column; labels fit to the row and truncate with `…`.
 */
export function checklist(options: ChecklistOptions): SceneNode[] {
  const rows = checklistRows(options)
  const nodes: SceneNode[] = []
  for (const row of rows) {
    const y = options.y + row.index
    if (row.marker !== "") {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x,
        y,
        text: row.marker,
        fg: options.markerFg ?? "primary",
      })
    }
    const boxX = options.x + row.marker.length
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: boxX,
      y,
      text: row.box,
      fg: row.disabled
        ? (options.disabledFg ?? "muted")
        : row.checked
          ? (options.checkedFg ?? "success")
          : (options.uncheckedFg ?? "muted"),
    })
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: boxX + row.boxWidth + 1,
      y,
      text: row.label,
      fg: row.selected ? (options.selectedFg ?? "primary") : (options.fg ?? "foreground"),
    })
  }
  return nodes
}

/** One crumb, separator or elision mark in a `breadcrumbs()` trail. */
export type BreadcrumbSegment = BreadcrumbSegmentInput

export type BreadcrumbsOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Available columns. */
  width: number
  items: readonly string[]
  /** Separator between crumbs; defaults to ` › `. */
  separator?: string
  /** Elision mark; defaults to `…`. */
  ellipsis?: string
  /** Middle crumb colour. Defaults to `muted`. */
  fg?: string
  /** First crumb colour. Defaults to `muted`. */
  rootFg?: string
  /** Current crumb colour. Defaults to `foreground`. */
  currentFg?: string
  /** Separator colour. Defaults to `muted`. */
  separatorFg?: string
  /** Elision mark colour. Defaults to `muted`. */
  ellipsisFg?: string
}

/**
 * A folder-style trail with fitting.
 *
 *   breadcrumbs({ anchor: "top-left", x: 2, y: 0, width: 24,
 *                 items: ["LEARN", "Physics unit 4", "Chat"] })
 *
 * When the full trail does not fit, the middle is elided first
 * (`LEARN › … › Chat`), then the root (`… › Chat`), and finally the last crumb
 * is truncated. The current crumb always survives.
 */
export function breadcrumbs(options: BreadcrumbsOptions): SceneNode[] {
  const layout = breadcrumbLayout(options)
  const nodes: SceneNode[] = []
  let x = options.x
  for (const segment of layout.segments) {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x,
      y: options.y,
      text: segment.text,
      fg:
        segment.kind === "separator"
          ? (options.separatorFg ?? "muted")
          : segment.kind === "ellipsis"
            ? (options.ellipsisFg ?? "muted")
            : segment.last
              ? (options.currentFg ?? "foreground")
              : segment.first
                ? (options.rootFg ?? "muted")
                : (options.fg ?? "muted"),
    })
    x += segment.text.length
  }
  return nodes
}

/** One glyph and optional label in a `legend()`. */
export type LegendItem = LegendItemInput

export type LegendOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Available columns for the whole row. */
  width: number
  items: readonly LegendItem[]
  /** Spaces between entries; defaults to 2. */
  gap?: number
  /** Draw labels; defaults true. */
  labels?: boolean
  /** Tone for items without one. Defaults to `muted`. */
  tone?: string
  /** Label colour. Defaults to `muted`. */
  labelFg?: string
}

/**
 * A single-row legend of coloured glyphs and labels.
 *
 *   legend({ anchor: "top-left", x: 2, y: 12, width: 40, items: [
 *     { glyph: "·", label: "less", tone: "muted" },
 *     { glyph: "░", tone: "muted" },
 *     { glyph: "▒", tone: "primary" },
 *     { glyph: "█", label: "more", tone: "primary" },
 *   ] })
 *
 * Entries are placed left to right with `gap`; the first entry that does not
 * fit ends the row rather than clipping a swatch. `labels: false` shows glyphs
 * only.
 */
export function legend(options: LegendOptions): SceneNode[] {
  const segments = legendLayout(options)
  const nodes: SceneNode[] = []
  for (const segment of segments) {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + segment.x,
      y: options.y,
      text: segment.glyph,
      fg: segment.tone,
    })
    if (segment.label !== "") {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x + segment.x + segment.glyph.length + 1,
        y: options.y,
        text: segment.label,
        fg: options.labelFg ?? "muted",
      })
    }
  }
  return nodes
}

/** A target rectangle for `tooltipPosition`. */
export type TooltipTarget = TooltipTargetInput

export type TooltipOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Outer width, including borders and padding. */
  width: number
  text: string
  title?: string
  /** Maximum body lines; defaults to 6. */
  maxLines?: number
  /** When both are given, the box is placed relative to the target and clamped. */
  target?: TooltipTarget
  bounds?: { width: number; height: number }
  gap?: number
  prefer?: "below" | "above"
  borderStyle?: "rounded" | "single" | "double"
  borderColor?: string
  bg?: string
  titleFg?: string
  bodyFg?: string
}

/**
 * A bordered help tooltip.
 *
 *   tooltip({ anchor: "top-left", x: 2, y: 4, width: 36,
 *             title: "hint", text: "Enter links this provider's key." })
 *
 * Text wraps to the box; over-long bodies clip at `maxLines` with an ellipsis.
 * Pass `target` and `bounds` to use the shared placement: the box centres
 * under the target, flips above when there is no room, and stays on screen.
 */
export function tooltip(options: TooltipOptions): SceneNode[] {
  const layout = tooltipLayout(options)
  const placed =
    options.target !== undefined && options.bounds !== undefined
      ? tooltipPosition({
          target: options.target,
          size: { width: layout.width, height: layout.height },
          bounds: options.bounds,
          ...(options.gap === undefined ? {} : { gap: options.gap }),
          ...(options.prefer === undefined ? {} : { prefer: options.prefer }),
        })
      : { left: options.x, top: options.y, side: "below" as const }
  const nodes: SceneNode[] = [
    {
      kind: "box",
      anchor: options.anchor,
      x: placed.left,
      y: placed.top,
      width: layout.width,
      height: layout.height,
      border: true,
      borderStyle: options.borderStyle ?? "rounded",
      borderColor: options.borderColor ?? "line",
      bg: options.bg ?? "surface",
    },
  ]
  layout.lines.forEach((line, index) => {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: placed.left + 2,
      y: placed.top + 1 + index,
      text: line,
      fg:
        index === 0 && options.title !== undefined
          ? (options.titleFg ?? "primary")
          : (options.bodyFg ?? "foreground"),
    })
  })
  return nodes
}

/** The markers a `radio()` uses. */
export type RadioGlyphs = RadioGlyphsInput

/** One option in a `radio()` list. */
export type RadioItem = RadioItemInput

export type RadioOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total row width in cells. */
  width: number
  items: readonly RadioItem[]
  /** Draw a marker column and mark this row. */
  selected?: number
  glyphs?: Partial<RadioGlyphs>
  /** Marker colour. Defaults to `primary`. */
  markerFg?: string
  /** Checked marker colour. Defaults to `success`. */
  onFg?: string
  /** Unchecked marker colour. Defaults to `muted`. */
  offFg?: string
  /** Label colour. Defaults to `foreground`. */
  labelFg?: string
  /** Selected label colour. Defaults to `primary`. */
  selectedFg?: string
}

/**
 * A single-select list: one radio per option and an optional cursor marker.
 *
 *   radio({ anchor: "top-left", x: 2, y: 2, width: 36, selected: 0,
 *           items: [
 *             { id: "lockedin", label: "LockedIn Crimson", checked: true },
 *             { id: "dracula", label: "Dracula" },
 *           ] })
 *
 * `checked` marks the value in force and `selected` marks the cursor; the same
 * row can be both. Markers are three cells (`(•)`/`( )`), and labels fit with
 * `…`. `glyphs` overrides the markers.
 */
export function radio(options: RadioOptions): SceneNode[] {
  const rows = radioRows(options)
  const nodes: SceneNode[] = []
  for (const row of rows) {
    const y = options.y + row.index
    if (row.marker !== "") {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x,
        y,
        text: row.marker,
        fg: options.markerFg ?? "primary",
      })
    }
    const boxX = options.x + row.marker.length
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: boxX,
      y,
      text: row.box,
      fg: row.checked ? (options.onFg ?? "success") : (options.offFg ?? "muted"),
    })
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: boxX + row.boxWidth + 1,
      y,
      text: row.label,
      fg: row.selected ? (options.selectedFg ?? "primary") : (options.labelFg ?? "foreground"),
    })
  }
  return nodes
}

/** One share in a `distribution()`. */
export type DistributionSegment = DistributionSegmentInput

/** One item in a stacked distribution. */
export type DistributionItem = DistributionItemInput

export type DistributionOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Bar width in cells. */
  width: number
  items: readonly DistributionItem[]
  /** Tone cycle for items without one. */
  tones?: readonly string[]
  /** Filled cell glyph; defaults to `█`. */
  glyph?: string
  /** Draw a legend row below the bar; defaults true. */
  legend?: boolean
  /** Spaces between legend entries; defaults to 2. */
  legendGap?: number
  /** Legend label colour. Defaults to `muted`. */
  legendLabelFg?: string
}

/**
 * A stacked distribution bar with a shared legend.
 *
 *   distribution({ anchor: "top-left", x: 2, y: 4, width: 40, items: [
 *     { label: "gpt-4.1", value: 78 },
 *     { label: "claude", value: 22, tone: "accent" },
 *   ] })
 *
 * Cells are allocated by largest remainder, so the bar always fills `width`.
 * Each legend entry is a coloured block and `label percentage`; entries that do
 * not fit are dropped by the shared legend layout. Pass `legend: false` for a
 * bare bar.
 */
export function distribution(options: DistributionOptions): SceneNode[] {
  const segments = distributionSegments(options)
  if (segments.length === 0) return []
  const glyph = options.glyph ?? "█"
  const nodes: SceneNode[] = []
  for (const segment of segments) {
    if (segment.cells <= 0) continue
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + segment.start,
      y: options.y,
      text: glyph.repeat(segment.cells),
      fg: segment.tone,
    })
  }
  if (options.legend === false) return nodes
  const legend = legendLayout({
    items: segments.map((segment) => ({
      glyph,
      label: `${segment.label} ${Math.round(segment.fraction * 100)}%`,
      tone: segment.tone,
    })),
    width: options.width,
    ...(options.legendGap === undefined ? {} : { gap: options.legendGap }),
  })
  for (const entry of legend) {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + entry.x,
      y: options.y + 1,
      text: entry.glyph,
      fg: entry.tone,
    })
    if (entry.label !== "") {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x + entry.x + entry.glyph.length + 1,
        y: options.y + 1,
        text: entry.label,
        fg: options.legendLabelFg ?? "muted",
      })
    }
  }
  return nodes
}

/** One source line in a `diff()`. */
export type DiffLine = DiffLineInput

export type DiffOptions = Omit<DiffLayoutOptions, "lines"> & {
  anchor: ScenePosition
  x: number
  y: number
  lines: readonly DiffLine[]
  /** Addition colour. Defaults to `success`. */
  addFg?: string
  /** Removal colour. Defaults to `error`. */
  removeFg?: string
  /** Context colour. Defaults to `muted`. */
  contextFg?: string
  /** Gutter colour. Defaults to `line`. */
  gutterFg?: string
}

/**
 * A unified diff with line-number gutters.
 *
 *   diff({ anchor: "top-left", x: 2, y: 2, width: 60, oldStart: 12, newStart: 12,
 *          lines: [
 *            { kind: "context", text: "const a = 1" },
 *            { kind: "remove", text: "const b = 2" },
 *            { kind: "add", text: "const b = 3" },
 *          ] })
 *
 * Context advances both numbers, an addition only the new side and a removal
 * only the old side. Long lines wrap under the content column with a blank
 * gutter; `wrap: false` ellipsises instead. `numbers: false` gives a bare
 * `+`/`-` gutter.
 */
export function diff(options: DiffOptions): SceneNode[] {
  const rows = diffRows(options)
  const nodes: SceneNode[] = []
  for (const row of rows) {
    const y = options.y + row.index
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y,
      text: row.gutter,
      fg: options.gutterFg ?? "line",
    })
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + row.gutter.length,
      y,
      text: row.text,
      fg:
        row.kind === "add"
          ? (options.addFg ?? "success")
          : row.kind === "remove"
            ? (options.removeFg ?? "error")
            : (options.contextFg ?? "muted"),
    })
  }
  return nodes
}

/** One placeholder row in a `skeleton()`. */
export type SkeletonLine = SkeletonLineInput

export type SkeletonOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Maximum row width in cells. */
  width: number
  /** Number of rows; defaults to 3. */
  rows?: number
  /** Fill glyph; defaults to `░`. */
  glyph?: string
  /** Fractions of `width` for successive rows. */
  pattern?: readonly number[]
  /** Row colour. Defaults to `muted`. */
  tone?: string
}

/**
 * Ragged placeholder rows for a loading list.
 *
 *   skeleton({ anchor: "top-left", x: 2, y: 2, width: 40, rows: 4 })
 *
 * Widths follow a deterministic pattern, so the rows look like text without
 * animating. Pass `glyph` for another fill or `pattern` for different lengths.
 */
export function skeleton(options: SkeletonOptions): SceneNode[] {
  return skeletonLines(options).map((line) => ({
    kind: "text" as const,
    anchor: options.anchor,
    x: options.x,
    y: options.y + line.index,
    text: line.text,
    fg: options.tone ?? "muted",
  }))
}

/** One cap or separator in a `keycaps()` chord. */
export type KeycapToken = KeycapTokenInput

export type KeycapsOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Available columns for the chord. */
  width: number
  /** Display chord, e.g. `␣ c`, `shift+r`, or `g`. */
  chord: string
  /** Cap fill. Defaults to `line`. */
  capBg?: string
  /** Cap label colour. Defaults to `background`. */
  capFg?: string
  /** Separator colour. Defaults to `muted`. */
  separatorFg?: string
}

/**
 * A chord drawn as filled keycaps.
 *
 *   keycaps({ anchor: "top-left", x: 2, y: 1, width: 14, chord: "shift+r" })
 *
 * Caps and separators concatenate to the original chord, so styling does not
 * change the text. A chord wider than `width` drops trailing tokens.
 */
export function keycaps(options: KeycapsOptions): SceneNode[] {
  const layout = keycapLayout(options)
  const nodes: SceneNode[] = []
  for (const token of layout.tokens) {
    if (token.kind === "cap") {
      nodes.push({
        kind: "rect",
        anchor: options.anchor,
        x: options.x + token.x,
        y: options.y,
        width: token.width,
        height: 1,
        fill: true,
        color: options.capBg ?? "line",
      })
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x + token.x,
        y: options.y,
        text: token.text,
        fg: options.capFg ?? "background",
      })
    } else {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x + token.x,
        y: options.y,
        text: token.text,
        fg: options.separatorFg ?? "muted",
      })
    }
  }
  return nodes
}

/** One card in a `kanban()` column. */
export type KanbanCard = KanbanCardInput

/** One titled column in a `kanban()`. */
export type KanbanColumn = KanbanColumnInput

export type KanbanOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Total width in cells. */
  width: number
  columns: readonly KanbanColumn[]
  /** Spaces between columns; defaults to 1. */
  gap?: number
  /** Card id to mark with the cursor. */
  selected?: string
  /** Visible cards per column. */
  maxCards?: number
  /** Column-title colour. Defaults to `primary`. */
  titleFg?: string
  /** Default card colour. Defaults to `foreground`. */
  cardFg?: string
  /** Selected card colour. Defaults to `primary`. */
  selectedFg?: string
  /** Colour of the `+N more` row. Defaults to `muted`. */
  hiddenFg?: string
}

/**
 * A kanban board: titled columns with counted, single-line cards.
 *
 *   kanban({ anchor: "top-left", x: 2, y: 2, width: 90, selected: "t2",
 *            columns: [
 *              { id: "active", title: "ACTIVE", cards: [
 *                { id: "t1", title: "build the parser" },
 *                { id: "t2", title: "review the diff" },
 *              ] },
 *              { id: "done", title: "DONE", cards: [] },
 *            ] })
 *
 * Columns split the width evenly; a selected card gets `▸ ` and every card is
 * fitted to its column. `maxCards` keeps the first cards and adds `+N more`.
 */
export function kanban(options: KanbanOptions): SceneNode[] {
  const layout = kanbanLayout(options)
  const nodes: SceneNode[] = []
  for (const column of layout.columns) {
    const x = options.x + column.x
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x,
      y: options.y,
      text: column.title,
      fg: options.titleFg ?? "primary",
    })
    column.cards.forEach((card, index) => {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x,
        y: options.y + 1 + index,
        text: card.text,
        fg: card.selected
          ? (options.selectedFg ?? "primary")
          : card.tone === "foreground"
            ? (options.cardFg ?? "foreground")
            : card.tone,
      })
    })
    if (column.hidden > 0) {
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x,
        y: options.y + 1 + column.cards.length,
        text: `+${column.hidden} more`,
        fg: options.hiddenFg ?? "muted",
      })
    }
  }
  return nodes
}

/** One day cell in a `calendar()`. */
export type CalendarCell = CalendarCellInput

export type CalendarOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Grid width in cells. */
  width: number
  /** Any ISO date in the month to show. */
  month: string
  /** ISO dates with activity. */
  marked?: readonly string[]
  /** ISO date to mark as today. */
  today?: string
  /** Week starts Monday; defaults true. */
  mondayFirst?: boolean
  /** Columns per day; defaults to 3. */
  cellWidth?: number
  /** Title colour. Defaults to `primary`. */
  titleFg?: string
  /** Weekday-header colour. Defaults to `muted`. */
  weekdayFg?: string
  /** Activity-day colour. Defaults to `primary`. */
  markedFg?: string
  /** Today colour. Defaults to `warning`. */
  todayFg?: string
  /** Ordinary day colour. Defaults to `muted`. */
  dayFg?: string
  /** Optional background for today's cell. */
  todayBg?: string
}

/**
 * A month grid with weekday headers and activity/today marks.
 *
 *   calendar({ anchor: "top-left", x: 2, y: 2, width: 21, month: "2026-11-01",
 *              marked: ["2026-11-05"], today: "2026-11-10" })
 *
 * Today wins over an activity mark for colour. The grid is Monday-first by
 * default; `mondayFirst: false` starts on Sunday. Invalid months draw nothing.
 */
export function calendar(options: CalendarOptions): SceneNode[] {
  const layout = calendarLayout(options)
  if (layout.weeks.length === 0) return []
  const nodes: SceneNode[] = [
    {
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y: options.y,
      text: layout.title,
      fg: options.titleFg ?? "primary",
    },
  ]
  layout.weekdays.forEach((label, column) => {
    nodes.push({
      kind: "text",
      anchor: options.anchor,
      x: options.x + column * layout.cellWidth,
      y: options.y + 1,
      text: label,
      fg: options.weekdayFg ?? "muted",
    })
  })
  layout.weeks.forEach((week, row) => {
    week.forEach((cell, column) => {
      if (cell.day === null) return
      nodes.push({
        kind: "text",
        anchor: options.anchor,
        x: options.x + column * layout.cellWidth,
        y: options.y + 2 + row,
        text: cell.glyph,
        fg:
          cell.today
            ? (options.todayFg ?? "warning")
            : cell.marked
              ? (options.markedFg ?? "primary")
              : (options.dayFg ?? "muted"),
        ...(cell.today && options.todayBg !== undefined ? { bg: options.todayBg } : {}),
      })
    })
  })
  return nodes
}

/** The state and fitted text of a `toggle()`. */
export type ToggleLayout = ToggleLayoutInput

export type ToggleOptions = {
  anchor: ScenePosition
  x: number
  y: number
  /** Pill width; defaults to the natural text width. */
  width?: number
  on: boolean
  /** On-state label; defaults `on`. */
  onLabel?: string
  /** Off-state label; defaults `off`. */
  offLabel?: string
  /** On pill fill. Defaults to `success`. */
  onBg?: string
  /** Off pill fill. Defaults to `line`. */
  offBg?: string
  /** On text colour. Defaults to `background`. */
  onFg?: string
  /** Off text colour. Defaults to `foreground`. */
  offFg?: string
}

/**
 * A pill switch: `● on` on a success fill, `○ off` on a line fill.
 *
 *   toggle({ anchor: "top-left", x: 2, y: 2, width: 6, on: true,
 *            onLabel: "yes", offLabel: "no" })
 *
 * Labels are fitted to `width`; a custom label truncates rather than spilling.
 * `onBg`/`offBg`/`onFg`/`offFg` override the pill colours.
 */
export function toggle(options: ToggleOptions): SceneNode[] {
  const layout = toggleLayout(options)
  if (layout.text === "") return []
  return [
    {
      kind: "rect",
      anchor: options.anchor,
      x: options.x,
      y: options.y,
      width: layout.width,
      height: 1,
      fill: true,
      color: options.on ? (options.onBg ?? "success") : (options.offBg ?? "line"),
    },
    {
      kind: "text",
      anchor: options.anchor,
      x: options.x,
      y: options.y,
      text: layout.text,
      fg: options.on ? (options.onFg ?? "background") : (options.offFg ?? "foreground"),
    },
  ]
}

export type FormOptions = {
  anchor: ScenePosition
  x: number
  y: number
  width: number
  title?: string
  titleAlign?: "left" | "center" | "right"
  rows: readonly FieldRow[]
  selected?: number
  labelWidth?: number
  actions?: readonly FooterAction[]
  footerRule?: boolean
  padding?: number
  gap?: number
  bg?: string
}

/** A settings form: framed window with aligned fields and a footer. */
export function form(options: FormOptions): SceneGroup {
  const padding = Math.max(0, options.padding ?? 1)
  const gap = Math.max(0, options.gap ?? 1)
  const body = fields({
    rows: options.rows,
    width: Math.max(1, options.width - (padding + 1) * 2),
    ...(options.selected === undefined ? {} : { selected: options.selected }),
    ...(options.labelWidth === undefined ? {} : { labelWidth: options.labelWidth }),
  })
  const footer = options.actions ? [footerActions(options.actions)] : []
  const bodyRows = body.reduce(
    (total, node) => Math.max(total, node.y + sceneHeight(node)),
    0,
  )
  const rule = footer.length > 0 && (options.footerRule ?? true) ? 1 : 0
  const height =
    2 + padding * 2 + Math.max(1, bodyRows) + (footer.length > 0 ? gap + 1 + rule : 0)
  return window({
    anchor: options.anchor,
    x: options.x,
    y: options.y,
    width: options.width,
    height,
    title: options.title,
    titleAlign: options.titleAlign,
    padding,
    gap,
    bg: options.bg ?? "surface",
    body,
    ...(footer.length > 0
      ? { footer, footerRule: options.footerRule ?? true }
      : {}),
  })
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
