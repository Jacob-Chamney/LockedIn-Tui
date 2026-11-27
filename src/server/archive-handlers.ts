import { basename, join, resolve, sep } from "node:path";

import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { SettingsView } from "../types/settings";
import type { SessionHandlerContext, SessionServices } from "./session-context";
import type { ArchiveRef } from "../archive/types";
import { pathExists } from "./rpc";
import {
  goalFolderFor,
  readMeta as readGoalMeta,
  writeMeta as writeGoalMeta,
} from "../services/skills/progress";
import { readFile, rm } from "node:fs/promises";
import { SESSION_FILES, sessionFromMeta } from "../domain/session";
import { messageOf } from "./rpc";
import { writeMeta as writeSessionMeta } from "../services/lockin/manager";
import { sessionFolderFor } from "../services/lockin/manager";
import type { SessionAction } from "../app/actions/archive";
import { loadArchiveRows, runSessionAction } from "../app/actions/archive";
import { restoreSession } from "../services/lockin/archive";
import { resolveArchiveBackend } from "./archive-backend";
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
 * Normalise a session folder a **remote** backend just restored.
 *
 * The GitHub adapter copies files down; it does not know the session's metadata
 * rules. A restored session must be live: `archived: false`, no
 * `chat_archived` claim, and no `chat.jsonl` even if a remote copy held one.
 * The session's own files are left alone.
 */
async function normaliseRestoredSession(
  folder: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(folder, SESSION_FILES.meta), "utf8"));
    const parsed = sessionFromMeta(raw);
    if (!parsed.ok) return { ok: false, message: parsed.error.message };
    await writeSessionMeta(folder, { ...parsed.value, archived: false });
    await rm(join(folder, SESSION_FILES.chat), { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}



/** What the archive surface needs from the core. */
export type ArchiveHandlerContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  settingsView: (current: C) => SettingsView;
  /** Drop one cached session chat before its folder moves or disappears. */
  dropSessionChat: (sessionId: string) => void;
  resolveSession: SessionHandlerContext<C>["resolveSession"];
};

/**
 * The archive surface: the picker's read, restore and delete, plus the session
 * manager's archive/delete/export verbs (`docs/product.md` §4.4, §9).
 *
 * The backend is **configuration, never a parameter**: a folder archive needs a
 * folder and a GitHub archive needs a working, private backend. With neither
 * the refusal happens before the item is read, and nothing is moved.
 */
export function createArchiveHandlers<C extends SessionServices>(
  ctx: ArchiveHandlerContext<C>,
): {
  handlers: {
    sessionArchive: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionRemove: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionExport: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    archiveList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    archiveRestore: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    archiveRemove: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
} {
  const { services, settingsView, dropSessionChat, resolveSession } = ctx;

/**
   * The archive/delete/export/restore failure shape: one session, one verb, one
   * line.
   *
   * The shell has already asked the user; a failure here is the core reporting
   * that the action did not happen, and the reply is never retried.
   */
  const sessionActionFailure = (
    id: RpcId,
    sessionId: string,
    action: SessionAction | "restore",
    message: string,
  ): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "session-action", id: sessionId, action, message }, false);

  /**
   * Archive one session to the configured backend.
   *
   * The backend choice is configuration, never a parameter: a folder archive
   * needs `archive.folder` and a GitHub archive needs a working backend. With
   * neither there is nowhere to put the session, so the refusal happens before
   * the session is read — one actionable line, nothing touched, and the live
   * folder is never deleted in place of an archive.
   *
   * The service owns the move (copy to a temp folder, rename, then remove the
   * live copy) and it always receives `confirmed: true`: the Flutter manager
   * asks the user, so this layer is the execution half of that confirmation.
   */
  const sessionArchive = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.archive requires a session id");
    }
    const wantedId = rawId.trim();

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const view = settingsView(current.value);
    let github: C["createGithubArchive"] = undefined;
    if (view.archiveBackend === "github") {
      if (!current.value.createGithubArchive) {
        const message = "the GitHub archive backend is not available in this build";
        return failure(id, BOOT_FAILED, message, { kind: "archive", id: wantedId, message }, false);
      }
      // Building the backend is configuration, not a transfer: it refuses an
      // unconfigured repo or a missing keychain token with one sentence. That
      // refusal is the archive's own blocked state, not a failed session action.
      const ready = await current.value.createGithubArchive();
      if (!ready.ok) {
        const message = oneLine(ready.error.message);
        return failure(id, BOOT_FAILED, message, { kind: "archive", id: wantedId, message }, false);
      }
      github = async () => ready;
    } else if (view.archiveFolder.trim() === "") {
      const message = "set an archive folder in Settings → Storage and archive first";
      return failure(id, BOOT_FAILED, message, { kind: "archive", id: wantedId, message }, false);
    }

    const resolved = await resolveSession(id, current.value, wantedId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const outcome = await runSessionAction({
      workspace: current.value.workspace,
      id: sessionId,
      action: "archive",
      archiveRoot: view.archiveFolder,
      ...(github === undefined ? {} : { createGithubArchive: github }),
    });
    if (!outcome.ok) {
      return sessionActionFailure(id, sessionId, "archive", oneLine(outcome.message));
    }
    if (outcome.action !== "archive") {
      return sessionActionFailure(
        id,
        sessionId,
        "archive",
        "the archive did not report an archived session",
      );
    }
    dropSessionChat(sessionId);
    return success(id, { action: "archive", backend: outcome.backend });
  };

  /**
   * Delete one session folder.
   *
   * The shell confirms first (`docs/product.md` §4.4) and this method executes
   * the confirmed delete; `deleteSession` receives `confirmed: true` through the
   * action adapter. Nothing else is removed: no note, no work project and no
   * archive entry, so an archived copy survives a delete of the live folder.
   */
  const sessionRemove = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    if (typeof params.id !== "string" || params.id.trim() === "") {
      return invalid(id, "session.remove requires a session id");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    // No `archiveRoot`: a delete removes the live folder, and an archived copy
    // of the same id survives (`archive.remove` is the only verb that deletes
    // one).
    const outcome = await runSessionAction({
      workspace: current.value.workspace,
      id: sessionId,
      action: "delete",
    });
    if (!outcome.ok) {
      return sessionActionFailure(id, sessionId, "delete", oneLine(outcome.message));
    }
    if (outcome.action !== "delete") {
      return sessionActionFailure(
        id,
        sessionId,
        "delete",
        "the delete did not report a deleted session",
      );
    }
    dropSessionChat(sessionId);
    return success(id, { action: "delete" });
  };

  /**
   * Export one session as a zip in this workspace's `exports/` folder.
   *
   * There is no destination parameter: the service writes
   * `exports/session-<id>.zip` itself, so the shell cannot point an export at a
   * path it does not own. The reply is that path, and the containment check
   * below keeps the invariant even if the service ever changed.
   */
  const sessionExport = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    if (typeof params.id !== "string" || params.id.trim() === "") {
      return invalid(id, "session.export requires a session id");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const outcome = await runSessionAction({
      workspace: current.value.workspace,
      id: sessionId,
      action: "export",
      archiveRoot: settingsView(current.value).archiveFolder,
    });
    if (!outcome.ok) {
      return sessionActionFailure(id, sessionId, "export", oneLine(outcome.message));
    }
    if (outcome.action !== "export") {
      return sessionActionFailure(id, sessionId, "export", "the export did not produce a file");
    }

    const exportsRoot = resolve(current.value.workspace.paths.exports);
    const target = resolve(outcome.path);
    if (target !== exportsRoot && !target.startsWith(exportsRoot + sep)) {
      return sessionActionFailure(
        id,
        sessionId,
        "export",
        "the export was written outside this workspace's exports folder",
      );
    }
    return success(id, { action: "export", path: outcome.path });
  };

  /**
   * List the archive, read-only, for both sides of the wall.
   *
   * This is the picker's read half only: it never restores, deletes, exports or
   * writes a byte. The backend is configuration, exactly as for
   * `session.archive`: a folder backend with no folder configured has nowhere
   * to look and is therefore `{rows: []}`, while a GitHub backend this build
   * cannot build — no repo, no token or no backend at all — is one actionable
   * refusal instead of an empty lie.
   *
   * Rows come from the backends themselves. The local `archive-index/*.json`
   * files are a cache, so a missing or corrupt index still lists the archived
   * folders rather than failing the request.
   */
  const archiveList = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const view = settingsView(current.value);
    const backend = view.archiveBackend === "github" ? "github" : "folder";

    const loaded = await loadArchiveRows({
      archiveRoot: view.archiveFolder,
      backend,
      workspaceRoot: current.value.workspace.root,
      ...(current.value.createGithubArchive === undefined
        ? {}
        : { createGithubArchive: current.value.createGithubArchive }),
    });
    if (!loaded.ok) {
      const message = oneLine(loaded.message);
      return failure(id, BOOT_FAILED, message, { kind: "archive", message }, false);
    }
    return success(id, { rows: loaded.rows });
  };

  /**
   * The configured archive backend, resolved exactly as `archive.list` does.
   *
   * The backend choice is configuration, never a parameter. A GitHub backend is
   * built on demand; a folder backend needs an absolute `archive.folder`. Both
   * refusals are one actionable sentence naming Settings, because there is no
   * retry that can fix a missing setting.
   */
  /** One archive verb, one item, one line — never a retry. */
  const archiveItemFailure = (
    id: RpcId,
    item: { id: string; side: "school" | "skills" },
    message: string,
  ): JsonRpcFailure =>
    failure(
      id,
      BOOT_FAILED,
      message,
      { kind: "archive", id: item.id, side: item.side, message },
      false,
    );

  /**
   * Delete one **archived** item; the live copy is never touched.
   *
   * This is the archive picker's delete verb (`docs/product.md` §9) and it is
   * destructive: the shell asks first, naming the item, and this method is the
   * execution half of that confirmation. `ArchiveBackend.remove` only ever
   * resolves a folder inside the archive root (a symlinked or escaping location
   * is refused by the backend), so a live session or goal cannot be deleted by
   * this path — `session.remove` owns that, with its own confirmation.
   *
   * An item that is not in the archive is a typed refusal naming the id, not a
   * silent success: the picker was showing a row that is no longer there.
   */
  const archiveRemove = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "archive.remove requires an archived item id");
    }
    const wantedId = rawId.trim();

    const rawSide = params.side;
    if (rawSide !== "school" && rawSide !== "skills") {
      return invalid(id, 'archive.remove: side must be "school" or "skills"');
    }
    const side = rawSide;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const view = settingsView(current.value);

    const resolved = await resolveArchiveBackend(current.value, view);
    if (!resolved.ok) return archiveItemFailure(id, { id: wantedId, side }, resolved.message);

    // The side decides the kind: a school row is a session, a skills row is a
    // goal. `project` archives are not produced by either side's manager yet.
    const kind: "session" | "goal" = side === "school" ? "session" : "goal";
    const ref: ArchiveRef = { side, id: wantedId, backend: resolved.backend.id, kind };

    // `confirm: true` is the shell's confirmation; the GitHub adapter refuses a
    // remote delete without it, and the folder adapter ignores it.
    const removed = await resolved.backend.remove(ref, { confirm: true });
    if (!removed.ok) {
      return archiveItemFailure(id, { id: wantedId, side }, oneLine(removed.error.message));
    }
    if (!removed.value.removed) {
      return archiveItemFailure(
        id,
        { id: wantedId, side },
        `there is no archived ${kind} "${wantedId}" on the ${side} side`,
      );
    }
    return success(id, { action: "delete", side, id: wantedId });
  };

  /**
   * Bring one archived **skill goal** back into `skills/goals/<id>`.
   *
   * The archive port's `restore` copies an archived item into a destination and
   * `remove` drops the archived copy, so the same composition serves both
   * backends: a folder archive's `restore` stages and renames locally, and the
   * GitHub archive downloads the item's files into the destination:
   *
   * 1. the backend copies the archived goal into `skills/goals/<id>`;
   * 2. the goal's `archived` flag is cleared when the archived copy carried it;
   * 3. the archived copy is removed, making the restore a move.
   *
   * Any failure after step 1 removes the freshly restored folder, so a failed
   * restore leaves the archive and the live goals folder exactly as they were.
   * A goal that is already open is refused rather than overwritten, and the id
   * is confined to the goals root: it is a folder name, never a path.
   */
  const restoreArchivedGoal = async (
    id: RpcId,
    current: C,
    view: SettingsView,
    wantedId: string,
  ): Promise<JsonRpcResponse> => {
    const refused = (message: string): JsonRpcFailure =>
      archiveItemFailure(id, { id: wantedId, side: "skills" }, message);

    const resolved = await resolveArchiveBackend(current, view);
    if (!resolved.ok) return refused(resolved.message);

    const destination = goalFolderFor(current.workspace, wantedId);
    if (basename(destination) !== wantedId) {
      return refused(`"${wantedId}" is not a goal id in this workspace`);
    }
    if (await pathExists(destination)) {
      return refused(`"${wantedId}" is already open in this workspace; delete or archive it first`);
    }

    const ref: ArchiveRef = {
      side: "skills",
      id: wantedId,
      backend: resolved.backend.id,
      kind: "goal",
    };

    const restored = await resolved.backend.restore(ref, destination);
    if (!restored.ok) return refused(oneLine(restored.error.message));

    const loaded = await readGoalMeta(destination);
    if (!loaded.ok) {
      await rm(destination, { recursive: true, force: true }).catch(() => {});
      return refused(oneLine(loaded.error.message));
    }
    // Only rewrite when the archived copy actually carried the flag: a course
    // `meta.json` that never had one is left byte-identical.
    if (loaded.value.meta.archived === true) {
      const written = await writeGoalMeta(
        destination,
        { ...loaded.value.meta, archived: false },
        loaded.value.goal.stages,
      );
      if (!written.ok) {
        await rm(destination, { recursive: true, force: true }).catch(() => {});
        return refused(oneLine(written.error.message));
      }
    }

    // The restore is a move: drop the archived copy now that the live goal
    // exists. `removed: false` means it was already gone — the same end state —
    // so only a backend error rolls the restore back.
    const removed = await resolved.backend.remove(ref);
    if (!removed.ok) {
      await rm(destination, { recursive: true, force: true }).catch(() => {});
      return refused(oneLine(removed.error.message));
    }
    return success(id, { action: "restore", side: "skills", id: wantedId });
  };

  /**
   * Bring one archived item back into the live workspace.
   *
   * The **school** side is a session restore. With the folder backend,
   * `restoreSession` moves the archived session back through the same service
   * the TUI uses. With the GitHub backend, the port copies the item's files
   * into `school/sessions/<id>` and the composed path here normalises the
   * metadata and drops the remote copy, so a restore is a move on both.
   *
   * Either way the restored session keeps its sources, steps, progress and
   * outputs and — like `archive` — carries **no chat history** (`chat.jsonl` is
   * removed; the archive never stored one).
   *
   * The **skills** side is a goal restore for either backend, composed from the
   * archive port and the goal metadata writer (`restoreArchivedGoal`).
   */
  const archiveRestore = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "archive.restore requires a session id");
    }
    const wantedId = rawId.trim();

    const rawSide = params.side;
    if (rawSide !== "school" && rawSide !== "skills") {
      return invalid(id, 'archive.restore: side must be "school" or "skills"');
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const view = settingsView(current.value);

    if (rawSide === "skills") {
      return restoreArchivedGoal(id, current.value, view, wantedId);
    }

    const refusedBuild = (message: string): JsonRpcFailure =>
      failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "archive", id: wantedId, side: "school", message },
        false,
      );

    if (view.archiveBackend === "github") {
      if (!current.value.createGithubArchive) {
        return refusedBuild("the GitHub archive backend is not available in this build");
      }
      // Building the backend is configuration, not a transfer: an unconfigured
      // repo or a missing keychain token is one sentence naming Settings.
      // Nothing is read from the archive before this refusal.
      const made = await current.value.createGithubArchive();
      if (!made.ok) return refusedBuild(oneLine(made.error.message));
      const backend = made.value;

      const destination = sessionFolderFor(current.value.workspace, wantedId);
      if (basename(destination) !== wantedId) {
        return refusedBuild(`"${wantedId}" is not a session id in this workspace`);
      }
      if (await pathExists(destination)) {
        return refusedBuild(
          `"${wantedId}" is already open in this workspace; delete or archive it first`,
        );
      }

      const ref: ArchiveRef = {
        side: "school",
        id: wantedId,
        backend: backend.id,
        kind: "session",
      };
      const restored = await backend.restore(ref, destination);
      if (!restored.ok) {
        return sessionActionFailure(id, wantedId, "restore", oneLine(restored.error.message));
      }

      // The adapter copies files; the session's own rules are ours. A failure
      // here removes the fresh folder so the archive is the only copy left.
      const normalised = await normaliseRestoredSession(destination);
      if (!normalised.ok) {
        await rm(destination, { recursive: true, force: true }).catch(() => {});
        return sessionActionFailure(id, wantedId, "restore", oneLine(normalised.message));
      }

      // The restore is a move: drop the archived copy now that the live copy
      // exists. A backend error rolls the fresh folder back.
      const removed = await backend.remove(ref);
      if (!removed.ok) {
        await rm(destination, { recursive: true, force: true }).catch(() => {});
        return sessionActionFailure(id, wantedId, "restore", oneLine(removed.error.message));
      }

      dropSessionChat(wantedId);
      return success(id, { action: "restore", side: "school", id: wantedId });
    }

    if (view.archiveFolder.trim() === "") {
      return refusedBuild("set an archive folder in Settings → Storage and archive first");
    }

    // `restoreSession` owns the move: it finds the archived copy, stages the
    // restore, renames it into `school/sessions/<id>` and drops `chat.jsonl`, so
    // a failure leaves the archive and the live folder exactly as they were.
    const restored = await restoreSession({
      workspace: current.value.workspace,
      id: wantedId,
      archiveRoot: view.archiveFolder,
      confirmed: true,
    });
    if (!restored.ok) {
      return sessionActionFailure(id, wantedId, "restore", oneLine(restored.error.message));
    }
    if (!restored.value.restored) {
      return sessionActionFailure(
        id,
        wantedId,
        "restore",
        "the restore did not report a restored session",
      );
    }
    return success(id, { action: "restore", side: "school", id: wantedId });
  };
  return {
    handlers: {
      sessionArchive,
      sessionRemove,
      sessionExport,
      archiveList,
      archiveRestore,
      archiveRemove,
    },
  };
}
