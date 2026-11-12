/** The achievement inventory: dark locked slots, card art and sharing. */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"

const { testRender } = await import("@opentui/solid")
const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const achievements = await import("../../src/ui/achievements/achievements")
const source = await import("../../src/ui/achievements/pixel-source")
const domain = await import("../../src/domain/achievements")
const { project } = await import("../../src/ui/knowledge/scene")
const { crimson } = await import("../../src/ui/theme")

async function mount(
  metrics = domain.EMPTY_METRICS,
  view = achievements.initialAchievementView,
  unlockAll = false,
  awards: Record<string, string> = {},
  graphics?: boolean,
) {
  const setup = await testRender(
    () => (
      <achievements.AchievementPane
        theme={crimson}
        width={120}
        height={40}
        focused
        view={view}
        metrics={metrics}
        unlockAll={unlockAll}
        awards={awards}
        graphics={graphics}
        reducedMotion
      />
    ),
    { width: 120, height: 40 },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function frame(setup: { captureCharFrame: () => string }): string {
  return setup.captureCharFrame()
}

describe("inventory", () => {
  test("locked achievements are dark slots with dimmed art and hidden names", async () => {
    const setup = await mount()
    try {
      const text = frame(setup)
      expect(text).toContain("ACHIEVEMENTS")
      expect(text).toContain(`0 / ${domain.ACHIEVEMENTS.length} unlocked`)
      expect(text).toContain("???")
      expect(text).not.toMatch(/[\u2800-\u28ff]/)
      expect(text).not.toContain("First Light")
    } finally {
      await setup.dispose()
    }
  })

  test("unlocked achievements show the name, art and status", async () => {
    const setup = await mount({
      ...domain.EMPTY_METRICS,
      messages: 12,
      toolCalls: 30,
      steps: 30,
      cardsKnown: 40,
      lessons: 6,
    })
    try {
      const text = frame(setup)
      expect(text).toContain("First Light")
      expect(text).toContain("s share")
      expect(text).toContain(`8 / ${domain.ACHIEVEMENTS.length} unlocked`)
    } finally {
      await setup.dispose()
    }
  })

  test("the pixel map draws flat achievement labels", async () => {
    const setup = await mount(domain.EMPTY_METRICS, achievements.initialAchievementView, true, {}, true)
    try {
      const text = frame(setup)
      expect(text).toContain("ACHIEVEMENTS")
      expect(text).toContain("First Light") // detail card
      expect(text).not.toContain("◆")
      expect(text).not.toContain("● Open Book") // no list fallback
    } finally {
      await setup.dispose()
    }
  })

  test("moving the selection never moves the node layout", () => {
    const first = achievements.achievementScene(
      { ...achievements.initialAchievementView, cursor: 0 },
      domain.EMPTY_METRICS,
      960,
      480,
      false,
    ).scene
    for (const cursor of [1, 4, 9, 20]) {
      const next = achievements.achievementScene(
        { ...achievements.initialAchievementView, cursor },
        domain.EMPTY_METRICS,
        960,
        480,
        false,
      ).scene
      expect(next.nodes.map((node) => [node.id, node.x, node.y, node.z])).toEqual(
        first.nodes.map((node) => [node.id, node.x, node.y, node.z]),
      )
      const focus = next.nodes.find((node) => node.id === next.focusId)!
      // The camera centres the node's base; the visible node drifts a couple
      // of units inside its orbit.
      expect(Math.abs(next.camera.x - focus.x)).toBeLessThan(6)
      expect(Math.abs(next.camera.y - focus.y)).toBeLessThan(6)
      expect(Math.abs(next.camera.z - focus.z)).toBeLessThan(6)
    }
  })

  test("difficulty tiers come from the target alone", () => {
    expect(domain.difficultyTier(1)).toBe(1)
    expect(domain.difficultyTier(10)).toBe(1)
    expect(domain.difficultyTier(11)).toBe(2)
    expect(domain.difficultyTier(25)).toBe(2)
    expect(domain.difficultyTier(50)).toBe(3)
    expect(domain.difficultyTier(100)).toBe(4)
    expect(domain.difficultyTier(250)).toBe(5)
    expect(domain.difficultyTier(500)).toBe(6)
    expect(domain.difficultyTier(1000)).toBe(7)
    expect(domain.difficultyTier(1001)).toBe(8)
    expect(domain.difficultyLabel(50)).toBe("medium")
  })

  test("branches are metric chains ordered easiest to hardest", () => {
    const branches = achievements.achievementBranches(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      true,
    )
    expect(branches.length).toBeGreaterThan(1)
    for (const branch of branches) {
      const targets = branch.items.map((achievement) => achievement.target)
      expect(targets).toEqual([...targets].sort((a, b) => a - b))
      expect(new Set(branch.items.map((achievement) => achievement.metric))).toEqual(new Set([branch.metric]))
    }
  })

  test("connector edges follow the chains and join every base", () => {
    const built = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      960,
      480,
      true,
    )
    const ids = new Set(built.scene.nodes.map((node) => node.id))
    for (const edge of built.scene.edges) {
      expect(ids.has(edge.from)).toBe(true)
      expect(ids.has(edge.to)).toBe(true)
    }
    for (const branch of built.branches) {
      for (let index = 1; index < branch.items.length; index++) {
        expect(
          built.scene.edges.some(
            (edge) =>
              edge.from.endsWith(branch.items[index - 1]!.id) &&
              edge.to.endsWith(branch.items[index]!.id),
          ),
        ).toBe(true)
      }
    }
    // One open path through every base: a constellation line, with two ends.
    const baseIds = new Set(
      built.branches.map((branch) => `achievement:${branch.items[0]!.id}`),
    )
    const pathEdges = built.scene.edges.filter(
      (edge) => baseIds.has(edge.from) && baseIds.has(edge.to),
    )
    expect(pathEdges).toHaveLength(baseIds.size - 1)
    const degree = new Map([...baseIds].map((id) => [id, 0]))
    for (const edge of pathEdges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
    }
    expect([...degree.values()].filter((value) => value === 1)).toHaveLength(2)
    expect([...degree.values()].every((value) => value === 1 || value === 2)).toBe(true)
    expect(built.scene.edges.some((edge) => edge.hot)).toBe(true)
  })

  test("directions follow the screen and lines reconnect only at a base", () => {
    const list = achievements.visibleAchievements(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      true,
    )
    const branches = achievements.achievementBranches(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      true,
    )
    const scene = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      960,
      480,
      true,
    ).scene
    const points = new Map(scene.nodes.map((node) => [node.id, node]))
    const inDirection = (direction: string, dx: number, dy: number): boolean => {
      if (direction === "up") return dy < -1 && Math.abs(dx) <= Math.abs(dy) * 1.5
      if (direction === "down") return dy > 1 && Math.abs(dx) <= Math.abs(dy) * 1.5
      if (direction === "left") return dx < -1 && Math.abs(dy) <= Math.abs(dx) * 1.5
      return dx > 1 && Math.abs(dy) <= Math.abs(dx) * 1.5
    }
    const at = (achievement: { id: string }) => {
      const point = points.get(`achievement:${achievement.id}`)!
      return point
    }
    const branch = branches.find((candidate) => candidate.items.length >= 2)!
    const inner = branch.items[1]!
    const innerView = { ...achievements.initialAchievementView, cursor: list.findIndex((a) => a.id === inner.id) }
    for (const direction of ["up", "down", "left", "right"] as const) {
      const moved = achievements.moveAchievementNode(
        innerView,
        direction,
        domain.EMPTY_METRICS,
        120,
        30,
        true,
      )
      const target = list[moved.cursor]!
      expect(target.metric).toBe(branch.metric)
      if (moved.cursor !== innerView.cursor) {
        const from = at(inner)
        const to = at(target)
        expect(inDirection(direction, to.x - from.x, to.y - from.y)).toBe(true)
      }
    }
    // A base may cross to another line, but only in the pressed direction.
    let crossed = false
    for (const candidate of branches) {
      const base = candidate.items[0]!
      const baseView = {
        ...achievements.initialAchievementView,
        cursor: list.findIndex((achievement) => achievement.id === base.id),
      }
      for (const direction of ["up", "down", "left", "right"] as const) {
        const moved = achievements.moveAchievementNode(
          baseView,
          direction,
          domain.EMPTY_METRICS,
          120,
          30,
          true,
        )
        if (moved.cursor === baseView.cursor) continue
        const target = list[moved.cursor]!
        const from = at(base)
        const to = at(target)
        expect(inDirection(direction, to.x - from.x, to.y - from.y)).toBe(true)
        if (target.metric !== candidate.metric) crossed = true
      }
    }
    expect(crossed).toBe(true)
  })

  test("g/G jump to the easiest and hardest targets", () => {
    const first = achievements.jumpAchievement(achievements.initialAchievementView, "first", domain.EMPTY_METRICS, true)
    const last = achievements.jumpAchievement(achievements.initialAchievementView, "last", domain.EMPTY_METRICS, true)
    const list = achievements.visibleAchievements(achievements.initialAchievementView, domain.EMPTY_METRICS, true)
    expect(list[first.cursor]!.target).toBe(1)
    expect(list[last.cursor]!.target).toBe(500)
  })

  test("directions never skip a node", () => {
    const list = achievements.visibleAchievements(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      true,
    )
    const branches = achievements.achievementBranches(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      true,
    )
    const place = new Map<string, { metric: string; rank: number }>()
    for (const branch of branches) {
      branch.items.forEach((achievement, rank) => place.set(achievement.id, { metric: branch.metric, rank }))
    }
    for (let cursor = 0; cursor < list.length; cursor++) {
      const from = place.get(list[cursor]!.id)!
      for (const direction of ["up", "down", "left", "right"] as const) {
        const moved = achievements.moveAchievementNode(
          { ...achievements.initialAchievementView, cursor },
          direction,
          domain.EMPTY_METRICS,
          255,
          57,
          true,
        )
        if (moved.cursor === cursor) continue
        const to = place.get(list[moved.cursor]!.id)!
        const adjacent = to.metric === from.metric && Math.abs(to.rank - from.rank) === 1
        const baseToBase = from.rank === 0 && to.rank === 0 && to.metric !== from.metric
        expect(adjacent || baseToBase).toBe(true)
      }
    }
  })

  test("every achievement is reachable with the arrow keys", () => {
    const seen = new Set<number>([0])
    const queue = [0]
    while (queue.length > 0) {
      const at = queue.shift()!
      for (const direction of ["up", "down", "left", "right"] as const) {
        const next = achievements.moveAchievementNode(
          { ...achievements.initialAchievementView, cursor: at },
          direction,
          domain.EMPTY_METRICS,
          120,
          30,
          true,
        ).cursor
        if (next !== at && !seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    expect(seen.size).toBe(domain.ACHIEVEMENTS.length)
  })

  test("long labels wrap at word boundaries", () => {
    expect(achievements.wrapLabel("short", 12)).toEqual(["short"])
    const wrapped = achievements.wrapLabel("a rather long achievement label", 12, 2)
    expect(wrapped).toHaveLength(2)
    expect(wrapped.every((line) => line.length <= 12)).toBe(true)
    expect(wrapped[1]).toContain("...")
  })

  test("the achievement map is flat and widely spaced", () => {
    const built = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      960,
      480,
      false,
    )
    const notes = built.scene.nodes.filter((node) => node.kind === "note")
    expect(notes).toHaveLength(domain.ACHIEVEMENTS.length)
    expect(new Set(notes.map((node) => `${node.x}:${node.y}`)).size).toBe(
      domain.ACHIEVEMENTS.length,
    )
    for (let a = 0; a < notes.length; a++) {
      for (let b = a + 1; b < notes.length; b++) {
        const first = notes[a]!
        const second = notes[b]!
        expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(30)
      }
    }
    expect(built.scene.near.size).toBe(built.scene.nodes.length)
    expect(notes.every((node) => node.tone === "error")).toBe(true)
    expect(notes.every((node) => node.shape === "star")).toBe(true)
    const unlocked = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      960,
      480,
      true,
    )
    expect(unlocked.scene.nodes.filter((node) => node.kind === "note").every((node) => node.tone === "success")).toBe(
      true,
    )
    const later = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      960,
      480,
      false,
      2,
    )
    const before = notes.map((node) => `${node.id}:${node.x.toFixed(2)}:${node.y.toFixed(2)}`)
    const after = later.scene.nodes
      .filter((node) => node.kind === "note")
      .map((node) => `${node.id}:${node.x.toFixed(2)}:${node.y.toFixed(2)}`)
    // The map only ever translates. Per-node drift made every star wobble
    // independently during a pan, which read as dancing.
    expect(after).toEqual(before)
    expect(later.scene.nodes.every((node) => node.z === 0)).toBe(true)
    expect(later.scene.camera.yaw).toBe(0)
    expect(later.scene.camera.pitch).toBe(0)
    expect(achievements.moveAchievementList(
      achievements.initialAchievementView,
      "down",
      domain.EMPTY_METRICS,
      false,
    ).cursor).toBe(1)
    const spatial = achievements.moveAchievementNode(
      achievements.initialAchievementView,
      "up",
      domain.EMPTY_METRICS,
      120,
      30,
      false,
    )
    expect(spatial.cursor).not.toBe(0)
  })

  test("filters and grid movement stay inside the visible list", () => {
    const empty = domain.EMPTY_METRICS
    const unlockedFilter = achievements.cycleFilter(achievements.initialAchievementView, empty, false)
    expect(unlockedFilter.filter).toBe("unlocked")
    expect(achievements.visibleAchievements(unlockedFilter, empty, false)).toHaveLength(0)
    expect(achievements.currentAchievement(unlockedFilter, empty, false)).toBeUndefined()

    const next = achievements.moveAchievement(achievements.initialAchievementView, "down", empty, 4)
    expect(next.cursor).toBe(4)
    expect(achievements.moveAchievement(next, "up", empty, 4).cursor).toBe(0)
    expect(achievements.moveAchievement(achievements.initialAchievementView, "left", empty, 4).cursor).toBe(0)
    const last = achievements.moveAchievement(next, "last", empty, 4)
    expect(last.cursor).toBe(domain.ACHIEVEMENTS.length - 1)
    expect(achievements.moveAchievement(last, "down", empty, 4).cursor).toBe(domain.ACHIEVEMENTS.length - 1)
    expect(achievements.moveAchievement(last, "right", empty, 4).cursor).toBe(domain.ACHIEVEMENTS.length - 1)
  })

  test("every achievement has a non-empty 80x48 image source", () => {
    for (const achievement of domain.ACHIEVEMENTS) {
      const art = source.achievementArt(achievement)
      expect(art.width).toBe(80)
      expect(art.height).toBe(48)
      expect(art.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
    }
  })

  test("the share card carries the large art and the achievement name", () => {
    const first = domain.ACHIEVEMENTS[0]!
    const card = domain.shareText(first)
    expect(card).toContain("ACHIEVEMENT UNLOCKED")
    expect(card).toContain("First Light")
    expect(card).toContain("Send your first message.")
    expect(card).toContain("LockedIn")
  })

  test("the grid detail card shows name, task and award date", async () => {
    const setup = await mount(
      domain.EMPTY_METRICS,
      achievements.initialAchievementView,
      true,
      { "first-light": "2026-11-05" },
    )
    try {
      const text = frame(setup)
      expect(text).toContain("First Light")
      expect(text).toContain("Send your first message.")
      expect(text).toContain("awarded 2026-11-05")
      expect(text).toContain("Open Book")
    } finally {
      await setup.dispose()
    }
  })
})

describe("the image budget", () => {
  test("a larger window shows more map at the same zoom", () => {
    const small = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      800,
      300,
      true,
    ).scene
    const full = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      2400,
      900,
      true,
    ).scene
    expect(small.camera.distance).toBe(achievements.ACHIEVEMENT_CAMERA_DISTANCE)
    expect(full.camera.distance).toBe(small.camera.distance)
    const node = small.nodes.find((entry) => entry.kind === "note")!
    const a = project(node, small.camera, 800, 300)
    const b = project(node, full.camera, 2400, 900)
    // Same number of pixels from centre in both windows: maximising reveals
    // more of the map instead of shrinking the stars.
    expect(b.x - 1200).toBeCloseTo(a.x - 400, 6)
    expect(b.y - 450).toBeCloseTo(a.y - 150, 6)
  })

  test("rendering smaller is a uniform downscale, not a zoom", () => {
    const full = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      1600,
      600,
      true,
      1600,
    ).scene
    const small = achievements.achievementScene(
      achievements.initialAchievementView,
      domain.EMPTY_METRICS,
      800,
      300,
      true,
      1600,
    ).scene
    expect(small.camera.distance).toBe(full.camera.distance)
    for (let index = 0; index < full.nodes.length; index++) {
      const a = project(full.nodes[index]!, full.camera, 1600, 600)
      const b = project(small.nodes[index]!, small.camera, 800, 300)
      expect(b.x / 800).toBeCloseTo(a.x / 1600, 6)
      expect(b.y / 300).toBeCloseTo(a.y / 600, 6)
    }
  })
})

describe("animation", () => {
  test("the map moves while travelling and then stops repainting", async () => {
    const [view, setView] = createSignal(achievements.initialAchievementView)
    const setup = await testRender(
      () => (
        <achievements.AchievementPane
          theme={crimson}
          width={100}
          height={32}
          focused
          view={view()}
          metrics={domain.EMPTY_METRICS}
          unlockAll
          graphics
        />
      ),
      { width: 100, height: 32 },
    )
    try {
      await setup.flush()
      // Let the first animation tick install the initial camera; otherwise the
      // next view change snaps straight to its target instead of panning.
      await new Promise((resolve) => setTimeout(resolve, 100))
      await setup.renderOnce()
      const start = setup.captureCharFrame()
      const targetView = achievements.moveAchievementNode(view(), "up", domain.EMPTY_METRICS, 98, 24)
      setView(targetView)
      // Mid-travel: the hold is over, the camera is still well short of the
      // target, and enough frames have presented for the capture to be current.
      await new Promise((resolve) => setTimeout(resolve, 250))
      await setup.renderOnce()
      const selection = setup.captureCharFrame()
      expect(selection).not.toBe(start)
      let previous = selection
      let moved = false
      let stable = 0
      let settled: string | null = null
      for (let step = 0; step < 80 && settled === null; step++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        // `flush` waits for visual idle, which the moving camera never reaches
        // until the end; step the renderer directly instead.
        await setup.renderOnce()
        const current = setup.captureCharFrame()
        if (current !== selection) moved = true
        stable = moved && current === previous ? stable + 1 : 0
        // A late retry after a busy buffer can still publish the snapped frame,
        // so require a few quiet frames before calling it settled.
        if (stable >= 3) settled = current
        previous = current
      }
      // The camera really travelled...
      if (settled === null) throw new Error("the map never settled")
      expect(settled).not.toBe(selection)
      // ...and once it is there, no ticker keeps repainting.
      await new Promise((resolve) => setTimeout(resolve, 150))
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toBe(settled)
    } finally {
      await setup.dispose()
    }
  }, 30_000)
})

describe("the camera hold", () => {
  test("a held-key repeat does not restart the highlight hold", () => {
    // First press of a burst gets the hold.
    expect(achievements.startsFocusBurst(1_000, 0)).toBe(true)
    // Terminal key repeat arrives far faster than the window, so the camera is
    // allowed to keep moving instead of being held on every repeat.
    let last = 1_000
    for (let now = 1_040; now < 1_200; now += 40) {
      expect(achievements.startsFocusBurst(now, last)).toBe(false)
      last = now
    }
    // A deliberate second press after the burst starts a fresh hold.
    expect(achievements.startsFocusBurst(1_500, last)).toBe(true)
  })
})

describe("the buffer", () => {
  test("the Explorer global section opens the achievement buffer", async () => {
    const ui = await renderApp({ width: 140, height: 36, app: () => <App /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      await ui.press("e")
      await ui.waitUntil(() => ui.frame().includes("EXPLORER"))
      for (let step = 0; step < 6; step++) await ui.press("down")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("ACHIEVEMENTS"))
      expect(ui.frame()).toContain("2/2")
      expect(ui.frame()).toContain("ACHIEVEMENTS")
    } finally {
      await ui.dispose()
    }
  }, 30_000)

  test("space i opens a full achievement buffer and Esc returns", async () => {
    const ui = await renderApp({ width: 140, height: 36, app: () => <App /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      await ui.press("i")
      await ui.waitUntil(() => ui.frame().includes("ACHIEVEMENTS"))
      expect(ui.frame()).toContain("2/2")
      expect(ui.frame()).toContain(`${domain.ACHIEVEMENTS.length} / ${domain.ACHIEVEMENTS.length} unlocked`)
      expect(ui.frame()).toContain("s share")

      await ui.press("escape")
      await ui.waitUntil(() => !ui.frame().includes("ACHIEVEMENTS"))
      expect(ui.frame()).not.toContain("ACHIEVEMENTS")
    } finally {
      await ui.dispose()
    }
  }, 30_000)
})
