/**
 * Splash tones, derived from the active theme.
 *
 * The boot field follows LockedIn Crimson by default and every other palette
 * without a second colour table: the field is the background mixed toward
 * primary, the lock is primary, and the captions use the semantic tokens.
 */
import { mixHex } from "./mix"
import type { ThemePalette } from "./tokens"

export type SplashTone =
  | "field"
  | "fieldBright"
  | "lock"
  | "lockFlash"
  | "wordmark"
  | "subtitle"
  | "captionMuted"
  | "captionWarning"
  | "captionSuccess"
  | "hint"

/** `fade` 0 is the background; 1 is the full splash tone. */
export function splashTones(palette: ThemePalette, fade = 1): Record<SplashTone, string> {
  const at = (color: string) => mixHex(palette.background, color, fade)
  return {
    field: at(mixHex(palette.background, palette.primary, 0.26)),
    fieldBright: at(mixHex(palette.background, palette.primary, 0.46)),
    lock: at(palette.primary),
    lockFlash: at(mixHex(palette.primary, palette.foreground, 0.65)),
    wordmark: at(palette.primary),
    subtitle: at(palette.muted),
    captionMuted: at(palette.muted),
    captionWarning: at(palette.warning),
    captionSuccess: at(palette.success),
    hint: at(mixHex(palette.background, palette.muted, 0.7)),
  }
}
