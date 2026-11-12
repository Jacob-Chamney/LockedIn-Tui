/**
 * Agent profiles for a Work project (WP-503).
 *
 * An agent profile is a *declaration of permission*, written before the agent
 * is allowed to do anything (`docs/product.md` §8.3, `docs/architecture.md`
 * §3.2, `docs/data-model.md` §6.1). Everything here is therefore about
 * narrowing, never widening:
 *
 * - `allowWrite` and `allowCommand` are **false unless written as true**, and a
 *   template or a swarm can never set them;
 * - `maxToolCalls` is bounded 1–32 and an unknown tool name is refused by name;
 * - exactly one default agent exists per project, and clearing it is a single
 *   atomic write (deleting the default leaves *no* default, which blocks project
 *   chat rather than silently picking another agent);
 * - a profile that no longer validates on reload is **reported**, not dropped,
 *   so a hand-edited `meta.json` is visible instead of mysterious.
 *
 * Storage is `work/projects/<id>/meta.json`, the same file WP-501 registers and
 * WP-502 reads. This module owns only the `agents` array and `default_agent`;
 * every other key — including keys a later packet adds — is preserved verbatim.
 *
 * The TypeScript shape is camelCase (`docs/architecture.md` §3.2); the file is
 * snake_case (`docs/data-model.md` §6.1). Both spellings are accepted on read so
 * a hand-edited file still loads, and only snake_case is written.
 */

import { randomUUID } from "node:crypto"
import { open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { slugify } from "../../domain/note"
import type { Workspace } from "../../storage/workspace"
import {
  assertProjectId,
  parseProjectMeta,
  projectMetaPath,
  type ProjectMeta,
  type WorkError,
} from "./register"
import { READ_ONLY_TOOL_NAMES } from "./scope"

/* -------------------------------------------------------------------------- */
/* limits and the known tool set                                               */
/* -------------------------------------------------------------------------- */

export const MAX_AGENT_NAME_CHARS = 60
export const MAX_ROLE_CHARS = 60
export const MAX_MODEL_CHARS = 200
export const MAX_AGENT_INSTRUCTIONS_CHARS = 20_000
export const MAX_TEMPLATE_ID_CHARS = 80

export const MIN_TOOL_CALLS = 1
export const MAX_TOOL_CALLS = 32
export const DEFAULT_TOOL_CALLS = 8

/** The reference default role; an empty role reads as this. */
export const DEFAULT_ROLE = "builder"

/**
 * Every tool name a profile may list **today**.
 *
 * This is the read-only project toolbox from WP-502. A packet that ships a write
 * or command tool extends this list in the same change, so "unknown tool" stays
 * a real refusal rather than a name-shaped no-op. Capabilities are carried by
 * `allowWrite`/`allowCommand`; the tool list says *which* tools, not *whether*.
 */
export const KNOWN_TOOL_NAMES: readonly string[] = READ_ONLY_TOOL_NAMES

/** A single folder-safe id, e.g. `reviewer-9ab12c`. */
export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

export type AgentProfile = {
  /** Stable for the life of the agent; renaming never changes it. */
  id: string
  name: string
  role: string
  instructions: string
  /** `""` means the project/chat default model. */
  model: string
  maxToolCalls: number
  /**
   * The tools this profile may call. An empty list means "every tool the
   * profile's capabilities permit" (the same rule WP-502 applies at chat time).
   */
  allowedTools: string[]
  allowWrite: boolean
  allowCommand: boolean
  /** The template id this profile was seeded from, or `""`. */
  template: string
}

export type AgentFields = Omit<AgentProfile, "id">

/**
 * Input for a new profile. Only `name` is required: every other field has a
 * documented default (`allowWrite`/`allowCommand` false, `maxToolCalls` 8, no
 * tools means "all permitted"), so a caller does not have to restate them.
 */
export type AgentInput = Partial<AgentFields> & Pick<AgentFields, "name">

export type AgentPatch = Partial<AgentFields>

export type AgentIssue = {
  /** Position in the stored `agents` array. */
  index: number
  id: string
  name: string
  field: string
  message: string
}

export type AgentList = {
  agents: AgentProfile[]
  /** Saved profiles that fail validation; shown, never silently dropped. */
  issues: AgentIssue[]
}

export type AgentError =
  | WorkError
  | { kind: "not-found"; id: string; message: string }
  | { kind: "unknown-tool"; tool: string; field: string; message: string }
  | { kind: "template"; template: string; message: string }

/* -------------------------------------------------------------------------- */
/* small helpers                                                               */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = codeOf(error)
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

function storageError(path: string, error: unknown, message: string): AgentError {
  return { kind: "storage", path, message: `${message} (${describe(error)})` }
}

function inputError(field: string, message: string): AgentError {
  return { kind: "invalid-input", field, message }
}

/**
 * One writer per `meta.json`.
 *
 * Registration, agents and (later) tasks all read-modify-write the same file;
 * serialising in-process is what stops two quick agent edits from producing a
 * file that contains half of each. The queue is keyed by the absolute path.
 */
const writeQueues = new Map<string, Promise<unknown>>()

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  writeQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/**
 * Temp file in the destination directory, fsync, rename, then fsync the
 * directory best-effort (`docs/data-model.md` §3). A crash leaves the previous
 * `meta.json` or the new one, never half a file.
 */
export async function writeJsonAtomic(
  destination: string,
  value: unknown,
): Promise<Result<void, AgentError>> {
  const directory = dirname(destination)
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  const payload = `${JSON.stringify(value, null, 2)}\n`
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await open(temporary, "w")
    await handle.writeFile(payload, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, destination)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // Nothing useful to do with a close failure here.
    }
    await rm(temporary, { force: true })
    return err(storageError(destination, error, "the project metadata could not be written"))
  }

  try {
    const dirHandle = await open(directory, "r")
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    // Directory fsync is not supported everywhere; the rename already landed.
  }

  return ok(undefined)
}

/* -------------------------------------------------------------------------- */
/* project state                                                               */
/* -------------------------------------------------------------------------- */

type ProjectState = {
  path: string
  /** The raw JSON object, so unknown keys survive a rewrite. */
  raw: Record<string, unknown>
  meta: ProjectMeta
  rawAgents: unknown[]
}

async function readState(
  workspace: Workspace,
  projectId: string,
): Promise<Result<ProjectState, AgentError>> {
  const id = assertProjectId(projectId)
  if (!id.ok) return id

  const path = projectMetaPath(workspace, id.value)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return err({
        kind: "path",
        path,
        reason: "missing",
        message: "this project is not registered in this workspace",
      })
    }
    return err(storageError(path, error, "the project metadata could not be read"))
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return err({
      kind: "invalid-meta",
      path,
      field: "json",
      message: `meta.json is not valid JSON (${describe(error)})`,
    })
  }

  const parsed = parseProjectMeta(raw, path)
  if (!parsed.ok) return parsed

  const record = raw as Record<string, unknown>
  const rawAgents = Array.isArray(record.agents) ? record.agents : []
  return ok({ path, raw: record, meta: parsed.value, rawAgents })
}

/** The project's registration record, for callers that only need a name/root. */
export async function loadProjectMeta(
  workspace: Workspace,
  projectId: string,
): Promise<Result<ProjectMeta, AgentError>> {
  const state = await readState(workspace, projectId)
  if (!state.ok) return state
  return ok(state.value.meta)
}

async function writeState(
  state: ProjectState,
  agents: unknown[],
  defaultAgent: string,
): Promise<Result<void, AgentError>> {
  return writeJsonAtomic(state.path, {
    ...state.raw,
    agents,
    default_agent: defaultAgent,
  })
}

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

function text(raw: unknown, field: string, max: number): Result<string, AgentError> {
  if (typeof raw !== "string") {
    return err(inputError(field, `${field} must be text`))
  }
  const value = raw.trim()
  if (value.length > max) {
    return err(inputError(field, `${field} is at most ${max} characters`))
  }
  return ok(value)
}

function optionalText(
  raw: unknown,
  field: string,
  max: number,
): Result<string, AgentError> {
  if (raw === undefined) return ok("")
  return text(raw, field, max)
}

function boolean(raw: unknown, field: string): Result<boolean, AgentError> {
  if (raw === undefined) return ok(false)
  if (typeof raw !== "boolean") {
    return err(inputError(field, `${field} must be true or false`))
  }
  return ok(raw)
}

/**
 * Validate one profile, with or without an id.
 *
 * `takenNames` is every other agent name in the project; names are compared
 * case-insensitively after trimming, so "Reviewer" and "reviewer" cannot both
 * exist. Validation never mutates its input and never writes.
 */
export function validateAgent(
  raw: unknown,
  options: { takenNames?: Iterable<string> } = {},
): Result<AgentFields, AgentError> {
  if (!isRecord(raw)) {
    return err(inputError("name", "an agent must be a JSON object"))
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : raw.name
  if (typeof name !== "string") {
    return err(inputError("name", "an agent name must be text"))
  }
  if (name === "") {
    return err(inputError("name", "an agent needs a name"))
  }
  if (name.length > MAX_AGENT_NAME_CHARS) {
    return err(
      inputError("name", `an agent name is at most ${MAX_AGENT_NAME_CHARS} characters`),
    )
  }
  if (options.takenNames) {
    const folded = name.toLowerCase()
    for (const taken of options.takenNames) {
      if (taken.trim().toLowerCase() === folded) {
        return err(
          inputError("name", `“${name}” is already used by another agent in this project`),
        )
      }
    }
  }

  const role = optionalText(raw.role, "role", MAX_ROLE_CHARS)
  if (!role.ok) return role
  const instructions = optionalText(
    raw.instructions,
    "instructions",
    MAX_AGENT_INSTRUCTIONS_CHARS,
  )
  if (!instructions.ok) return instructions
  const model = optionalText(raw.model, "model", MAX_MODEL_CHARS)
  if (!model.ok) return model
  const template = optionalText(raw.template, "template", MAX_TEMPLATE_ID_CHARS)
  if (!template.ok) return template

  const allowWrite = boolean(raw.allowWrite, "allowWrite")
  if (!allowWrite.ok) return allowWrite
  const allowCommand = boolean(raw.allowCommand, "allowCommand")
  if (!allowCommand.ok) return allowCommand

  let maxToolCalls = DEFAULT_TOOL_CALLS
  if (raw.maxToolCalls !== undefined) {
    if (
      typeof raw.maxToolCalls !== "number" ||
      !Number.isInteger(raw.maxToolCalls) ||
      raw.maxToolCalls < MIN_TOOL_CALLS ||
      raw.maxToolCalls > MAX_TOOL_CALLS
    ) {
      return err(
        inputError(
          "maxToolCalls",
          `maxToolCalls must be a whole number from ${MIN_TOOL_CALLS} to ${MAX_TOOL_CALLS}`,
        ),
      )
    }
    maxToolCalls = raw.maxToolCalls
  }

  let allowedTools: string[] = []
  if (raw.allowedTools !== undefined) {
    if (!Array.isArray(raw.allowedTools)) {
      return err(inputError("allowedTools", "allowedTools must be a list of tool names"))
    }
    const seen = new Set<string>()
    for (const entry of raw.allowedTools) {
      if (typeof entry !== "string" || entry.trim() === "") {
        return err(inputError("allowedTools", "a tool name must be a non-empty string"))
      }
      const tool = entry.trim()
      if (!KNOWN_TOOL_NAMES.includes(tool)) {
        return err({
          kind: "unknown-tool",
          tool,
          field: "allowedTools",
          message: `unknown tool "${tool}"; known tools are ${KNOWN_TOOL_NAMES.join(", ")}`,
        })
      }
      if (seen.has(tool)) continue
      seen.add(tool)
      allowedTools.push(tool)
    }
  }

  return ok({
    name,
    role: role.value === "" ? DEFAULT_ROLE : role.value,
    instructions: instructions.value,
    model: model.value,
    maxToolCalls,
    allowedTools,
    allowWrite: allowWrite.value,
    allowCommand: allowCommand.value,
    template: template.value,
  })
}

/* -------------------------------------------------------------------------- */
/* disk codec                                                                  */
/* -------------------------------------------------------------------------- */

function toDisk(agent: AgentProfile): Record<string, unknown> {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    instructions: agent.instructions,
    model: agent.model,
    max_tool_calls: agent.maxToolCalls,
    allowed_tools: [...agent.allowedTools],
    allow_write: agent.allowWrite,
    allow_command: agent.allowCommand,
    template: agent.template,
  }
}

/**
 * snake_case first, camelCase accepted for a hand-edited file.
 *
 * Exported so template files use the same field names as `meta.json` and are
 * validated by the same rules instead of growing a second codec.
 */
export function agentFieldsFromDisk(raw: Record<string, unknown>): Record<string, unknown> {
  const value = (snake: string, camel: string): unknown =>
    raw[snake] !== undefined ? raw[snake] : raw[camel]

  return {
    name: raw.name,
    role: value("role", "role"),
    instructions: value("instructions", "instructions"),
    model: value("model", "model"),
    maxToolCalls: value("max_tool_calls", "maxToolCalls"),
    allowedTools: value("allowed_tools", "allowedTools"),
    allowWrite: value("allow_write", "allowWrite"),
    allowCommand: value("allow_command", "allowCommand"),
    template: value("template", "template"),
  }
}

/* -------------------------------------------------------------------------- */
/* ids                                                                         */
/* -------------------------------------------------------------------------- */

function shortHash(base: string, salt: number): string {
  return new Bun.CryptoHasher("sha256")
    .update(`work-agent\u0000${base}\u0000${salt}`)
    .digest("hex")
    .slice(0, 6)
}

/**
 * `<slug>-<6 hex>`, salted until free.
 *
 * `prefix` is used by template instantiation so a seeded profile carries the
 * project's name before the template's (`my-app-reviewer-4f2a1c`); a plain
 * create yields the documented `reviewer-9ab12c` form. The result depends only
 * on the inputs, so two runs over the same state agree.
 */
export function agentId(
  name: string,
  taken: Iterable<string> = [],
  prefix = "",
): string {
  const used = new Set(taken)
  const slug = slugify(name, 32)
  const base = prefix.trim() === "" ? slug : `${slugify(prefix, 24)}-${slug}`
  for (let salt = 0; ; salt++) {
    const candidate = `${base}-${shortHash(base, salt)}`
    if (!used.has(candidate)) return candidate
  }
}

function validAgentId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_TEMPLATE_ID_CHARS && AGENT_ID_PATTERN.test(id)
}

/* -------------------------------------------------------------------------- */
/* parsing stored profiles                                                     */
/* -------------------------------------------------------------------------- */

type FoundAgent = { agent: AgentProfile; index: number }

export type ParsedAgents = {
  agents: AgentProfile[]
  issues: AgentIssue[]
  found: FoundAgent[]
}

/**
 * Read every saved profile, reporting the ones that fail validation.
 *
 * One broken entry must not hide the others, and it must not disappear: the
 * caller gets an issue with the position, the id it could read and the field
 * that failed, so the editor can show "profile 2 is invalid" instead of
 * pretending the agent was never saved.
 */
export function parseAgents(rawAgents: readonly unknown[]): ParsedAgents {
  const found: FoundAgent[] = []
  const issues: AgentIssue[] = []
  const names = new Map<string, string>()

  rawAgents.forEach((raw, index) => {
    if (!isRecord(raw)) {
      issues.push({
        index,
        id: "",
        name: "",
        field: "agent",
        message: "an agent entry is not a JSON object",
      })
      return
    }
    const id = typeof raw.id === "string" ? raw.id : ""
    const name = typeof raw.name === "string" ? raw.name : ""
    if (!validAgentId(id)) {
      issues.push({
        index,
        id,
        name,
        field: "id",
        message:
          id === ""
            ? "an agent needs an id"
            : `"${id}" is not a valid agent id; use lowercase letters, digits and dashes`,
      })
      return
    }

    const validated = validateAgent(agentFieldsFromDisk(raw))
    if (!validated.ok) {
      issues.push({
        index,
        id,
        name,
        field: "field" in validated.error ? validated.error.field : "agent",
        message: validated.error.message,
      })
      return
    }

    const folded = validated.value.name.toLowerCase()
    if (names.has(folded)) {
      issues.push({
        index,
        id,
        name,
        field: "name",
        message: `another agent in this project is already called “${validated.value.name}”`,
      })
      return
    }
    names.set(folded, id)
    found.push({ agent: { id, ...validated.value }, index })
  })

  return { agents: found.map((entry) => entry.agent), issues, found }
}

/* -------------------------------------------------------------------------- */
/* reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every valid profile plus the issues found in the stored array.
 *
 * An empty project returns `{ agents: [], issues: [] }` — the home screen shows
 * `0 agents`, which is a state, not an error.
 */
export async function listAgents(
  workspace: Workspace,
  projectId: string,
): Promise<Result<AgentList, AgentError>> {
  const state = await readState(workspace, projectId)
  if (!state.ok) return state
  const parsed = parseAgents(state.value.rawAgents)
  return ok({ agents: parsed.agents, issues: parsed.issues })
}

/** One profile by id; an unreadable saved entry is reported, not hidden. */
export async function getAgent(
  workspace: Workspace,
  projectId: string,
  agentIdValue: string,
): Promise<Result<AgentProfile, AgentError>> {
  const state = await readState(workspace, projectId)
  if (!state.ok) return state
  const parsed = parseAgents(state.value.rawAgents)

  const found = parsed.found.find((entry) => entry.agent.id === agentIdValue)
  if (found) return ok(found.agent)

  const index = state.value.rawAgents.findIndex(
    (raw) => isRecord(raw) && raw.id === agentIdValue,
  )
  if (index >= 0) {
    const issue = parsed.issues.find((entry) => entry.index === index)
    return err({
      kind: "invalid-meta",
      path: state.value.path,
      field: `agents[${index}].${issue?.field ?? "agent"}`,
      message: issue?.message ?? "this saved agent profile is not valid",
    })
  }

  return err({
    kind: "not-found",
    id: agentIdValue,
    message: `this project has no agent "${agentIdValue}"`,
  })
}

/* -------------------------------------------------------------------------- */
/* writes                                                                      */
/* -------------------------------------------------------------------------- */

export type CreateAgentInput = {
  workspace: Workspace
  projectId: string
  /**
   * Prepended to the generated id. Template instantiation passes the project
   * name; a manual create leaves it empty.
   */
  idPrefix?: string
  /**
   * Pre-computed id, so the shell can paint the agent without waiting for the
   * meta write. It must be a free, valid id or the create is refused.
   */
  id?: string
} & AgentInput

/** Every name already used, including entries that themselves fail validation. */
function takenNames(rawAgents: readonly unknown[], exceptIndex = -1): string[] {
  const names: string[] = []
  rawAgents.forEach((raw, index) => {
    if (index === exceptIndex) return
    if (isRecord(raw) && typeof raw.name === "string" && raw.name.trim() !== "") {
      names.push(raw.name)
    }
  })
  return names
}

function takenIds(rawAgents: readonly unknown[]): string[] {
  return rawAgents
    .map((raw) => (isRecord(raw) && typeof raw.id === "string" ? raw.id : ""))
    .filter((id) => id !== "")
}

/**
 * Create one agent.
 *
 * The id, not the name, is the identity: it is generated once here and never
 * regenerated by an update. `default_agent` is **not** touched — choosing a
 * default is a separate, explicit action.
 */
export async function createAgent(
  input: CreateAgentInput,
): Promise<Result<AgentProfile, AgentError>> {
  const project = assertProjectId(input.projectId)
  if (!project.ok) return project
  const path = projectMetaPath(input.workspace, project.value)

  return serialize(path, async () => {
    const state = await readState(input.workspace, project.value)
    if (!state.ok) return state

    const validated = validateAgent(input, {
      takenNames: takenNames(state.value.rawAgents),
    })
    if (!validated.ok) return validated

    const used = takenIds(state.value.rawAgents)
    if (input.id !== undefined && (!validAgentId(input.id) || used.includes(input.id))) {
      return err({
        kind: "invalid-input",
        field: "id",
        message: `"${input.id}" is not a free agent id`,
      })
    }
    const agent: AgentProfile = {
      id: input.id ?? agentId(validated.value.name, used, input.idPrefix),
      ...validated.value,
    }

    const written = await writeState(
      state.value,
      [...state.value.rawAgents, toDisk(agent)],
      state.value.meta.default_agent,
    )
    if (!written.ok) return written
    return ok(agent)
  })
}

export type UpdateAgentInput = {
  workspace: Workspace
  projectId: string
  id: string
  patch: AgentPatch
}

/**
 * Update one agent in place.
 *
 * The `id` is taken from the stored record, never from the patch, so renaming
 * or retargeting the model keeps every reference valid. Unknown keys on the
 * stored record (a field a later packet owns) are preserved.
 */
export async function updateAgent(
  input: UpdateAgentInput,
): Promise<Result<AgentProfile, AgentError>> {
  const project = assertProjectId(input.projectId)
  if (!project.ok) return project
  const path = projectMetaPath(input.workspace, project.value)

  return serialize(path, async () => {
    const state = await readState(input.workspace, project.value)
    if (!state.ok) return state

    const index = state.value.rawAgents.findIndex(
      (raw) => isRecord(raw) && raw.id === input.id,
    )
    const stored = index >= 0 ? state.value.rawAgents[index] : undefined
    if (!isRecord(stored) || !validAgentId(input.id)) {
      return err({
        kind: "not-found",
        id: input.id,
        message: `this project has no agent "${input.id}"`,
      })
    }

    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input.patch)) {
      if (value !== undefined) patch[key] = value
    }

    const validated = validateAgent(
      { ...agentFieldsFromDisk(stored), ...patch },
      { takenNames: takenNames(state.value.rawAgents, index) },
    )
    if (!validated.ok) return validated

    const agent: AgentProfile = { id: input.id, ...validated.value }
    const agents = [...state.value.rawAgents]
    agents[index] = { ...stored, ...toDisk(agent) }

    const written = await writeState(state.value, agents, state.value.meta.default_agent)
    if (!written.ok) return written
    return ok(agent)
  })
}

export type DeleteAgentInput = {
  workspace: Workspace
  projectId: string
  id: string
}

export type DeleteAgentResult = {
  id: string
  /** The deleted agent was the default, so the project now has none. */
  defaultCleared: boolean
}

/**
 * Delete one agent.
 *
 * Deleting the last agent and deleting the default are both allowed. The
 * default is cleared in the same write; the project is then in the documented
 * blocked state (WP-502's `choose a default agent for this project`), never a
 * silent promotion of a neighbour.
 */
export async function deleteAgent(
  input: DeleteAgentInput,
): Promise<Result<DeleteAgentResult, AgentError>> {
  const project = assertProjectId(input.projectId)
  if (!project.ok) return project
  const path = projectMetaPath(input.workspace, project.value)

  return serialize(path, async () => {
    const state = await readState(input.workspace, project.value)
    if (!state.ok) return state

    const index = state.value.rawAgents.findIndex(
      (raw) => isRecord(raw) && raw.id === input.id,
    )
    if (index < 0) {
      return err({
        kind: "not-found",
        id: input.id,
        message: `this project has no agent "${input.id}"`,
      })
    }

    const defaultCleared = state.value.meta.default_agent === input.id
    const agents = state.value.rawAgents.filter((_, position) => position !== index)
    const written = await writeState(
      state.value,
      agents,
      defaultCleared ? "" : state.value.meta.default_agent,
    )
    if (!written.ok) return written
    return ok({ id: input.id, defaultCleared })
  })
}

export type SetDefaultAgentInput = {
  workspace: Workspace
  projectId: string
  /** `""` clears the default; anything else must name a valid saved agent. */
  id: string
}

export type SetDefaultAgentResult = { defaultAgent: string }

/**
 * Set (or clear) the project default.
 *
 * Exactly one default exists at a time because the previous value is replaced in
 * the same atomic write. A default id that does not name a **valid** saved agent
 * is refused, so `meta.json` can never point at a profile that cannot run.
 */
export async function setDefaultAgent(
  input: SetDefaultAgentInput,
): Promise<Result<SetDefaultAgentResult, AgentError>> {
  const project = assertProjectId(input.projectId)
  if (!project.ok) return project
  const path = projectMetaPath(input.workspace, project.value)

  return serialize(path, async () => {
    const state = await readState(input.workspace, project.value)
    if (!state.ok) return state

    if (input.id !== "") {
      const parsed = parseAgents(state.value.rawAgents)
      if (!parsed.agents.some((agent) => agent.id === input.id)) {
        return err({
          kind: "not-found",
          id: input.id,
          message: `this project has no valid agent "${input.id}"`,
        })
      }
    }

    const written = await writeState(
      state.value,
      state.value.rawAgents,
      input.id,
    )
    if (!written.ok) return written
    return ok({ defaultAgent: input.id })
  })
}

/* -------------------------------------------------------------------------- */
/* swarm boundary                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The tools a profile may actually call: its list, or every known tool when the
 * list is empty (WP-502's rule, kept in one place).
 */
export function effectiveToolNames(agent: AgentProfile): string[] {
  return agent.allowedTools.length === 0
    ? [...KNOWN_TOOL_NAMES]
    : [...agent.allowedTools]
}

/**
 * The **only** way a swarm worker gets a profile.
 *
 * A coordinator may hand a worker any agent, including `implementer`; the copy
 * that crosses into the swarm is forced read-only and command-free, and its tool
 * list keeps only read-only names. Because the copy is a value, a worker holding
 * it cannot flip a flag on the project's stored profile either.
 */
export function forSwarm(agent: AgentProfile): AgentProfile {
  const readOnly = new Set<string>(READ_ONLY_TOOL_NAMES)
  return {
    ...agent,
    allowedTools: effectiveToolNames(agent).filter((name) => readOnly.has(name)),
    allowWrite: false,
    allowCommand: false,
  }
}
