import type { BootFailure, Booted } from "../app/boot";
import type { Result } from "../domain/markdown";
import type { OpenResult } from "../services/lockin/manager";
import type { Workspace } from "../storage/workspace";
import type { JsonRpcFailure, RpcId } from "./rpc";

/**
 * What a session handler needs from the core, and nothing more.
 *
 * `generate` is the one-shot completion a document or output build uses; it is
 * absent in a workspace with no linked model, which every caller reports as
 * "link a model in Settings → Providers".
 */
export type SessionServices = {
  workspace: Workspace;
  generate?: Booted["generate"];
};

/**
 * The two doors every extracted session handler uses: boot once, and resolve
 * one id.
 *
 * They are passed in rather than imported so a handler module can be driven
 * with a real workspace and no process — which is the reason for moving the
 * handlers out of `createCoreServer` at all.
 */
export type SessionHandlerContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  resolveSession: (
    id: RpcId,
    current: C,
    raw: unknown,
    field?: "id" | "sessionId",
  ) => Promise<{ error: JsonRpcFailure } | { opened: OpenResult }>;
};
