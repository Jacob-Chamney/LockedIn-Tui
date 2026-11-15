import { expect, test } from "bun:test"

import { toggleLayout } from "../../src/ui/toggle"

test("the default labels are on and off", () => {
  expect(toggleLayout({ on: true })).toEqual({
    on: true,
    label: "on",
    text: "● on",
    tone: "success",
    width: 4,
  })
  expect(toggleLayout({ on: false })).toMatchObject({ text: "○ off", tone: "muted", width: 5 })
})

test("custom labels are used", () => {
  expect(toggleLayout({ on: true, onLabel: "yes", offLabel: "no" }).text).toBe("● yes")
  expect(toggleLayout({ on: false, onLabel: "yes", offLabel: "no" }).text).toBe("○ no")
})

test("the text fits the supplied width", () => {
  expect(toggleLayout({ on: true, width: 6 }).width).toBe(6)
  expect(toggleLayout({ on: true, width: 3 }).text).toBe("● …")
  expect(toggleLayout({ on: true, width: 0 }).text).toBe("")
})

test("the tone follows the state", () => {
  expect(toggleLayout({ on: true }).tone).toBe("success")
  expect(toggleLayout({ on: false }).tone).toBe("muted")
})
