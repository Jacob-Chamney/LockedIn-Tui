/**
 * Dev-only demo runner for the particle-system API.
 *
 *   bun run src/ui/effects/plugin-lab.tsx
 *
 * The demo plugin lives in `examples/fireflies.ts` and is the code shown on the
 * wiki. The host owns the buffer and rendering; the plugin only spawns, steps
 * and styles particles.
 */
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"

import { crimson } from "../theme/palettes"
import type { ThemePalette } from "../theme"
import { CursorSpring, CursorTrail } from "./cursor"
import fireflies from "./examples/fireflies"
import { CustomParticleHost } from "./host"
import { paintCursor, paintParticles, paintTrail } from "./paint"

class DemoLab {
  readonly host: CustomParticleHost
  readonly trail = new CursorTrail(0.45, 80)
  readonly spring: CursorSpring
  private readonly palette: ThemePalette
  private width: number
  private height: number
  private time = 0
  private last = { x: -1, y: -1 }
  paused = false

  constructor(width: number, height: number, palette: ThemePalette) {
    this.width = Math.max(20, width)
    this.height = Math.max(8, height)
    this.palette = palette
    this.host = new CustomParticleHost(this.width, this.height, palette, fireflies)
    this.spring = new CursorSpring(this.width / 2, this.height / 2)
  }

  resize(width: number, height: number): void {
    this.width = Math.max(20, width)
    this.height = Math.max(8, height)
    this.host.resize(this.width, this.height)
  }

  update(dt: number): void {
    if (this.paused) return
    this.time += dt
    const left = 3
    const right = this.width - 4
    const top = 5
    const bottom = this.height - 5
    const x = left + (right - left) * (0.5 + 0.42 * Math.sin(this.time * 0.61))
    const y = top + (bottom - top) * (0.5 + 0.38 * Math.sin(this.time * 0.93 + 1.2))
    this.spring.setTarget(x, y)
    this.spring.update(dt)
    const cell = this.spring.cell
    if (cell.x !== this.last.x || cell.y !== this.last.y) {
      this.trail.record(cell.x, cell.y)
      this.last = cell
    }
    this.trail.update(dt)
    this.host.setCursor(cell.x, cell.y)
    this.host.update(dt)
  }

  paint(buffer: Parameters<typeof paintParticles>[0]): void {
    paintTrail(buffer, this.trail, this.palette, this.host.layer)
    paintParticles(buffer, this.host.particles(), this.palette, this.host.layer)
    paintCursor(buffer, this.spring.cell.x, this.spring.cell.y, this.palette, this.host.layer)
  }
}

function Lab() {
  const renderer = useRenderer()
  const palette = crimson
  const [stats, setStats] = createSignal({ particles: 0, paused: false })
  let lab: DemoLab | null = null

  onMount(() => {
    const demo = new DemoLab(renderer.width, renderer.height, palette)
    lab = demo
    const paint = (buffer: Parameters<DemoLab["paint"]>[0]) => demo.paint(buffer)
    renderer.addPostProcessFn(paint)
    renderer.setCursorPosition(0, 0, false)
    const stop = renderer.onAnimationTick(60, (dt) => {
      demo.update(dt)
      renderer.requestRender()
    })
    const resize = (width: number, height: number) => demo.resize(width, height)
    renderer.on("resize", resize)
    const timer = setInterval(() => {
      setStats({ particles: demo.host.particleCount, paused: demo.paused })
    }, 250)
    onCleanup(() => {
      clearInterval(timer)
      renderer.off("resize", resize)
      stop()
      renderer.removePostProcessFn(paint)
    })
  })

  useKeyboard((key) => {
    if (!lab) return
    if (key.name === "q" || key.name === "escape") {
      renderer.destroy()
      process.exit(0)
    }
    if (key.name === "p") lab.paused = !lab.paused
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={palette.background}>
      <box height={3} flexShrink={0} paddingLeft={2} paddingTop={1}>
        <text fg={palette.primary}>FIREFLIES · PARTICLE API DEMO</text>
        <text fg={palette.muted} wrapMode="none">
          {"  p pause · q quit · the plugin only spawns, steps and styles particles"}
        </text>
      </box>
      <box flexGrow={1} />
      <box height={2} flexShrink={0} paddingLeft={2}>
        <text fg={palette.muted} wrapMode="none">
          {`demo.fireflies · ${stats().particles}p · under text${stats().paused ? " · paused" : ""}`}
        </text>
      </box>
    </box>
  )
}

await render(() => <Lab />, { targetFps: 60, maxFps: 60 })
