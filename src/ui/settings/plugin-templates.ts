/**
 * Starter templates offered by `plugin:new` and the in-app gallery.
 *
 * Data only: the scaffold script and the settings surface both read this list.
 */
export const PLUGIN_TEMPLATES = [
  {
    id: "sidebar-main",
    label: "Sidebar + main",
    description:
      "A fixed sidebar window beside a session table, with focus ids and row commands.",
    command: "bun run plugin:new my.plugin --template sidebar-main",
  },
  {
    id: "kpi",
    label: "KPI strip",
    description:
      "A row of metric cards above a detail window, with a refresh command.",
    command: "bun run plugin:new my.plugin --template kpi",
  },
  {
    id: "table",
    label: "Table",
    description:
      "A table window with a row/column cursor, pointer hits and row commands.",
    command: "bun run plugin:new my.plugin --template table",
  },
] as const

export type TemplateId = (typeof PLUGIN_TEMPLATES)[number]["id"]

export function templateRowLabel(template: (typeof PLUGIN_TEMPLATES)[number]): string {
  return `${template.label}  ${template.id}`
}

export function clampTemplateCursor(cursor: number): number {
  return Math.max(0, Math.min(PLUGIN_TEMPLATES.length - 1, cursor))
}

export function moveTemplateCursor(cursor: number, delta: number): number {
  return clampTemplateCursor(cursor + delta)
}

export function selectedTemplate(cursor: number) {
  return PLUGIN_TEMPLATES[clampTemplateCursor(cursor)]
}
