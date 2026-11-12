/**
 * Task-centre keys: one table, parsed by the keymap registry's own parser.
 *
 * `task.open` / `task.cancel` are not registry actions yet (a keymap packet owns
 * that); when they land this table shrinks to a lookup of their bindings.
 */
import { parseBinding, bindingLabel, type Binding } from "../../keymap/registry"

export type TaskIntent = "down" | "up" | "open" | "cancel" | "close"

const SPECS: Array<{ intent: TaskIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "open", key: "return", footer: "Enter open" },
  { intent: "cancel", key: "c", footer: "c cancel" },
  { intent: "close", key: "escape", footer: "Esc close" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`task key "${key}": ${binding.message}`)
  return binding
}

export const TASK_KEYS: Array<{ intent: TaskIntent; binding: Binding; footer: string }> = SPECS.map(
  (spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }),
)

export function intentFor(name: string): TaskIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return TASK_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

/** The footer is generated, never typed into the component. */
export function footerHints(): string {
  return TASK_KEYS.filter((entry) => entry.footer)
    .map((entry) => entry.footer)
    .join(" · ")
}

/** Shown next to the row so the key for cancelling is visible, not guessed. */
export function cancelKeyLabel(): string {
  const entry = TASK_KEYS.find((item) => item.intent === "cancel")
  return entry ? bindingLabel(entry.binding) : ""
}
