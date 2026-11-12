/**
 * The effects painter runs inside OpenTUI's post-process hook, after layout
 * and before encoding. It must draw on empty cells and leave text alone.
 */
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { testRender, useRenderer } from "@opentui/solid"

import { crimson } from "../../src/ui/theme/palettes"
import { CursorTrail } from "../../src/ui/effects/cursor"
import { paintCursor, paintParticles, paintTrail } from "../../src/ui/effects/paint"
import type { Particle } from "../../src/ui/effects/particles"

test("effects paint on empty cells and preserve text", async () => {
  const particle: Particle = {
    x: 5,
    y: 1,
    vx: 0,
    vy: 0,
    age: 0,
    life: 1,
    seed: 0,
    glyph: "█",
    mode: "fire",
  }
  const trail = new CursorTrail(1)
  trail.points.push({ x: 5, y: 2, age: 0, life: 1 })

  function Probe() {
    const renderer = useRenderer()
    onMount(() => {
      renderer.addPostProcessFn((buffer) => {
        paintParticles(buffer, [particle], crimson)
        // Same row as the text: the particle must not erase the glyph.
        paintParticles(buffer, [{ ...particle, x: 0, y: 0 }], crimson)
        paintTrail(buffer, trail, crimson)
        paintCursor(buffer, 8, 3, crimson)
      })
    })
    return (
      <box width={20} height={5} backgroundColor={crimson.background}>
        <text>AB</text>
      </box>
    )
  }

  const setup = await testRender(() => <Probe />, { width: 20, height: 5 })
  try {
    await setup.flush()
    const frame = setup.captureSpans()
    const rows = frame.lines.map((line) => line.spans.map((span) => span.text).join(""))
    expect(rows[0]).toContain("AB")
    expect(rows[1]).toContain("█")
    expect(rows[3]).toContain("█")
    const trailRow = frame.lines[2]!.spans
    expect(trailRow.some((span) => span.text.includes(" ") && span.bg.toInts()[3] > 0)).toBe(true)
  } finally {
    await setup.dispose()
  }
})

async function renderLayer(layer: "under" | "over") {
  const particle: Particle = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 1,
    seed: 0,
    glyph: "█",
    mode: "fire",
  }
  function Probe() {
    const renderer = useRenderer()
    onMount(() => {
      renderer.addPostProcessFn((buffer) => {
        paintParticles(buffer, [particle], crimson, layer)
      })
    })
    return (
      <box width={8} height={2} backgroundColor={crimson.background}>
        <text>AB</text>
      </box>
    )
  }
  const setup = await testRender(() => <Probe />, { width: 8, height: 2 })
  await setup.flush()
  const frame = setup.captureSpans()
  await setup.dispose()
  return frame
}

test("under preserves the glyph and tints its background", async () => {
  const frame = await renderLayer("under")
  const row = frame.lines[0]!
  const text = row.spans.map((span) => span.text).join("")
  expect(text).toContain("AB")
  const a = row.spans.find((span) => span.text.includes("A"))
  expect(a).toBeDefined()
  expect(a!.bg.toInts()).not.toEqual([13, 15, 17, 255])
})

test("over draws the effect glyph over the text", async () => {
  const frame = await renderLayer("over")
  const text = frame.lines[0]!.spans.map((span) => span.text).join("")
  expect(text).toContain("█")
  expect(text).not.toContain("AB")
})
