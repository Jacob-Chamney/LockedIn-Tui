/**
 * Theme provider and hook.
 *
 * Components read tokens from `useTheme()`; a literal colour in a shell
 * component is a review failure. The provider is mount-scoped state, so the
 * headless harness can render one frame per palette.
 */
import { createContext, useContext } from "solid-js"

import type { ThemePalette } from "./tokens"
import { DEFAULT_THEME, crimson, resolveTheme, type ResolvedTheme, type ThemeId } from "./palettes"

export const ThemeContext = createContext<ResolvedTheme>({
  id: DEFAULT_THEME,
  label: "LockedIn Crimson",
  palette: crimson,
})

export function ThemeProvider(props: {
  theme?: ThemeId
  custom?: Partial<ThemePalette> | null
  children?: unknown
}) {
  const resolved = () => resolveTheme(props.theme, props.custom)
  return (
    <ThemeContext.Provider value={resolved()}>{props.children as never}</ThemeContext.Provider>
  )
}

export function useTheme(): ResolvedTheme {
  return useContext(ThemeContext)
}

/** The palette a component renders with; also usable outside a provider. */
export function usePalette(): ThemePalette {
  return useTheme().palette
}
