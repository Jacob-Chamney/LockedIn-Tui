/**
 * Session settings view model (pure).
 *
 * The pane edits `prompt.md`; the original instruction file is provenance, not
 * the editable value. Rendering decisions live here so the keyboard route and
 * the component agree on which rows exist and which one is selected.
 */
import type { InstructionsSource } from "../../../domain/session"

export type SessionSettingsMode = "view" | "edit"

export type SessionSettingsData = {
  prompt: string
  instructions: InstructionsSource | null
  originalPresent: boolean
}

export type SessionSettingsState = {
  mode: SessionSettingsMode
  cursor: number
  data: SessionSettingsData | null
  /** The textarea value; only meaningful in edit mode. */
  draft: string
  notice: string | null
  error: string | null
  busy: boolean
  /** True after Esc with unsaved changes; a second Esc discards. */
  discardArmed: boolean
}

export const initialSessionSettings: SessionSettingsState = {
  mode: "view",
  cursor: 0,
  data: null,
  draft: "",
  notice: null,
  error: null,
  busy: false,
  discardArmed: false,
}

export type SettingsActionId = "edit" | "file" | "extract"

export type SettingsRow = {
  id: SettingsActionId
  label: string
  detail: string
  enabled: boolean
}

export function settingsRows(state: SessionSettingsState): SettingsRow[] {
  const data = state.data
  const instructions = data?.instructions ?? null
  return [
    {
      id: "edit",
      label: "Edit instructions",
      detail: data && data.prompt.trim() !== "" ? "change the text the model reads" : "write the assignment instructions",
      enabled: data !== null && !state.busy,
    },
    {
      id: "file",
      label: "Load instructions from file",
      detail: "PDF, DOCX or text · the original is copied into this session",
      enabled: data !== null && !state.busy,
    },
    {
      id: "extract",
      label: "Re-extract from original",
      detail: instructions
        ? `${instructions.name}${data?.originalPresent === false ? " · copy missing" : ""}`
        : "no original file loaded",
      enabled: data !== null && instructions !== null && data.originalPresent && !state.busy,
    },
  ]
}

export function move(state: SessionSettingsState, delta: number): SessionSettingsState {
  const rows = settingsRows(state)
  const enabled = rows.map((row, index) => (row.enabled ? index : -1)).filter((index) => index >= 0)
  if (enabled.length === 0) return state
  const at = enabled.indexOf(state.cursor)
  const next = Math.max(0, Math.min(enabled.length - 1, (at === -1 ? 0 : at) + delta))
  return { ...state, cursor: enabled[next]!, discardArmed: false }
}

export function selectedRow(state: SessionSettingsState): SettingsRow | undefined {
  return settingsRows(state)[state.cursor]
}

export function dirty(state: SessionSettingsState): boolean {
  return state.mode === "edit" && state.draft !== (state.data?.prompt ?? "")
}

/** The description under the header: the original file, or that there is none. */
export function provenanceLine(instructions: InstructionsSource | null): string {
  if (instructions === null) return "no original file · instructions are text only"
  const parts = [instructions.name, instructions.kind, `sha256:${instructions.hash.replace(/^sha256:/, "").slice(0, 8)}`]
  if (instructions.pages !== undefined) parts.push(`${instructions.pages} page${instructions.pages === 1 ? "" : "s"}`)
  if (instructions.characters !== undefined) parts.push(`${instructions.characters} chars`)
  return parts.join(" · ")
}

export type PromptPreview = {
  lines: string[]
  more: number
  empty: boolean
}

export function promptPreview(prompt: string, limit = 10): PromptPreview {
  const text = prompt.trimEnd()
  if (text.trim() === "") return { lines: [], more: 0, empty: true }
  const lines = text.split("\n")
  return {
    lines: lines.slice(0, limit),
    more: Math.max(0, lines.length - limit),
    empty: false,
  }
}

/** How many lines the pane can show before the actions begin. */
export function previewLimit(height: number): number {
  return Math.max(3, Math.min(14, height - 14))
}
