/**
 * Dev-only effects lab.
 *
 *   bun run src/ui/effects/lab.tsx
 *
 * A synthetic cursor moves across the empty canvas, leaving a trail and
 * emitting particles. Keys: 1 fire, 2 snow, 3 sparks, space burst, c trail,
 * a auto-emit, p pause, q quit. The lab is not part of the app.
 */
import type { TextareaRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"

import { crimson } from "../theme/palettes"
import type { ThemePalette } from "../theme"
import { CursorSpring, CursorTrail } from "./cursor"
import { paintCursor, paintParticles, paintTrail, type TextLayer } from "./paint"
import { ParticleField, type ParticleMode } from "./particles"

type LabStats = {
  mode: ParticleMode
  particles: number
  trail: number
  paused: boolean
  auto: boolean
  trailOn: boolean
  following: boolean
  layer: TextLayer
}

class EffectsLab {
  readonly particles: ParticleField
  readonly trail = new CursorTrail(0.42, 80)
  readonly spring: CursorSpring
  private readonly palette: ThemePalette
  private lastCell = { x: -1, y: -1 }
  private emit = 0
  private time = 0
  private width: number
  private height: number
  mode: ParticleMode = "fire"
  paused = false
  auto = true
  trailOn = true
  following = true
  layer: TextLayer = "around"

  constructor(width: number, height: number, palette: ThemePalette) {
    this.width = Math.max(20, width)
    this.height = Math.max(8, height)
    this.palette = palette
    this.particles = new ParticleField(this.width, this.height, { max: 320 })
    this.spring = new CursorSpring(this.width / 2, this.height / 2)
  }

  resize(width: number, height: number): void {
    this.width = Math.max(20, width)
    this.height = Math.max(8, height)
    this.particles.resize(this.width, this.height)
  }

  setMode(mode: ParticleMode): void {
    this.mode = mode
    this.burst(18)
  }

  cycleLayer(): void {
    this.layer = this.layer === "around" ? "under" : this.layer === "under" ? "over" : "around"
  }

  burst(count = 12): void {
    const cell = this.spring.cell
    this.particles.spawn(cell.x, cell.y, this.mode, count)
  }

  update(dt: number, cursor?: { x: number; y: number; visible: boolean }): void {
    if (this.paused) return
    this.time += dt
    if (this.following && cursor?.visible) {
      this.spring.setTarget(cursor.x, cursor.y)
    } else {
      const left = 2
      const right = this.width - 3
      const top = 4
      const bottom = this.height - 5
      const targetX = left + (right - left) * (0.5 + 0.42 * Math.sin(this.time * 0.73))
      const targetY = top + (bottom - top) * (0.5 + 0.4 * Math.sin(this.time * 1.09 + 1.4))
      this.spring.setTarget(targetX, targetY)
    }
    this.spring.update(dt)

    const cell = this.spring.cell
    if (this.trailOn && (cell.x !== this.lastCell.x || cell.y !== this.lastCell.y)) {
      this.trail.record(cell.x, cell.y)
      this.lastCell = cell
    }
    this.trail.update(dt)

    if (this.auto) {
      this.emit += dt
      while (this.emit >= 0.09) {
        this.emit -= 0.09
        this.particles.spawn(cell.x, cell.y, this.mode, this.mode === "sparks" ? 1 : 2)
      }
    }
    this.particles.update(dt)
  }

  paint(buffer: Parameters<typeof paintParticles>[0]): void {
    if (this.trailOn) paintTrail(buffer, this.trail, this.palette, this.layer)
    paintParticles(buffer, this.particles.particles, this.palette, this.layer)
    if (!this.following) {
      const cell = this.spring.cell
      paintCursor(buffer, cell.x, cell.y, this.palette, this.layer)
    }
  }

  stats(): LabStats {
    return {
      mode: this.mode,
      particles: this.particles.count,
      trail: this.trail.points.length,
      paused: this.paused,
      auto: this.auto,
      trailOn: this.trailOn,
      following: this.following,
      layer: this.layer,
    }
  }
}

function Lab() {
  const renderer = useRenderer()
  const palette = crimson
  const [stats, setStats] = createSignal<LabStats>({
    mode: "fire",
    particles: 0,
    trail: 0,
    paused: false,
    auto: true,
    trailOn: true,
    following: true,
    layer: "around",
  })
  let lab: EffectsLab | null = null
  let editor: TextareaRenderable | null = null
  const [textFocused, setTextFocused] = createSignal(true)

  onMount(() => {
    const effects = new EffectsLab(renderer.width, renderer.height, palette)
    effects.following = true
    lab = effects
    const paint = (buffer: Parameters<EffectsLab["paint"]>[0]) => effects.paint(buffer)
    renderer.addPostProcessFn(paint)
    const stopTicks = renderer.onAnimationTick(60, (dt) => {
      // The renderer reports milliseconds; effect ages are in seconds.
      effects.update(dt / 1000, renderer.getCursorState())
      renderer.requestRender()
    })
    // Start with the textarea focused so arrow keys immediately move the
    // cursor the trail follows.
    editor?.focus()
    const resize = (width: number, height: number) => effects.resize(width, height)
    renderer.on("resize", resize)
    const timer = setInterval(() => setStats(effects.stats()), 250)
    onCleanup(() => {
      clearInterval(timer)
      renderer.off("resize", resize)
      stopTicks()
      renderer.removePostProcessFn(paint)
    })
  })

  useKeyboard((key) => {
    if (!lab) return
    if (textFocused()) {
      if (key.name === "escape") {
        setTextFocused(false)
        lab.following = false
        editor?.blur()
        renderer.setCursorPosition(0, 0, false)
      }
      return
    }
    if (key.name === "q" || key.name === "escape") {
      renderer.destroy()
      process.exit(0)
    }
    if (key.name === "t") {
      setTextFocused(true)
      lab.following = true
      editor?.focus()
      return
    }
    if (key.name === "1") lab.setMode("fire")
    else if (key.name === "2") lab.setMode("snow")
    else if (key.name === "3") lab.setMode("sparks")
    else if (key.name === "space") lab.burst(24)
    else if (key.name === "c") lab.trailOn = !lab.trailOn
    else if (key.name === "m") lab.cycleLayer()
    else if (key.name === "a") lab.auto = !lab.auto
    else if (key.name === "p") lab.paused = !lab.paused
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={palette.background}>
      <box height={4} flexShrink={0} paddingLeft={2} paddingTop={1}>
        <text fg={palette.primary}>EFFECTS LAB</text>
        <text fg={palette.muted} wrapMode="none">
          {"  arrows move · Esc for modes · 1/2/3 fire/snow/sparks · space burst"}
        </text>
        <text fg={palette.muted} wrapMode="none">
          {"  c trail · m layer · a auto · t text · p pause · q quit"}
        </text>
      </box>
      <box flexGrow={1} paddingLeft={2} paddingRight={2}>
        <textarea
          ref={(value: TextareaRenderable) => {
            editor = value
          }}
          initialValue={"Move the cursor with the arrow keys.\nThe trail follows the real cursor.\nText stays visible under every effect."}
          focused={textFocused()}
          width={52}
          height={5}
          wrapMode="word"
          backgroundColor={palette.surface}
          textColor={palette.foreground}
          focusedBackgroundColor={palette.panel}
          focusedTextColor={palette.foreground}
          placeholderColor={palette.muted}
        />
      </box>
      <box height={2} flexShrink={0} paddingLeft={2}>
        <text fg={palette.muted}>
          {`${stats().mode} · ${stats().particles} particles · ${stats().trail} trail cells · auto ${
            stats().auto ? "on" : "off"
          } · trail ${stats().trailOn ? "on" : "off"} · ${stats().layer} text · ${
            stats().following ? "real cursor" : "synthetic cursor"
          }${stats().paused ? " · paused" : ""}`}
        </text>
      </box>
    </box>
  )
}

await render(() => <Lab />, { targetFps: 60, maxFps: 60 })
