import { expect, test } from "bun:test"

import { keycapLayout } from "../../src/ui/keycaps"

test("a single key is one cap", () => {
  const layout = keycapLayout({ chord: "g", width: 14 })
  expect(layout.text).toBe("g")
  expect(layout.caps).toEqual([{ kind: "cap", text: "g", x: 0, width: 1, index: 0 }])
})

test("leader chords are split on the space and keep it", () => {
  const layout = keycapLayout({ chord: "␣ c", width: 14 })
  expect(layout.text).toBe("␣ c")
  expect(layout.tokens.map((token) => [token.kind, token.text, token.x])).toEqual([
    ["cap", "␣", 0],
    ["separator", " ", 1],
    ["cap", "c", 2],
  ])
})

test("modified chords are split on plus", () => {
  const layout = keycapLayout({ chord: "shift+r", width: 14 })
  expect(layout.text).toBe("shift+r")
  expect(layout.caps.map((cap) => cap.text)).toEqual(["shift", "r"])
  expect(layout.caps[1]!.x).toBe(6)
})

test("a chord wider than the column drops trailing tokens", () => {
  const layout = keycapLayout({ chord: "shift+r", width: 6 })
  expect(layout.text).toBe("shift")
  expect(layout.truncated).toBe(true)
})

test("empty input and zero width", () => {
  expect(keycapLayout({ chord: "", width: 14 })).toMatchObject({ text: "", tokens: [], truncated: false })
  expect(keycapLayout({ chord: "g", width: 0 })).toMatchObject({ text: "", tokens: [], truncated: true })
})
