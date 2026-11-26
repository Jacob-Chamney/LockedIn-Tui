import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { SessionServices } from "./session-context";
import { loadProjectMeta } from "../services/work/agents";
import {
  createProject,
  loadAgentTemplates,
  loadProjects,
  loadWorkHome,
  makeAgentId,
  makeProjectId,
  setProjectInstructions,
} from "../app/actions/projects";
import { listProjects, type ProjectMeta } from "../services/work/register";
import { changes as readChanges } from "../services/work/changes";
import { parseAgentSave, takenAgentIds } from "./agent-input";
import {
  createAgent,
  deleteAgent,
  setDefaultAgent,
  updateAgent,
  type AgentFields,
} from "../services/work/agents";
import {
  BOOT_FAILED,
  bootFailureResponse,
  isRecord,
  failure,
  invalid,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";
import type { AgentTemplateRowView, WorkProjectDetailView, WorkProjectRowView } from "./views";
import { projectAgentRows, templateSummary } from "./views";

/** What a Work project handler needs from the core. */
export type WorkProjectContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
};

/**
 * Resolve one project id from a request; a failure is the project error shape.
 *
 * `work.create` does not need this (it registers a folder that need not exist),
 * but every agent write addresses an existing project, so the check happens
 * once here and the service's own message is preserved.
 */
export async function resolveProject<C extends SessionServices>(
  id: RpcId,
  current: C,
  raw: unknown,
): Promise<{ error: JsonRpcFailure } | { projectId: string; meta: ProjectMeta }> {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: invalid(id, "a project id is required") };
  }
  const projectId = raw.trim();
  const meta = await loadProjectMeta(current.workspace, projectId);
  if (!meta.ok) {
    const message = oneLine(meta.error.message);
    return {
      error: failure(id, BOOT_FAILED, message, { kind: "project", projectId, message }, false),
    };
  }
  return { projectId: meta.value.id, meta: meta.value };
}

/**
 * The Work project and agent surface: `work.list/open/create/instructions`,
 * the template picker, agent profiles, the default agent and the read-only
 * Changes summary (`docs/product.md` §8.1, §8.3, §8.5).
 *
 * Nothing here reads, writes, moves, copies or deletes a file inside a
 * registered project root: the only writes are `work/projects/<id>/meta.json`.
 */
export function createWorkProjectHandlers<C extends SessionServices>(
  ctx: WorkProjectContext<C>,
): {
  workList: (id: RpcId) => Promise<JsonRpcResponse>;
  workOpen: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  workCreate: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  workInstructionsSave: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  workTemplatesList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  workAgentSave: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  workAgentDelete: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  workDefaultAgent: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  workChanges: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
} {
  const { services } = ctx;

  /**
   * The read-only Work surface.
   *
   * `work.list` projects the same rows the shell's project registry builds; a
   * broken `meta.json` is skipped by `loadProjects`, never invented here.
   * `work.open` adds the home summary and metadata the project page renders.
   * Nothing in this packet writes, moves or deletes a project folder.
   */
  const workList = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const rows = await loadProjects(current.value.workspace);
    return success(id, {
      projects: rows.map(
        (row): WorkProjectRowView => ({
          id: row.id,
          name: row.name,
          folder: row.folder,
          mode: row.mode,
          swarmName: row.swarmName,
          archived: row.archived,
          agents: projectAgentRows(row.agents),
        }),
      ),
    });
  };

  const workOpen = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const raw = params.id;
    if (typeof raw !== "string" || raw.trim() === "") {
      return invalid(id, "work.open requires a project id");
    }
    const projectId = raw.trim();
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    // The home read owns root/agents/default/task counts; the metadata read
    // owns mode/swarm name/archived/instructions. Both address the same folder,
    // so a missing project fails once with the service's own message.
    const [home, meta] = await Promise.all([
      loadWorkHome(current.value.workspace, projectId),
      loadProjectMeta(current.value.workspace, projectId),
    ]);
    if (home === null || !meta.ok) {
      const message = meta.ok
        ? `the project ${JSON.stringify(projectId)} is not registered in this workspace`
        : oneLine(meta.error.message);
      return failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "project", id: projectId, message },
        false,
      );
    }

    const detail: WorkProjectDetailView = {
      id: meta.value.id,
      name: meta.value.name,
      root: home.root,
      rootMissing: home.rootMissing,
      mode: meta.value.mode,
      swarmName: meta.value.swarm_name,
      archived: meta.value.archived,
      instructions: meta.value.instructions,
      defaultAgent: home.defaultAgentId ?? null,
      agents: home.agents,
      tasks: home.tasks,
      hasGit: home.hasGit,
      lastOpened: home.lastOpened,
    };
    return success(id, { project: detail });
  };

  /**
   * Register one existing folder as a project: the Work empty state's action.
   *
   * This is metadata only — `createProject` resolves the user's path (and may
   * create the leaf they named), then writes `work/projects/<id>/meta.json`.
   * The root is never moved, copied or deleted. Optional `instructions` are
   * saved with the registration; agent profiles are added with
   * `work.agent.save`.
   */
  const workCreate = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawName = params.name;
    if (typeof rawName !== "string" || rawName.trim() === "") {
      return invalid(id, "work.create requires a non-empty name string");
    }
    const rawFolder = params.folder;
    if (typeof rawFolder !== "string" || rawFolder.trim() === "") {
      return invalid(id, "work.create requires a folder path");
    }
    const mode = params.mode;
    if (mode !== "chat" && mode !== "swarm") {
      return invalid(id, 'work.create requires mode "chat" or "swarm"');
    }
    const rawInstructions = params.instructions;
    if (rawInstructions !== undefined && typeof rawInstructions !== "string") {
      return invalid(id, "work.create: instructions must be a string");
    }
    const instructions =
      typeof rawInstructions === "string" ? rawInstructions : undefined;

    const name = rawName.trim();
    const folder = rawFolder.trim();
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // The id is derived from the name against the ids already taken, so the
    // shell can open the project without a second lookup.
    const taken = (await listProjects(current.value.workspace)).map((row) => row.id);
    const created = await createProject({
      workspace: current.value.workspace,
      id: makeProjectId(name, taken),
      name,
      folder,
      mode,
      instructions,
    });
    if (!created.ok) {
      const message = oneLine(created.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "project-create", message }, false);
    }
    return success(id, { id: created.value.id, name });
  };

  /**
   * Replace a project's standing instructions (`work.instructions.save`).
   *
   * The value is metadata only: only `work/projects/<id>/meta.json` is
   * written, and nothing inside the registered root is read or changed. The
   * save is the same 20,000-character rule registration applies, so create and
   * edit cannot disagree. A failure preserves the previous text.
   */
  const workInstructionsSave = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProjectId = params.projectId;
    if (typeof rawProjectId !== "string" || rawProjectId.trim() === "") {
      return invalid(id, "work.instructions.save requires a project id");
    }
    const projectId = rawProjectId.trim();
    const rawInstructions = params.instructions;
    if (typeof rawInstructions !== "string") {
      return invalid(id, "work.instructions.save: instructions must be a string");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const saved = await setProjectInstructions({
      workspace: current.value.workspace,
      id: projectId,
      instructions: rawInstructions,
    });
    if (!saved.ok) {
      const message = oneLine(saved.error.message);
      return failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "project", projectId, message },
        false,
      );
    }
    return success(id, { instructions: saved.value.instructions });
  };

  /**
   * The agent templates a project's editor can offer (`docs/product.md` §8.3).
   *
   * The built-in three always ship; a project's own `work/templates/*.json` are
   * added when `projectId` names a registered project. The service
   * (`listTemplates`) reads the folder and reports a broken file as an issue, so
   * one unreadable template never fails the picker and is never silently turned
   * into a template: it simply is not offered.
   *
   * A template **seeds** an editor's fields; nothing here applies one. The write
   * path is still `work.agent.save`, and `template` there stays the free string
   * field it always was, so an agent saved before this method existed is
   * unaffected.
   *
   * Read-only: it opens `work/templates/` for reading only and writes nothing.
   */
  const workTemplatesList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const raw = params.projectId;
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      return invalid(id, "work.templates.list: projectId must be a string");
    }
    const supplied = typeof raw === "string" ? raw.trim() : "";
    if (typeof raw === "string" && supplied === "") {
      return invalid(
        id,
        "work.templates.list: projectId must be a non-empty string when supplied",
      );
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const workspace = current.value.workspace;

    if (supplied !== "") {
      // The picker filters project templates by the registered project, so an
      // id that is not registered is the shared project shape, not an empty list.
      const meta = await loadProjectMeta(workspace, supplied);
      if (!meta.ok) {
        const message = oneLine(meta.error.message);
        return failure(
          id,
          BOOT_FAILED,
          message,
          { kind: "project", projectId: supplied, message },
          false,
        );
      }
    }

    const listed = await loadAgentTemplates(workspace);
    return success(id, {
      templates: listed.templates.map(
        (template): AgentTemplateRowView => ({
          id: template.id,
          name: template.name,
          role: template.role,
          summary: templateSummary(template.instructions),
          source: template.builtin ? "built-in" : "project",
          // `name` and `role` above plus these three are the fields a pick fills,
          // so the shell never keeps a second template table.
          instructions: template.instructions,
          maxToolCalls: template.maxToolCalls,
          allowedTools: [...template.allowedTools],
        }),
      ),
    });
  };

  /**
   * Create or update one agent profile.
   *
   * This is metadata only: it rewrites `work/projects/<id>/meta.json` (the
   * `agents` array and `default_agent`) and never reads, writes, moves or deletes
   * a file inside the project root. A missing `agent.id` creates a profile whose
   * id is generated exactly as the TUI does (`makeAgentId` against the ids already
   * on disk); a present `id` updates in place, keeping the id stable across a
   * rename.
   *
   * `allowCommand` is stored as requested. The product rule "swarm workers never
   * inherit command access" is enforced at the swarm boundary
   * (`forSwarm` forces a worker copy read-only), so this packet neither widens
   * nor silently narrows the saved profile.
   */
  const workAgentSave = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProject = params.projectId;
    if (typeof rawProject !== "string" || rawProject.trim() === "") {
      return invalid(id, "work.agent.save requires a project id");
    }
    const rawAgent = params.agent;
    const parsed = parseAgentSave(
      rawAgent,
      !(isRecord(rawAgent) && typeof rawAgent.id === "string"),
    );
    if ("error" in parsed) return invalid(id, parsed.error);
    const { agentId: existingId, fields } = parsed;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, rawProject);
    if ("error" in resolved) return resolved.error;
    const { projectId, meta } = resolved;
    const workspace = current.value.workspace;

    if (existingId !== undefined) {
      const updated = await updateAgent({
        workspace,
        projectId,
        id: existingId,
        patch: fields,
      });
      if (!updated.ok) {
        const message = oneLine(updated.error.message);
        return failure(id, BOOT_FAILED, message, { kind: "agent", projectId, message }, false);
      }
      return success(id, { id: updated.value.id });
    }

    // `fields.name` is present: `parseAgentSave` required it for a create.
    const created = await createAgent({
      workspace,
      projectId,
      id: makeAgentId(fields.name as string, takenAgentIds(meta)),
      ...(fields as AgentFields),
    });
    if (!created.ok) {
      const message = oneLine(created.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "agent", projectId, message }, false);
    }
    return success(id, { id: created.value.id });
  };

  /**
   * Remove one agent profile.
   *
   * Deleting the default leaves the project with no default (the documented
   * blocked state) rather than silently promoting a neighbour; the shell calls
   * `work.defaultAgent` or `work.open` to see the result. Metadata only.
   */
  const workAgentDelete = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProject = params.projectId;
    if (typeof rawProject !== "string" || rawProject.trim() === "") {
      return invalid(id, "work.agent.delete requires a project id");
    }
    const rawAgent = params.agentId;
    if (typeof rawAgent !== "string" || rawAgent.trim() === "") {
      return invalid(id, "work.agent.delete requires an agent id");
    }
    const agentIdValue = rawAgent.trim();

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, rawProject);
    if ("error" in resolved) return resolved.error;
    const projectId = resolved.projectId;

    const deleted = await deleteAgent({
      workspace: current.value.workspace,
      projectId,
      id: agentIdValue,
    });
    if (!deleted.ok) {
      const message = oneLine(deleted.error.message);
      return failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "agent", projectId, agentId: agentIdValue, message },
        false,
      );
    }
    return success(id, { ok: true });
  };

  /**
   * Set or clear the project default agent.
   *
   * `agentId: null` or an omitted `agentId` clears it. An id that does not name a
   * valid saved profile is refused, so `meta.json` can never point at an agent
   * that cannot run. The reply always says what is stored now — `null` when the
   * project has no default.
   */
  const workDefaultAgent = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProject = params.projectId;
    if (typeof rawProject !== "string" || rawProject.trim() === "") {
      return invalid(id, "work.defaultAgent requires a project id");
    }
    const rawAgent = params.agentId;
    if (rawAgent !== undefined && rawAgent !== null && typeof rawAgent !== "string") {
      return invalid(id, "work.defaultAgent: agentId must be a string or null");
    }
    if (typeof rawAgent === "string" && rawAgent.trim() === "") {
      return invalid(id, "work.defaultAgent: agentId must be a non-empty string or null");
    }
    const agentIdValue = typeof rawAgent === "string" ? rawAgent.trim() : "";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, rawProject);
    if ("error" in resolved) return resolved.error;
    const projectId = resolved.projectId;

    const saved = await setDefaultAgent({
      workspace: current.value.workspace,
      projectId,
      id: agentIdValue,
    });
    if (!saved.ok) {
      const message = oneLine(saved.error.message);
      return failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "agent", projectId, agentId: agentIdValue, message },
        false,
      );
    }
    return success(id, {
      defaultAgent: saved.value.defaultAgent === "" ? null : saved.value.defaultAgent,
    });
  };

  /* ------------------------------------------------------------------------ */
  /* Changes — read-only git summary (WP-507)                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * The read-only Changes summary for one registered project.
   *
   * This is the "what changed?" panel, not a diff approval surface: it never
   * stages, commits or checks anything out, and it never writes a byte inside
   * the project (the service runs every git call with `--no-optional-locks` and
   * `GIT_OPTIONAL_LOCKS=0`). A folder that is missing, not a git repository, or
   * a machine without `git` is a **success** with `available: false` and a
   * reason — the shell renders that sentence and the rest of Work keeps working.
   * Only a git command that actually fails on a real repository is an error, and
   * then it is one message with `retryable: false` and `data.kind: "changes"`.
   *
   * The project id is resolved from the registry, never from a caller-supplied
   * path, and an unknown project is the shared project error shape.
   */
  const workChanges = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProject = params.projectId;
    if (typeof rawProject !== "string" || rawProject.trim() === "") {
      return invalid(id, "work.changes requires a project id");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, rawProject);
    if ("error" in resolved) return resolved.error;
    const projectId = resolved.projectId;

    const summary = await readChanges({
      workspace: current.value.workspace,
      projectId,
    });
    if (!summary.ok) {
      const message = oneLine(summary.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "changes", projectId, message }, false);
    }
    // `available: false` is a documented outcome, not a failure: pass the
    // service's summary through unchanged so the shell prints its reason.
    return success(id, { changes: summary.value });
  };


  return {
    workList,
    workOpen,
    workCreate,
    workInstructionsSave,
    workTemplatesList,
    workAgentSave,
    workAgentDelete,
    workDefaultAgent,
    workChanges,
  };
}
