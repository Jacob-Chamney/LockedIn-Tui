import { expect, test } from "bun:test"

import { copyToClipboard, osc52 } from "../../src/ui/effects/clipboard"
import { MAX_CLIPBOARD_CHARS } from "../../src/ui/effects/sandbox/limits"

test("osc52 encodes text for the terminal clipboard", () => {
  expect(osc52("hi")).toBe("\u001b]52;c;aGk=\u0007")
  expect(osc52("line\nnext")).toBe(`\u001b]52;c;${Buffer.from("line\nnext").toString("base64")}\u0007`)
})

test("copyToClipboard writes one sequence and strips control characters", () => {
  const written: string[] = []
  expect(copyToClipboard("hi", (data) => written.push(data))).toBe(true)
  expect(written).toEqual(["\u001b]52;c;aGk=\u0007"])

  const cleaned: string[] = []
  expect(copyToClipboard("a\u0000b\u0007c", (data) => cleaned.push(data))).toBe(true)
  const payload = cleaned[0]!.slice("\u001b]52;c;".length, -1)
  expect(Buffer.from(payload, "base64").toString("utf8")).toBe("abc")
})

test("copyToClipboard refuses empty, oversized and unavailable writes", () => {
  const written: string[] = []
  const write = (data: string) => written.push(data)
  expect(copyToClipboard("", write)).toBe(false)
  expect(copyToClipboard("\u0000\u0007", write)).toBe(false)
  expect(copyToClipboard("x".repeat(MAX_CLIPBOARD_CHARS + 1), write)).toBe(false)
  expect(
    copyToClipboard("ok", () => {
      throw new Error("no terminal")
    }),
  ).toBe(false)
  expect(written).toEqual([])
})
