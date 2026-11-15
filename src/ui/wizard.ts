/**
 * Horizontal wizards: numbered steps with done, current and upcoming states.
 *
 * One implementation serves the plugin SDK (`wizard()` paints the strip) and the
 * app's Sources flow. Steps are placed left to right with a gap; the first that
 * does not fit ends the strip, and if the current step would be lost it is shown
 * alone with a fitted label. Markers carry the state without colour.
 */
export type WizardStatus = "done" | "current" | "upcoming"

export type WizardGlyphs = {
  done: string
  current: string
  upcoming: string
}

export const WIZARD_GLYPHS: Readonly<WizardGlyphs> = {
  done: "✓",
  current: "●",
  upcoming: "○",
}

export type WizardStep = {
  id: string
  label: string
}

export type WizardSegment = {
  id: string
  label: string
  text: string
  x: number
  width: number
  status: WizardStatus
  current: boolean
  index: number
}

export type WizardOptions = {
  steps: readonly WizardStep[]
  /** Zero-based current step; clamped. */
  current: number
  width: number
  /** Spaces between steps; defaults 2. */
  gap?: number
  glyphs?: Partial<WizardGlyphs>
}

export type WizardLayout = {
  segments: WizardSegment[]
  hidden: number
  current: number
  width: number
  gap: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function wizardLayout(options: WizardOptions): WizardLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(8, Math.floor(options.gap ?? 2)))
  const glyphs = { ...WIZARD_GLYPHS, ...options.glyphs }
  const steps = options.steps
  if (steps.length === 0 || width === 0) {
    return { segments: [], hidden: steps.length, current: 0, width, gap }
  }
  const wanted = Number.isFinite(options.current) ? Math.round(options.current) : 0
  const current = Math.max(0, Math.min(steps.length - 1, wanted))
  const segments: WizardSegment[] = []
  let x = 0

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!
    const status: WizardStatus = index < current ? "done" : index === current ? "current" : "upcoming"
    const text = `${glyphs[status]} ${index + 1} ${step.label}`
    const at = segments.length === 0 ? 0 : x + gap
    if (at + text.length > width) break
    segments.push({
      id: step.id,
      label: step.label,
      text,
      x: at,
      width: text.length,
      status,
      current: index === current,
      index,
    })
    x = at + text.length
  }

  if (!segments.some((segment) => segment.current)) {
    const step = steps[current]!
    const status: WizardStatus = "current"
    const text = fit(`${glyphs[status]} ${current + 1} ${step.label}`, width)
    return {
      segments: [
        {
          id: step.id,
          label: step.label,
          text,
          x: 0,
          width: text.length,
          status,
          current: true,
          index: current,
        },
      ],
      hidden: steps.length - 1,
      current,
      width,
      gap,
    }
  }

  return { segments, hidden: steps.length - segments.length, current, width, gap }
}
