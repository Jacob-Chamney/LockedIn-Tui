import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { PluginCommand, PluginPolicy, PluginPolicyCell } from "../storage/config-schema";
import type { PluginRow } from "../app/actions/plugins";
import type { SessionServices } from "./session-context";
import {
  NEVER_PLUGIN_COMMANDS,
  PLUGIN_COMMANDS,
  PLUGIN_POLICY_VALUES,
} from "../storage/config-schema";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** What the MCP surface needs from the core. */
export type McpHandlerContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  /** The stored policy matrix, with a post-write override winning. */
  policy: (current: C) => PluginPolicy;
  setPolicy: (policy: PluginPolicy) => void;
  /** Answer one pending write prompt; unknown ids are a benign no-op. */
  resolvePermission: (requestId: string, allow: boolean) => void;
};

/**
 * The MCP surface: what is configured, never what it runs with, and never a
 * credential (`docs/product.md` §11).
 *
 * Only `mcp.policy.set` writes, and it writes configuration only. Tool output
 * obtained through a plugin is labelled **external explanation** and never
 * counts as a source; this list carries tool *names* only.
 */
export function createMcpHandlers<C extends SessionServices>(
  ctx: McpHandlerContext<C>,
): {
  handlers: {
    mcpList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    mcpRefresh: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    mcpPolicyGet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    mcpPolicySet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    mcpConfirm: (id: RpcId, params: Record<string, unknown>) => JsonRpcResponse;
  };
} {
  const { services, policy, setPolicy, resolvePermission } = ctx;



  const mcpUnavailable = (id: RpcId): JsonRpcFailure =>
    failure(id, -32601, "The plugin host is not available in this build", undefined, false);

  const mcpConfirm = (id: RpcId, params: Record<string, unknown>): JsonRpcResponse => {
    const rawRequestId = params.requestId;
    if (typeof rawRequestId !== "string" || rawRequestId.trim() === "") {
      return invalid(id, "mcp.confirm requires a requestId");
    }
    const allow = params.allow;
    if (typeof allow !== "boolean") {
      return invalid(id, "mcp.confirm: allow must be true or false");
    }
    // Consume the prompt: one answer, one call. A late answer has nothing left
    // to resolve and is still a success, never a replay of the tool call.
    resolvePermission(rawRequestId, allow);
    return success(id, { ok: true });
  };

  const mcpList = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const runtime = current.value.pluginRuntime;
    if (!runtime) return mcpUnavailable(id);
    const servers: PluginRow[] = runtime.rows();
    return success(id, { servers, policy: policy(current.value) });
  };

  const mcpRefresh = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const runtime = current.value.pluginRuntime;
    if (!runtime) return mcpUnavailable(id);
    // Explicit only: this may connect every enabled stdio server. A failure is
    // recorded on that server's row, never as a retry or a second attempt.
    const servers: PluginRow[] = await runtime.refresh();
    return success(id, { servers });
  };

  const mcpPolicyGet = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    return success(id, { policy: policy(current.value) });
  };

  /**
   * Write one policy cell for one command and server (`docs/product.md` §11).
   *
   * Validation happens before the boot so a malformed request never opens a
   * workspace. The cell's server must already be configured in
   * `plugins.servers` (or appear in the stored matrix): a cell for a server that
   * does not exist is a typo, not a policy, and silently storing it would make
   * the matrix claim a capability the app cannot have.
   *
   * `on` is refused for the two generation commands with the same copy the
   * config loader uses, so a hand-edited cell and a Settings click cannot
   * disagree about a rule that is a product invariant rather than a preference.
   */
  const mcpPolicySet = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawCommand = params.command;
    if (
      typeof rawCommand !== "string" ||
      !(PLUGIN_COMMANDS as readonly string[]).includes(rawCommand)
    ) {
      return invalid(
        id,
        `mcp.policy.set: unknown command ${JSON.stringify(rawCommand)}; expected one of ${PLUGIN_COMMANDS.join(", ")}`,
      );
    }
    const command = rawCommand as PluginCommand;

    const rawServer = params.server;
    if (typeof rawServer !== "string" || rawServer.trim() === "") {
      return invalid(id, "mcp.policy.set requires a non-empty server name");
    }
    const server = rawServer.trim();

    const rawValue = params.value;
    if (
      typeof rawValue !== "string" ||
      !(PLUGIN_POLICY_VALUES as readonly string[]).includes(rawValue)
    ) {
      return invalid(
        id,
        `mcp.policy.set: unknown value ${JSON.stringify(rawValue)}; expected one of ${PLUGIN_POLICY_VALUES.join(", ")}`,
      );
    }
    const value = rawValue as PluginPolicyCell;

    if (value === "on" && (NEVER_PLUGIN_COMMANDS as readonly string[]).includes(command)) {
      return invalid(
        id,
        `${command} never calls plugins, so plugins.policy.${command}.${server} cannot be "on". Set it to "off"; this command never calls a plugin.`,
      );
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    const knownServers = new Set(Object.keys(current.value.config?.plugins.servers ?? {}));
    for (const row of Object.values(policy(current.value))) {
      for (const name of Object.keys(row)) knownServers.add(name);
    }
    if (!knownServers.has(server)) {
      const message = `no MCP server named “${server}” is configured; add it in Settings → Plugins`;
      return failure(id, BOOT_FAILED, message, { kind: "plugin", command, server, message }, false);
    }

    if (!current.value.savePolicy) {
      return failure(
        id,
        -32601,
        "MCP policy editing is not available in this build",
        undefined,
        false,
      );
    }
    const saved = await current.value.savePolicy({ command, server, value });
    if (!saved.ok) {
      const message = oneLine(saved.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "config", message }, false);
    }
    // The stored matrix is the truth, not our guess at the merged cell: a
    // config write is the only place the value can land.
    setPolicy(saved.value);
    return success(id, { policy: saved.value });
  };
  return {
    handlers: { mcpList, mcpRefresh, mcpPolicyGet, mcpPolicySet, mcpConfirm },
  };
}
