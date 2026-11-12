/** WP-150 — flashcard deck and study-guide readers over their service seam. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { testRender } = await import("@opentui/solid")
const deckUi = await import("../../src/ui/reader/deck")
const guideUi = await import("../../src/ui/reader/guide")
type Deck = import("../../src/ui/reader/deck").Deck
type Guide = import("../../src/ui/reader/guide").Guide
const { crimson } = await import("../../src/ui/theme")
const { createSignal } = await import("solid-js")

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/deck-reader/deck.json"), "utf8"))
const deck = (): Deck => structuredClone(FIXTURE.deck)
const guide = (): Guide => structuredClone(FIXTURE.guide)

function fakePorts() {
  const calls: string[] = []
  const state = { deck: deck(), guide: guide(), answers: { ...FIXTURE.answers } as Record<string, string> }
  return {
    calls,
    state,
    deckPort: {
      mark: async (_deckId: string, cardId: string, mark: string) => {
        calls.push(`mark:${cardId}:${mark}`)
        const card = state.deck.cards.find((entry) => entry.id === cardId)!
        if (mark === "missed") { card.missed = true; card.known = false }
        else if (mark === "known") { card.known = true; card.missed = false }
        else { card.missed = false; card.known = false }
      },
      reload: async (_deckId: string) => structuredClone(state.deck),
      tick: async () => {},
    },
    guidePort: {
      reveal: async (_guideId: string, sectionId: string) => {
        calls.push(`reveal:${sectionId}`)
        return state.answers[sectionId] ?? ""
      },
      tick: async (_guideId: string, sectionId: string) => {
        calls.push(`tick:${sectionId}`)
        const section = state.guide.sections.find((entry) => entry.id === sectionId)!
        section.reviewed = !section.reviewed
      },
      reload: async (_guideId: string) => structuredClone(state.guide),
    },
  }
}

async function mountDeck(width: number, height: number, value = deck(), view = deckUi.initialDeckView) {
  const setup = await testRender(
    () => <deckUi.DeckPane theme={crimson} width={width} height={height} focused deck={value} view={view} />,
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

async function mountGuide(width: number, height: number, value = guide(), view = guideUi.initialGuideView) {
  const setup = await testRender(
    () => <guideUi.GuidePane theme={crimson} width={width} height={height} focused guide={value} view={view} />,
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("deck", () => {
  test("shows one card; flipping reveals the answer and writes nothing", async () => {
    const ports = fakePorts()
    const before = await mountDeck(120, 24)
    try {
      const frame = lines(before).join("\n")
      expect(frame).toContain("What does the learning rate control?")
      expect(frame).not.toContain("The step size of each update.")
    } finally {
      await before.dispose()
    }

    const flipped = deckUi.flip(deckUi.initialDeckView)
    expect(flipped.flipped).toBe(true)
    const after = await mountDeck(120, 24, deck(), flipped)
    try {
      expect(lines(after).join("\n")).toContain("The step size of each update.")
    } finally {
      await after.dispose()
    }
    expect(ports.calls).toEqual([])
  })

  test("m and k go through the port and survive a reload", async () => {
    const ports = fakePorts()
    const second = deckUi.move(deck(), deckUi.initialDeckView, 1)
    const marked = deckUi.mark(deck(), second, "known")
    if ("notice" in marked) throw new Error("expected a mark")
    expect(marked.mark).toBe("known")
    await ports.deckPort.mark("d1", marked.cardId, marked.mark)

    const reloaded = await ports.deckPort.reload("d1")
    const card = reloaded.cards.find((entry) => entry.id === marked.cardId)!
    expect(card.known).toBe(true)
    expect(card.missed).toBe(false)

    // an already-known card toggles back to clear
    const clear = deckUi.mark(deck(), deckUi.initialDeckView, "known")
    if ("notice" in clear) throw new Error("expected a mark")
    expect(clear.mark).toBe("clear")
    expect(deckUi.intentFor("m")).toBe("missed")
    expect(deckUi.intentFor("w")).toBe("known")
  })

  test("a multiple-choice card shows exactly one correct choice", () => {
    const card = deck().cards[2]!
    expect(deckUi.correctChoices(card)).toEqual([0])
    expect(deckUi.choose(card, 0)).toEqual({ kind: "known", index: 0 })
    expect(deckUi.choose(card, 1)).toEqual({ kind: "missed", index: 1 })
    expect(deckUi.choose(card, 9).kind).toBe("refused")
    expect(deckUi.intentFor("1")).toBe("choose")
    expect(deckUi.intentFor("4")).toBe("choose")
  })

  test("M shows only missed cards", () => {
    const missedOnly = deckUi.toggleMissedOnly(deck(), deckUi.initialDeckView)
    expect(missedOnly.missedOnly).toBe(true)
    expect(deckUi.visibleCards(deck(), missedOnly)).toHaveLength(1)
    expect(deckUi.intentFor("m", { shift: true })).toBe("missed-only")
  })

  test("filtering to missed cards changes the shown card", async () => {
    const [view, setView] = createSignal(deckUi.initialDeckView)
    const setup = await testRender(
      () => <deckUi.DeckPane theme={crimson} width={120} height={24} focused deck={deck()} view={view()} />,
      { width: 120, height: 24 },
    )
    try {
      await setup.flush()
      await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      expect(setup.captureCharFrame()).toContain("What does the learning rate control?")
      setView(deckUi.toggleMissedOnly(deck(), view()))
      await setup.flush()
      await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      expect(setup.captureCharFrame()).toContain("Which limit does a boundary condition fix?")
    } finally {
      await setup.dispose()
    }
  })

  test("a missing deck shows the build action", async () => {
    const setup = await mountDeck(120, 24, { ...deck(), built: false, cards: [] })
    try {
      expect(lines(setup).join("\n")).toContain("not built yet · press b to build it")
    } finally {
      await setup.dispose()
    }
  })

  test("progress line counts known and missed", () => {
    expect(deckUi.progressLine(deck())).toBe("1 known · 1 missed · 3 cards")
  })
})

describe("guide", () => {
  test("revealing an answer leaves the guide byte-identical", async () => {
    const ports = fakePorts()
    const before = JSON.stringify(ports.state.guide)
    const view = guideUi.showAnswer(guideUi.initialGuideView, guide().sections[0]!, await ports.guidePort.reveal("g1", "s1"))
    expect(JSON.stringify(ports.state.guide)).toBe(before)

    const setup = await mountGuide(120, 24, guide(), view)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("(answer shown)")
      expect(frame).toContain("Because the boundary conditions fix the integral limits.")
    } finally {
      await setup.dispose()
    }
  })

  test("ticking a section changes only its checkbox and the progress line", async () => {
    const ports = fakePorts()
    const before = FIXTURE.guide.sections.map((s: { reviewed: boolean }) => s.reviewed)
    expect(guideUi.progressLine(guide())).toBe("1 of 2 sections reviewed")

    await ports.guidePort.tick("g1", "s2")
    const after = await ports.guidePort.reload("g1")
    expect(guideUi.progressLine(after)).toBe("2 of 2 sections reviewed")
    // only the reviewed flags moved
    expect(after.sections.map((s) => s.reviewed)).toEqual([true, true])
    expect(FIXTURE.guide.sections.map((s: { reviewed: boolean }) => s.reviewed)).toEqual(before)
    expect(after.sections.map((s) => s.title)).toEqual(FIXTURE.guide.sections.map((s: { title: string }) => s.title))
  })

  test("moving the guide cursor changes the shown question", async () => {
    const [view, setView] = createSignal(guideUi.initialGuideView)
    const setup = await testRender(
      () => <guideUi.GuidePane theme={crimson} width={120} height={24} focused guide={guide()} view={view()} />,
      { width: 120, height: 24 },
    )
    try {
      await setup.flush()
      await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      expect(setup.captureCharFrame()).toContain("Why does the balance close?")
      setView({ ...view(), cursor: 1 })
      await setup.flush()
      await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      expect(setup.captureCharFrame()).toContain("What fixes the limits?")
    } finally {
      await setup.dispose()
    }
  })

  test("a missing guide shows the build action", async () => {
    const setup = await mountGuide(120, 24, { ...guide(), built: false, sections: [] })
    try {
      expect(lines(setup).join("\n")).toContain("not built yet · press b to build it")
    } finally {
      await setup.dispose()
    }
  })

  test("plugin output is labelled external explanation", async () => {
    const setup = await mountGuide(120, 24, guide(), { ...guideUi.initialGuideView })
    try {
      expect(lines(setup).join("\n")).not.toContain("external explanation")
    } finally {
      await setup.dispose()
    }
    const labelled = await testRender(
      () => <guideUi.GuidePane theme={crimson} width={120} height={24} focused guide={guide()} view={guideUi.initialGuideView} plugin="notes" />,
      { width: 120, height: 24 },
    )
    try {
      await labelled.flush()
      await (labelled.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      expect(labelled.captureCharFrame()).toContain("external explanation · notes")
    } finally {
      await labelled.dispose()
    }
  })
})

describe("layout and keys", () => {
  test("80x24 and 200x60 snapshots", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const d = await mountDeck(w, h)
      try {
        const out = lines(d)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
      } finally {
        await d.dispose()
      }
      const g = await mountGuide(w, h)
      try {
        const out = lines(g)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
      } finally {
        await g.dispose()
      }
    }
  })

  test("each reader keeps one parsed key table and no file IO", () => {
    for (const name of ["deck.tsx", "guide.tsx"]) {
      const source = readFileSync(join(import.meta.dir, "../../src/ui/reader", name), "utf8")
      expect(source).not.toMatch(/writeFile\(|readFileSync\(|rename\(|unlink\(/)
      expect(source).not.toContain("src/services")
      expect(source).toContain("parseBinding")
    }
    expect(deckUi.footerHints()).toContain("m missed")
    expect(guideUi.footerHints()).toContain("Enter answer")
  })
})
