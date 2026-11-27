import { openFolderArchive } from "../archive/folder";
import type { ArchiveBackend } from "../archive/types";
import type { SettingsView } from "../types/settings";
import { oneLine } from "./rpc";

/** The app state a backend choice needs: the workspace root and the GitHub factory. */
export type ArchiveBackendServices = {
  workspace: { root: string };
  createGithubArchive?: () => Promise<
    | { ok: true; value: ArchiveBackend }
    | { ok: false; error: { message: string } }
  >;
};

/**
 * Build the configured archive backend.
 *
 * The backend is **configuration, never a parameter**: a GitHub archive needs a
 * working adapter and a folder archive needs a non-empty folder. With neither
 * there is nowhere to put an item, so the refusal happens before the item is
 * read — one actionable line, nothing touched.
 */
export async function resolveArchiveBackend<C extends ArchiveBackendServices>(
  current: C,
  view: SettingsView,
): Promise<{ ok: true; backend: ArchiveBackend } | { ok: false; message: string }> {
  if (view.archiveBackend === "github") {
    if (!current.createGithubArchive) {
      return { ok: false, message: "the GitHub archive backend is not available in this build" };
    }
    const made = await current.createGithubArchive();
    return made.ok
      ? { ok: true, backend: made.value }
      : { ok: false, message: oneLine(made.error.message) };
  }
  if (view.archiveFolder.trim() === "") {
    return { ok: false, message: "set an archive folder in Settings → Storage and archive first" };
  }
  const opened = openFolderArchive({
    archiveRoot: view.archiveFolder,
    workspaceRoot: current.workspace.root,
  });
  return opened.ok
    ? { ok: true, backend: opened.value }
    : { ok: false, message: oneLine(opened.error.message) };
}
