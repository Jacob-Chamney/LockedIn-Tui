/**
 * A quiet pulse for the `Thinking…` line.
 *
 * The colour moves between two semantic tokens rather than changing brightness
 * arbitrarily, so it keeps the theme's contrast rules: `muted` at rest,
 * `foreground` at the peak. The full swing is deliberate — a subtler one was
 * invisible at normal font sizes and terminal gamma. `LOCKEDIN_REDUCED_MOTION=1` holds it
 * still, the same switch the Knowledge and Achievements animations honour.
 */
import type { Accessor } from "solid-js"
import { mixHex } from "../theme/mix"
import { createEffect, createSignal, onCleanup } from "solid-js"

/** The pulse travels the whole way to the peak colour: muted → foreground. */
const AMPLITUDE = 1
/** One tick every 120 ms; the sine period is about 2.3 s. */
const TICK_MS = 120
const PHASE_STEP = 3

export { mixHex } from "../theme/mix"

export function pulseColour(base: string, peak: string, phase: number): string {
  return mixHex(base, peak, phase * AMPLITUDE)
}

export function reducedMotion(env: Record<string, string | undefined> = process.env): boolean {
  return env.LOCKEDIN_REDUCED_MOTION === "1"
}

/** Colour for a line that should breathe while `active`, still otherwise. */
export function useThinkingPulse(
  active: Accessor<boolean>,
  base: Accessor<string>,
  peak: Accessor<string>,
): Accessor<string> {
  const [phase, setPhase] = createSignal(0)
  createEffect(() => {
    if (!active() || reducedMotion()) {
      setPhase(0)
      return
    }
    let tick = 0
    const timer = setInterval(() => {
      tick += 1
      setPhase((Math.sin(tick / PHASE_STEP) + 1) / 2)
    }, TICK_MS)
    onCleanup(() => clearInterval(timer))
  })
  return () => pulseColour(base(), peak(), phase())
}
