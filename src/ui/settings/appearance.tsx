/**
 * Settings shell and the appearance section.
 *
 * The section router is data; this packet ships `appearance` and marks the rest
 * `not built yet` rather than opening an empty pane (AGENTS.md §2.13). Nothing
 * here writes config: every change is a patch the shell applies.
 */
import { parseBinding, type Binding } from "../keymap/registry";
import { contrastRatio, crimson, failingContrast, isValidHex, resolveTheme, paletteChoices, type ThemePalette } from "../theme";
import type { ThemeId } from "../theme";
// ---------------------------------------------------------------- sections

export type SectionId = "appearance" | "models" | "usage" | "storage" | "keybinds" | "plugins"

export type Section = {
  id: SectionId
  label: string
  /** Whether the section applies on the spot or needs an explicit save. */
  saving: "immediate" | "confirm"
  built: boolean
}

export const SECTIONS: Section[] = [
  { id: "appearance", label: "appearance", saving: "immediate", built: true },
  { id: "models", label: "models", saving: "confirm", built: false },
  { id: "usage", label: "usage and budget", saving: "confirm", built: false },
  { id: "storage", label: "storage and archive", saving: "confirm", built: false },
  { id: "keybinds", label: "keybinds", saving: "immediate", built: false },
  { id: "plugins", label: "plugins", saving: "immediate", built: true },
]

export type SettingsRouter = {
  pane: "list" | "section"
  cursor: number
  /** Cursor to restore when a section closes. */
  previousCursor: number
  section: SectionId | null
}

export const initialRouter: SettingsRouter = { pane: "list", cursor: 0, previousCursor: 0, section: null }

export function moveCursor(router: SettingsRouter, delta: number): SettingsRouter {
  if (router.pane !== "list") return router
  const cursor = Math.max(0, Math.min(SECTIONS.length - 1, router.cursor + delta))
  return { ...router, cursor }
}

export function openSection(router: SettingsRouter): SettingsRouter {
  const section = SECTIONS[router.cursor]!
  // The previous cursor is remembered for built *and* unbuilt sections, so Esc
  // always lands where the user left the list.
  return { ...router, pane: "section", previousCursor: router.cursor, section: section.id }
}

/** Esc returns to the list with the previous cursor, always in NORMAL. */
export function closeSection(router: SettingsRouter): SettingsRouter {
  if (router.pane === "list") return router
  return { ...router, pane: "list", cursor: router.previousCursor, section: null }
}

export function savingHint(section: Section): string {
  return section.saving === "immediate" ? "applies immediately" : "Enter save"
}

export function notBuiltCopy(section: SectionId): string {
  return `${section} is not built yet · press Esc to pick another section`
}

// ---------------------------------------------------------------- identity

export const USERNAME_MIN = 1
export const USERNAME_MAX = 40

export function validateUsername(name: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (trimmed.length < USERNAME_MIN) return { ok: false, reason: "a username needs at least one character" }
  if (trimmed.length > USERNAME_MAX) return { ok: false, reason: `a username is at most ${USERNAME_MAX} characters` }
  return { ok: true }
}

export type Nudge = "gentle" | "balanced" | "intensive"

/** Threshold each density implies (product §6.2). */
export const NUDGE_THRESHOLDS: Record<Nudge, number> = { gentle: 5, balanced: 3, intensive: 2 }

export function nudgeLine(nudge: Nudge): string {
  return `${nudge} · offers a focused review after ${NUDGE_THRESHOLDS[nudge]} misses`
}

// ---------------------------------------------------------------- semantics

/**
 * The four semantic swatches. They carry meaning, not style: the same values in
 * every theme, which is what proves a theme switch moved no meaning.
 */
export const SEMANTIC_SWATCHES = [
  { token: "success", label: "success", value: crimson.success },
  { token: "warning", label: "warning", value: crimson.warning },
  { token: "error", label: "error", value: crimson.error },
  { token: "accent", label: "accent", value: crimson.accent },
] as const

export function semanticValues(): string[] {
  return SEMANTIC_SWATCHES.map((swatch) => swatch.value)
}

// ---------------------------------------------------------------- appearance state

export type AppearanceState = {
  theme: ThemeId
  custom: ThemePalette
  username: string
  /** Draft while typing; committed on Enter only. */
  usernameDraft: string
  usernameColor: string
  hideHints: boolean
  nudge: Nudge
  mouse: boolean
  /** A failing palette stays pending until it is confirmed by name. */
  pendingPalette?: { token: string; pair: string; ratio: number } | null
  notice?: string | null
}

export function initialAppearance(palette: ThemePalette): AppearanceState {
  return {
    theme: "lockedin",
    custom: palette,
    username: "friend",
    usernameDraft: "friend",
    usernameColor: "",
    hideHints: false,
    nudge: "balanced",
    mouse: false,
    pendingPalette: null,
    notice: null,
  }
}

/** Theme choice applies immediately; the preview is the same palette. */
export function chooseTheme(state: AppearanceState, theme: ThemeId): AppearanceState {
  return { ...state, theme, notice: null }
}

export function themePreview(theme: ThemeId, custom: ThemePalette): ThemePalette {
  return resolveTheme(theme, custom).palette
}

export type FieldResult = { kind: "patch"; patch: Record<string, unknown> } | { kind: "refused"; reason: string }

export function typeUsername(state: AppearanceState, value: string): AppearanceState {
  return { ...state, usernameDraft: value, notice: null }
}

/** Enter commits; an invalid name is refused and nothing is written. */
export function commitUsername(state: AppearanceState): FieldResult {
  const valid = validateUsername(state.usernameDraft)
  if (!valid.ok) return { kind: "refused", reason: valid.reason }
  return { kind: "patch", patch: { "ui.username": state.usernameDraft.trim() } }
}

export function setUsernameColor(_state: AppearanceState, value: string, palette: ThemePalette): FieldResult {
  if (value !== "" && !isValidHex(value)) {
    return { kind: "refused", reason: `username colour must be #rrggbb, got “${value}”` }
  }
  if (value === "") return { kind: "patch", patch: { "ui.username_color": "" } }
  const ratio = contrastRatio(value, palette.background)
  return {
    kind: "patch",
    patch: {
      "ui.username_color": value.toUpperCase(),
      "ui.username_color_contrast": ratio >= 4.5 ? "AA" : "fail",
    },
  }
}

export function usernameContrastLabel(value: string, palette: ThemePalette): string {
  if (!value || !isValidHex(value)) return "no colour set"
  const ratio = contrastRatio(value, palette.background)
  return ratio >= 4.5 ? `AA pass · ${ratio.toFixed(2)}:1` : `AA fail · ${ratio.toFixed(2)}:1`
}

/**
 * A custom token change. A palette that fails contrast is held for an explicit
 * confirmation that names the failing pair.
 */
export function editCustomToken(
  state: AppearanceState,
  token: keyof ThemePalette,
  value: string,
  options: { confirmed?: boolean } = {},
): AppearanceState | FieldResult {
  if (!isValidHex(value)) {
    return { kind: "refused", reason: `${token} must be #rrggbb, got “${value}”` }
  }
  const next: ThemePalette = { ...state.custom, [token]: value.toUpperCase() }
  const failing = failingContrast(next)
  if (failing.length > 0 && !options.confirmed) {
    const worst = failing[0]!
    return {
      ...state,
      custom: next,
      theme: "custom",
      pendingPalette: {
        token: worst.token,
        pair: `${worst.token} on ${worst.on}`,
        ratio: worst.ratio,
      },
      notice: `${worst.token} on ${worst.on} is AA fail at ${worst.ratio.toFixed(2)}:1 · press y to keep it anyway`,
    }
  }
  return { ...state, custom: next, theme: "custom", pendingPalette: null, notice: null }
}

export function confirmPalette(state: AppearanceState): FieldResult {
  if (!state.pendingPalette) return { kind: "refused", reason: "nothing is waiting to be confirmed" }
  return {
    kind: "patch",
    patch: { "ui.custom_theme": state.custom, "ui.theme": "custom" },
  }
}

export function toggleHints(state: AppearanceState): FieldResult {
  return { kind: "patch", patch: { "ui.hide_hints": !state.hideHints } }
}

export function setNudge(_state: AppearanceState, nudge: Nudge): FieldResult {
  return { kind: "patch", patch: { "ui.nudge_intensity": nudge } }
}

export function toggleMouse(state: AppearanceState): FieldResult {
  return { kind: "patch", patch: { "ui.mouse": !state.mouse } }
}

export const MOUSE_COPY = "mouse is off by default · the keyboard reaches every action"

/** NO_COLOR turns colour into decoration only; the section says so. */
export function noColorState(env: Record<string, string | undefined>): { override: boolean; copy: string } {
  const override = env.NO_COLOR !== undefined && env.NO_COLOR !== ""
  return {
    override,
    copy: override
      ? "NO_COLOR is set · colour is decoration only, every state has a glyph or a word"
      : "colour is paired with a glyph or a word in every state",
  }
}

export function reducedMotion(env: Record<string, string | undefined>): boolean {
  return env.LOCKEDIN_REDUCED_MOTION === "1"
}

// ---------------------------------------------------------------- keys

export type SettingsIntent = "down" | "up" | "open" | "back"

const SPECS: Array<{ intent: SettingsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "open", key: "return", footer: "Enter open" },
  { intent: "back", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`settings key "${key}": ${binding.message}`)
  return binding
}

export const SETTINGS_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): SettingsIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return SETTINGS_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return SETTINGS_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

// ---------------------------------------------------------------- render

export function AppearancePanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: AppearanceState
  env?: Record<string, string | undefined>
}) {
  const palette = () => props.theme
  const wide = () => props.width >= 120
  const noColor = () => noColorState(props.env ?? {})
  const contrast = () => usernameContrastLabel(props.state.usernameColor || palette().primary, palette())
  const preview = () => props.state.usernameDraft || props.state.username

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} APPEARANCE · applies immediately`}
      </text>

      <text fg={palette().foreground} wrapMode="none">
        {`theme      ${props.state.theme}  (${paletteChoices().length} palettes)`}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {`  semantic   ${SEMANTIC_SWATCHES.map((swatch) => `${swatch.label} ${swatch.value}`).join("  ")}`}
      </text>

      <text fg={palette().foreground} wrapMode="none">
        {`username   ${preview()}`}
      </text>
      {wide() ? (
        <text fg={palette().secondary} wrapMode="none">
          {`  preview    ${preview()}   ${contrast()}`}
        </text>
      ) : (
        <text fg={palette().secondary} wrapMode="none">
          {`  contrast   ${contrast()}`}
        </text>
      )}

      <text fg={palette().foreground} wrapMode="none">
        {`hints      ${props.state.hideHints ? "hidden" : "shown"}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {`nudges     ${nudgeLine(props.state.nudge)}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {`mouse      ${props.state.mouse ? "on" : "off"} · ${MOUSE_COPY}`}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {`  ${noColor().copy}`}
      </text>

      {props.state.pendingPalette ? (
        <text fg={palette().error} wrapMode="none">
          {`! custom theme keeps ${props.state.pendingPalette.pair} at AA fail · y keep · n revert`}
        </text>
      ) : null}
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

export function SettingsList(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  router: SettingsRouter
}) {
  const palette = () => props.theme
  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} SETTINGS`}
      </text>
      {SECTIONS.map((section, index) => (
        <text
          fg={index === props.router.cursor ? palette().primary : section.built ? palette().foreground : palette().muted}
          wrapMode="none"
        >
          {`${index === props.router.cursor ? "▸" : " "} ${section.label}${section.built ? "" : "  · not built yet"}  ${savingHint(section)}`}
        </text>
      ))}
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
