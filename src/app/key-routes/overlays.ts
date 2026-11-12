/** Command palette, help and the quit chord. */
import { filterCommands, resolveCommand } from "../../ui/shell/commands"
import { reduce, type ShellState } from "../../ui/shell/state"
import type { KeymapRegistry } from "../../ui/keymap/registry"
import type { ShellPress } from "../keys/press"

export type OverlayKeyDeps = {
  registry: KeymapRegistry
  dispatch: (id: string) => void
  update: (next: ShellState) => void
  setHelpPage: (updater: (page: number) => number) => void
  destroy: () => void
}

export function handleOverlayKeys(
  state: ShellState,
  press: ShellPress,
  event: { name?: string; preventDefault: () => void },
  deps: OverlayKeyDeps,
): boolean {
  if (state.overlay === "command") {
    const matches = filterCommands(deps.registry, state.commandQuery, 10)
    if (press.name === ":") {
      deps.update({ ...state, commandQuery: "", commandMessage: null, commandIndex: 0 })
      event.preventDefault()
      return true
    }
    if (press.name === "escape") {
      deps.update(reduce(state, { type: "close-overlay" }))
    } else if (press.name === "tab") {
      if (matches.length > 0) {
        const delta = press.shift ? -1 : 1
        deps.update(reduce(state, { type: "command-cycle", delta, count: matches.length }))
      }
    } else if (press.name === "return") {
      const pick = matches[state.commandIndex] ?? matches[0]
      if (pick) {
        const result = resolveCommand(deps.registry, pick.name)
        if (result.kind === "action") deps.dispatch(result.id)
        else if (result.kind === "panel") deps.update(reduce(state, { type: "panel-open", id: result.id }))
        else deps.update(reduce(state, { type: "command-message", message: result.message }))
      } else {
        const result = resolveCommand(deps.registry, state.commandQuery)
        if (result.kind === "action") deps.dispatch(result.id)
        else if (result.kind === "panel") deps.update(reduce(state, { type: "panel-open", id: result.id }))
        else deps.update(reduce(state, { type: "command-message", message: result.message }))
      }
    } else if (event.name === "down") {
      deps.update(reduce(state, { type: "command-move", delta: 1, count: matches.length }))
    } else if (event.name === "up") {
      deps.update(reduce(state, { type: "command-move", delta: -1, count: matches.length }))
    } else if (press.name === "backspace" || press.name === "delete") {
      deps.update(reduce(state, { type: "command-input", value: state.commandQuery.slice(0, -1) }))
    } else if (!press.ctrl && !press.meta && press.name.length === 1) {
      deps.update(reduce(state, { type: "command-input", value: state.commandQuery + press.name }))
    }
    event.preventDefault()
    return true
  }

  if (state.overlay === "help") {
    if (press.name === "escape" || press.name === "?") {
      deps.update(reduce(state, { type: "close-overlay" }))
      event.preventDefault()
      return true
    }
    if (press.name === "tab") {
      deps.setHelpPage((page) => page + (press.shift ? -1 : 1))
      event.preventDefault()
      return true
    }
    return true
  }

  if (press.name === "q" && press.ctrl) {
    deps.destroy()
    event.preventDefault()
    return true
  }
  return false
}
