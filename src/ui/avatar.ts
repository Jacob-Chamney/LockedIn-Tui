import { stringWidth } from "bun"

/**
 * Monogram avatars: bracketed initials with a deterministic tone.
 *
 * One implementation serves the plugin SDK (`avatar()` draws a filled badge)
 * and the app's agent roster. The tone is derived from the name, so the same
 * agent keeps the same colour across surfaces without storing anything.
 */
export type AvatarTone = "primary" | "accent" | "secondary" | "success" | "warning"

export const AVATAR_TONES = [
  "primary",
  "accent",
  "secondary",
  "success",
  "warning",
] as const satisfies readonly AvatarTone[]

export type AvatarOptions = {
  name: string
  /** Available columns; defaults to the natural `[AB]` width. */
  width?: number
  /** Fixed tone, instead of the name hash. */
  tone?: AvatarTone
}

export type AvatarLayout = {
  initials: string
  /** `[AB]`, fitted to `width`. */
  text: string
  tone: AvatarTone
  width: number
}

/** Up to two initials: first letters of the first and last words, or two
 * characters of a single word. Empty names use `?`. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "")
  if (words.length === 0) return "?"
  const first = Array.from(words[0]!)
  if (words.length === 1) {
    let initials = ""
    let width = 0
    for (const character of first) {
      const cell = stringWidth(character)
      if (width + cell > 2) break
      initials += character
      width += cell
    }
    return initials.toUpperCase()
  }
  const last = Array.from(words[words.length - 1]!)
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase()
}

function toneFor(name: string): AvatarTone {
  let hash = 0
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]!
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  if (stringWidth(text) <= width) return text
  const budget = Math.max(0, width - 1)
  let out = ""
  let used = 0
  for (const character of text) {
    const cell = stringWidth(character)
    if (used + cell > budget) break
    out += character
    used += cell
  }
  return `${out}…`
}

export function avatarLayout(options: AvatarOptions): AvatarLayout {
  const initials = avatarInitials(options.name)
  const natural = `[${initials}]`
  const width =
    options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  return {
    initials,
    text: fit(natural, width),
    tone: options.tone ?? toneFor(options.name),
    width,
  }
}
