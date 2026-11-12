/** Lock-in creation, source-picker loading and session chat context. */
import { createLockInSession, type CreateRequest, type CreateOutcome, type CreateError } from "../../services/lockin/create"
import { sessionContext, sessionContextReport } from "../../services/lockin/context"
import {
  importSessionInstructions,
  loadSessionSettings,
  reExtractInstructions,
  saveSessionPrompt,
  type InstructionsError,
  type SessionSettingsData,
} from "../../services/lockin/instructions"
import { addSources, sessionFolderFor } from "../../services/lockin/manager"
import { createToolbox } from "../../services/lockin/toolbox"
import { stampStepsGeneration, stepsAreStale } from "../../services/lockin/generation"
import { SESSION_FILES, type InstructionsSource } from "../../domain/session"
import {
  appendConfidence,
  appendMisconception,
  parkQuestion,
  questionCount,
  readSessionFile,
  writeIntakeLevel,
  writeSessionFile,
} from "../../services/lockin/insights"
import type { ChatToolSource } from "./projects"
import {
  broadSteps,
  generateSteps,
  readSteps,
  toggleStep,
  validatePlan,
  type StepPlan,
} from "../../services/lockin/steps"
import type { Result } from "../../domain/markdown"
import { join } from "node:path"
import type { Workspace } from "../../storage/workspace"

export { previewFile as previewPickerFile } from "../../services/lockin/preview"

export type PickerApi = typeof import("../../services/lockin/picker")
let picker: PickerApi | null = null

export async function pickerApi(): Promise<PickerApi> {
  picker ??= await import("../../services/lockin/picker")
  return picker
}

export async function createLockIn(request: CreateRequest): Promise<Result<CreateOutcome, CreateError>> {
  return createLockInSession(request)
}

export async function lockInContext(workspace: Workspace, id: string): Promise<string> {
  return sessionContext(workspace, id)
}

/**
 * The session's own read-only source tools. The toolbox is bound to
 * `<session>/sources`, so no prompt can widen it, and every spec is
 * `write: false` / `command: false`.
 */
export function sessionTools(workspace: Workspace, id: string): ChatToolSource {
  const box = createToolbox({ workspace, sessionId: id })
  return {
    // The toolbox declares its own schema shape; the specs are validated there.
    specs: box.specs as unknown as import("../../llm/tools").ToolSpec[],
    resolveTool: async (name, args) => {
      switch (name) {
        case "list_sources":
          return JSON.stringify(await box.tools.listSources())
        case "read_source": {
          const source = typeof args.name === "string" ? args.name : ""
          return JSON.stringify(await box.tools.readSource(source))
        }
        case "search_sources": {
          const term = typeof args.term === "string" ? args.term : ""
          return JSON.stringify(await box.tools.searchSources(term))
        }
        default:
          return JSON.stringify({
            ok: false,
            error: {
              kind: "blocked",
              message: `unknown tool "${name}"`,
              next: "Use list_sources, read_source or search_sources.",
            },
          })
      }
    },
    context: async (context) =>
      sessionContext(workspace, id, { webExplicit: context?.webExplicit === true }),
  }
}

function sessionFolder(workspace: Workspace, id: string): string {
  return sessionFolderFor(workspace, id)
}

/** The session's original assignment instructions (`prompt.md`). */
export async function loadSessionPrompt(workspace: Workspace, id: string): Promise<string | null> {
  try {
    return await Bun.file(join(sessionFolder(workspace, id), "prompt.md")).text()
  } catch {
    return null
  }
}

export type SessionInstructionsData = SessionSettingsData

function instructionsFailure(error: InstructionsError): { message: string } {
  return { message: error.message }
}

export async function loadSessionInstructions(
  workspace: Workspace,
  id: string,
): Promise<Result<SessionInstructionsData, { message: string }>> {
  const loaded = await loadSessionSettings({ workspace, id })
  return loaded.ok ? loaded : { ok: false, error: instructionsFailure(loaded.error) }
}

export async function saveSessionInstructions(input: {
  workspace: Workspace
  id: string
  text: string
}): Promise<Result<{ prompt: string }, { message: string }>> {
  const saved = await saveSessionPrompt(input)
  return saved.ok ? { ok: true, value: { prompt: saved.value.prompt } } : { ok: false, error: instructionsFailure(saved.error) }
}

export async function importSessionInstructionsFile(input: {
  workspace: Workspace
  id: string
  file: string
}): Promise<Result<{ prompt: string; instructions: InstructionsSource; added: boolean }, { message: string }>> {
  const imported = await importSessionInstructions(input)
  return imported.ok
    ? {
        ok: true,
        value: {
          prompt: imported.value.prompt,
          instructions: imported.value.instructions,
          added: imported.value.added,
        },
      }
    : { ok: false, error: instructionsFailure(imported.error) }
}

export async function reExtractSessionInstructions(
  workspace: Workspace,
  id: string,
): Promise<Result<{ prompt: string; instructions: InstructionsSource }, { message: string }>> {
  const extracted = await reExtractInstructions({ workspace, id })
  return extracted.ok
    ? { ok: true, value: { prompt: extracted.value.prompt, instructions: extracted.value.instructions } }
    : { ok: false, error: instructionsFailure(extracted.error) }
}

/** The session's `assignment-steps.md`, or null when it has none yet. */
export async function loadSessionSteps(workspace: Workspace, id: string): Promise<string | null> {
  return readSteps(sessionFolder(workspace, id))
}

/** Toggle one step; the file is the truth and the caller replaces its copy. */
export async function toggleSessionStep(
  workspace: Workspace,
  id: string,
  index: number,
): Promise<Result<string, { message: string }>> {
  const toggled = await toggleStep({ folder: sessionFolder(workspace, id), index })
  if (!toggled.ok) return { ok: false, error: { message: toggled.error.kind === "blocked" ? toggled.error.message : "the steps file could not be written" } }
  return { ok: true, value: toggled.value.text }
}

/** Add picked files to an existing, live session. */
export async function addSessionSources(input: {
  workspace: Workspace
  id: string
  files: readonly string[]
}): Promise<Result<{ added: number; skipped: number }, { message: string }>> {
  const result = await addSources(input)
  if (!result.ok) return { ok: false, error: { message: result.error.kind === "blocked" ? result.error.message : "the sources could not be added" } }
  return { ok: true, value: { added: result.value.added, skipped: result.value.skipped } }
}

/** Turn a provider failure into one sentence the reader can show in full. */
export function stepFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/overload/i.test(text)) {
    return "the provider is overloaded upstream; wait a few seconds, then press R, or pick another generation model in Settings → Models"
  }
  const rate = /rate[- ]?limit/i.test(text)
  if (rate) return "the provider is rate limiting; wait a moment, then press R to retry"
  const failed = /generation failed:\s*(.+)/i.exec(text)
  if (failed) {
    if (/output ceiling/i.test(failed[1]!)) {
      return "the generation hit the output ceiling; press R to retry"
    }
    return `step generation failed (${failed[1]}); press R to retry`
  }
  if (/no readable sources/i.test(text)) return "this session has no readable sources to build steps from"
  return text
}

/** Return the first complete `{...}` object, respecting strings and escapes. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{")
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < raw.length; index++) {
    const char = raw[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) return raw.slice(start, index + 1)
    }
  }
  return null
}

/** Escape literal control characters inside JSON strings (models sometimes emit newlines). */
function escapeControlChars(text: string): string {
  let out = ""
  let inString = false
  let escaped = false
  for (const char of text) {
    if (!inString) {
      if (char === '"') inString = true
      out += char
      continue
    }
    if (escaped) {
      escaped = false
      out += char
      continue
    }
    if (char === "\\") {
      escaped = true
      out += char
      continue
    }
    if (char === '"') {
      inString = false
      out += char
      continue
    }
    if (char === "\n") out += "\\n"
    else if (char === "\r") out += "\\r"
    else if (char === "\t") out += "\\t"
    else if (char.charCodeAt(0) < 0x20) out += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
    else out += char
  }
  return out
}

/** Remove trailing commas before a closing brace/bracket, outside strings. */
function removeTrailingCommas(text: string): string {
  let out = ""
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === ",") {
      let next = index + 1
      while (next < text.length && /\s/.test(text[next]!)) next++
      if (text[next] === "}" || text[next] === "]") continue
    }
    out += char
  }
  return out
}

function parseStepPlan(raw: string): Result<StepPlan, { message: string }> {
  const object = extractJsonObject(raw)
  if (object === null) {
    return {
      ok: false,
      error: {
        message:
          "the model returned incomplete JSON; it may have hit the output ceiling. Press R to retry.",
      },
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(object)
  } catch {
    try {
      parsed = JSON.parse(removeTrailingCommas(object))
    } catch {
      try {
        parsed = JSON.parse(removeTrailingCommas(escapeControlChars(object)))
      } catch {
        return {
          ok: false,
          error: {
            message:
              "the model returned invalid JSON; press R to retry. If this repeats, the generation may be hitting its output ceiling.",
          },
        }
      }
    }
  }
  const candidate = (parsed ?? {}) as { phases?: unknown }
  if (!Array.isArray(candidate.phases) || candidate.phases.length === 0) {
    return { ok: false, error: { message: "the model returned no phases" } }
  }
  const plan: StepPlan = {
    phases: candidate.phases.map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      return {
        phase: typeof row.phase === "string" ? row.phase : "",
        items: Array.isArray(row.items) ? row.items.filter((item): item is string => typeof item === "string") : [],
      }
    }),
  }
  const valid = validatePlan(plan)
  return valid.ok ? valid : { ok: false, error: { message: valid.error.message } }
}

const STEP_PROMPT = [
  "Write assignment steps for a study session from the assignment instructions and selected sources below.",
  'Reply with JSON only: {"phases":[{"phase":"...","items":["..."]}]}.',
  "First extract every explicit deliverable, operator, function, file, section, equation and acceptance condition from the instructions.",
  "Give every extracted requirement at least one concrete step and use the assignment's own phase names when it has sections.",
  "Each step must name a concrete action and object: a file, symbol, operator, equation, problem number, output or test.",
  "State what completion or verification looks like where possible.",
  "Split implement, test and verify into separate steps when they are independent actions.",
  "Never use a vague standalone step such as 'Review the assignment', 'Understand X', 'Study the material' or 'Familiarize yourself'.",
  "Do not invent requirements that the instructions and sources do not support.",
  "The previous steps are deliberately not included; derive a fresh plan.",
  "Use 6 to 30 steps in 2 to 6 phases. Each step is one short imperative line.",
  "Every step must be supported by the text below.",
].join("\n")

const REFINE_PROMPT = [
  "The previous step plan is too broad. Rewrite the full plan.",
  "Do not merely rename a broad step: split it into concrete, checkable actions.",
  "Every step must name a concrete object from the assignment and say what completion looks like.",
  "Keep the assignment's own sections and terminology as phases where possible.",
  'Reply with JSON only: {"phases":[{"phase":"...","items":["..."]}]}.',
].join("\n")

/** Regenerate steps from the session's own sources, keeping checked text. */
export async function regenerateSessionSteps(input: {
  workspace: Workspace
  id: string
  generate: (prompt: string) => Promise<string>
}): Promise<Result<{ markdown: string; kept: number; lost: number }, { message: string }>> {
  // Old steps and generated outputs are deliberately absent: regeneration must
  // derive a fresh plan from the assignment, not copy the previous one.
  const report = await sessionContextReport(input.workspace, input.id, {
    includeSteps: false,
    includeOutputs: false,
  })
  const blocking = report.unreadable.filter((entry) => entry.kind !== "image")
  if (blocking.length > 0) {
    const details = blocking
      .map((entry) => `${entry.name} (${entry.kind}): ${entry.message}`)
      .join("; ")
    return {
      ok: false,
      error: { message: `steps cannot be built because a source could not be read: ${details}` },
    }
  }
  if (report.text.trim() === "") {
    return { ok: false, error: { message: "this session has no readable sources to build steps from" } }
  }
  let raw: string
  try {
    raw = await input.generate([STEP_PROMPT, "", report.text].join("\n"))
  } catch (error) {
    return { ok: false, error: { message: stepFailureMessage(error) } }
  }
  const first = parseStepPlan(raw)
  let valid = first
  if (valid.ok) {
    const broad = broadSteps(valid.value)
    if (broad.length > 0) {
      const listed = broad.slice(0, 8).map((step) => `- ${step.text} (${step.reason})`).join("\n")
      try {
        const refinedRaw = await input.generate([
          REFINE_PROMPT,
          "",
          "Too-broad steps:",
          listed,
          "",
          report.text,
        ].join("\n"))
        const refined = parseStepPlan(refinedRaw)
        if (refined.ok) valid = refined
      } catch {
        // A failed quality pass keeps the first valid plan; it is not a request retry.
      }
    }
  }
  if (!valid.ok) return { ok: false, error: { message: valid.error.message } }
  const folder = sessionFolder(input.workspace, input.id)
  const generated = await generateSteps({ folder, plan: valid.value, confirmed: true })
  if (!generated.ok) return { ok: false, error: { message: generated.error.message } }
  await stampStepsGeneration({ workspace: input.workspace, id: input.id })
  return {
    ok: true,
    value: { markdown: generated.value.markdown, kept: generated.value.kept, lost: generated.value.lost },
  }
}

/** Names of the sources already copied into one session. */
export async function loadSessionSourceNames(workspace: Workspace, id: string): Promise<string[]> {
  const listed = await createToolbox({ workspace, sessionId: id }).tools.listSources()
  return listed.ok ? listed.value.map((source) => source.name) : []
}

/** Save a question without interrupting the current step. */
export async function parkSessionQuestion(input: {
  workspace: Workspace
  id: string
  text: string
  step?: string
}): Promise<Result<number, { message: string }>> {
  try {
    const count = await parkQuestion(sessionFolder(input.workspace, input.id), input.text, input.step)
    return { ok: true, value: count }
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}

export async function loadSessionQuestions(workspace: Workspace, id: string): Promise<string | null> {
  const text = await readSessionFile(sessionFolder(workspace, id), SESSION_FILES.questions)
  return text.trim() === "" ? null : text
}

export async function loadParkedQuestionCount(workspace: Workspace, id: string): Promise<number> {
  return questionCount(sessionFolder(workspace, id))
}

export async function saveIntakeLevel(
  workspace: Workspace,
  id: string,
  level: "beginner" | "intermediate" | "advanced",
): Promise<Result<void, { message: string }>> {
  try {
    await writeIntakeLevel(sessionFolder(workspace, id), level)
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}

export async function appendSessionMisconception(input: {
  workspace: Workspace
  id: string
  text: string
  step?: string
}): Promise<Result<void, { message: string }>> {
  try {
    await appendMisconception(sessionFolder(input.workspace, input.id), input.text, input.step)
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}

export async function recordSessionConfidence(input: {
  workspace: Workspace
  id: string
  rating: number
  step?: string
}): Promise<Result<void, { message: string }>> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: { message: "confidence must be a whole number from 1 to 5" } }
  }
  try {
    await appendConfidence(sessionFolder(input.workspace, input.id), input.rating, input.step)
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}

export type SessionDocumentKind = "contract" | "contradictions" | "check"

/** Generate one Markdown learning document from the session's own context. */
export async function generateSessionDocument(input: {
  workspace: Workspace
  id: string
  kind: SessionDocumentKind
  generate: (prompt: string) => Promise<string>
  attempt?: string
}): Promise<Result<{ text: string; name: string }, { message: string }>> {
  const context = await sessionContext(input.workspace, input.id, {
    includeSteps: input.kind !== "contract",
    includeOutputs: false,
  })
  if (context.trim() === "") {
    return { ok: false, error: { message: "this session has no readable sources" } }
  }
  const prompts: Record<SessionDocumentKind, string> = {
    contract:
      "From the assignment instructions and sources below, extract the deliverables and acceptance criteria. Reply in Markdown with a short 'Done when' checklist. Do not solve the assignment.",
    contradictions:
      "Compare the session sources. List only substantive contradictions, differences in terminology, or conflicting requirements. Quote the file names and short excerpts. If there are none, say 'No substantive contradictions found.' Do not invent conflicts.",
    check:
      "Review the learner's attempt below against the assignment and sources. Start with what is correct, then name one concrete gap, then ask one guiding question. Do not give the full solution unless the learner explicitly asks.",
  }
  const prompt = [
    prompts[input.kind],
    input.attempt ? `\nLearner attempt:\n${input.attempt}` : "",
    "",
    context,
  ].join("\n")
  let text: string
  try {
    text = await input.generate(prompt)
  } catch (error) {
    return { ok: false, error: { message: stepFailureMessage(error) } }
  }
  const name = SESSION_FILES[input.kind]
  try {
    await writeSessionFile(sessionFolder(input.workspace, input.id), name, `${text.trim()}\n`)
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
  return { ok: true, value: { text: text.trim(), name } }
}

export async function sessionNeedsStepRefresh(workspace: Workspace, id: string): Promise<boolean> {
  return stepsAreStale(workspace, id)
}
