import { expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { onMount } from "solid-js"
import { testRender, useRenderer } from "@opentui/solid"

import { crimson } from "../../src/ui/theme/palettes"
import { paintParticles } from "../../src/ui/effects/paint"
import type { Particle } from "../../src/ui/effects/particles"

function marker(x: number, y: number): Particle {
  return { x, y, vx: 0, vy: 0, age: 0, life: 1, seed: 0, glyph: "@", mode: "fire" }
}

function findMarker(setup: Awaited<ReturnType<typeof testRender>>): { x: number; y: number } | null {
  const lines = setup.captureSpans().lines
  for (let y = 0; y < lines.length; y++) {
    let x = 0
    for (const span of lines[y]!.spans) {
      if (span.text.includes("@")) return { x: x + span.text.indexOf("@"), y }
      x += span.width
    }
  }
  return null
}

test("the effect layer sees the focused textarea cursor move", async () => {
  function Probe() {
    const renderer = useRenderer()
    onMount(() => {
      renderer.addPostProcessFn((buffer) => {
        const cursor = renderer.getCursorState()
        if (cursor.visible && cursor.x >= 0 && cursor.y >= 0) {
          paintParticles(buffer, [marker(cursor.x, cursor.y)], crimson)
        }
      })
    })
    return (
      <box width={40} height={4} backgroundColor={crimson.background}>
        <textarea
          ref={(value: TextareaRenderable) => value.focus()}
          focused
          initialValue={"hello world"}
          width={30}
          height={3}
          backgroundColor={crimson.surface}
          textColor={crimson.foreground}
          focusedBackgroundColor={crimson.panel}
          focusedTextColor={crimson.foreground}
        />
      </box>
    )
  }

  const setup = await testRender(() => <Probe />, { width: 40, height: 4 })
  try {
    await setup.flush()
    await setup.flush()
    const before = findMarker(setup)
    expect(before).not.toBeNull()
    setup.mockInput.pressKey("right")
    setup.mockInput.pressKey("right")
    await setup.flush()
    await setup.flush()
    const after = findMarker(setup)
    expect(after).not.toBeNull()
    expect(after!.x).toBeGreaterThan(before!.x)
  } finally {
    await setup.dispose()
  }
})
