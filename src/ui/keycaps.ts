/**
 * Keycap layout: a chord split into caps and separators.
 *
 * One implementation serves the plugin SDK (`keycaps()` draws filled caps) and
 * the app's keybind editor. The concatenated token text equals the chord, so a
 * renderer can style caps without changing the string a test or copy action
 * sees. A chord wider than the column drops trailing tokens and reports
 * `truncated`.
 */
export type KeycapToken = {
  kind: "cap" | "separator"
  text: string
  /** Offset from the chord's left edge. */
  x: number
  width: number
  index: number
}

export type KeycapLayout = {
  tokens: KeycapToken[]
  caps: KeycapToken[]
  /** The rendered chord (caps and separators joined). */
  text: string
  width: number
  truncated: boolean
}

export type KeycapOptions = {
  /** Display chord, e.g. `␣ c`, `shift+r`, or `g`. */
  chord: string
  /** Available columns. */
  width: number
}

export function keycapLayout(options: KeycapOptions): KeycapLayout {
  const chord = options.chord
  const width = Math.max(0, Math.floor(options.width))
  if (chord === "" || width === 0) {
    return { tokens: [], caps: [], text: "", width, truncated: chord !== "" }
  }

  let labels: string[]
  let separator: string
  if (chord.includes("+")) {
    labels = chord.split("+").filter((label) => label !== "")
    separator = "+"
  } else if (/\s/.test(chord)) {
    labels = chord.trim().split(/\s+/).filter((label) => label !== "")
    separator = " "
  } else {
    labels = [chord]
    separator = ""
  }
  if (labels.length === 0) {
    return { tokens: [], caps: [], text: "", width, truncated: true }
  }

  const tokens: KeycapToken[] = []
  labels.forEach((label, index) => {
    if (index > 0 && separator !== "") {
      tokens.push({
        kind: "separator",
        text: separator,
        x: tokens.reduce((sum, token) => sum + token.width, 0),
        width: separator.length,
        index: tokens.length,
      })
    }
    tokens.push({
      kind: "cap",
      text: label,
      x: tokens.reduce((sum, token) => sum + token.width, 0),
      width: label.length,
      index: tokens.length,
    })
  })

  let total = tokens.reduce((sum, token) => sum + token.width, 0)
  let truncated = false
  while (total > width && tokens.length > 0) {
    const removed = tokens.pop()!
    total -= removed.width
    truncated = true
  }
  // A trailing separator after a dropped cap adds no meaning.
  while (tokens.length > 0 && tokens[tokens.length - 1]!.kind === "separator") {
    total -= tokens.pop()!.width
  }

  return {
    tokens,
    caps: tokens.filter((token) => token.kind === "cap"),
    text: tokens.map((token) => token.text).join(""),
    width,
    truncated,
  }
}
