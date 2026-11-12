/** Plugin settings surface, policy matrix and permission gate. */
import type { ThemePalette } from "../../theme"
import { WindowBody } from "../../panels/floating-window"
import { PanelWindow } from "../../panels/panel-window"
import { SelectList } from "../../panels/select-list"
import {
  cellLabel,
  footerHints,
  gateCopy,
  lockedReason,
  serverLine,
  standingNote,
  statusLabel,
  toolLine,
  type Command,
  type GateView,
  type ServerRow,
} from "./mcp-model"

const COMMANDS: Command[] = ["chill", "lockin", "flashcards", "study-guide", "skill"]

/** The named middle region of the Plugins window. */
export function PluginList(props: {
  theme: ThemePalette
  height: number
  servers: ServerRow[]
  cursor: number
  toolsOpen: boolean
}) {
  const palette = () => props.theme
  return (
    <WindowBody>
      {props.servers.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {"no servers configured · press a to add one and see the config it would write"}
        </text>
      ) : (
        <SelectList
          theme={palette()}
          cursor={props.cursor}
          visibleCount={Math.max(1, props.height - 10)}
          rows={props.servers.map((server) => ({
            id: server.name,
            label: serverLine(server),
            tone: typeof server.status === "object" ? "error" : "normal",
          }))}
        />
      )}

      {props.toolsOpen && props.servers[props.cursor] ? (
        <box flexDirection="column">
          {props.servers[props.cursor]!.tools.map((tool) => (
            <text fg={tool.write ? palette().warning : palette().muted} wrapMode="none">
              {toolLine(tool)}
            </text>
          ))}
        </box>
      ) : null}

      <text fg={palette().secondary} wrapMode="none">
        {"POLICY"}
      </text>
      {COMMANDS.map((command) => {
        const locked = lockedReason(command)
        return (
          <text fg={locked ? palette().muted : palette().foreground} wrapMode="none">
            {`${command.padEnd(11)}${props.servers.map((server) => cellLabel(command, server)).join("  ")}${locked ? `  · ${locked}` : ""}`}
          </text>
        )
      })}

      <text fg={palette().muted} wrapMode="none">
        {standingNote()}
      </text>
    </WindowBody>
  )
}

export function McpPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  servers: ServerRow[]
  cursor: number
  toolsOpen: boolean
}) {
  const palette = () => props.theme
  return (
    <PanelWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      title="MCP servers"
      meta={`${props.servers.filter((s) => s.enabled).length} of ${props.servers.length} enabled`}
      detail="MCP servers, the tools each one may call, and the policy that gates them."
      hints={footerHints().split(" · ")}
    >
      <PluginList
        theme={palette()}
        height={props.height}
        servers={props.servers}
        cursor={props.cursor}
        toolsOpen={props.toolsOpen}
      />
    </PanelWindow>
  )
}

export function PermissionGate(props: { theme: ThemePalette; width: number; height: number; view: GateView }) {
  const palette = () => props.theme
  if (!props.view.open) return <box />
  return (
    <box
      position="absolute"
      top={3}
      left={Math.floor(props.width * 0.1)}
      width={Math.floor(props.width * 0.8)}
      flexDirection="column"
      backgroundColor={palette().panel}
      paddingX={1}
    >
      <text fg={palette().warning} wrapMode="none">
        {"! plugin tool wants to run"}
      </text>
      {gateCopy(props.view).map((line) => (
        <text fg={palette().foreground} wrapMode="none">
          {`  ${line}`}
        </text>
      ))}
      <text fg={palette().muted} wrapMode="none">
        {"  every call asks; nothing is remembered"}
      </text>
    </box>
  )
}

/** Plugin output is labelled in every surface and never counted as a source. */
export function labelledOutput(server: string, text: string): string[] {
  return [`external explanation · ${server}`, text]
}

export { statusLabel }
