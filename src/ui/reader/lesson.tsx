/**
 * Lesson reader: a staged lesson with citations, checkpoints and a solution
 * that stays hidden until asked for.
 *
 * Domain rules live in the lesson service; this module only parses text for
 * display, emits intents and renders the snapshot it is given. No file IO.
 */
import { bindingLabel, parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"

export type LessonSource = { name: string; url?: string; excerpt: string }

export type Lesson = {
  goal: string
  stage: string
  status: "draft" | "ready"
  sources: LessonSource[]
  body: string
  /** False when the lesson was built without a solution. */
  includeSolution: boolean
  checkpoints: Array<{ id: string; text: string; done: boolean }>
}

export type SectionKind = "exercise" | "hints" | "checkpoint" | "solution" | "other"

export type Section = { kind: SectionKind; title: string; lines: string[] }

const HEADINGS: Array<[RegExp, SectionKind]> = [
  [/^exercise/i, "exercise"],
  [/^hints?/i, "hints"],
  [/^checkpoints?/i, "checkpoint"],
  [/^solutions?/i, "solution"],
]

/** Sections in file order; the solution keeps its place but renders closed. */
export function sectionsFor(body: string): Section[] {
  const out: Section[] = []
  let current: Section | null = null
  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.*)$/)
    if (heading) {
      const title = heading[1]!.trim()
      const kind = HEADINGS.find(([pattern]) => pattern.test(title))?.[1] ?? "other"
      current = { kind, title, lines: [] }
      out.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  return out
}

/** `[1]` markers resolve to a saved excerpt; `(agent explanation)` is labelled. */
export function citationMarkers(text: string): number[] {
  return [...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]))
}

export function progressLine(checkpoints: Lesson["checkpoints"]): string {
  const done = checkpoints.filter((point) => point.done).length
  return `${done} of ${checkpoints.length} checkpoints done`
}

export function askForSolutionCopy(): string {
  return "no solution was written · press s to ask for one"
}

export function draftCopy(): string {
  return "this lesson is still a draft · press Enter to build the next stage"
}

export function missingStageCopy(stage: string): string {
  return `stage “${stage}” is not built yet · press Enter to build it`
}

export type LessonView = {
  /** Index into the open sections (solution excluded while hidden). */
  cursor: number
  /** Index of the citation excerpt on screen, or null. */
  citationOpen: number | null
  solutionOpen: boolean
  notice?: string | null
}

export const initialLessonView: LessonView = { cursor: 0, citationOpen: null, solutionOpen: false, notice: null }

export function visibleSections(lesson: Lesson, view: LessonView): Section[] {
  return sectionsFor(lesson.body).filter(
    (section) => section.kind !== "solution" || (view.solutionOpen && lesson.includeSolution),
  )
}

export function openCitation(view: LessonView, index: number, lesson: Lesson): LessonView {
  if (index < 1 || index > lesson.sources.length) {
    return { ...view, notice: `citation [${index}] is not in this lesson` }
  }
  return { ...view, citationOpen: index - 1, notice: null }
}

export function closeCitation(view: LessonView): LessonView {
  return { ...view, citationOpen: null }
}

/** Revealing a solution is explicit and never persisted. */
export function revealSolution(lesson: Lesson, view: LessonView): LessonView {
  if (!lesson.includeSolution) {
    return { ...view, notice: askForSolutionCopy() }
  }
  return { ...view, solutionOpen: true, notice: null }
}

export type LessonIntent =
  | "down"
  | "up"
  | "citation"
  | "checkpoint"
  | "reveal"
  | "ask-solution"
  | "close"

const SPECS: Array<{ intent: LessonIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "citation", key: "return", footer: "Enter citation" },
  { intent: "checkpoint", key: "x", footer: "x checkpoint" },
  { intent: "reveal", key: "s", footer: "s solution" },
  { intent: "ask-solution", key: "shift+s", footer: "" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`lesson key "${key}": ${binding.message}`)
  return binding
}

export const LESSON_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean } = {}): LessonIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower === "enter" ? "return" : lower
  return LESSON_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return LESSON_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function solutionKeyLabel(): string {
  return bindingLabel(LESSON_KEYS.find((entry) => entry.intent === "reveal")!.binding)
}

// ---------------------------------------------------------------- render

export function LessonReader(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  lesson: Lesson
  view: LessonView
  /** Set when the stage has no lesson file yet. */
  missingStage?: string | null
}) {
  const palette = () => props.theme
  const body = () => (props.focused ? palette().foreground : palette().muted)
  const sections = () => visibleSections(props.lesson, props.view)
  const title = () => `${props.focused ? "▸" : " "} ${props.lesson.goal}`

  if (props.missingStage) {
    return (
      <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
        <text fg={palette().warning} wrapMode="none">{`! ${missingStageCopy(props.missingStage)}`}</text>
        <text fg={palette().muted} wrapMode="none">{footerHints()}</text>
      </box>
    )
  }

  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={palette().panel}
      paddingX={1}
    >
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {title()}
      </text>
      <text fg={palette().secondary} wrapMode="none">
        {`${props.lesson.stage} · ${props.lesson.status}`}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {progressLine(props.lesson.checkpoints)}
      </text>

      {props.lesson.status === "draft" ? (
        <text fg={palette().warning} wrapMode="none">{`! ${draftCopy()}`}</text>
      ) : null}

      {sections().map((section, index) => (
        <box flexDirection="column">
          <text fg={palette().primary} wrapMode="none">
            {`${index === props.view.cursor ? "▌" : " "} ${section.title}`}
          </text>
          {section.lines
            .filter((line) => line.trim().length > 0)
            .map((line) => (
              <text fg={section.kind === "hints" ? palette().secondary : body()} wrapMode="none">
                {`  ${line}`}
              </text>
            ))}
        </box>
      ))}

      {!props.lesson.includeSolution ? (
        <text fg={palette().muted} wrapMode="none">
          {`  ${askForSolutionCopy()}`}
        </text>
      ) : !props.view.solutionOpen ? (
        <text fg={palette().muted} wrapMode="none">
          {`  solution hidden · press ${solutionKeyLabel()} to reveal`}
        </text>
      ) : null}

      {props.view.citationOpen !== null ? (
        <box flexDirection="column">
          <text fg={palette().accent} wrapMode="none">
            {`citations · ${props.lesson.sources[props.view.citationOpen]?.name ?? ""}`}
          </text>
          <text fg={body()} wrapMode="none">
            {`  ${props.lesson.sources[props.view.citationOpen]?.excerpt ?? ""}`}
          </text>
        </box>
      ) : null}

      {props.view.notice ? (
        <text fg={palette().warning} wrapMode="none">{`! ${props.view.notice}`}</text>
      ) : null}

      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
