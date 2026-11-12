/**
 * Skill outputs: a study guide, its answers and a flashcard deck.
 *
 * Built only from the goal's own sources and its ready lessons. Chats and memory
 * are never a source; trust rules are the lesson's (WP-403): every factual line
 * cites a saved source or is prefixed `(agent explanation)`.
 *
 * The progress line is recomputed from the checkboxes, never trusted from a
 * model, and a cancelled or failed build writes nothing.
 */

import { readFile, readdir, rename } from "node:fs/promises"
import { join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { AGENT_EXPLANATION } from "../../domain/curriculum"
import type { Workspace } from "../../storage/workspace"
import { goalFolderFor, readMeta } from "./progress"
import { isCitable } from "./lesson"
import type { SkillSource } from "./gather"

export const OUTPUTS_DIR = "outputs"
export const STUDY_GUIDE = "study-guide.md"
export const STUDY_ANSWERS = "study-guide-answers.md"
export const FLASHCARDS = "flashcards.md"
export const NOT_BUILT = "not built yet"
export const NO_GOAL_NEXT = "open a goal first, or pick one from the goal list"
export const EMPTY_DECK = "no card could be built from these sources"

export type OutputError =
  | { kind: "blocked"; message: string; next: string }
  | { kind: "validation"; message: string; section?: string }
  | { kind: "confirm"; message: string }
  | { kind: "storage"; path: string; message: string }

export type UsageRecord = {
  kind: "study-guide" | "flashcards"
  input: number
  output: number
  failed: boolean
}

export type OutputOptions = {
  workspace: Workspace
  /** Absent means nothing is open: the action must be blocked, not empty. */
  goalId?: string
  cancelled?: () => boolean
  recordUsage?: (usage: UsageRecord) => void
  confirmed?: boolean
}

export type GuideSection = {
  stageId: string
  heading: string
  /** Body paragraphs; each must cite a source or carry the label. */
  body: string[]
  /** Revealed only from the answers file. */
  answer: string
}

export type Card = {
  question: string
  answer: string
  /** Exactly one entry is correct when present. */
  choices?: Array<{ text: string; correct: boolean }>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function outputsFolder(workspace: Workspace, goalId: string): string {
  return join(goalFolderFor(workspace, goalId), OUTPUTS_DIR)
}

async function loadGoal(workspace: Workspace, goalId: string): Promise<
  Result<{ name: string; sources: SkillSource[] }, OutputError>
> {
  const folder = goalFolderFor(workspace, goalId)
  const meta = await readMeta(folder)
  if (!meta.ok) {
    return err({
      kind: "blocked",
      message: `there is no goal "${goalId}"`,
      next: NO_GOAL_NEXT,
    })
  }
  const raw = JSON.parse(await readFile(join(folder, "meta.json"), "utf8")) as {
    sources?: SkillSource[]
  }
  return ok({ name: meta.value.goal.name, sources: raw.sources ?? [] })
}

function sourcesOf(sources: readonly SkillSource[]): string[] {
  return sources.filter((source) => !source.unusable).map((source) => source.name)
}

function validateLines(lines: readonly string[], sources: readonly string[], where: string): Result<void, OutputError> {
  for (const line of lines) {
    if (!isCitable(line)) {
      return err({
        kind: "validation",
        section: where,
        message:
          `${where}: "${line.slice(0, 60)}" is a factual claim with neither a [src: name] ` +
          `citation nor the ${AGENT_EXPLANATION} label`,
      })
    }
    for (const name of [...line.matchAll(/\[src:\s*([^\]]+)\]/g)].map((match) => match[1]!.trim())) {
      if (!sources.includes(name)) {
        return err({ kind: "validation", section: where, message: `${where} cites "${name}", which is not a goal source` })
      }
    }
  }
  return ok(undefined)
}

// ------------------------------------------------------------------ guide

export type GuideSectionInput = GuideSection | { stageId: string; heading: string; notBuilt: true }

export function renderStudyGuide(
  name: string,
  sections: readonly GuideSectionInput[],
  reviewed: readonly boolean[] = [],
): string {
  const checked = reviewed.filter(Boolean).length
  const lines = [`# Study guide — ${name}`, "", `> ${checked} of ${sections.length} sections reviewed`, ""]

  for (const [index, section] of sections.entries()) {
    lines.push(`## ${section.heading}`, "")
    if ("notBuilt" in section) {
      lines.push(NOT_BUILT, "", "- [ ] Build this stage's lesson first", "")
      continue
    }
    for (const paragraph of section.body) lines.push(paragraph, "")
    lines.push(`- [${reviewed[index] === true ? "x" : " "}] Reviewed`, "")
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`
}

/** Answers mirror the section headings so revealing one never edits the guide. */
export function renderAnswers(name: string, sections: readonly GuideSectionInput[]): string {
  const lines = [`# Study guide answers — ${name}`, ""]
  for (const section of sections) {
    lines.push(`## ${section.heading}`, "")
    lines.push("notBuilt" in section ? "not built yet" : section.answer, "")
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`
}

export type GuideOutcome = {
  guidePath: string
  answersPath: string
  sections: number
  reviewed: number
}

export async function buildStudyGuide(
  options: OutputOptions,
  sections: readonly GuideSectionInput[],
): Promise<Result<GuideOutcome, OutputError>> {
  if (options.goalId === undefined) {
    return err({ kind: "blocked", message: "no goal is open", next: NO_GOAL_NEXT })
  }

  const goal = await loadGoal(options.workspace, options.goalId)
  if (!goal.ok) return goal

  if (options.cancelled?.() === true) {
    return err({ kind: "blocked", message: "generation cancelled", next: "build again when you are ready" })
  }

  const names = sourcesOf(goal.value.sources)
  for (const section of sections) {
    if ("notBuilt" in section) continue
    const checked = validateLines(section.body, names, section.heading)
    if (!checked.ok) return checked
  }

  const folder = outputsFolder(options.workspace, options.goalId)
  const guidePath = join(folder, STUDY_GUIDE)
  const answersPath = join(folder, STUDY_ANSWERS)

  const existing = await readFile(guidePath, "utf8").catch(() => null)
  if (existing !== null && options.confirmed !== true) {
    return err({ kind: "confirm", message: "a study guide already exists; rebuilding replaces it" })
  }

  // Keep the boxes the user has already ticked, matched by heading.
  const reviewed = sections.map((section) => {
    if (existing === null) return false
    const heading = `## ${section.heading}`
    const at = existing.indexOf(heading)
    if (at === -1) return false
    // Slice to the next heading: searching to EOF would let one ticked
    // section mark every earlier section reviewed.
    const next = existing.indexOf("\n## ", at + heading.length)
    const body = existing.slice(at, next === -1 ? undefined : next)
    return body.includes(`- [x] Reviewed`)
  })

  try {
    await import("node:fs/promises").then((fs) => fs.mkdir(folder, { recursive: true }))
    await writeAtomic(guidePath, renderStudyGuide(goal.value.name, sections, reviewed))
    await writeAtomic(answersPath, renderAnswers(goal.value.name, sections))
  } catch (error) {
    options.recordUsage?.({ kind: "study-guide", input: 0, output: 0, failed: true })
    return err({ kind: "storage", path: guidePath, message: messageOf(error) })
  }

  options.recordUsage?.({ kind: "study-guide", input: 0, output: 0, failed: false })
  return ok({
    guidePath,
    answersPath,
    sections: sections.length,
    reviewed: reviewed.filter(Boolean).length,
  })
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.tmp-${crypto.randomUUID()}`
  await Bun.write(temporary, text)
  await rename(temporary, path)
}

// ------------------------------------------------------------------ deck

export type ParsedCard = Card & { known: boolean; missed: boolean }

export function renderDeck(name: string, cards: readonly ParsedCard[]): string {
  const lines = [`# Flashcards — ${name}`, ""]
  for (const [index, card] of cards.entries()) {
    lines.push(`## Card ${index + 1}`, "")
    lines.push(`Q: ${card.question}`, `A: ${card.answer}`)
    lines.push(`M: ${card.missed ? "yes" : "no"}`, `K: ${card.known ? "yes" : "no"}`, "")
    if (card.choices && card.choices.length > 0) {
      lines.push("### Choices")
      for (const choice of card.choices) lines.push(`- [${choice.correct ? "x" : " "}] ${choice.text}`)
      lines.push("")
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`
}

export function parseDeck(markdown: string): ParsedCard[] {
  const cards: ParsedCard[] = []
  let current: ParsedCard | null = null
  let inChoices = false

  const flush = () => {
    if (current) cards.push(current)
    current = null
    inChoices = false
  }

  for (const line of markdown.split("\n")) {
    if (/^## Card \d+/.test(line)) {
      flush()
      current = { question: "", answer: "", known: false, missed: false }
      continue
    }
    if (current === null) continue
    if (line.trim() === "### Choices") {
      inChoices = true
      current.choices = []
      continue
    }
    const choice = /^- \[([ x])\] (.+)$/.exec(line)
    if (inChoices && choice) {
      current.choices ??= []
      current.choices.push({ text: choice[2]!.trim(), correct: choice[1] === "x" })
      continue
    }
    const q = /^Q: (.*)$/.exec(line)
    if (q) {
      current.question = q[1]!.trim()
      continue
    }
    const a = /^A: (.*)$/.exec(line)
    if (a) {
      current.answer = a[1]!.trim()
      continue
    }
    const m = /^M: (yes|no)$/.exec(line)
    if (m) {
      current.missed = m[1] === "yes"
      continue
    }
    const k = /^K: (yes|no)$/.exec(line)
    if (k) current.known = k[1] === "yes"
  }
  flush()
  return cards
}

/** `K` survives an identical question; `M` resets, so a miss is not inherited. */
export function mergeDeck(previous: readonly ParsedCard[], fresh: readonly Card[]): ParsedCard[] {
  const knownByQuestion = new Map(previous.map((card) => [card.question, card.known]))
  return fresh.map((card) => ({
    ...card,
    known: knownByQuestion.get(card.question) === true,
    missed: false,
  }))
}

export type DeckOutcome = { path: string; cards: number; known: number }

export async function buildDeck(
  options: OutputOptions,
  cards: readonly Card[],
): Promise<Result<DeckOutcome, OutputError>> {
  if (options.goalId === undefined) {
    return err({ kind: "blocked", message: "no goal is open", next: NO_GOAL_NEXT })
  }
  if (cards.length === 0) {
    return err({
      kind: "blocked",
      message: EMPTY_DECK,
      next: "add a source with citable text, then build the deck again",
    })
  }

  const goal = await loadGoal(options.workspace, options.goalId)
  if (!goal.ok) return goal

  if (options.cancelled?.() === true) {
    return err({ kind: "blocked", message: "generation cancelled", next: "build again when you are ready" })
  }

  for (const card of cards) {
    if (card.choices !== undefined) {
      const correct = card.choices.filter((choice) => choice.correct).length
      if (correct !== 1) {
        return err({
          kind: "validation",
          message: `a multiple-choice card needs exactly one correct choice; "${card.question.slice(0, 40)}" has ${correct}`,
        })
      }
    }
  }

  const folder = outputsFolder(options.workspace, options.goalId)
  const path = join(folder, FLASHCARDS)
  const existing = await readFile(path, "utf8").catch(() => null)
  if (existing !== null && options.confirmed !== true) {
    return err({ kind: "confirm", message: "a deck already exists; rebuilding keeps the cards you know" })
  }

  const merged = mergeDeck(existing === null ? [] : parseDeck(existing), cards)

  try {
    await import("node:fs/promises").then((fs) => fs.mkdir(folder, { recursive: true }))
    await writeAtomic(path, renderDeck(goal.value.name, merged))
  } catch (error) {
    options.recordUsage?.({ kind: "flashcards", input: 0, output: 0, failed: true })
    return err({ kind: "storage", path, message: messageOf(error) })
  }

  options.recordUsage?.({ kind: "flashcards", input: 0, output: 0, failed: false })
  return ok({ path, cards: merged.length, known: merged.filter((card) => card.known).length })
}

/** What the goal has on disk, for the context-aware open action. */
export async function listOutputs(
  workspace: Workspace,
  goalId: string,
): Promise<{ studyGuide: boolean; answers: boolean; flashcards: boolean }> {
  const folder = outputsFolder(workspace, goalId)
  let entries: string[] = []
  try {
    entries = await readdir(folder)
  } catch {
    entries = []
  }
  return {
    studyGuide: entries.includes(STUDY_GUIDE),
    answers: entries.includes(STUDY_ANSWERS),
    flashcards: entries.includes(FLASHCARDS),
  }
}
