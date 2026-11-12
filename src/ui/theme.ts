/**
 * Public theme API. `src/ui/theme/**` holds the data and the model; this barrel
 * is what the shell imports.
 */
export type { ThemePalette } from "./theme/tokens"
export {
  AA_BODY,
  BODY_TOKENS,
  TOKEN_NAMES,
  contrastRatio,
  contrastTable,
  failingContrast,
  isValidHex,
  relativeLuminance,
  validatePalette,
  type ContrastRow,
  type PaletteIssue,
} from "./theme/tokens"
export {
  crimson,
  highContrast,
  claudeCode,
  codex,
  customDefault,
  palettes,
  paletteChoices,
  resolveTheme,
  DEFAULT_THEME,
  type PaletteEntry,
  type ResolvedTheme,
  type ThemeId,
} from "./theme/palettes"
export { opencodePalettes } from "./theme/opencode"
export { ThemeContext, ThemeProvider, useTheme, usePalette } from "./theme/provider"
export {
  readThemeConfig,
  writeThemeConfig,
  setCustomToken,
  resetCustom,
  type CustomEdit,
  type ThemeConfig,
  type ThemeState,
} from "./theme/config"
