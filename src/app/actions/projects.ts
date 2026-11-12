/**
 * Project registry calls used by the shell.
 *
 * Registration, the archive flag and the agent profiles already live in
 * `services/work/{register,agents}`. This module is the single place that maps
 * the shell's flat `Project`/`Agent` view onto that storage, so the UI never
 * writes `meta.json` itself.
 */
import { rmdir } from "node:fs/promises"

import type { Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"
import {
  agentId,
  createAgent,
  deleteAgent,
  listAgents,
  loadProjectMeta,
  setDefaultAgent,
  updateAgent,
} from "../../services/work/agents"
import { instantiateTemplate, listTemplates, type AgentTemplate } from "../../services/work/templates"
import {
  createProjectScope,
  projectToolSpecs,
  type ProjectScope,
  type ScopeError,
} from "../../services/work/scope"
import type { ToolResolver, ToolSpec } from "../../llm/tools"
import {
  home as projectHome,
  listProjects,
  projectId,
  register,
  remove,
  resolveProjectRoot,
  setArchived,
  setMode,
  type WorkMode,
} from "../../services/work/register"

export type ProjectPermission = "read-only" | "write" | "commands"

/** The shell's agent row; the wire shape is `AgentProfile`. */
export type ProjectAgent = {
  id: string
  name: string
  /** The one-line task / instruction shown in the manager. */
  task: string
  model: string
  permissions: ProjectPermission
}

export type LoadedProject = {
  id: string
  name: string
  folder: string
  mode: WorkMode
  swarmName: string
  archived: boolean
  agents: ProjectAgent[]
}

export type ProjectError = { message: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function permissionOf(profile: { allowCommand: boolean; allowWrite: boolean }): ProjectPermission {
  if (profile.allowCommand) return "commands"
  return profile.allowWrite ? "write" : "read-only"
}

function profileOf(agent: ProjectAgent) {
  return {
    name: agent.name,
    instructions: agent.task,
    model: agent.model,
    allowWrite: agent.permissions !== "read-only",
    allowCommand: agent.permissions === "commands",
  }
}

/** Every registered project plus its agents. A broken row is skipped, never fatal. */
export async function loadProjects(workspace: Workspace): Promise<LoadedProject[]> {
  const rows = await listProjects(workspace)
  return Promise.all(
    rows
      .filter((row) => !row.broken)
      .map(async (row) => {
        const listed = await listAgents(workspace, row.id)
        const agents: ProjectAgent[] = listed.ok
          ? listed.value.agents.map((profile) => ({
              id: profile.id,
              name: profile.name,
              task: profile.instructions,
              model: profile.model,
              permissions: permissionOf(profile),
            }))
          : []
        return {
          id: row.id,
          name: row.name,
          folder: row.root,
          mode: row.mode,
          swarmName: row.swarmName,
          archived: row.archived,
          agents,
        }
      }),
  )
}

export async function createProject(input: {
  workspace: Workspace
  /** Pre-computed id, so the caller can open the project immediately. */
  id: string
  name: string
  folder: string
  mode: WorkMode
}): Promise<Result<{ id: string; folder: string }, ProjectError>> {
  // The wizard's "New project" may name a folder that does not exist yet. The
  // low-level register still requires an existing folder; this action is the
  // one place that creates the leaf the user explicitly named.
  let createdParents: string[] = []
  const prepared = await resolveProjectRoot(input.workspace, input.folder, {
    create: true,
    onCreated: (_path, ancestors) => {
      createdParents = [...ancestors]
    },
  })
  const removeCreated = async (): Promise<void> => {
    for (const path of createdParents) await rmdir(path).catch(() => {})
  }
  if (!prepared.ok) {
    await removeCreated()
    return { ok: false, error: { message: prepared.error.message } }
  }

  const created = await register({
    workspace: input.workspace,
    root: prepared.value,
    name: input.name,
    id: input.id,
    mode: input.mode,
  })
  if (!created.ok) {
    // The wizard may have created this leaf and its missing parents just for a
    // registration that then failed. Remove the empty directories it created.
    await removeCreated()
    return { ok: false, error: { message: created.error.message } }
  }
  return { ok: true, value: { id: created.value.meta.id, folder: created.value.meta.root } }
}

export async function setProjectMode(input: {
  workspace: Workspace
  id: string
  mode: WorkMode
  name?: string
}): Promise<Result<{ id: string; mode: WorkMode }, ProjectError>> {
  const updated = await setMode({ ...input, swarmName: input.name })
  if (!updated.ok) return { ok: false, error: { message: updated.error.message } }
  return { ok: true, value: { id: updated.value.id, mode: updated.value.mode } }
}

export async function archiveProject(input: {
  workspace: Workspace
  id: string
  archived: boolean
}): Promise<Result<{ id: string }, ProjectError>> {
  const updated = await setArchived(input)
  if (!updated.ok) return { ok: false, error: { message: updated.error.message } }
  return { ok: true, value: { id: updated.value.id } }
}

/** Remove the project's metadata only; the folder on disk is kept. */
export async function deleteProject(input: {
  workspace: Workspace
  id: string
}): Promise<Result<{ id: string }, ProjectError>> {
  const removed = await remove({
    workspace: input.workspace,
    id: input.id,
    approve: () => true,
  })
  if (!removed.ok) return { ok: false, error: { message: removed.error.message } }
  return { ok: true, value: { id: input.id } }
}

export async function createProjectAgent(input: {
  workspace: Workspace
  projectId: string
  /** Pre-computed id, so the row paints before the meta write. */
  id: string
  agent: ProjectAgent
}): Promise<Result<{ id: string }, ProjectError>> {
  const created = await createAgent({
    workspace: input.workspace,
    projectId: input.projectId,
    id: input.id,
    ...profileOf(input.agent),
  })
  if (!created.ok) return { ok: false, error: { message: created.error.message } }
  return { ok: true, value: { id: created.value.id } }
}

export async function updateProjectAgent(input: {
  workspace: Workspace
  projectId: string
  id: string
  agent: ProjectAgent
}): Promise<Result<{ id: string }, ProjectError>> {
  const updated = await updateAgent({
    workspace: input.workspace,
    projectId: input.projectId,
    id: input.id,
    patch: profileOf(input.agent),
  })
  if (!updated.ok) return { ok: false, error: { message: updated.error.message } }
  return { ok: true, value: { id: updated.value.id } }
}

export async function deleteProjectAgent(input: {
  workspace: Workspace
  projectId: string
  id: string
}): Promise<Result<{ id: string }, ProjectError>> {
  const deleted = await deleteAgent(input)
  if (!deleted.ok) return { ok: false, error: { message: deleted.error.message } }
  return { ok: true, value: { id: input.id } }
}

export type ChatToolSource = {
  specs: ToolSpec[]
  /** Evaluated at send time so a late plugin connection can join. */
  dynamicSpecs?: () => ToolSpec[]
  resolveTool: ToolResolver
  /** The system context for this project's chat, or "" when it cannot be read. */
  context: (context?: { webExplicit?: boolean; toolMode?: string }) => Promise<string>
}

/**
 * Bind the read-only project toolbox to one registered project.
 *
 * The scope is created lazily (once) because a buffer can open before the
 * folder is readable. A vanished root yields one typed tool error per call and
 * an empty context, never a crash.
 */
export function projectTools(input: {
  workspace: Workspace
  id: string
  name: string
  folder: string
}): ChatToolSource | null {
  if (input.folder.trim() === "") return null
  let opened: Promise<Result<ProjectScope, ScopeError>> | null = null
  const scope = () => (opened ??= createProjectScope({ root: input.folder }))
  return {
    specs: projectToolSpecs(),
    resolveTool: async (name, args) => {
      const ready = await scope()
      if (!ready.ok) return JSON.stringify({ ok: false, error: ready.error })
      return ready.value.resolveTool(name, args)
    },
    context: async () => {
      const ready = await scope()
      if (!ready.ok) return ""
      const listed = await ready.value.tools.listFiles({ depth: 2 })
      const files = listed.ok
        ? listed.value.entries
            .slice(0, 80)
            .map((entry) => `${entry.kind === "directory" ? "dir " : "file"} ${entry.path}`)
            .join("\n")
        : ""
      const meta = await loadProjectMeta(input.workspace, input.id)
      const instructions = meta.ok ? meta.value.instructions.trim() : ""
      return [
        `You are working inside the project “${input.name}”.`,
        `Root: ${input.folder}`,
        instructions === "" ? "" : `Project instructions:\n${instructions}`,
        "Use list_files, read_file and search_files for facts about this project.",
        "Writes and commands are off, so do not claim a change was made.",
        files === "" ? "" : `Files (depth 2):\n${files}`,
      ]
        .filter((line) => line !== "")
        .join("\n\n")
    },
  }
}

export { projectId as makeProjectId, agentId as makeAgentId }
export { messageOf as projectErrorMessage }

export type WorkHomeData = {
  name: string
  root: string
  rootMissing: boolean
  agents: import("../../services/work/agents").AgentProfile[]
  defaultAgentId?: string
  tasks: number
  hasGit: boolean
  lastOpened: string
  changes: null
}

/** The project summary the shell uses for the agent sidebar. */
export async function loadWorkHome(
  workspace: Workspace,
  id: string,
): Promise<WorkHomeData | null> {
  const [home, agents] = await Promise.all([
    projectHome({ workspace, id }).catch(() => null),
    listAgents(workspace, id).catch(() => null),
  ])
  if (home === null || !home.ok) return null
  const list = agents !== null && agents.ok ? agents.value.agents : []
  const byName = list.find((agent) => agent.name === home.value.defaultAgentName)
  return {
    name: home.value.name,
    root: home.value.root,
    rootMissing: home.value.rootMissing,
    agents: list,
    ...(byName ? { defaultAgentId: byName.id } : {}),
    tasks: home.value.taskCount,
    hasGit: home.value.hasGit,
    lastOpened: home.value.lastOpenedAt,
    changes: null,
  }
}

/** The built-in plus project templates for an agent picker. */
export async function loadAgentTemplates(
  workspace: Workspace,
): Promise<{ templates: AgentTemplate[]; issues: Array<{ file: string; message: string }> }> {
  const listed = await listTemplates(workspace).catch(() => null)
  return listed !== null && listed.ok
    ? { templates: listed.value.templates, issues: listed.value.issues }
    : { templates: [], issues: [] }
}

/** Create a profile from a template and return it in shell shape. */
export async function createAgentFromTemplate(input: {
  workspace: Workspace
  projectId: string
  templateId: string
}): Promise<Result<ProjectAgent, { message: string }>> {
  const created = await instantiateTemplate({
    workspace: input.workspace,
    projectId: input.projectId,
    template: input.templateId,
  })
  if (!created.ok) return { ok: false, error: { message: created.error.message } }
  const profile = created.value
  return {
    ok: true,
    value: {
      id: profile.id,
      name: profile.name,
      task: profile.instructions,
      model: profile.model,
      permissions: permissionOf(profile),
    },
  }
}

/** Reload one project's agents in shell shape. */
export async function loadProjectAgents(
  workspace: Workspace,
  projectId: string,
): Promise<ProjectAgent[]> {
  const listed = await listAgents(workspace, projectId).catch(() => null)
  if (listed === null || !listed.ok) return []
  return listed.value.agents.map((profile) => ({
    id: profile.id,
    name: profile.name,
    task: profile.instructions,
    model: profile.model,
    permissions: permissionOf(profile),
  }))
}

export async function setProjectDefaultAgent(input: {
  workspace: Workspace
  projectId: string
  id: string
}): Promise<Result<{ id: string }, { message: string }>> {
  const result = await setDefaultAgent(input)
  if (!result.ok) return { ok: false, error: { message: result.error.message } }
  return { ok: true, value: { id: input.id } }
}
