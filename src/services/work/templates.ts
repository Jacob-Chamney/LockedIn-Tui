/**
 * Reusable agent profiles for Work projects (WP-503).
 *
 * A template **seeds** a profile; it never grants anything the user did not ask
 * for (`docs/product.md` §8.3). Three built-ins ship with the app, and a project
 * may add its own as `work/templates/<name>.json`.
 *
 * The one rule that matters most: a template may ask for write access, but it
 * may never grant command access. `allowCommand: true` in a template file is
 * *loaded* (so it is visible and can be fixed) and **refused at instantiation**
 * with a typed error — command access is turned on per agent, by the user, after
 * the agent exists (`AGENTS.md` §2.12).
 */

import { mkdir, readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { slugify } from "../../domain/note"
import type { Workspace } from "../../storage/workspace"
import {
  agentFieldsFromDisk,
  createAgent,
  loadProjectMeta,
  validateAgent,
  writeJsonAtomic,
  type AgentError,
  type AgentFields,
  type AgentInput,
  type AgentProfile,
} from "./agents"
import { projectSlug } from "./register"
import { READ_ONLY_TOOL_NAMES } from "./scope"

/** One entry per template file; `builtin` distinguishes the shipped three. */
export type AgentTemplate = AgentFields & {
  id: string
  /** True for the shipped profiles; false for `work/templates/*.json`. */
  builtin: boolean
}

export type TemplateIssue = {
  file: string
  message: string
}

export type TemplateList = {
  /** Built-ins first, then project templates by id. */
  templates: AgentTemplate[]
  /** A template file that could not be used; reported, never silently skipped. */
  issues: TemplateIssue[]
}

const TEMPLATE_SCHEMA = 1

/* -------------------------------------------------------------------------- */
/* built-ins                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The shipped profiles, as data.
 *
 * - `reviewer` and `researcher` are read-only and command-free;
 * - `implementer` may write but not command; its empty `allowedTools` means
 *   "every tool the profile's capabilities permit", so the write tool a later
 *   packet ships is not filtered out by a stale name list.
 *
 * None of them sets `allowCommand`. That is the point of the table.
 */
export const BUILT_IN_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: "reviewer",
    name: "Reviewer",
    role: "reviewer",
    instructions:
      "Review the work for correctness, regressions, security issues and missing tests. Report findings and cite file paths; do not change files.",
    model: "",
    maxToolCalls: 8,
    allowedTools: [...READ_ONLY_TOOL_NAMES],
    allowWrite: false,
    allowCommand: false,
    template: "",
    builtin: true,
  },
  {
    id: "implementer",
    name: "Implementer",
    role: "implementer",
    instructions:
      "Implement the next concrete step. Inspect existing code first and propose small, reviewable edits.",
    model: "",
    maxToolCalls: 10,
    allowedTools: [],
    allowWrite: true,
    allowCommand: false,
    template: "",
    builtin: true,
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "researcher",
    instructions:
      "Map the relevant files, APIs and constraints. Search before reading, and report evidence with file paths.",
    model: "",
    maxToolCalls: 12,
    allowedTools: [...READ_ONLY_TOOL_NAMES],
    allowWrite: false,
    allowCommand: false,
    template: "",
    builtin: true,
  },
]

export function builtInTemplate(id: string): AgentTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id)
}

/* -------------------------------------------------------------------------- */
/* project template files                                                      */
/* -------------------------------------------------------------------------- */

/** `work/templates` — created by the workspace layout, not by this module. */
export function templatesDir(workspace: Workspace): string {
  return join(workspace.paths.root, "work", "templates")
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const code = codeOf(error)
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

/** Parse one template file into a template, or an issue explaining why not. */
function readTemplateText(
  file: string,
  text: string,
): { template?: AgentTemplate; issue?: TemplateIssue } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { issue: { file, message: `not valid JSON (${messageOf(error)})` } }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { issue: { file, message: "a template must be a JSON object" } }
  }

  const id = basename(file, ".json")
  const record = raw as Record<string, unknown>
  const fields = agentFieldsFromDisk(record)
  // The file name *is* the id; a file without a name is named after itself.
  if (fields.name === undefined) fields.name = id

  const validated = validateAgent(fields)
  if (!validated.ok) {
    return { issue: { file, message: validated.error.message } }
  }

  return {
    template: { id, ...validated.value, builtin: false },
  }
}

/**
 * Built-in profiles plus every usable `work/templates/*.json`.
 *
 * A template file that shadows a built-in id is reported rather than allowed to
 * change what `reviewer` means. A non-JSON file (a README) is not an issue.
 */
export async function listTemplates(
  workspace: Workspace,
): Promise<Result<TemplateList, AgentError>> {
  const templates: AgentTemplate[] = [...BUILT_IN_TEMPLATES]
  const issues: TemplateIssue[] = []
  const taken = new Set(templates.map((template) => template.id))

  let entries
  try {
    entries = await readdir(templatesDir(workspace), { withFileTypes: true })
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return ok({ templates, issues })
    }
    return err({
      kind: "storage",
      path: templatesDir(workspace),
      message: `the template folder could not be read (${messageOf(error)})`,
    })
  }

  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."),
    )
    .map((entry) => entry.name)
    .sort()

  for (const file of files) {
    const path = join(templatesDir(workspace), file)
    let text: string
    try {
      text = await readFile(path, "utf8")
    } catch (error) {
      issues.push({ file, message: `could not be read (${messageOf(error)})` })
      continue
    }
    const parsed = readTemplateText(file, text)
    if (parsed.issue) {
      issues.push(parsed.issue)
      continue
    }
    const template = parsed.template as AgentTemplate
    if (taken.has(template.id)) {
      issues.push({
        file,
        message: `“${template.id}” is already the id of a built-in template; rename the file`,
      })
      continue
    }
    taken.add(template.id)
    templates.push(template)
  }

  return ok({ templates, issues })
}

async function resolveTemplate(
  workspace: Workspace,
  id: string,
): Promise<Result<AgentTemplate, AgentError>> {
  const builtIn = builtInTemplate(id)
  if (builtIn) return ok(builtIn)

  const listed = await listTemplates(workspace)
  if (!listed.ok) return listed
  const found = listed.value.templates.find((template) => template.id === id)
  if (!found) {
    return err({
      kind: "not-found",
      id,
      message: `there is no agent template called "${id}"`,
    })
  }
  return ok(found)
}

/* -------------------------------------------------------------------------- */
/* instantiation                                                               */
/* -------------------------------------------------------------------------- */

export type InstantiateTemplateInput = {
  workspace: Workspace
  projectId: string
  /** Built-in id or the file stem of a project template. */
  template: string
  /** Override the seeded name, e.g. when it is already taken. */
  name?: string
  /**
   * Field overrides such as a deliberately chosen model. `name`, `template` and
   * `allowCommand` are not overridable here: command access is enabled on the
   * saved agent, explicitly, never as a side effect of seeding.
   */
  overrides?: Partial<Omit<AgentInput, "name" | "template" | "allowCommand">>
}

/**
 * Seed a new agent from a template.
 *
 * The new profile gets a fresh id — prefixed with the project's name — and the
 * template keeps no link back other than the informational `template` field, so
 * editing the template later never rewrites existing agents.
 */
export async function instantiateTemplate(
  input: InstantiateTemplateInput,
): Promise<Result<AgentProfile, AgentError>> {
  const template = await resolveTemplate(input.workspace, input.template)
  if (!template.ok) return template

  const overrides = (input.overrides ?? {}) as Record<string, unknown>
  if (overrides.allowCommand !== undefined) {
    return err({
      kind: "invalid-input",
      field: "allowCommand",
      message:
        "command access is turned on for a saved agent, explicitly; it cannot be granted while instantiating a template",
    })
  }

  if (template.value.allowCommand) {
    return err({
      kind: "template",
      template: template.value.id,
      message:
        `the template “${template.value.name}” requests command access. ` +
        "Commands are a per-agent setting the user turns on explicitly, never a template default.",
    })
  }

  const meta = await loadProjectMeta(input.workspace, input.projectId)
  if (!meta.ok) return meta

  return createAgent({
    workspace: input.workspace,
    projectId: input.projectId,
    idPrefix: projectSlug(meta.value.name),
    name: input.name ?? template.value.name,
    role: template.value.role,
    instructions: template.value.instructions,
    model: template.value.model,
    maxToolCalls: template.value.maxToolCalls,
    allowedTools: [...template.value.allowedTools],
    allowWrite: template.value.allowWrite,
    allowCommand: false,
    template: template.value.id,
    ...input.overrides,
  })
}

/* -------------------------------------------------------------------------- */
/* saving                                                                      */
/* -------------------------------------------------------------------------- */

export type SaveTemplateInput = {
  workspace: Workspace
  /** The profile to snapshot. */
  agent: AgentProfile
  /** File stem; defaults to the slug of the agent name. */
  name?: string
}

function templatePayload(template: AgentTemplate): Record<string, unknown> {
  return {
    schema: TEMPLATE_SCHEMA,
    name: template.name,
    role: template.role,
    instructions: template.instructions,
    model: template.model,
    max_tool_calls: template.maxToolCalls,
    allowed_tools: [...template.allowedTools],
    allow_write: template.allowWrite,
    // A template may never grant command access; saving one that does would
    // produce a file that instantiation always refuses.
    allow_command: false,
  }
}

/**
 * Save a profile as a project template (`work/templates/<name>.json`).
 *
 * A built-in id is refused rather than shadowed: the shipped three must mean the
 * same thing in every project. The file is written atomically; saving over an
 * existing project template replaces it.
 */
export async function saveProjectTemplate(
  input: SaveTemplateInput,
): Promise<Result<AgentTemplate, AgentError>> {
  const name = (input.name ?? input.agent.name).trim()
  const validated = validateAgent({
    name,
    role: input.agent.role,
    instructions: input.agent.instructions,
    model: input.agent.model,
    maxToolCalls: input.agent.maxToolCalls,
    allowedTools: input.agent.allowedTools,
    allowWrite: input.agent.allowWrite,
    allowCommand: input.agent.allowCommand,
    template: "",
  })
  if (!validated.ok) return validated

  const id = slugify(name, 48)
  if (builtInTemplate(id)) {
    return err({
      kind: "template",
      template: id,
      message: `“${id}” is a built-in template id; choose another name`,
    })
  }

  const template: AgentTemplate = { id, ...validated.value, builtin: false }
  const directory = templatesDir(input.workspace)
  try {
    await mkdir(directory, { recursive: true })
  } catch (error) {
    return err({
      kind: "storage",
      path: directory,
      message: `the template folder could not be created (${messageOf(error)})`,
    })
  }

  const written = await writeJsonAtomic(join(directory, `${id}.json`), templatePayload(template))
  if (!written.ok) return written
  return ok(template)
}
