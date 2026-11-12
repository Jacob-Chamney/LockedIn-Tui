/**
 * Syntax colours, derived from the app palette.
 *
 * Shiki wants a TextMate theme; the app wants its own semantic tokens. This
 * builds one from the other, so a theme change restyles code with the rest of
 * the UI instead of importing a foreign palette. The theme name is derived from
 * the colours, which makes it a cache key: two palettes never share tokens.
 */

export type SyntaxColours = {
  background: string
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

export type ThemeRule = {
  scope: string | string[]
  settings: { foreground?: string; fontStyle?: string }
}

export type SyntaxTheme = {
  name: string
  type: "dark" | "light"
  colors: Record<string, string>
  tokenColors: ThemeRule[]
}

function luminance(hex: string): number {
  const value = hex.replace("#", "")
  const normal = value.length === 3 ? value.split("").map((c) => c + c).join("") : value
  const n = Number.parseInt(normal, 16)
  const channel = (raw: number) => {
    const v = raw / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  )
}

/** Stable identity for a palette: the cache and Shiki both key on it. */
export function syntaxThemeName(colours: SyntaxColours): string {
  let hash = 0x811c9dc5
  const source = Object.values(colours).join("")
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `lockedin-${(hash >>> 0).toString(16)}`
}

export function syntaxTheme(colours: SyntaxColours): SyntaxTheme {
  return {
    name: syntaxThemeName(colours),
    type: luminance(colours.background) < 0.5 ? "dark" : "light",
    colors: {
      "editor.background": colours.background,
      "editor.foreground": colours.foreground,
    },
    // The same semantic mapping the app used before: keywords carry the brand
    // accent, strings the success token, comments the muted one, and so on.
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: colours.muted, fontStyle: "italic" },
      },
      {
        scope: ["string", "punctuation.definition.string", "string.regexp"],
        settings: { foreground: colours.success },
      },
      {
        scope: ["constant.numeric", "constant.language", "constant.character", "constant.other"],
        settings: { foreground: colours.accent },
      },
      {
        scope: ["keyword", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
        settings: { foreground: colours.primary },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call", "variable.function"],
        settings: { foreground: colours.secondary },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class"],
        settings: { foreground: colours.accent },
      },
      {
        scope: ["variable", "variable.other", "variable.parameter", "meta.object-literal.key"],
        settings: { foreground: colours.foreground },
      },
      {
        scope: ["keyword.operator", "punctuation.accessor"],
        settings: { foreground: colours.secondary },
      },
      {
        scope: ["punctuation", "meta.brace"],
        settings: { foreground: colours.muted },
      },
      {
        scope: ["entity.name.tag", "meta.tag"],
        settings: { foreground: colours.primary },
      },
      {
        scope: ["entity.other.attribute-name"],
        settings: { foreground: colours.warning },
      },
      {
        scope: ["invalid", "invalid.illegal"],
        settings: { foreground: colours.error },
      },
      {
        scope: ["markup.heading", "markup.bold"],
        settings: { foreground: colours.primary, fontStyle: "bold" },
      },
    ],
  }
}
