/**
 * Scaffold a plugin from a template.
 *
 *   bun run plugin:new my.status --template sidebar-main --out plugins-src
 *   bun run plugin:build plugins-src/my.status --out plugins
 *
 * The generated source is a normal plugin directory (`manifest.json` plus a
 * typed `effect.ts`); the build command packages it as `<id>.lockedin`.
 */
import { access, mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export const SCAFFOLD_TEMPLATES = ["sidebar-main", "kpi", "table"] as const
export type ScaffoldTemplate = (typeof SCAFFOLD_TEMPLATES)[number]

export const SCAFFOLD_INFO: Record<ScaffoldTemplate, string> = {
  "sidebar-main": "fixed sidebar + session table with focus ids and row commands",
  kpi: "three-card KPI strip above a detail window with a refresh command",
  table: "table window with a row/column cursor and pointer hits",
}

/** One line per template, for `plugin:new --list` and docs. */
export function scaffoldListing(): string[] {
  return SCAFFOLD_TEMPLATES.map(
    (template) => `${template.padEnd(14)} ${SCAFFOLD_INFO[template]}`,
  )
}

export type ScaffoldOptions = {
  id: string
  template: ScaffoldTemplate
  /** Parent directory; the plugin is written to `<out>/<id>`. */
  out?: string
  /** Display name; defaults to the last id segment, title-cased. */
  name?: string
  /** Overwrite an existing manifest and entry. */
  force?: boolean
}

export type ScaffoldResult =
  | { ok: true; dir: string; id: string; template: ScaffoldTemplate }
  | { ok: false; error: string }

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function pluginDisplayName(id: string): string {
  const last = id.split(/[._-]/).filter(Boolean).pop() ?? id
  return last
    .split(/[._-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function manifestFor(options: ScaffoldOptions) {
  const id = options.id
  const commands =
    options.template === "kpi"
      ? [
          { id: "refresh", title: "Refresh the metrics", keys: "r" },
        ]
      : [
          { id: "next-row", title: "Select the next row", keys: "ctrl+n" },
          { id: "prev-row", title: "Select the previous row", keys: "ctrl+p" },
        ]
  return {
    manifestVersion: 1,
    id,
    name: options.name ?? pluginDisplayName(id),
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      scene: {
        anchors: ["top-left"],
        maxNodes: 60,
        maxText: 512,
        fps: 10,
      },
      state: ["focusedWindow"],
      commands,
    },
  }
}

function sidebarMainSource(options: ScaffoldOptions): string {
  return `/**
 * ${options.name ?? pluginDisplayName(options.id)} — sidebar + main starter.
 *
 * Edit the rows, menu and colours; the window, table, focus ids and commands
 * are wired. Package with: bun run plugin:build <this dir>
 */
import {
  definePlugin,
  footerActions,
  sidebarMain,
  table,
} from "@lockedin/sdk"

const columns = [
  { label: "item", width: 18 },
  { label: "time", width: 7, align: "right" as const },
  { label: "state", width: 9, align: "center" as const },
]

const rows = [
  { cells: ["First item", "25:00", "active"] },
  { cells: ["Second item", "12:00", "queued"] },
  { cells: ["Third item", "5:00", "todo"] },
]

const menu = ["Overview", "Queue", "Archive", "Settings"]

let selected = 0

function clamp(index: number): number {
  return Math.max(0, Math.min(rows.length - 1, Math.round(index)))
}

export default definePlugin({
  id: "${options.id}",
  name: "${options.name ?? pluginDisplayName(options.id)}",
  fps: 10,

  activate(ctx) {
    const saved = ctx.store.get("selected")
    if (typeof saved === "number") selected = clamp(saved)
  },

  commands: {
    "next-row"(ctx) {
      selected = clamp(selected + 1)
      ctx.store.set("selected", selected)
      return "row " + selected
    },
    "prev-row"(ctx) {
      selected = clamp(selected - 1)
      ctx.store.set("selected", selected)
      return "row " + selected
    },
  },

  compose(ctx) {
    const focused = ctx.state?.focusedWindow ?? null
    return {
      nodes: [
        sidebarMain({
          anchor: "top-left",
          x: 2,
          y: 2,
          width: 88,
          height: 28,
          sidebarWidth: 22,
          gap: 2,
          padding: 1,
          border: true,
          title: " ${pluginDisplayName(options.id)} ",
          titleAlign: "center",
          bg: "background",
          borderColor: "line",
          sidebar: {
            id: "menu",
            focusable: true,
            title: " menu ",
            padding: 1,
            gap: 0,
            bg: "surface",
            focused: focused === "menu",
            focusedColor: "accent",
            body: menu.map((text, index) => ({
              kind: "text" as const,
              anchor: "top-left" as const,
              x: 0,
              y: index,
              text,
              fg: index === 0 ? "foreground" : "muted",
            })),
            footer: [footerActions([{ key: "f6", label: "focus" }])],
            footerRule: true,
          },
          main: {
            id: "main",
            focusable: true,
            title: " ${pluginDisplayName(options.id)} ",
            padding: 1,
            gap: 1,
            bg: "surface",
            focused: focused === "main",
            focusedColor: "success",
            body: table({
              columns,
              rows,
              selected,
              height: 6,
              selectedBg: "accent",
              selectedFg: "surface",
              cursorBg: "warning",
              cursorFg: "background",
              fg: "muted",
            }),
            footer: [
              footerActions([
                { key: "ctrl+n/p", label: "select" },
                { key: "f6", label: "focus" },
              ]),
            ],
            footerRule: true,
          },
        }),
      ],
    }
  },
})
`
}

function kpiSource(options: ScaffoldOptions): string {
  return `/**
 * ${options.name ?? pluginDisplayName(options.id)} — KPI starter.
 *
 * Edit the metrics and the detail window. Package with: bun run plugin:build
 */
import { definePlugin, kpiStrip, window } from "@lockedin/sdk"

let refresh = 0

export default definePlugin({
  id: "${options.id}",
  name: "${options.name ?? pluginDisplayName(options.id)}",
  fps: 10,

  commands: {
    "refresh"(ctx) {
      refresh += 1
      ctx.store.set("refresh", refresh)
      return "refreshed " + refresh
    },
  },

  compose(ctx) {
    return {
      nodes: [
        kpiStrip({
          anchor: "top-left",
          x: 2,
          y: 2,
          width: 88,
          height: 6,
          gap: 1,
          metrics: [
            { label: "metric", value: String(12 + refresh), detail: "today", color: "accent" },
            { label: "streak", value: "5 days", detail: "best", color: "warning" },
            { label: "queue", value: "3", detail: "due", color: "muted" },
          ],
        }),
        window({
          id: "detail",
          focusable: true,
          anchor: "top-left",
          x: 2,
          y: 9,
          width: 88,
          height: 12,
          title: " detail ",
          padding: 1,
          gap: 1,
          bg: "surface",
          focused: ctx.state?.focusedWindow === "detail",
          focusedColor: "accent",
          body: [
            { kind: "text", anchor: "top-left", x: 0, y: 0, text: "Replace this with your content", fg: "foreground" },
            { kind: "text", anchor: "top-left", x: 0, y: 1, text: "refreshes: " + refresh, fg: "muted" },
          ],
          footer: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "r refresh", fg: "muted" }],
          footerRule: true,
        }),
      ],
    }
  },
})
`
}

function tableSource(options: ScaffoldOptions): string {
  return `/**
 * ${options.name ?? pluginDisplayName(options.id)} — table starter.
 *
 * Edit the columns and rows. Package with: bun run plugin:build
 */
import { definePlugin, footerActions, table, window } from "@lockedin/sdk"

const columns = [
  { label: "item", width: 20 },
  { label: "time", width: 7, align: "right" as const },
  { label: "state", width: 9, align: "center" as const },
]

const rows = [
  { cells: ["First item", "25:00", "active"] },
  { cells: ["Second item", "12:00", "queued"] },
  { cells: ["Third item", "5:00", "todo"] },
]

let selected = 0
let column = 0

function clampRow(index: number): number {
  return Math.max(0, Math.min(rows.length - 1, Math.round(index)))
}

function clampColumn(index: number): number {
  return Math.max(0, Math.min(columns.length - 1, Math.round(index)))
}

export default definePlugin({
  id: "${options.id}",
  name: "${options.name ?? pluginDisplayName(options.id)}",
  fps: 10,

  activate(ctx) {
    const saved = ctx.store.get("selected")
    if (typeof saved === "number") selected = clampRow(saved)
    const savedColumn = ctx.store.get("column")
    if (typeof savedColumn === "number") column = clampColumn(savedColumn)
  },

  commands: {
    "next-row"(ctx) {
      selected = clampRow(selected + 1)
      ctx.store.set("selected", selected)
      return "row " + selected
    },
    "prev-row"(ctx) {
      selected = clampRow(selected - 1)
      ctx.store.set("selected", selected)
      return "row " + selected
    },
  },

  compose(ctx) {
    return {
      nodes: [
        window({
          id: "table",
          focusable: true,
          anchor: "top-left",
          x: 2,
          y: 2,
          width: 72,
          height: 20,
          title: " ${pluginDisplayName(options.id)} ",
          titleAlign: "center",
          padding: 1,
          gap: 1,
          bg: "surface",
          focused: ctx.state?.focusedWindow === "table",
          focusedColor: "accent",
          body: table({
            columns,
            rows,
            selected,
            column,
            height: 6,
            selectedBg: "accent",
            selectedFg: "surface",
            cursorBg: "warning",
            cursorFg: "background",
            hit: true,
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
      ],
    }
  },
})
`
}

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!ID.test(options.id)) {
    return {
      ok: false,
      error: "id must be 1-64 characters: lowercase letters, digits, dot, dash or underscore",
    }
  }
  if (!SCAFFOLD_TEMPLATES.includes(options.template)) {
    return { ok: false, error: `template must be one of ${SCAFFOLD_TEMPLATES.join(", ")}` }
  }
  const dir = resolve(options.out ?? "plugins-src", options.id)
  const manifestPath = join(dir, "manifest.json")
  if (!options.force) {
    try {
      await access(manifestPath)
      return { ok: false, error: `${manifestPath} already exists (use --force to overwrite)` }
    } catch {
      // Missing is the expected path.
    }
  }
  const manifest = manifestFor(options)
  const entry =
    options.template === "kpi"
      ? kpiSource(options)
      : options.template === "table"
        ? tableSource(options)
        : sidebarMainSource(options)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  await writeFile(join(dir, "effect.ts"), entry, "utf8")
  return { ok: true, dir, id: options.id, template: options.template }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.includes("--list")) {
    for (const line of scaffoldListing()) console.log(line)
    process.exit(0)
  }
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`)
    return index >= 0 ? args[index + 1] : undefined
  }
  const id = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--template" && args[index - 1] !== "--out" && args[index - 1] !== "--name")
  const template = option("template") ?? "sidebar-main"
  if (!id) {
    console.error("usage: bun run plugin:new <id> [--template sidebar-main|kpi|table] [--out dir] [--name name] [--force]")
    process.exit(1)
  }
  const result = await scaffoldPlugin({
    id,
    template: template as ScaffoldTemplate,
    ...(option("out") ? { out: option("out")! } : {}),
    ...(option("name") ? { name: option("name")! } : {}),
    force: args.includes("--force"),
  })
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }
  console.log(`created ${result.template} plugin ${result.id} -> ${result.dir}`)
  console.log(`next: bun run plugin:build ${result.dir} --out plugins`)
}
