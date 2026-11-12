/**
 * Second file on purpose: `bun test` schedules test files in parallel by
 * default, so two files that both drive the native renderer prove the harness
 * has no shared global state between files. Keep it small — its job is
 * concurrency, not coverage.
 */

import { expect, test } from "bun:test"

import { renderApp, resolveKeyName } from "./render"

test("a second file can render concurrently with the first", async () => {
  const harness = await renderApp({ width: 120, height: 30 })
  try {
    const frame = await harness.waitFor("LOCKEDIN")
    expect(frame).toContain("NORMAL")
  } finally {
    await harness.dispose()
  }
})

test("key names are normalised in one place", () => {
  expect(resolveKeyName("enter")).toBe("RETURN")
  expect(resolveKeyName("Esc")).toBe("ESCAPE")
  expect(resolveKeyName("j")).toBe("j")
  expect(resolveKeyName("up")).toBe("ARROW_UP")
})
