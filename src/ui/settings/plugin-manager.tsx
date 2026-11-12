/**
 * The effect-plugin manager: every discovered plugin, enabled or disabled.
 *
 * The list is data; the shell owns discovery, persistence and mounting. Space
 * flips one plugin, Esc returns to Settings. A bundled plugin's directory ends
 * in `.lockedin` and is marked in the row and the detail column.
 */
import type { ThemePalette } from "../theme"
import { ListRow } from "../panels/list-row"
import { TwoColumnSurface } from "../panels/two-column"
import {
  exampleRowLabel,
  moveExampleCursor,
  PLUGIN_EXAMPLES,
  selectedExample,
} from "./plugin-examples"
import {
  moveTemplateCursor,
  PLUGIN_TEMPLATES,
  selectedTemplate,
  templateRowLabel,
} from "./plugin-templates"

export type PluginManagerMode = "plugins" | "templates" | "examples"

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
  /** `templates`/`examples` show a gallery instead of discovered plugins. */
  mode: PluginManagerMode
  templateCursor: number
  exampleCursor: number
}

export const initialPluginManager: PluginManagerState = {
  cursor: 0,
  items: [],
  loading: false,
  notice: null,
  mode: "plugins",
  templateCursor: 0,
  exampleCursor: 0,
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

export function togglePluginManagerMode(state: PluginManagerState): PluginManagerState {
  return { ...state, mode: state.mode === "plugins" ? "templates" : "plugins" }
}

export function setPluginManagerMode(
  state: PluginManagerState,
  mode: PluginManagerMode,
): PluginManagerState {
  return { ...state, mode }
}

export function moveTemplateManagerCursor(
  state: PluginManagerState,
  delta: number,
): PluginManagerState {
  return { ...state, templateCursor: moveTemplateCursor(state.templateCursor, delta) }
}

export function moveExampleManagerCursor(
  state: PluginManagerState,
  delta: number,
): PluginManagerState {
  return { ...state, exampleCursor: moveExampleCursor(state.exampleCursor, delta) }
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
  const templates = () => props.state.mode === "templates"
  const examples = () => props.state.mode === "examples"
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
  const template = () => selectedTemplate(props.state.templateCursor)

  return (
    <TwoColumnSurface
      theme={palette()}
      width={props.width}
      height={props.height}
      focused={props.focused}
      title={
        templates() ? "Plugin templates" : examples() ? "Shipped examples" : "Plugin manager"
      }
      meta={
        templates()
          ? `${PLUGIN_TEMPLATES.length} starter layouts`
          : examples()
            ? `${PLUGIN_EXAMPLES.length} bundled examples`
            : props.state.loading
              ? "discovering…"
              : `${props.state.items.length} discovered`
      }
      hints={
        templates()
          ? ["j/k move · Enter copy · e examples · Esc back"]
          : examples()
            ? ["j/k move · Enter copy · t templates · Esc back"]
            : ["j/k move · Space enable · t templates · e examples · Esc back"]
      }
      notice={props.state.notice}
      detail={
        templates()
          ? {
              title: template().label,
              meta: template().id,
              body: template().description,
              footer: template().command,
            }
          : examples()
            ? {
                title: selectedExample(props.state.exampleCursor).name,
                meta: selectedExample(props.state.exampleCursor).id,
                body: selectedExample(props.state.exampleCursor).description,
                footer: selectedExample(props.state.exampleCursor).command,
              }
            : current()
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
      {examples() ? (
        PLUGIN_EXAMPLES.map((entry, index) => (
          <ListRow
            theme={palette()}
            selected={index === props.state.exampleCursor}
            label={exampleRowLabel(entry)}
            value=""
            labelWidth={Math.max(24, Math.floor(props.width * 0.45))}
          />
        ))
      ) : templates() ? (
        PLUGIN_TEMPLATES.map((entry, index) => (
          <ListRow
            theme={palette()}
            selected={index === props.state.templateCursor}
            label={templateRowLabel(entry)}
            value=""
            labelWidth={Math.max(24, Math.floor(props.width * 0.45))}
          />
        ))
      ) : (
        <>
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
        </>
      )}
    </TwoColumnSurface>
  )
}
