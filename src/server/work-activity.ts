import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { SessionServices } from "./session-context";
import {
  ACTIVITY_KINDS,
  createActivityLog,
  type ActivityKind,
  type ActivityLog,
  type ActivityRecord,
} from "../services/work/activity";
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

/**
 * The Work activity log (`docs/product.md` §8.5, `docs/data-model.md` §6.3).
 *
 * One process-wide log, opened on first use. Metadata only: the reply is the
 * records themselves, never the log's absolute path and never a file body. A
 * failed write is dropped silently — a decision is final whether or not it
 * could be recorded.
 */
function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === "string" && (ACTIVITY_KINDS as readonly string[]).includes(value);
}

export function createWorkActivityHandlers<C extends SessionServices>(ctx: {
  services: () => Promise<Result<C, BootFailure>>;
  dataDir: (current: C) => string;
}): {
  activitySink: (current: C) => ((record: ActivityRecord) => Promise<void>) | undefined;
  activityList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
} {
  const { services, dataDir } = ctx;

  let activityLog: ActivityLog | null = null;

  /** The activity log for this process, or the one-line reason it cannot exist. */
  const activityFor = (current: C): ActivityLog | { message: string } => {
    if (activityLog !== null) return activityLog;
    const created = createActivityLog(current.workspace, { dataDir: dataDir(current) });
    if (!created.ok) return { message: oneLine(created.error.message) };
    activityLog = created.value;
    return activityLog;
  };

  /** The best-effort sink the write, command and swarm services append through. */
  const activitySink = (current: C): ((record: ActivityRecord) => Promise<void>) | undefined => {
    const log = activityFor(current);
    if ("message" in log) return undefined;
    return (record) => log.append(record).then(() => undefined);
  };

  /** One typed activity refusal; the log's absolute path never crosses the wire. */
  const activityFailure = (id: RpcId, message: string): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "activity", message }, false);

  /**
   * Read the Work activity log (`docs/product.md` §8.5).
   *
   * Metadata only: the reply is the records themselves, never the log's
   * absolute path and never a file body. An absent file is an empty list, a
   * corrupt line is counted in `skipped`, and the readable records are returned
   * regardless. `kind` and `project` filter in the service so the shell cannot
   * re-derive a different answer.
   */
  const activityList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawKind = params.kind;
    if (rawKind !== undefined && !isActivityKind(rawKind)) {
      return invalid(
        id,
        `activity.list: unknown kind ${JSON.stringify(rawKind)}; expected one of ${ACTIVITY_KINDS.join(", ")}`,
      );
    }
    const rawProject = params.project;
    if (rawProject !== undefined && (typeof rawProject !== "string" || rawProject.trim() === "")) {
      return invalid(id, "activity.list: project must be a project id");
    }
    const rawLimit = params.limit;
    if (rawLimit !== undefined) {
      if (
        typeof rawLimit !== "number" ||
        !Number.isInteger(rawLimit) ||
        rawLimit < 1 ||
        rawLimit > 500
      ) {
        return invalid(id, "activity.list: limit must be a whole number from 1 to 500");
      }
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const log = activityFor(current.value);
    if ("message" in log) return activityFailure(id, log.message);

    const listed = await log.list({
      ...(rawKind === undefined ? {} : { kind: rawKind }),
      ...(rawProject === undefined ? {} : { project: rawProject.trim() }),
      ...(rawLimit === undefined ? {} : { limit: rawLimit }),
    });
    if (!listed.ok) return activityFailure(id, oneLine(listed.error.message));

    // The record list is the whole reply: `path` stays on the core side, and a
    // record only ever carries metadata, so no absolute path or file body can
    // escape through this method.
    return success(id, {
      records: listed.value.records,
      skipped: listed.value.skipped,
      empty: listed.value.empty,
    });
  };


  return { activitySink, activityList };
}
