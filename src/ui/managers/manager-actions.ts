/** The manager key set: every session manager uses the same verbs. */
export type ManagerIntent = "new" | "open" | "archive" | "delete" | "export" | "close"

export const MANAGER_KEYS: ReadonlyArray<{ intent: ManagerIntent; key: string; footer: string }> = [
  { intent: "new", key: "n", footer: "n new" },
  { intent: "open", key: "return", footer: "Enter open" },
  { intent: "archive", key: "a", footer: "a archive" },
  { intent: "delete", key: "d", footer: "d delete" },
  { intent: "export", key: "x", footer: "x export" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

export function managerIntent(name: string): ManagerIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return MANAGER_KEYS.find((entry) => entry.key === key)?.intent
}

/** Footer hints in the standard order; export is optional per manager. */
export function managerHints(options: { export?: boolean } = {}): string[] {
  return MANAGER_KEYS.filter((entry) => options.export === false ? entry.intent !== "export" : true).map(
    (entry) => entry.footer,
  )
}
