import { expect, test } from "bun:test"

import { actionBarLayout } from "../../src/ui/actions"

const GROUPS = [
  {
    id: "keys",
    actions: [
      { id: "send", key: "Enter", label: "send" },
      { id: "normal", key: "Esc", label: "normal", disabled: true },
    ],
  },
  { id: "caps", actions: [{ id: "style", label: "style: normal" }] },
]

test("keys, labels and group separators are separate tokens", () => {
  const layout = actionBarLayout({ groups: GROUPS, width: 60 })
  expect(layout.tokens.map((token) => [token.kind, token.text, token.x])).toEqual([
    ["key", "[Enter]", 0],
    ["label", " send", 7],
    ["separator", "  ", 12],
    ["key", "[Esc]", 14],
    ["label", " normal", 19],
    ["separator", " · ", 26],
    ["label", "style: normal", 29],
  ])
  expect(layout.hidden).toBe(0)
})

test("disabled actions carry the flag on both tokens", () => {
  const layout = actionBarLayout({ groups: GROUPS, width: 60 })
  expect(layout.tokens.filter((token) => token.id === "key:normal" || token.id === "label:normal")).toMatchObject([
    { kind: "key", disabled: true },
    { kind: "label", disabled: true },
  ])
})

test("the first action that does not fit ends the bar", () => {
  const layout = actionBarLayout({ groups: GROUPS, width: 20 })
  expect(layout.tokens.map((token) => token.text)).toEqual(["[Enter]", " send"])
  expect(layout.hidden).toBe(2)
})

test("a too-narrow first action truncates its label", () => {
  const layout = actionBarLayout({ groups: GROUPS, width: 10 })
  expect(layout.tokens.map((token) => token.text)).toEqual(["[Enter]", " s…"])
  expect(layout.hidden).toBe(2)
})

test("empty groups and zero width", () => {
  expect(actionBarLayout({ groups: [{ id: "a", actions: [] }], width: 20 }).tokens).toEqual([])
  expect(actionBarLayout({ groups: GROUPS, width: 0 }).hidden).toBe(3)
})

test("custom gaps and separators are honoured", () => {
  const layout = actionBarLayout({ groups: GROUPS, width: 60, actionGap: 1, groupSeparator: " | " })
  expect(layout.tokens[2]!.text).toBe(" ")
  expect(layout.tokens[5]!.text).toBe(" | ")
})
