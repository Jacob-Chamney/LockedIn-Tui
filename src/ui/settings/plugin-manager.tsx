/**
 * The effect-plugin manager: every discovered plugin, enabled or disabled.
 *
 * The list is data; the shell owns discovery, persistence and mounting. Space
 * flips one plugin, Esc returns to Settings. A bundled plugin's directory ends
 * in `.lockedin` and is marked in the row and the detail column.
 *
 * Starter templates and the shipped examples live in the repository tooling
 * (`plugin:new`, `src/ui/plugins/examples`), not in the packaged app.
 */
import type { ThemePalette } from "../theme"
import { ListRow } from "../panels/list-row"
import { TwoColumnSurface } from "../panels/two-column"

export type PluginManagerItem = {
  id: string
  /** Name from the plugin code; the manifest name until the sandbox reports. */
  name: string
  manifestName: string
  /** Bundled with the app (directory name ends in `.lockedin`). */
  bundled: boolean
  enabled: boolean
  /** Why the plugin could not be inspected, when it could not. */
  error?: string
}

export type PluginManagerState = {
  cursor: number
  items: PluginManagerItem[]
  loading: boolean
  notice?: string | null
}

export const initialPluginManager: PluginManagerState = {
  cursor: 0,
  items: [],
  loading: false,
  notice: null,
}

export function clampPluginCursor(state: PluginManagerState): PluginManagerState {
  const cursor = state.items.length === 0 ? 0 : Math.max(0, Math.min(state.items.length - 1, state.cursor))
  return cursor === state.cursor ? state : { ...state, cursor }
}

export function movePluginCursor(state: PluginManagerState, delta: number): PluginManagerState {
  return clampPluginCursor({ ...state, cursor: state.cursor + delta })
}

/** Flip one plugin in place; the shell persists the disabled list. */
export function togglePluginItem(state: PluginManagerState, id: string): PluginManagerState {
  return {
    ...state,
    items: state.items.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item)),
  }
}

/** Replace a row's code name once the sandbox reports it. */
export function renamePluginItem(
  state: PluginManagerState,
  id: string,
  name: string,
  error?: string,
): PluginManagerState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === id ? { ...item, name: name.trim() === "" ? item.manifestName : name, error } : item,
    ),
  }
}

export function pluginRowLabel(item: PluginManagerItem): string {
  return `${item.enabled ? "[x]" : "[ ]"} ${item.name}`
}

export function PluginManagerPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: PluginManagerState
}) {
  const palette = () => props.theme
  const maxVisible = () => Math.max(4, props.height - 2)
  const start = () =>
    Math.max(
      0,
      Math.min(
        Math.max(0, props.state.items.length - maxVisible()),
        props.state.cursor - Math.floor(maxVisible() / 2),
      ),
    )
  const visible = () => props.state.items.slice(start(), start() + maxVisible())
  const current = () => props.state.items[props.state.cursor]

  return (
    <TwoColumnSurface
      theme={palette()}
      width={props.width}
      height={props.height}
      focused={props.focused}
      title="UI plugins"
      meta={props.state.loading ? "discovering…" : `${props.state.items.length} discovered`}
      hints={["j/k move · Space enable · Esc back"]}
      notice={props.state.notice}
      detail={
        current()
          ? {
              title: current()!.name,
              meta: current()!.enabled ? "enabled" : "disabled",
              body:
                current()!.error ??
                (current()!.bundled
                  ? "bundled with LockedIn; the folder name ends in .lockedin"
                  : "discovered from your effect plugin folders"),
              footer: `id: ${current()!.id}`,
            }
          : undefined
      }
    >
      {props.state.loading && props.state.items.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          discovering plugins…
        </text>
      ) : null}
      {!props.state.loading && props.state.items.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          no plugins found in ui.effects.dirs
        </text>
      ) : null}
      {visible().map((item) => (
        <ListRow
          theme={palette()}
          selected={props.state.items[props.state.cursor]?.id === item.id}
          label={pluginRowLabel(item)}
          value={item.bundled ? "bundled" : item.error ? "error" : ""}
          labelWidth={Math.max(24, Math.floor(props.width * 0.45))}
          tone={item.error ? "error" : undefined}
        />
      ))}
    </TwoColumnSurface>
  )
}
