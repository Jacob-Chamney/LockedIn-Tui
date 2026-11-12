/**
 * Study-guide reader.
 *
 * The guide and its answers are separate files and the service owns both.
 * Revealing an answer never rewrites the guide; ticking a section changes only
 * that checkbox and the progress line. No file IO here.
 */
import { parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"

export type GuideSection = { id: string; title: string; question: string; reviewed: boolean }

export type Guide = {
  id: string
  name: string
  sections: GuideSection[]
  built: boolean
}

/** The service seam: reveal reads the answers file without touching the guide. */
export type GuidePort = {
  reveal: (guideId: string, sectionId: string) => Promise<string>
  tick: (guideId: string, sectionId: string) => Promise<void>
  reload: (guideId: string) => Promise<Guide>
}

export type GuideView = {
  cursor: number
  /** Answer text currently shown, keyed by section id. */
  revealed: Record<string, string>
  notice?: string | null
}

export const initialGuideView: GuideView = { cursor: 0, revealed: {}, notice: null }

export function move(guide: Guide, view: GuideView, delta: number): GuideView {
  const count = guide.sections.length
  const cursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, view.cursor + delta))
  return { ...view, cursor }
}

export function currentSection(guide: Guide, view: GuideView): GuideSection | undefined {
  return guide.sections[view.cursor]
}

export function progressLine(guide: Guide): string {
  const reviewed = guide.sections.filter((section) => section.reviewed).length
  return `${reviewed} of ${guide.sections.length} sections reviewed`
}

export function showAnswer(view: GuideView, section: GuideSection, answer: string): GuideView {
  return { ...view, revealed: { ...view.revealed, [section.id]: answer }, notice: null }
}

export function isRevealed(view: GuideView, section: GuideSection): boolean {
  return view.revealed[section.id] !== undefined
}

export function notBuiltCopy(): string {
  return "this study guide is not built yet · press b to build it from the session sources"
}

/** Plugin output is labelled, never counted as a source. */
export function externalLabel(server: string): string {
  return `external explanation · ${server}`
}

export type GuideIntent = "down" | "up" | "reveal" | "tick" | "build" | "close"

const SPECS: Array<{ intent: GuideIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "reveal", key: "return", footer: "Enter answer" },
  { intent: "tick", key: "x", footer: "x reviewed" },
  { intent: "build", key: "b", footer: "b build" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`guide key "${key}": ${binding.message}`)
  return binding
}

export const GUIDE_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): GuideIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return GUIDE_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return GUIDE_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function GuidePane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  guide: Guide
  view: GuideView
  plugin?: string | null
}) {
  const palette = () => props.theme
  // A getter: moving the cursor must change the shown question.
  const section = () => currentSection(props.guide, props.view)
  const answer = () => {
    const current = section()
    return current && isRevealed(props.view, current) ? props.view.revealed[current.id] : null
  }

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} STUDY GUIDE · ${props.guide.name}`}
      </text>
      <text fg={palette().secondary} wrapMode="none">
        {progressLine(props.guide)}
      </text>

      {!props.guide.built ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${notBuiltCopy()}`}
        </text>
      ) : (
        props.guide.sections.map((entry, index) => (
          <text
            fg={index === props.view.cursor ? palette().primary : entry.reviewed ? palette().muted : palette().foreground}
            wrapMode="none"
          >
            {`${index === props.view.cursor ? "▌" : " "} [${entry.reviewed ? "x" : " "}] ${entry.title}${isRevealed(props.view, entry) ? "  (answer shown)" : ""}`}
          </text>
        ))
      )}

      {section() ? (
        <text fg={palette().foreground} wrapMode="none">
          {`  ${section()!.question}`}
        </text>
      ) : null}
      {answer() ? (
        <text fg={palette().accent} wrapMode="none">
          {`  ${answer()}`}
        </text>
      ) : null}
      {props.plugin ? (
        <text fg={palette().muted} wrapMode="none">
          {`  ${externalLabel(props.plugin)}`}
        </text>
      ) : null}

      {props.view.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.view.notice}`}
        </text>
      ) : null}
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
