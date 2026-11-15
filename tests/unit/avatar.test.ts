import { expect, test } from "bun:test"

import { AVATAR_TONES, avatarInitials, avatarLayout } from "../../src/ui/avatar"

test("initials come from the first and last words", () => {
  expect(avatarInitials("Ada Lovelace")).toBe("AL")
  expect(avatarInitials("Analyst")).toBe("AN")
  expect(avatarInitials("")).toBe("?")
})

test("single wide characters stay two cells", () => {
  expect(avatarInitials("漢字")).toBe("漢")
})

test("the badge text and width follow the options", () => {
  expect(avatarLayout({ name: "Ada Lovelace" })).toMatchObject({ text: "[AL]", width: 4 })
  expect(avatarLayout({ name: "Ada Lovelace", width: 2 }).text).toBe("[…")
  expect(avatarLayout({ name: "Ada Lovelace", width: 0 }).text).toBe("")
})

test("the tone is deterministic and can be fixed", () => {
  const first = avatarLayout({ name: "Ada Lovelace" }).tone
  expect(avatarLayout({ name: "Ada Lovelace" }).tone).toBe(first)
  expect(AVATAR_TONES).toContain(first)
  expect(avatarLayout({ name: "Ada Lovelace", tone: "accent" }).tone).toBe("accent")
})
