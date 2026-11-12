/**
 * Project chat for a registered Work project (WP-502).
 *
 * This module is the seam between three things that must not know about each
 * other: the project's stored metadata (WP-501), the model loop (`src/llm`), and
 * the path-confined toolbox (`./scope`).
 *
 * Guarantees:
 *
 * - **One streaming request per project.** A second `send()` while a turn is in
 *   flight yields `error(busy)` and starts no request.
 * - **A blocked chat is not a silent fallback.** No default agent (or a default
 *   that does not exist) yields the documented sentence and zero requests.
 * - **Records are append-only and gated on `done`.** A cancelled or failed turn
 *   leaves `chats/<id>.jsonl` byte-identical.
 * - **Every turn is replayed from the file.** A resumed chat sends the last
 *   `REPLAY_RECORDS` records and appends to the same file.
 *
 * The agent profile is read from `meta.json` here rather than imported from an
 * agent service, because WP-503 owns that module and this packet may not edit
 * it. The field names are the ones in `docs/data-model.md` §6.1; camelCase
 * equivalents are accepted so a hand-edited file still works. When WP-503 lands
 * it becomes the validator of record and this reader stays lenient on purpose.
 */

import { appendFile, mkdir, readFile, readdir } from "node:fs/promises"
import { basename, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import type { AppError, ChatEvent, Message, Usage } from "../../llm/events"
import type { ChatRequest, ChatService } from "../../llm/chat"
import type { ToolSpec } from "../../llm/tools"
import type { Workspace } from "../../storage/workspace"
import {
  assertProjectId,
  parseProjectMeta,
  projectFolder,
  projectMetaPath,
  type ProjectMeta,
  type WorkError,
} from "./register"
import {
  createProjectScope,
  projectToolSpecs,
  type ProjectScope,
  type ScopeError,
} from "./scope"

export const CHATS_DIR = "chats"

/** Chats are `chat-<n>.jsonl`, monotonic per project. */
export const CHAT_ID = /^chat-(\d+)$/

/** A resumed chat replays this many records before the new message. */
export const REPLAY_RECORDS = 20

export const DEFAULT_MAX_TOKENS = 16_000
export const DEFAULT_MAX_TOOL_CALLS = 8
export const MIN_TOOL_CALLS = 1
export const MAX_TOOL_CALLS = 32

/** The exact blocked copy `docs/product.md` §8.3 promises. */
export const NO_DEFAULT_AGENT = "choose a default agent for this project"
export const NO_MODEL = "No model is configured. Choose a model in Settings → Models."
export const BUSY = "A reply is already streaming in this view. Stop it first."

export type ChatRecord = {
  role: "user" | "assistant"
  content: string
  at: string
  /** Set on assistant records; never part of the prompt. */
  model?: string
  usage?: Usage
}

export type WorkChatError =
  | WorkError
  | ScopeError
  | { kind: "blocked"; message: string; next?: string }

/** The engine this service drives. `ChatService` satisfies it. */
export type ChatEngine = Pick<ChatService, "send" | "cancel">

export type WorkChatDeps = {
  workspace: Workspace
  /**
   * Builds the engine for one prepared turn, bound to that turn's scope.
   *
   * Production passes
   * `(scope) => createChatService({ resolveModel, resolveTool: scope.resolveTool, providerId })`,
   * so a tool call can only ever reach the project root resolved for this turn.
   * Tests pass a deterministic generator.
   */
  engine: (scope: ProjectScope) => ChatEngine
  /** `models.chat` from config; used when the agent does not name a model. */
  defaultModel?: string
  /** `models.max_tokens_per_request`; the per-turn token cap. */
  maxTokens?: number
  /** Global write opt-in. Off by default; WP-504 owns the write tool itself. */
  allowWrite?: boolean
  /** Deterministic timestamps in tests. */
  now?: () => Date
  /** A chat log that could not be written: reported, never fatal to the answer. */
  onPersistenceError?: (error: WorkChatError) => void
}

export type SendInput = {
  projectId: string
  text: string
  /** Omit to start the next chat. */
  chatId?: string
  requestId?: string
}

export type WorkChat = {
  send(input: SendInput): AsyncGenerator<ChatEvent>
  cancel(requestId: string): void
  /** Requests currently streaming, for the task centre. */
  active(): string[]
}

export function chatsDir(workspace: Workspace, projectId: string): string {
  return join(projectFolder(workspace, projectId), CHATS_DIR)
}

export function chatPath(workspace: Workspace, projectId: string, chatId: string): string {
  // Public callers may pass an id from a UI or an import; never let it join.
  return CHAT_ID.test(chatId)
    ? join(chatsDir(workspace, projectId), `${chatId}.jsonl`)
    : join(chatsDir(workspace, projectId), ".invalid-chat.jsonl")
}

/** `chat-<n>.jsonl` files in the project folder, in numeric order. */
export async function listChats(
  workspace: Workspace,
  projectId: string,
): Promise<Result<string[], WorkChatError>> {
  const id = assertProjectId(projectId)
  if (!id.ok) return id
  try {
    const entries = await readdir(chatsDir(workspace, id.value), { withFileTypes: true })
    const ids = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => basename(entry.name, ".jsonl"))
      .filter((name) => CHAT_ID.test(name))
    ids.sort((a, b) => Number(CHAT_ID.exec(a)![1]) - Number(CHAT_ID.exec(b)![1]))
    return ok(ids)
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return ok([])
    return err({
      kind: "storage",
      path: chatsDir(workspace, projectId),
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Read a chat back; a malformed line is skipped, not fatal. */
export async function readChat(
  workspace: Workspace,
  projectId: string,
  chatId: string,
): Promise<Result<ChatRecord[], WorkChatError>> {
  if (!CHAT_ID.test(chatId)) {
    return err({ kind: "storage", path: chatPath(workspace, projectId, chatId), message: `"${chatId}" is not a chat id` })
  }
  const path = chatPath(workspace, projectId, chatId)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    return err({
      kind: "storage",
      path,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  const records: ChatRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      const raw = JSON.parse(line) as Partial<ChatRecord>
      if (raw.role !== "user" && raw.role !== "assistant") continue
      if (typeof raw.content !== "string") continue
      records.push({
        role: raw.role,
        content: raw.content,
        at: typeof raw.at === "string" ? raw.at : "",
      })
    } catch {
      continue
    }
  }
  return ok(records)
}

function nextChatId(existing: readonly string[]): string {
  let highest = 0
  for (const id of existing) {
    const match = CHAT_ID.exec(id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `chat-${highest + 1}`
}

type AgentLimits = {
  id: string
  name: string
  model: string
  allowedTools: string[]
  maxToolCalls: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "")
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * The project's default agent, or the blocked copy.
 *
 * A chat-mode project has one implicit profile: it is the plain project chat,
 * not a swarm that needs a default. A swarm still blocks without an explicit
 * default agent. A saved profile that is missing fields is narrowed to safe
 * defaults instead of failing the chat: an agent with no `allow_write` is
 * read-only by definition.
 */
export function defaultAgent(
  meta: ProjectMeta,
): Result<AgentLimits, Extract<WorkChatError, { kind: "blocked" }>> {
  const blocked = (message: string, next: string) =>
    err({ kind: "blocked" as const, message, next })
  const implicit = (): AgentLimits => ({
    id: "single-agent",
    name: meta.name,
    model: "",
    allowedTools: [],
    maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  })

  if (meta.mode === "chat") {
    // A chat-mode project is the single-agent case: one implicit profile with
    // the project's tools, no agent manager and no profile to pick. This also
    // covers a stale default id left by an old/hand-edited meta.
    if (meta.default_agent === "") return ok(implicit())
    const chosen = meta.agents.find(
      (agent) => isRecord(agent) && agent.id === meta.default_agent,
    )
    if (!isRecord(chosen)) return ok(implicit())
  } else if (meta.default_agent === "") {
    return blocked(NO_DEFAULT_AGENT, "open the project, add an agent and mark it as the default")
  }

  const record = meta.agents.find(
    (agent) => isRecord(agent) && agent.id === meta.default_agent,
  )
  if (!isRecord(record)) {
    return blocked(NO_DEFAULT_AGENT, "the saved default agent no longer exists; choose another")
  }

  const allowedTools = stringArray(record.allowed_tools ?? record.allowedTools)
  return ok({
    id: meta.default_agent,
    name: typeof record.name === "string" ? record.name : meta.default_agent,
    model: typeof record.model === "string" ? record.model.trim() : "",
    allowedTools,
    maxToolCalls: numberIn(
      record.max_tool_calls ?? record.maxToolCalls,
      DEFAULT_MAX_TOOL_CALLS,
      MIN_TOOL_CALLS,
      MAX_TOOL_CALLS,
    ),
  })
}

/** The read-only tools this agent may see, in the order the specs declare them. */
export function toolsForAgent(agent: AgentLimits, specs: readonly ToolSpec[]): ToolSpec[] {
  if (agent.allowedTools.length === 0) return [...specs]
  return specs.filter((spec) => agent.allowedTools.includes(spec.name))
}

function toAppError(error: WorkChatError): AppError {
  switch (error.kind) {
    case "blocked":
    case "path":
    case "invalid-input":
    case "invalid-meta":
    case "duplicate":
      return { kind: "config", message: error.message }
    default:
      // `src/llm/events.ts` (WP-202) does not carry a `storage` kind yet; a
      // local write failure is reported through this provider-shaped error and
      // the packet handoff records the taxonomy gap.
      return { kind: "provider", provider: "work", status: 0, message: error.message }
  }
}

export type PreparedTurn = {
  chatId: string
  path: string
  history: ChatRecord[]
  model: string
  tools: ToolSpec[]
  caps: { maxToolCalls: number; maxTokens: number }
  /** Bound to the project root; the engine's resolver comes from here. */
  scope: ProjectScope
  request: ChatRequest
}

/**
 * Resolve everything a turn needs without streaming anything.
 *
 * Exported so a UI can show the blocked copy before offering a composer, and so
 * the test can assert "no request was issued" by construction.
 */
export async function prepareTurn(
  deps: WorkChatDeps,
  input: SendInput,
): Promise<Result<PreparedTurn, WorkChatError>> {
  const id = assertProjectId(input.projectId)
  if (!id.ok) return id
  const projectId = id.value

  const metaPath = projectMetaPath(deps.workspace, projectId)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(metaPath, "utf8"))
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return err({
        kind: "path",
        path: metaPath,
        reason: "missing",
        message: "this project is not registered in this workspace",
      })
    }
    return err({
      kind: "storage",
      path: metaPath,
      message: error instanceof Error ? error.message : String(error),
    })
  }
  const parsed = parseProjectMeta(raw, metaPath)
  if (!parsed.ok) return parsed
  const meta = parsed.value

  const agent = defaultAgent(meta)
  if (!agent.ok) return agent

  const model = agent.value.model === "" ? (deps.defaultModel ?? "").trim() : agent.value.model
  if (model === "") {
    return err({
      kind: "blocked",
      message: NO_MODEL,
      next: "link a provider and choose a model in Settings → Models",
    })
  }

  const scope = await createProjectScope({ root: meta.root })
  if (!scope.ok) return scope

  const chats = await listChats(deps.workspace, projectId)
  if (!chats.ok) return chats

  if (input.chatId !== undefined && !CHAT_ID.test(input.chatId)) {
    return err({
      kind: "blocked",
      message: `"${input.chatId}" is not a chat id`,
      next: "start a new chat instead",
    })
  }
  const chatId = input.chatId ?? nextChatId(chats.value)
  let history: ChatRecord[] = []
  if (input.chatId !== undefined) {
    const loaded = await readChat(deps.workspace, projectId, input.chatId)
    if (!loaded.ok) {
      return err({
        kind: "blocked",
        message: `there is no chat "${input.chatId}" in this project`,
        next: "start a new chat instead",
      })
    }
    history = loaded.value
  }

  const specs = toolsForAgent(agent.value, projectToolSpecs({ allowWrite: deps.allowWrite }))
  const messages: Message[] = history
    .slice(-REPLAY_RECORDS)
    .map((record) => ({ role: record.role, content: record.content }))
  messages.push({ role: "user", content: input.text })

  return ok({
    chatId,
    path: chatPath(deps.workspace, projectId, chatId),
    history,
    model,
    tools: specs,
    caps: {
      maxToolCalls: agent.value.maxToolCalls,
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
    scope: scope.value,
    request: {
      requestId: input.requestId ?? `${projectId}:${chatId}`,
      context: projectId,
      mode: "work",
      messages,
      model,
      tools: specs,
      caps: {
        maxToolCalls: agent.value.maxToolCalls,
        maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
    },
  })
}

async function appendTurn(
  deps: WorkChatDeps,
  projectId: string,
  prepared: PreparedTurn,
  done: Extract<ChatEvent, { type: "done" }>,
  userText: string,
): Promise<Result<void, WorkChatError>> {
  const at = (deps.now?.() ?? new Date()).toISOString()
  const records: ChatRecord[] = [
    { role: "user", content: userText, at },
    { role: "assistant", content: done.text, at, model: prepared.model, usage: done.usage },
  ]
  const directory = chatsDir(deps.workspace, projectId)
  try {
    await mkdir(directory, { recursive: true })
    const existing = await readFile(prepared.path, "utf8").catch(() => "")
    const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n"
    // One append for the pair, so a crash cannot leave half a turn.
    await appendFile(
      prepared.path,
      `${prefix}${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    )
    return ok(undefined)
  } catch (error) {
    return err({
      kind: "storage",
      path: prepared.path,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Build the project chat service.
 *
 * The engine is injected: in production it is `createChatService` from
 * `src/llm/chat.ts`; in tests it is a deterministic generator, so no network and
 * no provider key is involved.
 */
export function createWorkChat(deps: WorkChatDeps): WorkChat {
  const inFlight = new Set<string>()
  /** One engine per request, so cancelling A never reaches B's stream. */
  const engines = new Map<string, ChatEngine>()
  const cancelled = new Set<string>()

  return {
    active: () => [...inFlight],

    cancel(requestId: string) {
      cancelled.add(requestId)
      engines.get(requestId)?.cancel(requestId)
    },

    async *send(input: SendInput): AsyncGenerator<ChatEvent> {
      const context = input.projectId

      // One request per project. Claimed before the first await so two sends
      // cannot both pass the check.
      if (inFlight.has(context)) {
        yield { type: "error", error: { kind: "busy", message: BUSY } }
        return
      }
      inFlight.add(context)
      let requestId: string | undefined

      try {
        if (input.text.trim() === "") {
          yield { type: "error", error: { kind: "config", message: "Type a message before sending." } }
          return
        }

        const prepared = await prepareTurn(deps, input)
        if (!prepared.ok) {
          yield { type: "error", error: toAppError(prepared.error) }
          return
        }

        requestId = prepared.value.request.requestId
        if (cancelled.delete(requestId)) {
          yield { type: "cancelled" }
          return
        }
        const engine = deps.engine(prepared.value.scope)
        engines.set(requestId, engine)

        for await (const event of engine.send(prepared.value.request)) {
          if (event.type === "done") {
            const saved = await appendTurn(deps, input.projectId, prepared.value, event, input.text)
            if (!saved.ok) deps.onPersistenceError?.(saved.error)
            yield event
            return
          }
          yield event
          if (event.type === "cancelled" || event.type === "error") return
        }
        // The engine contract says this cannot happen; if it does, report once
        // rather than ending the stream silently.
        yield {
          type: "error",
          error: { kind: "provider", provider: "work", status: 0, message: "the reply ended without a result" },
        }
      } finally {
        // Only this turn may remove its own engine; another project's request
        // may still be streaming.
        if (requestId !== undefined) engines.delete(requestId)
        inFlight.delete(context)
      }
    },
  }
}
