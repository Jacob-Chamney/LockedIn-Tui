/**
 * One frame-rate setting for the renderer and every animated surface.
 *
 * Terminals do not advertise a refresh rate, so this is a configurable ceiling
 * rather than a guess. `LOCKEDIN_FPS` overrides it for testing.
 */
export const DEFAULT_FPS = 60
export const MIN_FPS = 15
export const MAX_FPS = 500

export function resolveFrameRate(raw: string | undefined = process.env.LOCKEDIN_FPS): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_FPS
  const value = Number(raw)
  if (!Number.isFinite(value)) return DEFAULT_FPS
  return Math.max(MIN_FPS, Math.min(MAX_FPS, Math.round(value)))
}

export const FRAME_RATE = resolveFrameRate()
