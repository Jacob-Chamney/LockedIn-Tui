/** Keymap rows grouped the way the overlays show them. */
import type { GeneratedRow, Group } from "./registry"

export const GROUP_TITLES: Record<Group, string> = {
  context: "CONTEXT",
  global: "GLOBAL",
  system: "SYSTEM",
}

export type KeyGroup = { group: Group; rows: GeneratedRow[] }

const ORDER: Group[] = ["context", "global", "system"]

/** Context first, then global, then system; empty groups are dropped. */
export function groupKeyRows(rows: GeneratedRow[]): KeyGroup[] {
  return ORDER.map((group) => ({ group, rows: rows.filter((row) => row.group === group) })).filter(
    (section) => section.rows.length > 0,
  )
}

/** The leader is already pressed, so only chords that follow it belong here. */
export function leaderKeyRows(rows: GeneratedRow[]): KeyGroup[] {
  return groupKeyRows(rows.filter((row) => row.binding.kind === "leader"))
}
