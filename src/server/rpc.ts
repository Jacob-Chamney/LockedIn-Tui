import type { BootFailure } from "../app/boot";
import { stat } from "node:fs/promises";

export type RpcId = string | number | null;

/** The one refusal code for "this needs the app, and the app would not start". */
export const BOOT_FAILED = -32000;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: RpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: RpcId;
  result: Record<string, unknown>;
};

export type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: RpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
    /** False for a failure the shell must not silently re-send. */
    retryable?: boolean;
  };
};

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export function failure(
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
  retryable?: boolean,
): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
      ...(retryable === undefined ? {} : { retryable }),
    },
  };
}

export function success(id: RpcId, result: Record<string, unknown>): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One sentence: a boot message may carry newlines from a TOML parse error. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A path probe that treats every failure as "not there". */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Parse one line; malformed lines become a JSON-RPC parse error. */
export function parseRequest(line: string): JsonRpcRequest | JsonRpcFailure {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return failure(null, -32700, "Parse error");
  }
  if (!isRecord(value)) return failure(null, -32600, "Invalid Request");
  if (value.jsonrpc !== "2.0") return failure(null, -32600, "Invalid Request");

  const rawId = value.id;
  const id: RpcId | undefined =
    rawId === undefined ? undefined : rawId === null ? null : typeof rawId === "number" || typeof rawId === "string" ? rawId : undefined;
  if (rawId !== undefined && id === undefined) return failure(null, -32600, "Invalid Request");
  if (typeof value.method !== "string" || value.method.length === 0) {
    return failure(id ?? null, -32600, "Invalid Request");
  }
  const params = value.params;
  if (params !== undefined && !isRecord(params)) {
    return failure(id ?? null, -32602, "Invalid params");
  }

  const method = value.method;
  return {
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method,
    ...(params === undefined ? {} : { params }),
  };
}

/** Provider id from a `provider/model` name; `""` when the name has no slash. */
export function providerOf(model: string): string {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  return slash === -1 ? "" : trimmed.slice(0, slash);
}

export function invalid(id: RpcId, message: string): JsonRpcFailure {
  return failure(id, -32602, message);
}


/**
 * The one refusal for an app that will not start.
 *
 * The shell shows `message` and `next` and must not silently re-send the
 * request; restarting the core after the user acts is the only retry.
 */
export function bootFailureResponse(id: RpcId, boot: BootFailure): JsonRpcFailure {
  return failure(
    id,
    BOOT_FAILED,
    `LockedIn could not start: ${oneLine(boot.message)}`,
    { kind: "boot", path: boot.path, message: boot.message, next: boot.next },
    false,
  );
}
