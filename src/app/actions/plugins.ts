/**
 * The MCP host as the shell sees it: start/stop configured servers, keep a
 * small cache of their tools, and expose the read-only ones to a chat.
 *
 * Write tools are deliberately not offered yet: the policy layer would answer
 * `approval-required`, and there is no approval surface in the shell, so the
 * safe first slice is read-only tools only.
 */
import type { ChatMode } from "../../llm/chat"
import type { ToolResolver, ToolSpec } from "../../llm/tools"
import { decidePolicy, coreServersFor } from "../../mcp/policy"
import { createMcpHost, type McpHost } from "../../mcp/stdio"
import type { McpServerConfig, McpTool } from "../../mcp/types"
import type { ChatToolSource } from "./projects"

export type PluginRow = {
  name: string
  transport: "stdio"
  enabled: boolean
  status: "connected" | "stopped" | { failed: string }
  tools: Array<{ name: string; write: boolean }>
}

export type PluginRuntime = {
  rows(): PluginRow[]
  start(): Promise<void>
  refresh(): Promise<PluginRow[]>
  connect(id: string): Promise<PluginRow[]>
  close(id: string): Promise<PluginRow[]>
  setEnabled(id: string, enabled: boolean): Promise<PluginRow[]>
  /** Read-only plugin tools for a mode; `explicitCall` is the `learning-web` opt-in. */
  sourceFor(mode: ChatMode, options?: { explicitCall?: boolean }): ChatToolSource | null
  dispose(): Promise<void>
}

function rowFor(
  config: McpServerConfig,
  alive: boolean,
  tools: readonly McpTool[],
  failure?: string,
): PluginRow {
  return {
    name: config.id,
    transport: "stdio",
    enabled: config.enabled !== false,
    status: failure !== undefined ? { failed: failure } : alive ? "connected" : "stopped",
    tools: tools.map((tool) => ({ name: tool.name, write: !tool.readOnly })),
  }
}

/** A server is the web-search core plugin, whatever its display name. */
function isWebServer(id: string): boolean {
  return coreServersFor("skill").includes(id)
}

export function createPluginRuntime(
  configs: readonly McpServerConfig[],
): PluginRuntime {
  const host: McpHost = createMcpHost(configs)
  const tools = new Map<string, McpTool[]>()
  const failures = new Map<string, string>()
  const byId = new Map(configs.map((config) => [config.id, config]))

  const rows = (): PluginRow[] =>
    configs.map((config) =>
      rowFor(
        config,
        host.state(config.id).alive,
        tools.get(config.id) ?? [],
        failures.get(config.id),
      ),
    )

  const load = async (id: string): Promise<void> => {
    failures.delete(id)
    const connected = await host.connect(id)
    if (!connected.ok) {
      failures.set(id, connected.error.message)
      return
    }
    const listed = await host.listTools(id)
    if (!listed.ok) {
      failures.set(id, listed.error.message)
      return
    }
    tools.set(id, listed.value)
  }

  const refresh = async (): Promise<PluginRow[]> => {
    for (const config of configs) {
      if (config.enabled === false) continue
      await load(config.id)
    }
    return rows()
  }

  return {
    rows,
    async start() {
      await refresh()
    },
    refresh,
    async connect(id) {
      await load(id)
      return rows()
    },
    async close(id) {
      await host.close(id)
      tools.delete(id)
      failures.delete(id)
      return rows()
    },
    async setEnabled(id, enabled) {
      const config = byId.get(id)
      if (!config) return rows()
      config.enabled = enabled
      if (!enabled) await host.close(id)
      else await load(id)
      return rows()
    },
    sourceFor(mode, options) {
      const explicitCall = options?.explicitCall === true
      const entries: Array<{ id: string; tool: McpTool }> = []
      for (const config of configs) {
        const coreForMode = coreServersFor(mode).includes(config.id)
        if (config.enabled === false) continue
        if (!host.state(config.id).alive) continue
        for (const tool of tools.get(config.id) ?? []) {
          // Read-only only: a write tool needs the approval surface (P-29).
          if (!tool.readOnly) continue
          const verdict = decidePolicy(mode, tool, {
            enabled: true,
            core: config.core === true || coreForMode,
            serverId: config.id,
            explicitCall,
          })
          if (verdict.kind === "allow") entries.push({ id: config.id, tool })
        }
      }
      if (entries.length === 0) return null

      const specs: ToolSpec[] = entries.map(({ id, tool }) => ({
        name: tool.name,
        description: `${tool.description} (external explanation)`,
        inputSchema: { type: "object", additionalProperties: true },
        side: "none",
        write: false,
        command: false,
        // The core web server's tools are the ones a learning chat hides
        // unless the user opted in with `learning-web`.
        ...(isWebServer(id) ? { web: true } : {}),
      }))
      const resolveTool: ToolResolver = async (name, input) => {
        const entry = entries.find((candidate) => candidate.tool.name === name)
        if (!entry) return JSON.stringify({ ok: false, error: { kind: "unavailable", message: `unknown plugin tool "${name}"` } })
        const config = byId.get(entry.id)
        const verdict = decidePolicy(mode, entry.tool, {
          enabled: config?.enabled !== false,
          core: config?.core === true || coreServersFor(mode).includes(entry.id),
          serverId: entry.id,
          explicitCall,
        })
        if (verdict.kind !== "allow") {
          return JSON.stringify({ ok: false, error: { ...verdict.error, server: entry.id } })
        }
        // The host runs the policy again, so the explicit opt-in must travel
        // with the call or a lock-in plugin is denied after being offered.
        const result = await host.call(entry.id, entry.tool.name, input, { mode, explicitCall })
        return result.ok
          ? result.value.text
          : JSON.stringify({ ok: false, error: { ...result.error, server: entry.id } })
      }
      return {
        specs,
        dynamicSpecs: () => specs,
        resolveTool,
        context: async () => "",
      }
    },
    async dispose() {
      await host.close()
    },
  }
}

/** Merge two optional tool sources; a duplicate name keeps the first source. */
export function mergeToolSources(
  first: ChatToolSource | null,
  second: ChatToolSource | null,
): ChatToolSource | null {
  if (first === null) return second
  if (second === null) return first
  const specs = [...first.specs, ...second.specs.filter((spec) => !first.specs.some((entry) => entry.name === spec.name))]
  return {
    specs,
    dynamicSpecs: () => specs,
    resolveTool: async (name, input) =>
      first.specs.some((spec) => spec.name === name)
        ? first.resolveTool(name, input)
        : second.resolveTool(name, input),
    context: async () => [await first.context(), await second.context()].filter(Boolean).join("\n\n"),
  }
}
