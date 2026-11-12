/**
 * Storage and data settings.
 *
 * Shows where data lives and offers maintenance actions as intents. Nothing
 * here deletes, rebuilds or exports by itself; every destructive row names its
 * object before it can run.
 */
import { parseBinding, type Binding } from "../keymap/registry";
import type { ThemePalette } from "../theme";
export type StorageCaps = {
  maxItemsPerSide: number
  maxMbPerSide: number
  excerptChars: number
}

export type Paths = {
  workspace: string
  dataDir: string
  archiveFolder: string
  exports: string
}

export type IndexState = { lastRebuiltAt: string | null; sizeBytes: number | null }

export type StorageState = {
  caps: StorageCaps
  paths: Paths
  index: { school: IndexState; skills: IndexState }
  /** Local Chill history that a clear would remove. */
  chillMessages: number
  pending?: { kind: "clear-history" | "rebuild"; side?: "school" | "skills" } | null
  rebuildProgress?: { side: "school" | "skills"; cancelable: boolean } | null
  notice?: string | null
}

export function initialStorage(caps: StorageCaps, paths: Paths, index: StorageState["index"], chillMessages = 0): StorageState {
  return { caps, paths, index, chillMessages, pending: null, rebuildProgress: null, notice: null }
}

export const CAP_RANGES = {
  maxItemsPerSide: { min: 1, max: 500 },
  maxMbPerSide: { min: 10, max: 100_000 },
  excerptChars: { min: 50, max: 4000 },
} as const

export type CapResult =
  | { kind: "patch"; patch: Record<string, unknown>; line: string }
  | { kind: "refused"; reason: string }

/**
 * Caps gate the *next* add; changing one never deletes what is already stored.
 */
export function setCap(_state: StorageState, key: keyof StorageCaps, value: number): CapResult {
  const range = CAP_RANGES[key]
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    return { kind: "refused", reason: `${key} is ${range.min}–${range.max}; got ${value}` }
  }
  return {
    kind: "patch",
    patch: { [`storage.${snake(key)}`]: value },
    line: "existing items are kept; the next add beyond the cap is refused",
  }
}

function snake(key: keyof StorageCaps): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function capsLine(caps: StorageCaps): string {
  return `${caps.maxItemsPerSide} items per side · ${caps.maxMbPerSide} MB per side · ${caps.excerptChars} char excerpts`
}

/** Paths are read-only here; the data directory is a launch decision. */
export function pathRows(paths: Paths): Array<{ label: string; value: string; editable: boolean }> {
  return [
    { label: "workspace", value: paths.workspace, editable: false },
    { label: "app data", value: paths.dataDir, editable: false },
    { label: "archive folder", value: paths.archiveFolder, editable: true },
    { label: "exports", value: paths.exports, editable: false },
  ]
}

export function dataDirNote(): string {
  return "the data directory is chosen at launch · start with --data-dir to move it"
}

export function validArchiveFolder(path: string, exists: boolean, writable: boolean): { ok: true } | { ok: false; reason: string } {
  if (path.trim() === "") return { ok: false, reason: "an archive folder is required" }
  if (!exists) return { ok: false, reason: `${path} does not exist` }
  if (!writable) return { ok: false, reason: `${path} is not writable` }
  return { ok: true }
}

export function indexLine(label: string, index: IndexState): string {
  if (!index.lastRebuiltAt) return `${label} · never rebuilt`
  const size = index.sizeBytes === null ? "size unknown" : `${Math.round(index.sizeBytes / 1024)} KB`
  return `${label} · last rebuilt ${index.lastRebuiltAt} · ${size}`
}

export function armRebuild(state: StorageState, side: "school" | "skills"): StorageState {
  return { ...state, pending: { kind: "rebuild", side }, notice: null }
}

export function startRebuild(state: StorageState, side: "school" | "skills"): StorageState {
  return { ...state, pending: null, rebuildProgress: { side, cancelable: true }, notice: null }
}

/** A cancelled rebuild leaves the previous index usable. */
export function cancelRebuild(state: StorageState): StorageState {
  return { ...state, rebuildProgress: null, notice: "rebuild cancelled · the previous index is still usable" }
}

export function rebuildNeverTouchesNotes(): string {
  return "a rebuild only rewrites the index; Markdown files are never modified"
}

export function armClearHistory(state: StorageState): StorageState {
  return { ...state, pending: { kind: "clear-history" }, notice: clearCopy(state.chillMessages) }
}

/** The confirmation names the object and how much is lost. */
export function clearCopy(messages: number): string {
  return `clear ${messages} message${messages === 1 ? "" : "s"} of chill history? press c again to confirm`
}

export type ClearOutcome = { kind: "call"; action: "clear-history" } | { kind: "refused"; reason: string }

export function confirmClear(state: StorageState): ClearOutcome {
  if (state.pending?.kind !== "clear-history") {
    return { kind: "refused", reason: clearCopy(state.chillMessages) }
  }
  return { kind: "call", action: "clear-history" }
}

export function exportPath(exports: string, format: "md" | "csv"): string {
  return `${exports}/stats.${format}`
}

export function exportCopy(exports: string, format: "md" | "csv"): string {
  return `export stats as ${format.toUpperCase()} to ${exportPath(exports, format)}`
}

export function exclusionNote(): string {
  return "stats are never archived; exports carry no secrets"
}

export type StorageIntent = "down" | "edit" | "rebuild" | "clear" | "export" | "cancel" | "close"

const SPECS: Array<{ intent: StorageIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "edit", key: "return", footer: "Enter edit" },
  { intent: "rebuild", key: "r", footer: "r rebuild" },
  { intent: "clear", key: "c", footer: "c clear history" },
  { intent: "export", key: "x", footer: "x export" },
  { intent: "cancel", key: "escape", footer: "Esc back" },
  { intent: "close", key: "q", footer: "" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`storage key "${key}": ${binding.message}`)
  return binding
}

export const STORAGE_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): StorageIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return STORAGE_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return STORAGE_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function StoragePanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: StorageState
}) {
  const palette = () => props.theme
  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} STORAGE`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {capsLine(props.state.caps)}
      </text>
      {pathRows(props.state.paths).map((row) => (
        <text fg={row.editable ? palette().foreground : palette().muted} wrapMode="none">
          {`${row.label.padEnd(15)}${row.value}`}
        </text>
      ))}
      <text fg={palette().muted} wrapMode="none">
        {`  ${dataDirNote()}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {indexLine("learn index", props.state.index.school)}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {indexLine("skills index", props.state.index.skills)}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {`  ${rebuildNeverTouchesNotes()}`}
      </text>

      {props.state.rebuildProgress ? (
        <text fg={palette().warning} wrapMode="none">
          {`… rebuilding ${props.state.rebuildProgress.side} index${props.state.rebuildProgress.cancelable ? " · Esc cancel" : ""}`}
        </text>
      ) : null}
      <text fg={palette().foreground} wrapMode="none">
        {`chill history  ${props.state.chillMessages} messages`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {`export  ${exportCopy(props.state.paths.exports, "md")}`}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {`  ${exclusionNote()}`}
      </text>

      {props.state.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.state.notice}`}
        </text>
      ) : null}
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
