/**
 * Stdio MCP client (`docs/architecture.md` §4.6, `docs/product.md` §11).
 *
 * Promoted from the S6 spike, with the spike's findings applied:
 *
 *   - stderr is **piped**, never inherited: the SDK's default (`inherit`) would
 *     print plugin output into the terminal and any captured log;
 *   - annotations are optional, so "no `readOnlyHint`" is treated as
 *     write-capable (fail closed) by the policy layer;
 *   - a crash rejects the pending call, so `onclose` must mark the server dead
 *     or the UI cannot tell "crashed" from "returned an error";
 *   - both a signal and a timeout are passed, so `Esc` works and a wedged
 *     server cannot hang the UI.
 *
 * LockedIn does not install plugin dependencies: a missing command is a typed
 * `unavailable` error, never a prompt to run a package manager.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { APP_VERSION } from "../version"
import { decidePolicy } from "./policy"
import {
  EXTERNAL_LABEL,
  pluginError,
  type CallOptions,
  type PluginCallResult,
  type PluginErrorKind,
  type PluginResult,
  type McpServerConfig,
  type McpTool,
  type ServerState,
} from "./types"

const DEFAULT_TIMEOUT_MS = 8_000
const CONNECT_TIMEOUT_MS = 8_000
const STDERR_LINES = 200

export type McpHostOptions = {
  /** Clock seam for tests. */
  now?: () => number
}

export type McpHost = {
  connect(id: string): Promise<PluginResult<ServerState>>
  listTools(id: string): Promise<PluginResult<McpTool[]>>
  call(id: string, tool: string, input: Record<string, unknown>, options: CallOptions): Promise<PluginResult<PluginCallResult>>
  close(id?: string): Promise<void>
  state(id: string): ServerState
  pidOf(id: string): number | null
  /** Bounded stderr ring buffer, for diagnostics only. */
  stderrOf(id: string): string[]
  /** Configured servers, for Settings → Plugins. */
  servers(): readonly McpServerConfig[]
}

function fail(kind: PluginErrorKind, server: string, message: string, hint: string): PluginResult<never> {
  return { ok: false, error: pluginError(kind, server, message, hint) }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function createMcpHost(configs: readonly McpServerConfig[]): McpHost {
  const clients = new Map<string, Client>()
  const transports = new Map<string, StdioClientTransport>()
  const pids = new Map<string, number | null>()
  const stderr = new Map<string, string[]>()
  const calls = new Map<string, number>()
  const dead = new Set<string>()
  const known = new Map(configs.map((config) => [config.id, config]))

  const state = (id: string): ServerState => ({
    id,
    pid: pids.get(id) ?? null,
    alive: clients.has(id) && !dead.has(id),
    calls: calls.get(id) ?? 0,
    stderr: [...(stderr.get(id) ?? [])],
  })

  /**
   * List one server's tools.
   *
   * A closed-over function, not `this.listTools`: the host is often passed
   * around as a value, and a destructured `call` must still work.
   */
  const listToolsFor = async (id: string): Promise<PluginResult<McpTool[]>> => {
    const client = clients.get(id)
    if (!client) return fail("unavailable", id, `Plugin server "${id}" is not connected.`, "Connect it first.")
    try {
      const result = await withTimeout(client.listTools(), DEFAULT_TIMEOUT_MS, () => new Error("listTools timed out"))
      return {
        ok: true,
        value: result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          // Fail closed: only an explicit readOnlyHint makes a tool read-only.
          readOnly: tool.annotations?.readOnlyHint === true,
          destructive: tool.annotations?.destructiveHint === true,
          label: EXTERNAL_LABEL,
        })),
      }
    } catch (err) {
      return fail("plugin", id, `Could not list tools: ${(err as Error).message}`, "Restart the server in Settings → Plugins.")
    }
  }

  return {
    servers: () => configs,

    state,
    pidOf: (id) => pids.get(id) ?? null,
    stderrOf: (id) => [...(stderr.get(id) ?? [])],

    async connect(id) {
      const config = known.get(id)
      if (!config) {
        return fail("unavailable", id, `Unknown plugin server "${id}".`, "Configure it in Settings → Plugins.")
      }

      const existing = clients.get(id)
      if (existing && !dead.has(id)) return { ok: true, value: state(id) }

      // A missing command is the most common setup failure; say so precisely.
      if (!config.command.trim() || Bun.which(config.command) === null) {
        return fail(
          "unavailable",
          id,
          `The plugin server "${id}" needs "${config.command}", which is not installed.`,
          "Install it yourself; LockedIn never installs plugin dependencies.",
        )
      }

      // Load the SDK only when a server is actually started. A build with no
      // configured plugins must not pay the module cost on its first frame.
      const [{ Client }, { StdioClientTransport, getDefaultEnvironment }] = await Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js"),
        import("@modelcontextprotocol/sdk/client/stdio.js"),
      ])

      const lines: string[] = []
      stderr.set(id, lines)
      calls.set(id, 0)

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...getDefaultEnvironment(), ...config.env },
        // Capture, never inherit (S6 surprise 1).
        stderr: "pipe",
      })
      transport.stderr?.on("data", (buffer: Buffer) => {
        for (const line of buffer.toString().split("\n")) {
          if (line.trim()) lines.push(line.trim())
          if (lines.length > STDERR_LINES) lines.shift()
        }
      })

      const client = new Client({ name: "lockedin", version: APP_VERSION }, { capabilities: {} })
      client.onclose = () => dead.add(id)

      try {
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, () =>
          new Error(`connect timed out after ${CONNECT_TIMEOUT_MS} ms`),
        )
      } catch (err) {
        await client.close().catch(() => {})
        return fail(
          "plugin",
          id,
          `The plugin server "${id}" did not start: ${(err as Error).message}`,
          "Check the command and its arguments in Settings → Plugins.",
        )
      }

      clients.set(id, client)
      transports.set(id, transport)
      pids.set(id, transport.pid ?? null)
      dead.delete(id)
      return { ok: true, value: state(id) }
    },

    listTools: listToolsFor,

    async call(id, toolName, input, options) {
      const client = clients.get(id)
      if (!client) return fail("unavailable", id, `Plugin server "${id}" is not connected.`, "Connect it first.")

      const config = known.get(id)
      const tools = await listToolsFor(id)
      if (!tools.ok) return tools
      const tool = tools.value.find((candidate) => candidate.name === toolName)
      if (!tool) return fail("unavailable", id, `Unknown plugin tool "${toolName}".`, "Refresh the plugin's tool list.")

      // The gate runs before anything is sent: a denied call never reaches the
      // server, which the stderr transcript proves.
      const verdict = decidePolicy(options.mode, tool, {
        enabled: config?.enabled !== false,
        core: config?.core === true,
        serverId: id,
        ...(options.explicitCall === undefined ? {} : { explicitCall: options.explicitCall }),
        ...(options.approval === undefined ? {} : { approval: options.approval }),
      })
      if (verdict.kind !== "allow") return { ok: false, error: { ...verdict.error, server: id } }

      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      options.signal?.addEventListener("abort", onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const started = Date.now()
      calls.set(id, (calls.get(id) ?? 0) + 1)

      try {
        const result = await client.callTool({ name: toolName, arguments: input }, undefined, {
          signal: controller.signal,
          timeout: timeoutMs,
        })
        const content = Array.isArray(result.content) ? result.content : []
        const text = content
          .map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : ""))
          .join("")
        return {
          ok: true,
          value: { text, isError: Boolean(result.isError), ms: Date.now() - started, label: EXTERNAL_LABEL },
        }
      } catch (err) {
        if (dead.has(id)) {
          return fail("plugin", id, `The plugin server "${id}" exited during the call.`, "Restart it or disable the server.")
        }
        if (options.signal?.aborted) return fail("cancelled", id, "Plugin call cancelled.", "Nothing was saved.")
        if (controller.signal.aborted) {
          return fail("timeout", id, `Plugin call timed out after ${timeoutMs} ms.`, "The server may be stuck; restart it.")
        }
        return fail("plugin", id, `Plugin call failed: ${(err as Error).message}`, "The plugin server returned an error.")
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", onAbort)
      }
    },

    async close(id) {
      const targets = id ? [id] : [...clients.keys()]
      for (const target of targets) {
        const client = clients.get(target)
        try {
          await client?.close()
        } catch {
          // closing a dead server is fine
        }
        clients.delete(target)
        transports.delete(target)
        dead.add(target)
        const pid = pids.get(target)
        if (pid) await waitForExit(pid, 2_000)
      }
    },
  }
}

/** Resolve when the pid is gone, or after `ms`. Never throws. */
export async function waitForExit(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !pidAlive(pid)
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
