/**
 * Side threads: one small conversation per teaching step.
 *
 * A learner reading a step often has one question about it — a word, a skipped
 * premise, "why is that true?". Leaving the step to ask it in the main chat
 * loses the step; asking it in the main chat also contaminates the lesson
 * transcript. A side thread is the smallest thing that solves both: tool-free,
 * scoped to one step, stored beside the goal, and never part of the lesson.
 *
 * Storage is an append-only JSONL file per step:
 *
 *   skills/goals/<id>/side/step-2.jsonl
 *
 * A failed reply writes nothing (the user's question is not saved until the
 * answer exists), which is the same rule as every other chat in the app. A
 * corrupt line is skipped, never fatal, so one interrupted append cannot hide
 * the rest of the thread.
 */
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Result } from "../../domain/markdown";

export type TeachingSideMessage = {
  role: "user" | "assistant"
  text: string
  at: string
}

export type SideStoreError = { kind: "storage"; path: string; message: string }

/** How much of a thread is replayed into the next side question. */
export const SIDE_HISTORY_MESSAGES = 10

/**
 * One writer per thread.
 *
 * Two sends can be in flight (a double Enter); the read-modify-write of a thread
 * must not interleave. The queue is process-local, like every other controller
 * in the core.
 */
const locks = new Map<string, Promise<unknown>>()

export function withSideLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.then(work, work)
  locks.set(
    key,
    next.then(
      () => {},
      () => {},
    ),
  )
  return next
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

/** A step id is `step-<n>`; anything else cannot name a thread. */
export function isSideStepId(value: string): boolean {
  return /^step-\d+$/.test(value)
}

export function sideThreadPath(folder: string, stepId: string): string {
  return join(folder, "side", `${stepId}.jsonl`);
}

export async function readSideThread(
  folder: string,
  stepId: string,
): Promise<Result<TeachingSideMessage[], SideStoreError>> {
  const path = sideThreadPath(folder, stepId);
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { ok: true, value: [] }
    return {
      ok: false,
      error: {
        kind: "storage",
        path,
        message: `the side thread cannot be read (${messageOf(error)}); fix its permissions`,
      },
    }
  }
  const messages: TeachingSideMessage[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== "object" || parsed === null) continue
    const row = parsed as Partial<TeachingSideMessage>
    if (row.role !== "user" && row.role !== "assistant") continue
    if (typeof row.text !== "string" || row.text.trim() === "") continue
    messages.push({
      role: row.role,
      text: row.text,
      at: typeof row.at === "string" ? row.at : "",
    })
  }
  return { ok: true, value: messages }
}

/**
 * Append one exchange. Both messages land together, after the reply exists, so
 * a failure cannot leave a question with no answer on disk.
 */
export async function appendSideExchange(
  folder: string,
  stepId: string,
  user: TeachingSideMessage,
  assistant: TeachingSideMessage,
): Promise<Result<TeachingSideMessage[], SideStoreError>> {
  const path = sideThreadPath(folder, stepId);
  const body =
    `${JSON.stringify({ role: user.role, text: user.text, at: user.at })}\n` +
    `${JSON.stringify({ role: assistant.role, text: assistant.text, at: assistant.at })}\n`
  try {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, body, "utf8")
  } catch (error) {
    return {
      ok: false,
      error: { kind: "storage", path, message: messageOf(error) },
    }
  }
  return readSideThread(folder, stepId)
}

export async function clearSideThread(
  folder: string,
  stepId: string,
): Promise<Result<null, SideStoreError>> {
  const path = sideThreadPath(folder, stepId);
  try {
    await rm(path, { force: true })
  } catch (error) {
    return { ok: false, error: { kind: "storage", path, message: messageOf(error) } }
  }
  return { ok: true, value: null }
}

/** One line, collapsed, capped. Side answers stay short on purpose. */
function flat(value: string, cap: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length <= cap ? text : `${text.slice(0, Math.max(0, cap - 1))}…`
}

/**
 * The side prompt.
 *
 * It is deliberately narrower than the main lesson prompt: the model is a
 * companion answering one question, not a second teacher. It gets the step (so
 * the question is in context), the thread so far, and the same voice rule. It
 * must not re-teach the lesson or change the plan.
 */
export function sidePrompt(input: {
  goal: string
  stepProse: string
  stepQuestion: string
  messages: TeachingSideMessage[]
  question: string
}): string {
  const history = input.messages.slice(-SIDE_HISTORY_MESSAGES).map((message) => {
    const speaker = message.role === "user" ? "Learner" : "Companion"
    return `${speaker}: ${flat(message.text, 1200)}`
  })
  return [
    "You are a companion answering one side question about a single lesson step.",
    "Answer only the question. One or two short sentences. No preamble, no headings, no bullet lists.",
    "Do not re-teach the step, do not change the plan, and do not ask a follow-up question.",
    "If the step does not contain the answer, say so in a few words and answer from general knowledge.",
    "",
    `The lesson's goal: ${flat(input.goal, 140)}`,
    `The step being read: ${flat(input.stepProse, 900)}`,
    `Its check question: ${flat(input.stepQuestion, 220)}`,
    ...(history.length === 0 ? [] : ["", "The side thread so far:", ...history]),
    "",
    `The learner asks: ${flat(input.question, 2000)}`,
  ].join("\n")
}
