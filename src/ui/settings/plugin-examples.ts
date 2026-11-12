/**
 * The shipped effect-plugin examples, as shown in the in-app gallery.
 *
 * Entries mirror `src/ui/effects/examples/<dir>/manifest.json`; tests load the
 * manifests and fail if the id or name drifts.
 */
export type ExampleEntry = {
  dir: string
  id: string
  name: string
  description: string
  /** Package the example into `plugins/`, then enable it in the manager. */
  command: string
}

const example = (
  dir: string,
  id: string,
  name: string,
  description: string,
): ExampleEntry => ({
  dir,
  id,
  name,
  description,
  command: `bun run plugin:build src/ui/effects/examples/${dir} --out plugins`,
})

export const PLUGIN_EXAMPLES: readonly ExampleEntry[] = [
  example(
    "scene-window",
    "example.scene-window",
    "Focus window",
    "Animated focus card with a progress bar, ring, scrollable sessions and focus colours.",
  ),
  example(
    "scene-shapes",
    "example.scene-shapes",
    "Shapes",
    "Rotating primitives and progress arcs rendered with sub-cell precision.",
  ),
  example(
    "scene-list",
    "example.scene-list",
    "Selectable list",
    "A list window with keyboard selection and a detail panel that fades in and out.",
  ),
  example(
    "scene-table",
    "example.scene-table",
    "Session table",
    "Multi-column table with a cell cursor, pointer hits and drag-selection ranges.",
  ),
  example(
    "scene-dashboard",
    "example.scene-dashboard",
    "Session dashboard",
    "Two-panel dashboard with focus cycling, clipboard copy, pointer and wheel actions.",
  ),
  example(
    "scene-workbench",
    "example.scene-workbench",
    "Session workbench",
    "KPI strip above a sidebar/main split, built from the layout presets.",
  ),
  example(
    "scene-drag",
    "example.scene-drag",
    "Drag card",
    "A draggable window using press/move/release, clamped to the viewport and persisted.",
  ),
  example(
    "scene-reorder",
    "example.scene-reorder",
    "Reorder panels",
    "Drag one dashboard panel onto another to swap their grid slots; the order persists.",
  ),
  example(
    "scene-status",
    "example.scene-status",
    "Status card",
    "A compact status window with progress and palette-aware colour.",
  ),
]

export function moveExampleCursor(cursor: number, delta: number): number {
  return Math.max(0, Math.min(PLUGIN_EXAMPLES.length - 1, cursor + delta))
}

export function selectedExample(cursor: number): ExampleEntry {
  return PLUGIN_EXAMPLES[Math.max(0, Math.min(PLUGIN_EXAMPLES.length - 1, cursor))]!
}

export function exampleRowLabel(entry: ExampleEntry): string {
  return `${entry.name}  ${entry.id}`
}
