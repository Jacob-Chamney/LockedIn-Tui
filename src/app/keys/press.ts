/** One normal form for a key press, before any handler sees it. */
export type ShellPress = {
  name: string
  /** The key before arrow aliasing; text fields must use this. */
  rawName?: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
}

/** Arrows are aliases for the movement keys the shell already documents. */
export const ARROW_ALIAS: Record<string, string> = { down: "j", up: "k" }

/** The character a text field should insert, or null for a navigation key. */
export function typedCharacter(press: ShellPress): string | null {
  // An arrow is aliased to j/k for movement; it must never type those letters.
  if (press.rawName !== undefined && press.rawName !== press.name) return null
  if (press.ctrl || press.meta) return null
  if (press.name === "space") return " "
  return press.name.length === 1 ? press.name : null
}

/**
 * The character a key actually types.
 *
 * `typedCharacter` reads the key *name*, which is lowercase (`a` even for
 * Shift+A). The terminal's `sequence` carries the shifted character, so a
 * composer or prompt can accept `A`, `!` and a path with uppercase letters.
 * Control sequences (arrows, Esc) are not text and fall back to the name.
 */
export function typedText(
  press: ShellPress,
  event: { sequence?: string },
): string | null {
  if (press.ctrl || press.meta) return null
  const sequence = event.sequence ?? ""
  if (sequence.length > 0 && !/[\u0000-\u001f\u007f]/.test(sequence)) return sequence
  return typedCharacter(press)
}

export function normalisePress(event: {
  name: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
}): ShellPress {
  return {
    name: ARROW_ALIAS[event.name] ?? event.name,
    rawName: event.name,
    ctrl: event.ctrl,
    shift: event.shift,
    meta: event.meta,
  }
}
