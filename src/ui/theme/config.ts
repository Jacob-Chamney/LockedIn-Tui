/**
 * Theme persistence: `ui.theme` plus `ui.custom_theme` in `config.toml`.
 *
 * The config is a projection of the theme state, so a round-trip is lossless:
 * read → edit → write → read returns the same palette.
 */
import { TOKEN_NAMES, isValidHex, validatePalette, type PaletteIssue, type ThemePalette } from "./tokens"
import { DEFAULT_THEME, customDefault, palettes, resolveTheme, type ThemeId } from "./palettes"

export type ThemeConfig = {
  ui?: {
    theme?: string
    custom_theme?: Record<string, string>
  }
}

export type ThemeState = { id: ThemeId; custom: ThemePalette }

export type ReadResult =
  | { ok: true; state: ThemeState; issues: PaletteIssue[] }
  | { ok: false; state: ThemeState; issues: PaletteIssue[]; message: string }

/** Unknown ids fall back to crimson and say so; a broken custom palette is reported once. */
export function readThemeConfig(config: ThemeConfig): ReadResult {
  const requested = config.ui?.theme ?? DEFAULT_THEME
  const known = requested in palettes
  const fallback = known ? requested : DEFAULT_THEME

  const raw = config.ui?.custom_theme
  // No stored custom palette is not an error: it means "not customised yet".
  const customResult = raw && Object.keys(raw).length > 0 ? validatePalette(raw) : { ok: true as const, palette: { ...customDefault } }
  if (customResult.ok) {
    return {
      ok: true,
      state: { id: fallback, custom: customResult.palette },
      issues: known ? [] : [{ token: "background", message: `Unknown theme "${requested}"; using ${DEFAULT_THEME}.` }],
    }
  }

  // A broken custom palette falls back to the default identity, not to "Custom".
  const fallbackTheme = resolveTheme(DEFAULT_THEME)
  return {
    ok: false,
    state: { id: fallbackTheme.id, custom: fallbackTheme.palette },
    issues: customResult.issues,
    message: `${customResult.issues[0]!.message} Keeping ${fallbackTheme.label}.`,
  }
}

export function writeThemeConfig(state: ThemeState): ThemeConfig {
  const custom: Record<string, string> = {}
  for (const token of TOKEN_NAMES) custom[token] = state.custom[token].toUpperCase()
  return { ui: { theme: state.id, custom_theme: custom } }
}

export type CustomEdit =
  | { ok: true; state: ThemeState }
  | { ok: false; message: string; token: keyof ThemePalette }

/** The editor model: one token change at a time, rejected with one message. */
export function setCustomToken(state: ThemeState, token: keyof ThemePalette, value: string): CustomEdit {
  if (!TOKEN_NAMES.includes(token)) {
    return { ok: false, message: `Unknown theme token "${token}".`, token }
  }
  if (!isValidHex(value)) {
    return { ok: false, message: `${token} must be #RRGGBB, got "${value}".`, token }
  }
  return { ok: true, state: { ...state, id: "custom", custom: { ...state.custom, [token]: value.toUpperCase() } } }
}

export function resetCustom(state: ThemeState): ThemeState {
  return { id: state.id, custom: resolveTheme(state.id).palette }
}
