import type { SettingsView } from "../types/settings";
import {
  RANGES,
  SCOPES,
  type StatsExportFormat,
  type StatsRange,
  type StatsScope,
  type StatsSummary,
} from "../stats/types";
import type { AchievementSnapshot } from "../app/actions/achievements";
import {
  ACHIEVEMENTS,
  achievementUnlocked,
  achievementValue,
  difficultyLabel,
} from "../domain/achievements";

/** The export formats the stats service can write (`src/stats/types.ts`). */
const STATS_EXPORT_FORMATS: readonly StatsExportFormat[] = ["md", "csv"];
import type { SessionHandlerContext, SessionServices } from "./session-context";
import { addSessionSources } from "../app/actions/lockin";
import { loadSessionRows } from "../app/actions/sessions";
import { loadAchievementSnapshot } from "../app/actions/achievements";
import { createStatsService } from "../stats/summary";
import { sourceRows } from "./views";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  messageOf,
  oneLine,
  providerOf,
  success,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

function isRange(value: unknown): value is StatsRange {
  return typeof value === "string" && (RANGES as readonly string[]).includes(value);
}

function isScope(value: unknown): value is StatsScope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

function isExportFormat(value: unknown): value is StatsExportFormat {
  return typeof value === "string" && (STATS_EXPORT_FORMATS as readonly string[]).includes(value);
}

/** What a read-projection handler needs from the core. */
export type WorkspaceReadContext<C extends SessionServices> = SessionHandlerContext<C> & {
  /** The settings in force, including an uncommitted patch. */
  settingsView: (current: C) => SettingsView;
};

/**
 * The workspace, session-list, stats, achievements and source projections
 * (`desktop/docs/protocol.md`).
 *
 * Everything here is a projection over state other modules already own: the
 * shell renders what it receives and never re-derives a total. `source.add` is
 * the one write, and its paths are user-picked sources, never destinations.
 */
export function createWorkspaceReadHandlers<C extends SessionServices>(
  ctx: WorkspaceReadContext<C>,
): {
  handlers: {
    workspaceInfo: (id: RpcId) => Promise<JsonRpcResponse>;
    sessionList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    statsSummary: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    statsExport: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    achievementsList: (id: RpcId) => Promise<JsonRpcResponse>;
    sourceList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sourceAdd: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
} {
  const { services, resolveSession, settingsView } = ctx;

  const sourceList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.sessionId, "sessionId");
    if ("error" in resolved) return resolved.error;
    return success(id, { sources: sourceRows(resolved.opened.session) });
  };

  /**
   * Copy user-picked files into one session's `sources/`.
   *
   * The paths are the user's files, never a destination: the manager copies
   * them under `sources/`, de-duplicates by hash and refuses anything that
   * belongs to the skills side. A path that cannot be copied is one typed
   * failure — nothing half-written survives.
   */
  const sourceAdd = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const sessionId = params.sessionId;
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      return invalid(id, "source.add requires a session id");
    }
    const paths = params.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      return invalid(id, "source.add requires a non-empty array of file paths");
    }
    if (!paths.every((path) => typeof path === "string" && path.trim() !== "")) {
      return invalid(id, "source.add: every entry in paths must be a non-empty string");
    }
    const files = paths as string[];

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // Resolve first so an unknown id is a session error naming the id, not a
    // generic copy failure. The manager then copies into that session only.
    const resolved = await resolveSession(id, current.value, sessionId, "sessionId");
    if ("error" in resolved) return resolved.error;
    const added = await addSessionSources({
      workspace: current.value.workspace,
      id: resolved.opened.session.id,
      files,
    });
    if (!added.ok) {
      const resolvedId = resolved.opened.session.id;
      const message = oneLine(added.error.message);
      return failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "source", sessionId: resolvedId, message },
        false,
      );
    }
    return success(id, { added: added.value.added, skipped: added.value.skipped });
  };


  const workspaceInfo = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const view = settingsView(current.value);
    const model = view.chatModel.trim();
    return success(id, {
      path: current.value.workspace.root,
      dataDir: view.dataDir,
      configured: model !== "",
      model,
      provider: providerOf(model),
    });
  };

  const sessionList = async (id: RpcId, params: Record<string, unknown>): Promise<JsonRpcResponse> => {
    const query = params.query;
    if (query !== undefined && typeof query !== "string") {
      return invalid(id, `session.list: query must be a string, not ${typeof query}`);
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const rows = await loadSessionRows(current.value.workspace);
    const needle = (query ?? "").trim().toLowerCase();
    const sessions =
      needle === ""
        ? rows
        : rows.filter(
            (row) => row.id.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle),
          );
    return success(id, { sessions });
  };

  const statsSummary = async (id: RpcId, params: Record<string, unknown>): Promise<JsonRpcResponse> => {
    const { range, scope } = params;
    if (range === undefined || scope === undefined) {
      return invalid(
        id,
        `stats.summary requires range (${RANGES.join(", ")}) and scope (${SCOPES.join(", ")})`,
      );
    }
    if (!isRange(range)) {
      return invalid(
        id,
        `stats.summary: unknown range ${JSON.stringify(range)}; expected one of ${RANGES.join(", ")}`,
      );
    }
    if (!isScope(scope)) {
      return invalid(
        id,
        `stats.summary: unknown scope ${JSON.stringify(scope)}; expected one of ${SCOPES.join(", ")}`,
      );
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const service = createStatsService({ dir: current.value.settings.dataDir });
    const summary: StatsSummary = await service.summary(range, scope);
    return success(id, summary as unknown as Record<string, unknown>);
  };

  /**
   * Stats as a document the shell can save or copy (`docs/product.md` §6.1).
   *
   * The core returns text, never a path: writing a file is the shell's job, so
   * this method cannot touch the filesystem and the selection of where the
   * export goes stays in the UI. `range` and `scope` are validated exactly as
   * `stats.summary`, so a view that can be shown can always be exported. `format`
   * is optional and defaults to `md`; the reply repeats it so the shell can pick
   * an extension and the "estimates, not a bill" caveat stays attached to the
   * numbers (the Markdown carries that line itself).
   */
  const statsExport = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const { range, scope } = params;
    if (range === undefined || scope === undefined) {
      return invalid(
        id,
        `stats.export requires range (${RANGES.join(", ")}) and scope (${SCOPES.join(", ")})`,
      );
    }
    if (!isRange(range)) {
      return invalid(
        id,
        `stats.export: unknown range ${JSON.stringify(range)}; expected one of ${RANGES.join(", ")}`,
      );
    }
    if (!isScope(scope)) {
      return invalid(
        id,
        `stats.export: unknown scope ${JSON.stringify(scope)}; expected one of ${SCOPES.join(", ")}`,
      );
    }
    const rawFormat = params.format;
    if (rawFormat !== undefined && !isExportFormat(rawFormat)) {
      return invalid(
        id,
        `stats.export: unknown format ${JSON.stringify(rawFormat)}; expected one of ${STATS_EXPORT_FORMATS.join(", ")}`,
      );
    }
    // Optional with a default: an omitted format is Markdown, not a refusal.
    const format: StatsExportFormat = rawFormat ?? "md";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    try {
      const service = createStatsService({ dir: current.value.settings.dataDir });
      const text = await service.export(range, scope, format);
      return success(id, { text, format });
    } catch (error) {
      // The readers tolerate a missing or corrupt counter file, so this is a
      // genuine failure (unexpected IO). It is reported once and never retried.
      const message = oneLine(messageOf(error));
      return failure(id, BOOT_FAILED, message, { kind: "stats", message }, false);
    }
  };

  /**
   * The achievements inventory (`docs/product.md` §2.2, Explorer → Achievements).
   *
   * One row per catalogue entry, in catalogue order, carrying the counter the
   * achievement measures, the clamped bar value and the raw `progress`. This is
   * the **one read that can write**: `loadAchievementSnapshot` records the UTC
   * day each achievement was first seen unlocked in
   * `<dataDir>/achievements.json`. That file lives in the platform data
   * directory, never in the workspace, and a write failure only costs the award
   * dates — it never fails the reply.
   *
   * `warning` is the snapshot's own sentence about an unreadable awards file: a
   * note beside the rows, not an error. A read failure is one `-32000` with
   * `data.kind: "achievements"` and `retryable: false`. The method takes no
   * parameters, so it never answers `-32602`.
   *
   * Dev and test builds unlock the whole catalogue on purpose
   * (`UNLOCK_ALL_ACHIEVEMENTS` in `src/domain/achievements.ts`); a release build
   * lets the counters decide. Both shapes are the domain's rule, not this
   * handler's, so the rows and `earned` always agree.
   */
  const achievementsList = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const view = settingsView(current.value);
    let snapshot: AchievementSnapshot;
    try {
      snapshot = await loadAchievementSnapshot({
        dataDir: view.dataDir,
        workspace: current.value.workspace,
      });
    } catch (error) {
      // The snapshot tolerates a missing awards file, a corrupt one and any
      // unreadable session or project folder, so this is a genuine failure.
      const message = oneLine(messageOf(error));
      return failure(id, BOOT_FAILED, message, { kind: "achievements", message }, false);
    }
    const achievements = ACHIEVEMENTS.map((achievement) => {
      const progress = achievementValue(achievement, snapshot.metrics);
      const unlocked = achievementUnlocked(achievement, snapshot.metrics);
      const awardedAt = snapshot.awards[achievement.id];
      return {
        id: achievement.id,
        name: achievement.name,
        task: achievement.task,
        category: achievement.category,
        metric: achievement.metric,
        target: achievement.target,
        // `value` fills the bar (clamped); `progress` is the raw counter.
        value: Math.min(achievement.target, progress),
        progress,
        unlocked,
        difficulty: difficultyLabel(achievement.target),
        ...(awardedAt === undefined ? {} : { awardedAt }),
      };
    });
    return success(id, {
      achievements,
      earned: achievements.filter((row) => row.unlocked).length,
      total: achievements.length,
      warning: snapshot.warning,
    });
  };
  return {
    handlers: {
      workspaceInfo,
      sessionList,
      statsSummary,
      statsExport,
      achievementsList,
      sourceList,
      sourceAdd,
    },
  };
}
