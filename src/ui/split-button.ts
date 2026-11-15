/**
 * Split buttons: one primary action with an attached secondary action.
 *
 * One implementation serves the plugin SDK (`splitButton()` paints the keys)
 * and the chat composer. The primary key and label stay together; a separator
 * and the secondary key/label follow. When the secondary action does not fit it
 * is dropped entire, and a disabled button keeps its shape but reads muted.
 */
export type SplitAction = {
  /** A keycap, e.g. `Enter`; omitted for label-only actions. */
  key?: string
  label: string
}

export type SplitButtonTokenKind = "key" | "label" | "separator"

export type SplitButtonToken = {
  kind: SplitButtonTokenKind
  text: string
  x: number
  width: number
  primary: boolean
}

export type SplitButtonOptions = {
  primary: SplitAction
  secondary?: SplitAction
  /** Available columns; defaults to the natural width. */
  width?: number
  disabled?: boolean
  /** Separator between the halves; defaults `│`. */
  separator?: string
}

export type SplitButtonLayout = {
  tokens: SplitButtonToken[]
  text: string
  width: number
  disabled: boolean
  /** True when the secondary action is drawn. */
  secondaryVisible: boolean
}

function actionTokens(action: SplitAction, primary: boolean, start: number): SplitButtonToken[] {
  const tokens: SplitButtonToken[] = []
  let x = start
  if (action.key !== undefined && action.key !== "") {
    const text = `[${action.key}]`
    tokens.push({ kind: "key", text, x, width: text.length, primary })
    x += text.length
  }
  const label = `${action.key === undefined || action.key === "" ? "" : " "}${action.label}`
  if (label !== "") {
    tokens.push({ kind: "label", text: label, x, width: label.length, primary })
    x += label.length
  }
  return tokens
}

export function splitButtonLayout(options: SplitButtonOptions): SplitButtonLayout {
  const disabled = options.disabled === true
  const separator = options.separator ?? "│"
  const primary = actionTokens(options.primary, true, 0)
  const primaryWidth = primary.reduce((sum, token) => sum + token.width, 0)
  const secondary = options.secondary ? actionTokens(options.secondary, false, 0) : []
  const secondaryWidth = secondary.reduce((sum, token) => sum + token.width, 0)
  const natural = primaryWidth + (secondary.length === 0 ? 0 : separator.length + secondaryWidth)
  const width = options.width === undefined ? natural : Math.max(0, Math.floor(options.width))
  if (width === 0) {
    return { tokens: [], text: "", width: 0, disabled, secondaryVisible: false }
  }

  let tokens = primary.map((token) => ({ ...token }))
  let text = primary.map((token) => token.text).join("")
  let secondaryVisible = false
  if (secondary.length > 0 && width >= primaryWidth + separator.length + secondaryWidth) {
    const sep = { kind: "separator" as const, text: separator, x: primaryWidth, width: separator.length, primary: false }
    const shifted = secondary.map((token) => ({ ...token, x: token.x + primaryWidth + separator.length }))
    tokens = [...primary, sep, ...shifted]
    text = `${text}${separator}${secondary.map((token) => token.text).join("")}`
    secondaryVisible = true
  }

  if (text.length > width) {
    text = width === 1 ? "…" : `${text.slice(0, width - 1)}…`
    const visible: SplitButtonToken[] = []
    let x = 0
    for (const token of tokens) {
      if (x >= width) break
      const room = width - x
      const part = token.text.slice(0, room)
      if (part !== "") visible.push({ ...token, text: part, width: part.length })
      x += part.length
      if (x >= width) break
    }
    tokens = visible
  }

  return { tokens, text, width, disabled, secondaryVisible }
}

/** The split button text without placement. */
export function splitButtonText(options: SplitButtonOptions): string {
  return splitButtonLayout(options).text
}
