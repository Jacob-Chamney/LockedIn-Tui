/**
 * The MCP host as the shell sees it: start/stop configured servers, keep a
 * small cache of their tools, and expose them to a chat under the policy layer.
 *
 * **Write tools need a per-call gate.** They are offered only when a
 * `PluginWriteApprover` is supplied — either per `sourceFor` call or installed
 * on the runtime by `setWriteApproval`. Without one they are absent, which is
 * the safe default for a frontend with no approval surface. With one, every
 * write *call* asks again: nothing is remembered, no call is bulk-approved and a
 * denied call never reaches the server. The gate is a consent check, not a
 * sandbox: an approved tool may still have side effects of its own.
 */
import type { ChatMode } from "../../llm/chat"
import type { ToolResolver, ToolSpec } from "../../llm/tools"
import { decidePolicy, coreServersFor } from "../../mcp/policy"
import { createMcpHost, type McpHost } from "../../mcp/stdio"
import type { McpServerConfig, McpTool } from "../../mcp/types"
import type { ChatToolSource } from "./projects"

/** One write-capable plugin call, put to the user before it runs. */
export type PluginWriteRequest = {
  server: string
  tool: string
  input: Record<string, unknown>
}

/**
 * The per-call write gate.
 *
 * The answer is for this one call. A `false` answer (or a timeout, decided by
 * the caller) becomes a typed `permission` tool result; the plugin is not
 * called.
 */
export type PluginWriteApprover = (request: PluginWriteRequest) => Promise<boolean>

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
  /** Plugin tools for a mode; `explicitCall` is the `learning-web` opt-in. */
  sourceFor(
    mode: ChatMode,
    options?: {
      explicitCall?: boolean
      /**
       * The per-call gate for write tools. When absent, write tools are not
       * offered at all. The installed gate from `setWriteApproval` is the
       * fallback, so a chat built by boot gets the gate without changing its
       * call site.
       */
      approveWrite?: PluginWriteApprover
    },
  ): ChatToolSource | null
  /**
   * Install the process-wide per-call write gate.
   *
   * The Flutter core installs this once, after boot, so every chat controller
   * boot builds (Chill, session, work, skill) asks the shell through
   * `mcp.permission` before a write tool runs. `null` removes the gate and makes
   * write tools absent again.
   */
  setWriteApproval?(approveWrite: PluginWriteApprover | null): void
  dispose(): Promise<void>
}

export type PluginRuntimeOptions = {
  /**
   * Test seam: use this host instead of spawning stdio servers. Production
   * never passes one, so a real runtime always talks to the configured servers.
   */
  host?: McpHost
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
  options: PluginRuntimeOptions = {},
): PluginRuntime {
  const host: McpHost = options.host ?? createMcpHost(configs)
  const tools = new Map<string, McpTool[]>()
  const failures = new Map<string, string>()
  const byId = new Map(configs.map((config) => [config.id, config]))
  /**
   * The installed per-call gate. It is deliberately not a list of approved
   * calls: `sourceFor` consults it on every write call, so a run of write tools
   * asks once per call and nothing survives the call it approved.
   */
  let installedApproval: PluginWriteApprover | null = null

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
    sourceFor(mode, sourceOptions) {
      const explicitCall = sourceOptions?.explicitCall === true
      const approveWrite = sourceOptions?.approveWrite ?? installedApproval ?? undefined
      const entries: Array<{ id: string; tool: McpTool }> = []
      for (const config of configs) {
        const coreForMode = coreServersFor(mode).includes(config.id)
        if (config.enabled === false) continue
        if (!host.state(config.id).alive) continue
        for (const tool of tools.get(config.id) ?? []) {
          // Product invariant: Chill is read-only, so a write tool is never
          // offered there however the policy is configured or the gate set.
          if (!tool.readOnly && mode === "chill") continue
          // A write tool is offered only when a gate exists: without one there
          // is no approval surface, so the call could never be consented to.
          if (!tool.readOnly && approveWrite === undefined) continue
          const verdict = decidePolicy(mode, tool, {
            enabled: true,
            core: config.core === true || coreForMode,
            serverId: config.id,
            explicitCall,
          })
          // `off` and the mode rules win over any gate: a write tool the policy
          // refuses is never offered, so it can never be approved into running.
          if (verdict.kind === "deny") continue
          entries.push({ id: config.id, tool })
        }
      }
      if (entries.length === 0) return null

      const specs: ToolSpec[] = entries.map(({ id, tool }) => ({
        name: tool.name,
        description: `${tool.description} (external explanation)`,
        inputSchema: { type: "object", additionalProperties: true },
        side: "none",
        write: !tool.readOnly,
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
        if (verdict.kind === "deny") {
          return JSON.stringify({ ok: false, error: { ...verdict.error, server: entry.id } })
        }
        if (verdict.kind === "approval-required") {
          // The same write tool call, a fresh decision: no cache, no session
          // grant, no bulk approve. A missing gate here is a closed gate.
          if (approveWrite === undefined) {
            return JSON.stringify({ ok: false, error: { ...verdict.error, server: entry.id } })
          }
          let approved = false
          try {
            approved = await approveWrite({ server: entry.id, tool: entry.tool.name, input })
          } catch {
            approved = false
          }
          if (!approved) {
            return JSON.stringify({
              ok: false,
              error: { kind: "permission", message: "the user declined this plugin write" },
            })
          }
        }
        // The host runs the policy again, so the explicit opt-in must travel
        // with the call or a lock-in plugin is denied after being offered, and
        // a write call carries the one-call approval or the host denies it.
        const result = await host.call(entry.id, entry.tool.name, input, {
          mode,
          explicitCall,
          ...(entry.tool.readOnly ? {} : { approval: { granted: true } }),
        })
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
    setWriteApproval(approveWrite) {
      installedApproval = approveWrite
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
