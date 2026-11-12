/**
 * The palette catalogue. Data, not a component tree: one entry per theme with a
 * label and twelve tokens. The shell reads a palette through the theme hook.
 */
import { opencodePalettes } from "./opencode"
import type { ThemePalette } from "./tokens"

export type ThemeId = string

/** LockedIn Crimson — the default identity (docs/design.md §3.1). */
export const crimson: ThemePalette = {
  background: "#0D0F11",
  surface: "#15181B",
  panel: "#1D2125",
  foreground: "#E7E7E7",
  muted: "#9199A3",
  primary: "#D9534F",
  secondary: "#9AA3AD",
  accent: "#FF6B6B",
  success: "#7FA37A",
  warning: "#D8B26A",
  error: "#FF5C5C",
  line: "#30363C",
}

/** Maximum legibility; colours pushed apart for low-vision use. */
export const highContrast: ThemePalette = {
  background: "#000000",
  surface: "#000000",
  panel: "#111111",
  foreground: "#FFFFFF",
  muted: "#D0D0D0",
  primary: "#FF8080",
  secondary: "#A6C8FF",
  accent: "#FFD166",
  success: "#5CFF8F",
  warning: "#FFD400",
  error: "#FF6B6B",
  line: "#8C8C8C",
}

/** Claude Code CLI, approximated from its published palette. */
export const claudeCode: ThemePalette = {
  background: "#1F1E1D",
  surface: "#262523",
  panel: "#2C2B29",
  foreground: "#E8E6E3",
  muted: "#A39E97",
  primary: "#D97757",
  secondary: "#B1A79B",
  accent: "#E8A87C",
  success: "#7AC47F",
  warning: "#E5B567",
  error: "#E06C75",
  line: "#3A3835",
}

/** Codex CLI, approximated from its published palette. */
export const codex: ThemePalette = {
  background: "#0D0D0D",
  surface: "#141414",
  panel: "#1A1A1A",
  foreground: "#EDEDED",
  muted: "#9A9A9A",
  primary: "#10A37F",
  secondary: "#8FB8AD",
  accent: "#4FD1B0",
  success: "#3FBF7F",
  warning: "#E3B341",
  error: "#F85149",
  line: "#30363D",
}

/** Starting point for the custom palette editor; identical to crimson. */
export const customDefault: ThemePalette = { ...crimson }

export type PaletteEntry = { label: string; palette: ThemePalette; builtIn: boolean }

const builtIn: Record<ThemeId, PaletteEntry> = {
  lockedin: { label: "LockedIn Crimson", palette: crimson, builtIn: true },
  "high-contrast": { label: "High Contrast", palette: highContrast, builtIn: true },
  "claude-code": { label: "Claude Code", palette: claudeCode, builtIn: true },
  codex: { label: "Codex", palette: codex, builtIn: true },
  custom: { label: "Custom", palette: customDefault, builtIn: false },
}

/** Built-ins plus the OpenCode set. Ids are stable; labels are data. */
export const palettes: Record<ThemeId, PaletteEntry> = {
  ...builtIn,
  ...Object.fromEntries(
    Object.entries(opencodePalettes).map(([id, entry]) => [
      id,
      { label: entry.label, palette: entry.palette, builtIn: true },
    ]),
  ),
}

export const DEFAULT_THEME: ThemeId = "lockedin"

export type ResolvedTheme = { id: ThemeId; label: string; palette: ThemePalette }

/** Resolve an id to a palette, falling back to crimson (never a blank screen). */
export function resolveTheme(
  id: ThemeId | undefined,
  custom?: Partial<ThemePalette> | null,
): ResolvedTheme {
  if (id === "custom" && custom) {
    return { id: "custom", label: "Custom", palette: { ...customDefault, ...custom } }
  }
  const entry = id ? palettes[id] : undefined
  if (entry) return { id: id!, label: entry.label, palette: entry.palette }
  return { id: DEFAULT_THEME, label: palettes[DEFAULT_THEME]!.label, palette: crimson }
}

export function paletteChoices(): Array<{ id: ThemeId; label: string }> {
  return Object.entries(palettes)
    .map(([id, entry]) => ({ id, label: entry.label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
