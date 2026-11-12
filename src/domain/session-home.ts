/**
 * Session home and coverage model (pure).
 *
 * Types and formatting live in the domain so an action can return the data
 * without importing the render layer; the pane only draws what is here.
 */
import {
  computeCoverage,
  coverageGaps,
  isFullyCovered,
  type CoverageDocument,
  type CoverageReport,
  type CoverageSource,
} from "./coverage"

export type OutputState = "ready" | "build"

export type SessionHome = {
  name: string
  created: string
  sources: CoverageSource[]
  steps: { done: number; total: number; exists: boolean }
  studyGuide: OutputState
  flashcards: OutputState
  history: Array<{ title: string; why: string }>
  documents: CoverageDocument[]
}

export type HomeBlockId = "sources" | "steps" | "outputs" | "history"

export type HomeRow = {
  id: HomeBlockId
  label: string
  detail: string
  action: string
  /** True when the block has work to offer (build/missing), not just info. */
  offers: boolean
}

/** Five copied names, then `+n more` (packet §Session home). */
export function sourceSummary(home: SessionHome, limit = 5): string {
  const names = home.sources.slice(0, limit).map((source) => source.name)
  const rest = home.sources.length - names.length
  const list = names.join(", ")
  return rest > 0 ? `${list} +${rest} more` : list
}

export function stepsLine(home: SessionHome): string {
  return home.steps.exists
    ? `steps · ${home.steps.done} of ${home.steps.total} done`
    : "steps · not built"
}

export function outputsLine(home: SessionHome): string {
  const label = (state: OutputState) => (state === "ready" ? "ready" : "build")
  return `outputs · study guide ${label(home.studyGuide)} · flashcards ${label(home.flashcards)}`
}

/** Blocks in the packet's order; every one carries a registry action id. */
export function homeRows(home: SessionHome): HomeRow[] {
  return [
    {
      id: "sources",
      label: `sources · ${home.sources.length}`,
      detail: sourceSummary(home),
      action: "sources",
      offers: false,
    },
    {
      id: "steps",
      label: stepsLine(home),
      detail: home.steps.exists ? "open the sheet" : "build the steps from the sources",
      action: home.steps.exists ? "reader" : "regenerate-steps",
      offers: !home.steps.exists,
    },
    {
      id: "outputs",
      label: outputsLine(home),
      detail:
        home.studyGuide === "build" || home.flashcards === "build"
          ? "build the missing output"
          : "both outputs ready",
      action: "session-outputs",
      offers: home.studyGuide === "build" || home.flashcards === "build",
    },
    {
      id: "history",
      label: "from your history",
      detail: home.history.length > 0 ? home.history.map((item) => item.title).join(", ") : "no related notes",
      action: "knowledge",
      offers: false,
    },
  ]
}

/** Home is only shown while the session has no chat; never a flash. */
export function showHome(messageCount: number): boolean {
  return messageCount === 0
}

// ---------------------------------------------------------------- coverage

export function coverageFor(home: SessionHome): CoverageReport {
  return computeCoverage(home.sources, home.documents)
}

/** `used in: steps, chat` — only the documents that actually mention it. */
export function coverageRow(entry: CoverageReport["sources"][number]): string {
  if (!entry.referenced) return `${entry.name} · not referenced`
  const order: Array<CoverageDocument["kind"]> = ["steps", "chat", "outputs", "memory"]
  const used = order.filter((kind) => entry.documents.includes(kind))
  return `${entry.name} · used in: ${used.join(", ")}`
}

export function coverageSummary(report: CoverageReport): string {
  if (report.total === 0) return "no sources to cover"
  const base = `${report.referencedCount} of ${report.total} sources referenced`
  return isFullyCovered(report) ? `${base} · fully covered` : base
}

export function gapRows(report: CoverageReport): string[] {
  return coverageGaps(report).map(
    (entry) => `${entry.name} · not referenced yet — add it to the steps or outputs`,
  )
}
