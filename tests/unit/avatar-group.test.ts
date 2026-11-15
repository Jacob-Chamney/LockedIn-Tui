import { expect, test } from "bun:test"

import { avatarGroupLayout } from "../../src/ui/avatar-group"

const ITEMS = [
  { id: "a", name: "Ada Lovelace" },
  { id: "b", name: "Builder" },
  { id: "c", name: "Writer" },
  { id: "d", name: "Reviewer" },
  { id: "e", name: "Planner" },
]

test("avatars start before the previous one ends", () => {
  const layout = avatarGroupLayout({ items: ITEMS.slice(0, 3), width: 20 })
  expect(layout.members.map((member) => member.x)).toEqual([0, 3, 6])
  expect(layout.members.map((member) => member.avatar.text)).toEqual(["[AL]", "[BU]", "[WR]"])
  expect(layout.totalWidth).toBe(10)
  expect(layout.hidden).toBe(0)
  expect(layout.overflow).toBe("")
})

test("overlap can be removed and the avatar width changed", () => {
  const layout = avatarGroupLayout({ items: ITEMS.slice(0, 2), width: 20, overlap: 0 })
  expect(layout.members.map((member) => member.x)).toEqual([0, 4])
  const wide = avatarGroupLayout({ items: ITEMS.slice(0, 2), width: 20, avatarWidth: 6, overlap: 2 })
  expect(wide.members.map((member) => member.x)).toEqual([0, 4])
  expect(wide.members[0]!.avatar.width).toBe(6)
})

test("the tail becomes an overflow count that still fits", () => {
  const layout = avatarGroupLayout({ items: ITEMS, width: 14 })
  expect(layout.members).toHaveLength(3)
  expect(layout.hidden).toBe(2)
  expect(layout.overflow).toBe("+2")
  expect(layout.overflowX).toBe(11)
  expect(layout.totalWidth).toBe(13)
})

test("a very narrow row shows only the count", () => {
  const layout = avatarGroupLayout({ items: ITEMS, width: 2 })
  expect(layout.members).toEqual([])
  expect(layout.hidden).toBe(5)
  expect(layout.overflow).toBe("+5")
  expect(layout.totalWidth).toBe(2)
})

test("fixed tones and empty input are handled", () => {
  const layout = avatarGroupLayout({ items: [{ id: "a", name: "Ada", tone: "accent" }], width: 10 })
  expect(layout.members[0]!.tone).toBe("accent")
  expect(avatarGroupLayout({ items: [], width: 10 })).toMatchObject({ members: [], hidden: 0, totalWidth: 0 })
  expect(avatarGroupLayout({ items: ITEMS, width: 0 }).members).toEqual([])
})
