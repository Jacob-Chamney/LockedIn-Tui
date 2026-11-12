/**
 * Build and read a skill goal's study guide and deck.
 *
 * Generation is one strict JSON ask over the goal's own sources; the service
 * owns validation, citation checks and the atomic write. This module only
 * shapes the prompt and turns the result into reader lines.
 */
import { readFile, rename } from "node:fs/promises"
import { join } from "node:path"

import type { Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"
import { createSkillsToolbox } from "../../services/skills/toolbox"
import {
  FLASHCARDS,
  STUDY_GUIDE,
  buildDeck,
  buildStudyGuide,
  parseDeck,
  renderDeck,
  outputsFolder,
  type Card,
  type GuideSection,
} from "../../services/skills/outputs"

export type OutputKind = "guide" | "deck"

export type OutputResult = { path: string; lines: string[]; title: string }

const MAX_CONTEXT = 100_000

async function sourceContext(workspace: Workspace, goalId: string): Promise<string> {
  const box = createSkillsToolbox({ workspace, goalId })
  const listed = await box.tools.listSources()
  if (!listed.ok || listed.value.length === 0) return ""
  const parts: string[] = []
  let bytes = 0
  for (const source of listed.value) {
    if (source.unusable || bytes >= MAX_CONTEXT) continue
    const read = await box.tools.readSource(source.name)
    if (!read.ok) continue
    const chunk = `### ${source.name}\n${read.value.text}`
    if (bytes + chunk.length > MAX_CONTEXT) break
    parts.push(chunk)
    bytes += chunk.length
  }
  return parts.join("\n\n")
}

function parseJson(raw: string): unknown {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end <= start) throw new Error("the model did not return JSON")
  return JSON.parse(raw.slice(start, end + 1))
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textOf).filter((line) => line !== "") : []
}

async function generateGuide(input: {
  workspace: Workspace
  goalId: string
  generate: (prompt: string) => Promise<string>
}): Promise<Result<OutputResult, { message: string }>> {
  const context = await sourceContext(input.workspace, input.goalId)
  if (context === "") return { ok: false, error: { message: "this goal has no readable sources to build from" } }
  const raw = await input.generate([
    "Write a study guide for a skill goal from the sources below.",
    'Reply with JSON only: {"sections":[{"heading":"...","body":["..."],"answer":"..."}]}.',
    "Use 3 to 8 sections. Every body paragraph must cite a source as [src: name] or start with (agent explanation).",
    "The answer is the short answer to the section's question; it is stored separately.",
    "",
    context,
  ].join("\n"))
  const parsed = parseJson(raw) as { sections?: unknown }
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    return { ok: false, error: { message: "the model returned no guide sections" } }
  }
  const sections: GuideSection[] = parsed.sections.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>
    return {
      stageId: `section-${index + 1}`,
      heading: textOf(record.heading) || `Section ${index + 1}`,
      body: stringsOf(record.body),
      answer: textOf(record.answer),
    }
  })
  const built = await buildStudyGuide({ workspace: input.workspace, goalId: input.goalId, confirmed: true }, sections)
  if (!built.ok) return { ok: false, error: { message: built.error.message } }
  const lines = (await readFile(built.value.guidePath, "utf8")).split("\n")
  return { ok: true, value: { path: built.value.guidePath, lines, title: "Study guide" } }
}

async function generateDeck(input: {
  workspace: Workspace
  goalId: string
  generate: (prompt: string) => Promise<string>
}): Promise<Result<OutputResult, { message: string }>> {
  const context = await sourceContext(input.workspace, input.goalId)
  if (context === "") return { ok: false, error: { message: "this goal has no readable sources to build from" } }
  const raw = await input.generate([
    "Write flashcards for a skill goal from the sources below.",
    'Reply with JSON only: {"cards":[{"question":"...","answer":"...","choices":[{"text":"...","correct":true}]}]}.',
    "Use 8 to 20 cards. Choices are optional; when present exactly one is correct.",
    "Every question and answer must be supported by the sources.",
    "",
    context,
  ].join("\n"))
  const parsed = parseJson(raw) as { cards?: unknown }
  if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) {
    return { ok: false, error: { message: "the model returned no cards" } }
  }
  const cards: Card[] = parsed.cards.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>
    const choices = Array.isArray(record.choices)
      ? record.choices.map((choice) => {
          const item = (choice ?? {}) as Record<string, unknown>
          return { text: textOf(item.text), correct: item.correct === true }
        }).filter((choice) => choice.text !== "")
      : undefined
    return {
      question: textOf(record.question),
      answer: textOf(record.answer),
      ...(choices === undefined || choices.length === 0 ? {} : { choices }),
    }
  }).filter((card) => card.question !== "" && card.answer !== "")
  const built = await buildDeck({ workspace: input.workspace, goalId: input.goalId, confirmed: true }, cards)
  if (!built.ok) return { ok: false, error: { message: built.error.message } }
  const lines = (await readFile(built.value.path, "utf8")).split("\n")
  return { ok: true, value: { path: built.value.path, lines, title: "Flashcards" } }
}

/** Build if needed, then return the Markdown for the reader. */
export async function buildOutput(input: {
  workspace: Workspace
  goalId: string
  kind: OutputKind
  generate: (prompt: string) => Promise<string>
}): Promise<Result<OutputResult, { message: string }>> {
  return input.kind === "guide" ? generateGuide(input) : generateDeck(input)
}

/** Read an existing output without building; null when it is absent. */
export async function readOutput(
  workspace: Workspace,
  goalId: string,
  kind: OutputKind,
): Promise<OutputResult | null> {
  const file = join(outputsFolder(workspace, goalId), kind === "guide" ? STUDY_GUIDE : FLASHCARDS)
  try {
    const lines = (await readFile(file, "utf8")).split("\n")
    return { path: file, lines, title: kind === "guide" ? "Study guide" : "Flashcards" }
  } catch {
    return null
  }
}

export type LoadedDeckCard = {
  question: string
  answer: string
  known: boolean
  missed: boolean
  choices?: Array<{ text: string; correct: boolean }>
}

export type LoadedDeck = { name: string; cards: LoadedDeckCard[] }

function deckName(markdown: string, fallback: string): string {
  const first = markdown.split("\n")[0] ?? ""
  const match = /^# Flashcards — (.+)$/.exec(first)
  return match?.[1]?.trim() || fallback
}

/** Read the deck file as cards; null when it does not exist. */
export async function loadDeck(
  workspace: Workspace,
  goalId: string,
  fallbackName: string,
): Promise<LoadedDeck | null> {
  const file = join(outputsFolder(workspace, goalId), FLASHCARDS)
  let markdown: string
  try {
    markdown = await readFile(file, "utf8")
  } catch {
    return null
  }
  return {
    name: deckName(markdown, fallbackName),
    cards: parseDeck(markdown).map((card) => ({
      question: card.question,
      answer: card.answer,
      known: card.known,
      missed: card.missed,
      ...(card.choices ? { choices: card.choices } : {}),
    })),
  }
}

/** Mark one card and rewrite the file atomically. */
export async function markDeckCard(input: {
  workspace: Workspace
  goalId: string
  index: number
  mark: "missed" | "known" | "clear"
}): Promise<Result<LoadedDeck, { message: string }>> {
  const file = join(outputsFolder(input.workspace, input.goalId), FLASHCARDS)
  let markdown: string
  try {
    markdown = await readFile(file, "utf8")
  } catch {
    return { ok: false, error: { message: "the deck file is missing" } }
  }
  const cards = parseDeck(markdown)
  const card = cards[input.index]
  if (!card) return { ok: false, error: { message: "that card is no longer in the deck" } }
  if (input.mark === "clear") {
    card.missed = false
    card.known = false
  } else {
    card.missed = input.mark === "missed"
    card.known = input.mark === "known"
  }
  const name = deckName(markdown, input.goalId)
  const text = renderDeck(name, cards)
  const temporary = `${file}.tmp-${crypto.randomUUID()}`
  try {
    await Bun.write(temporary, text)
    await rename(temporary, file)
  } catch {
    return { ok: false, error: { message: "the deck could not be written" } }
  }
  return {
    ok: true,
    value: {
      name,
      cards: cards.map((entry) => ({
        question: entry.question,
        answer: entry.answer,
        known: entry.known,
        missed: entry.missed,
        ...(entry.choices ? { choices: entry.choices } : {}),
      })),
    },
  }
}
