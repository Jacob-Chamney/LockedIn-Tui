/**
 * Theme tokens. Semantic only: a screen asks for `warning`, never a colour.
 *
 * Twelve tokens, mirroring docs/design.md §3.1. Adding a token means updating
 * every palette and the contrast table in the same change.
 */
export type ThemePalette = {
  background: string
  surface: string
  panel: string
  foreground: string
  muted: string
  primary: string
  secondary: string
  accent: string
  success: string
  warning: string
  error: string
  line: string
}

export const TOKEN_NAMES = [
  "background",
  "surface",
  "panel",
  "foreground",
  "muted",
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "line",
] as const satisfies readonly (keyof ThemePalette)[]

/** Tokens that carry body text and therefore owe WCAG AA on every surface. */
export const BODY_TOKENS = ["foreground", "muted"] as const

const HEX = /^#[0-9A-Fa-f]{6}$/

export function isValidHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value)
}

export type PaletteIssue = { token: keyof ThemePalette; message: string }

/** One message per offending token; the caller shows the first and keeps the rest. */
export function validatePalette(input: Record<string, unknown>): { ok: true; palette: ThemePalette } | { ok: false; issues: PaletteIssue[] } {
  const issues: PaletteIssue[] = []
  const palette = {} as Record<keyof ThemePalette, string>
  for (const token of TOKEN_NAMES) {
    const value = input[token]
    if (value === undefined || value === "") {
      issues.push({ token, message: `${token} is missing.` })
      continue
    }
    if (!isValidHex(value)) {
      issues.push({ token, message: `${token} must be #RRGGBB, got "${String(value)}".` })
      continue
    }
    palette[token] = (value as string).toUpperCase()
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, palette: palette as ThemePalette }
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  if (!isValidHex(hex)) throw new Error(`not a colour: ${hex}`)
  const n = Number.parseInt(hex.slice(1), 16)
  const r = channel((n >> 16) & 0xff)
  const g = channel((n >> 8) & 0xff)
  const b = channel(n & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio, 1…21. AA body text needs 4.5. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export const AA_BODY = 4.5

export type ContrastRow = {
  token: keyof ThemePalette
  on: keyof ThemePalette
  ratio: number
  passes: boolean
}

/** Body-token contrast on every surface the shell paints text on. */
export function contrastTable(palette: ThemePalette): ContrastRow[] {
  const rows: ContrastRow[] = []
  for (const token of BODY_TOKENS) {
    for (const on of ["background", "surface", "panel"] as const) {
      const ratio = contrastRatio(palette[token], palette[on])
      rows.push({ token, on, ratio, passes: ratio >= AA_BODY })
    }
  }
  return rows
}

export function failingContrast(palette: ThemePalette): ContrastRow[] {
  return contrastTable(palette).filter((row) => !row.passes)
}
