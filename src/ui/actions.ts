/**
 * Action bars: grouped actions with keycaps and labels.
 *
 * One implementation serves the plugin SDK (`actionBar()` draws keys and
 * labels) and the app's chat footer. Actions are laid out left to right in
 * groups; a `[key]` token is separate from its label so renderers can style the
 * keycap, and disabled actions keep their place while reading as muted. The
 * first action that does not fit ends the bar and the rest are counted hidden.
 */
export type ActionItem = {
  id: string
  /** A keycap, e.g. `Enter`; omitted for label-only actions. */
  key?: string
  label: string
  disabled?: boolean
}

export type ActionGroup = {
  id: string
  actions: readonly ActionItem[]
}

export type ActionTokenKind = "key" | "label" | "separator"

export type ActionToken = {
  id: string
  groupId: string
  kind: ActionTokenKind
  text: string
  x: number
  width: number
  disabled: boolean
}

export type ActionBarOptions = {
  groups: readonly ActionGroup[]
  /** Available columns. */
  width: number
  /** Spaces between actions in one group; defaults to 2. */
  actionGap?: number
  /** Separator between groups; defaults to ` · `. */
  groupSeparator?: string
}

export type ActionBarLayout = {
  tokens: ActionToken[]
  /** Actions that did not fit. */
  hidden: number
  width: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function actionBarLayout(options: ActionBarOptions): ActionBarLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(1, Math.floor(options.actionGap ?? 2))
  const separator = options.groupSeparator ?? " · "
  if (width === 0) {
    return {
      tokens: [],
      hidden: options.groups.reduce((sum, group) => sum + group.actions.length, 0),
      width,
    }
  }
  const tokens: ActionToken[] = []
  let x = 0
  let hidden = 0
  let stopped = false

  const push = (
    id: string,
    groupId: string,
    kind: ActionTokenKind,
    text: string,
    disabled = false,
  ) => {
    tokens.push({ id, groupId, kind, text, x, width: text.length, disabled })
    x += text.length
  }

  options.groups.forEach((group, groupIndex) => {
    if (stopped) {
      hidden += group.actions.length
      return
    }
    if (group.actions.length === 0) return
    if (groupIndex > 0) {
      if (x + separator.length > width) {
        hidden += group.actions.length
        stopped = true
        return
      }
      push(`separator:${group.id}`, group.id, "separator", separator)
    }
    group.actions.forEach((action, actionIndex) => {
      if (stopped) {
        hidden += 1
        return
      }
      const prefix = actionIndex > 0 ? " ".repeat(gap) : ""
      const keyText = action.key ? `[${action.key}]` : ""
      const labelText = keyText === "" ? action.label : ` ${action.label}`
      const cost = prefix.length + keyText.length + labelText.length
      if (x + cost > width) {
        if (tokens.length === 0) {
          const room = width - x - prefix.length - keyText.length
          if (room > 0) {
            if (prefix !== "") push(`gap:${action.id}`, group.id, "separator", prefix)
            if (keyText !== "") push(`key:${action.id}`, group.id, "key", keyText, action.disabled)
            push(`label:${action.id}`, group.id, "label", fit(labelText, room), action.disabled)
          } else {
            hidden += 1
          }
        } else {
          hidden += 1
        }
        stopped = true
        return
      }
      if (prefix !== "") push(`gap:${action.id}`, group.id, "separator", prefix)
      if (keyText !== "") push(`key:${action.id}`, group.id, "key", keyText, action.disabled)
      push(`label:${action.id}`, group.id, "label", labelText, action.disabled)
    })
  })

  return { tokens, hidden, width }
}
