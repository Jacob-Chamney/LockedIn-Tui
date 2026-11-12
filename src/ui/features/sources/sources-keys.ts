/**
 * Picker keyboard contract.
 *
 * One table, expressed as *intents*. Every spec is parsed by the keymap
 * registry's own parser so the format stays in `ui/keymap`; the verbs that do
 * not exist as registry actions yet are listed here and nowhere else.
 *
 * TODO(WP-126): promote these verbs to registry actions when `src/ui/keymap/**`
 * is in scope, then this table disappears.
 */
import { parseBinding, type Binding } from "../../keymap/registry"
import type { PickerView } from "./sources-model"

export type PickerIntent =
  | "move-down"
  | "move-up"
  | "top"
  | "bottom"
  | "finder"
  | "enter-directory"
  | "leave-directory"
  | "toggle-mark"
  | "mark-folder"
  | "review"
  | "focus-sources"
  | "remove-source"
  | "cancel"

type Spec = { intent: PickerIntent; keys: string[]; footer: string }

/** The single source of picker keys. No component may contain a key string. */
export const PICKER_KEY_SPECS: Spec[] = [
  { intent: "move-down", keys: ["j"], footer: "j/k move" },
  { intent: "move-up", keys: ["k"], footer: "" },
  { intent: "top", keys: ["g"], footer: "" },
  { intent: "bottom", keys: ["shift+g"], footer: "" },
  { intent: "finder", keys: ["/"], footer: "/ search" },
  { intent: "enter-directory", keys: ["enter", "l"], footer: "Enter open" },
  { intent: "leave-directory", keys: ["backspace", "h"], footer: "h up" },
  { intent: "toggle-mark", keys: ["space"], footer: "Space mark" },
  { intent: "mark-folder", keys: ["shift+a"], footer: "A folder" },
  { intent: "review", keys: ["r"], footer: "r review" },
  { intent: "focus-sources", keys: ["tab"], footer: "Tab sources" },
  { intent: "remove-source", keys: ["d"], footer: "d remove" },
  { intent: "cancel", keys: ["escape"], footer: "" },
]

export type KeySpec = { intent: PickerIntent; binding: Binding; footer: string }

/**
 * Every picker binding is produced by the registry's own parser, so the format
 * lives in `ui/keymap` and this file holds no binding shape of its own.
 */
function toBinding(spec: string): Binding {
  // The global keymap reserves "space" as its leader prefix, but inside the
  // picker it is the direct mark key.
  const parsed = parseBinding(spec, { allowLeaderPrefixKey: true })
  if ("reason" in parsed) throw new Error(`picker key "${spec}": ${parsed.message}`)
  return parsed
}

export const PICKER_KEYS: KeySpec[] = PICKER_KEY_SPECS.map((spec) => ({
  intent: spec.intent,
  binding: toBinding(spec.keys[0]!),
  footer: spec.footer,
}))

export const ALTERNATE_KEYS: Array<{ intent: PickerIntent; binding: Binding }> = PICKER_KEY_SPECS.flatMap(
  (spec) => spec.keys.slice(1).map((key) => ({ intent: spec.intent, binding: toBinding(key) })),
)

/** Resolve one keypress name (as the renderer reports it) to an intent. */
export function intentFor(name: string, options: { shift?: boolean } = {}): PickerIntent | undefined {
  const lower = name.toLowerCase()
  const normalised = lower === "enter" ? "return" : lower
  // Shifted letters arrive either as a shifted name (``a`` + shift) or as the
  // uppercase character itself, depending on the renderer.
  const shifted = options.shift === true || (name.length === 1 && name !== lower)
  const wanted = shifted && name.length === 1 ? `shift+${lower}` : normalised
  const all = [...PICKER_KEYS, ...ALTERNATE_KEYS]
  for (const entry of all) {
    if (entry.binding.kind !== "direct") continue
    if (entry.binding.key === wanted) return entry.intent
  }
  return undefined
}

/** Footer text is generated, never typed into the component. */
export function footerHints(view?: PickerView): string[] {
  if (!view) {
    return PICKER_KEYS.filter((entry) => entry.footer.length > 0).map((entry) => entry.footer)
  }
  if (view.editing) return ["↑↓ choose", "Enter apply", "Esc clear", "Ctrl+U clear"]
  if (view.step === "review") return ["j/k move", "d remove", "Enter continue", "Esc back"]
  if (view.focus === "sources") return ["j/k move", "d remove", "Enter reveal", "Tab back"]
  return ["j/k move", "Space mark", "Enter open", "A folder", "r review", "Tab sources", "/ search"]
}
