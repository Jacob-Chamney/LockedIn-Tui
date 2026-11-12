/**
 * The startup splash: a theme-coloured field of ASCII glyphs with a large
 * padlock silhouette. The left leg is hinged in the body, the right leg lifts
 * and slides shut, and the whole surface fades in and out.
 *
 * The lock is a mask over the field, not an outline: body and shackle cells are
 * bright theme glyphs, the keyhole is a dark cutout, and every other cell is a
 * dim glyph that changes each tick. The shackle starts two columns right of its
 * sockets, then drops in over two frames.
 *
 * The sequence is finite: seven phases and a field shimmer over ~1.6 s. It is
 * skipped by `Esc` (or Enter/Space), by `LOCKEDIN_REDUCED_MOTION=1`, and by
 * `LOCKEDIN_NO_SPLASH=1`. The `LOCKEDIN` wordmark is in the first frame, which
 * is what the startup gate measures. The app mounts after the sequence.
 */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"

import type { ThemePalette } from "../theme"
import { splashTones, type SplashTone as ThemeSplashTone } from "../theme/splash"
import { reducedMotion } from "../chat/pulse"

/** How long the whole sequence runs before the app mounts. */
export const SPLASH_TOTAL_MS = 2_700
export const SPLASH_FADE_IN_MS = 450
export const SPLASH_FADE_OUT_MS = 500

/** Frame changes; the final phase holds until `SPLASH_TOTAL_MS`. */
export const SPLASH_STEPS: ReadonlyArray<{ at: number; phase: number }> = [
  { at: 0, phase: 0 },
  { at: 450, phase: 1 },
  { at: 800, phase: 2 },
  { at: 1_150, phase: 3 },
  { at: 1_500, phase: 4 },
  { at: 1_850, phase: 5 },
  { at: 2_050, phase: 6 },
]

export const SPLASH_WORDMARK = "LOCKEDIN"

export type SplashTone = ThemeSplashTone | "blank"

export type SplashCell = { ch: string; tone: SplashTone }

export type SplashFrame = {
  rows: SplashCell[][]
  caption: string
  captionTone: "captionMuted" | "captionWarning" | "captionSuccess"
}

const FIELD_GLYPHS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.:-=+*<>/\\|()[]{}"
// The lock uses heavier glyphs as well as a brighter tone, so its silhouette
// survives a monochrome terminal and is not carried by colour alone.
const LOCK_GLYPHS =
  "#@%&8BQWM$0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"

/** A 32-bit hash; the only randomness, so every frame is reproducible. */
function hash(x: number, y: number, tick: number, phase: number): number {
  let n =
    Math.imul(x + 1, 374761393) ^
    Math.imul(y + 1, 668265263) ^
    Math.imul(tick + 1, 1442695041) ^
    Math.imul(phase + 1, 2246822519)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}

function glyph(x: number, y: number, tick: number, phase: number, lock = false): string {
  const set = lock ? LOCK_GLYPHS : FIELD_GLYPHS
  return set[hash(x, y, tick, phase) % set.length]!
}

export type LockLayout = {
  lockW: number
  lockH: number
  lockX: number
  lockY: number
  bodyX: number
  bodyY: number
  bodyW: number
  bodyH: number
  shackleX: number
  shackleW: number
  /** The right leg's bottom row; the left leg is fixed through `bodyY`. */
  rightBottom: number
  rightLift: number
  lift: number
  wall: number
  corner: number
  keyX: number
  keyY: number
  keyR: number
  stemHalf: number
}

/**
 * The padlock's cell geometry.
 *
 * It scales with the terminal but keeps a readable body/shackle ratio. The
 * left leg is hinged into the body; the right leg is lifted out while unlocked
 * and slides down into its socket: halfway at phase 4 and seated at phase 5.
 */
export function lockLayout(width: number, height: number, phase: number): LockLayout {
  const availableW = Math.max(21, width - 8)
  const availableH = Math.max(9, height - 8)
  let lockW = Math.min(65, availableW)
  let lockH = Math.min(Math.max(9, Math.round(lockW * 0.45)), availableH)
  lockW = Math.min(lockW, Math.max(21, Math.round(lockH / 0.45)))
  lockH = Math.min(lockH, availableH)

  const lockX = Math.floor((width - lockW) / 2)
  const lockY = Math.max(3, Math.floor((height - lockH) / 2))

  const bodyW = Math.max(15, Math.round(lockW * 0.82))
  const bodyH = Math.max(7, Math.round(lockH * 0.55))
  const bodyX = Math.floor((lockW - bodyW) / 2)
  const bodyY = lockH - bodyH

  const shackleW = Math.max(9, Math.round(lockW * 0.52))
  const shackleX = Math.floor((lockW - shackleW) / 2)
  const lift = Math.max(3, Math.min(5, Math.round(lockH * 0.22)))
  // The left leg never leaves the body. The right leg is lifted `rightLift`
  // rows and slides down into its socket; the top band stays put.
  const rightLift = phase <= 3 ? lift : phase === 4 ? Math.max(1, Math.round(lift / 2)) : 0
  const rightBottom = bodyY - rightLift
  const wall = Math.max(1, Math.round(lockW * 0.06))

  const keyX = bodyX + Math.floor(bodyW / 2)
  const keyY = bodyY + Math.max(2, Math.floor(bodyH * 0.42))
  const keyR = Math.max(1, Math.round(bodyW * 0.06))
  const stemHalf = Math.max(0, keyR - 1)

  return {
    lockW,
    lockH,
    lockX,
    lockY,
    bodyX,
    bodyY,
    bodyW,
    bodyH,
    shackleX,
    shackleW,
    rightBottom,
    rightLift,
    lift,
    wall,
    corner: Math.max(1, Math.round(lockW * 0.035)),
    keyX,
    keyY,
    keyR,
    stemHalf,
  }
}

function lockCell(x: number, y: number, layout: LockLayout, phase: number): "lock" | "blank" | null {
  const sx = x - layout.shackleX
  if (sx >= 0 && sx < layout.shackleW) {
    if (y >= 0 && y < layout.wall) return "lock"
    if (sx < layout.wall && y >= 0 && y <= layout.bodyY) return "lock"
    if (sx >= layout.shackleW - layout.wall && y >= 0 && y <= layout.rightBottom) return "lock"
  }

  if (phase < 2) return null
  const inBody =
    x >= layout.bodyX &&
    x < layout.bodyX + layout.bodyW &&
    y >= layout.bodyY &&
    y < layout.bodyY + layout.bodyH
  if (!inBody) return null

  const fromLeft = x - layout.bodyX
  const fromRight = layout.bodyX + layout.bodyW - 1 - x
  const fromTop = y - layout.bodyY
  const fromBottom = layout.bodyY + layout.bodyH - 1 - y
  const corner = layout.corner
  if (
    (fromLeft < corner && fromTop < corner) ||
    (fromRight < corner && fromTop < corner) ||
    (fromLeft < corner && fromBottom < corner) ||
    (fromRight < corner && fromBottom < corner)
  ) {
    return "blank"
  }

  if (phase >= 3) {
    const dx = x - layout.keyX
    const dy = y - layout.keyY
    if (
      dx * dx + dy * dy <= layout.keyR * layout.keyR ||
      (Math.abs(dx) <= layout.stemHalf && y > layout.keyY && y < layout.bodyY + layout.bodyH - 1)
    ) {
      return "blank"
    }
  }

  // The sockets are cut at the body top. The locked shackle covers them; while
  // it is shifted right they stay dark, which is what reads as "unlocked".
  if (
    y === layout.bodyY &&
    ((x >= layout.shackleX && x < layout.shackleX + layout.wall) ||
      (x >= layout.shackleX + layout.shackleW - layout.wall && x < layout.shackleX + layout.shackleW))
  ) {
    return "blank"
  }
  return "lock"
}

function overlay(rows: SplashCell[][], row: number, text: string, tone: SplashTone): void {
  if (row < 0 || row >= rows.length) return
  const line = rows[row]!
  const clipped = text.slice(0, line.length)
  const start = Math.max(0, Math.floor((line.length - clipped.length) / 2))
  for (let index = 0; index < clipped.length; index++) {
    const x = start + index
    if (x >= 0 && x < line.length) line[x] = { ch: clipped[index]!, tone }
  }
}

/**
 * One full frame. Pure, so the mask and the sequence are testable without a
 * terminal or a clock.
 */
export function splashFrame(input: {
  width: number
  height: number
  phase: number
  tick: number
}): SplashFrame {
  const width = Math.max(20, Math.floor(input.width))
  const height = Math.max(10, Math.floor(input.height))
  const phase = Math.max(0, Math.min(6, Math.floor(input.phase)))
  const tick = Math.max(0, Math.floor(input.tick))
  const layout = lockLayout(width, height, phase)

  const rows: SplashCell[][] = []
  for (let y = 0; y < height; y++) {
    const row: SplashCell[] = []
    for (let x = 0; x < width; x++) {
      const n = hash(x, y, tick, phase)
      row.push({
        ch: glyph(x, y, tick, phase),
        tone: n % 31 === 0 ? "fieldBright" : "field",
      })
    }
    rows.push(row)
  }

  if (phase > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const localX = x - layout.lockX
        const localY = y - layout.lockY
        if (localX < 0 || localY < 0 || localX >= layout.lockW || localY >= layout.lockH) continue
        const kind = lockCell(localX, localY, layout, phase)
        if (kind === null) continue
        rows[y]![x] =
          kind === "blank"
            ? { ch: " ", tone: "blank" }
            : {
                ch: glyph(x, y, tick, phase + 7, true),
                tone: phase === 5 ? "lockFlash" : "lock",
              }
      }
    }
  }

  const caption =
    phase <= 2 ? "assembling" : phase === 3 ? "unlocked" : phase === 4 ? "locking" : "locked"
  const captionTone =
    phase <= 3 ? "captionMuted" : phase === 4 ? "captionWarning" : "captionSuccess"

  const wordRow = Math.max(0, layout.lockY - 3)
  overlay(rows, wordRow, SPLASH_WORDMARK, "wordmark")
  overlay(rows, wordRow + 1, "learning, locked in", "subtitle")
  overlay(rows, height - 2, caption, captionTone)
  overlay(rows, height - 1, "Esc to skip", "hint")
  return { rows, caption, captionTone }
}

/** 0 at the edges and 1 in the steady middle of the sequence. */
export function splashFade(
  elapsed: number,
  total = SPLASH_TOTAL_MS,
  fadeIn = SPLASH_FADE_IN_MS,
  fadeOut = SPLASH_FADE_OUT_MS,
): number {
  const at = Math.max(0, Math.min(total, elapsed))
  if (at < fadeIn) return at / fadeIn
  if (at > total - fadeOut) return Math.max(0, (total - at) / fadeOut)
  return 1
}

/** Splash on a normal launch; off under reduced motion or an explicit opt-out. */
export function splashEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !reducedMotion(env) && env.LOCKEDIN_NO_SPLASH !== "1"
}

type Run = { text: string; tone: SplashTone }

function runs(row: SplashCell[]): Run[] {
  const out: Run[] = []
  for (const cell of row) {
    const last = out[out.length - 1]
    if (last && last.tone === cell.tone) last.text += cell.ch
    else out.push({ text: cell.ch, tone: cell.tone })
  }
  return out
}

export function StartupSplash(props: { palette: ThemePalette; onDone: () => void }) {
  const dimensions = useTerminalDimensions()
  const [phase, setPhase] = createSignal(0)
  const [tick, setTick] = createSignal(0)
  const [elapsed, setElapsed] = createSignal(0)
  const frame = createMemo(() =>
    splashFrame({
      width: dimensions().width,
      height: dimensions().height,
      phase: phase(),
      tick: tick(),
    }),
  )
  const tones = createMemo(() => splashTones(props.palette, splashFade(elapsed())))
  const rows = createMemo(() => frame().rows.map(runs))
  let finished = false
  let ticker: ReturnType<typeof setInterval> | null = null
  let fadeTicker: ReturnType<typeof setInterval> | null = null
  const timers: ReturnType<typeof setTimeout>[] = []

  const finish = () => {
    if (finished) return
    finished = true
    props.onDone()
  }

  onMount(() => {
    if (reducedMotion()) {
      finish()
      return
    }
    const started = performance.now()
    for (const step of SPLASH_STEPS) timers.push(setTimeout(() => setPhase(step.phase), step.at))
    ticker = setInterval(() => setTick((value) => value + 1), 110)
    fadeTicker = setInterval(
      () => setElapsed((value) => Math.max(value, performance.now() - started)),
      50,
    )
    // Land on a fully transparent frame just before the app mounts, so the
    // last visible moment is the background, not a partially faded field.
    timers.push(setTimeout(() => setElapsed(SPLASH_TOTAL_MS), SPLASH_TOTAL_MS - 50))
    timers.push(setTimeout(finish, SPLASH_TOTAL_MS))
  })
  onCleanup(() => {
    for (const timer of timers) clearTimeout(timer)
    timers.length = 0
    if (ticker) clearInterval(ticker)
    if (fadeTicker) clearInterval(fadeTicker)
    ticker = null
    fadeTicker = null
  })

  useKeyboard((key) => {
    const name = key.name?.toLowerCase()
    if (name === "escape" || name === "return" || name === "enter" || name === "space" || key.name === " ") {
      finish()
    }
  })

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={props.palette.background}
    >
      {rows().map((row) => (
        <text wrapMode="none">
          {row.map((run) => (
            <span
              style={{
                fg: run.tone === "blank" ? props.palette.background : tones()[run.tone],
              }}
            >
              {run.text}
            </span>
          ))}
        </text>
      ))}
    </box>
  )
}

/** Mount the app only after the splash (or immediately when it is disabled). */
export function StartupGate(props: {
  enabled: boolean
  palette: ThemePalette
  app: () => JSX.Element
}) {
  const [ready, setReady] = createSignal(!props.enabled)
  return (
    <Show
      when={ready()}
      fallback={<StartupSplash palette={props.palette} onDone={() => setReady(true)} />}
    >
      {props.app()}
    </Show>
  )
}
