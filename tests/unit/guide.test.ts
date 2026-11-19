import { describe, expect, test } from "bun:test"

import { guideSections, toggleGuideSection } from "../../src/domain/guide"

const GUIDE = `# Study guide — Physics — Unit 4

> 0 of 3 sections reviewed

## Energy balance

What limits the integral?

- [ ] Reviewed

## Momentum

Which quantity is conserved?

- [ ] Reviewed

## Work

When is work negative?

- [ ] Reviewed
`

describe("guide sections", () => {
  test("counts the reviewed rows in file order", () => {
    expect(guideSections(GUIDE)).toHaveLength(3)
    expect(guideSections(GUIDE).every((row) => !row.checked)).toBe(true)
  })

  test("user prose is not a section", () => {
    const edited = GUIDE.replace("What limits the integral?", "- [ ] a user's own checkbox")
    // The prose checkbox looks like a task row but is not the "Reviewed" row.
    expect(guideSections(edited)).toHaveLength(3)
  })
})

describe("toggleGuideSection", () => {
  test("changes exactly one bracket and the progress line", () => {
    const result = toggleGuideSection(GUIDE, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const before = GUIDE.split("\n")
    const after = result.value.markdown.split("\n")
    const changed = before
      .map((line, index) => (line === after[index] ? null : index))
      .filter((index): index is number => index !== null)
    // The section's bracket and the progress line, nothing else.
    expect(changed).toHaveLength(2)
    expect(result.value.done).toBe(1)
    expect(result.value.total).toBe(3)
    expect(result.value.checked).toBe(true)
    expect(result.value.markdown).toContain("> 1 of 3 sections reviewed")
    expect(result.value.markdown).toContain("## Momentum\n\nWhich quantity is conserved?\n\n- [x] Reviewed")
  })

  test("toggling the same section twice restores the document byte for byte", () => {
    const once = toggleGuideSection(GUIDE, 2)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = toggleGuideSection(once.value.markdown, 2)
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    expect(twice.value.markdown).toBe(GUIDE)
    expect(twice.value.done).toBe(0)
    expect(twice.value.checked).toBe(false)
  })

  test("an out-of-range section is a typed refusal and writes nothing", () => {
    const missing = toggleGuideSection(GUIDE, 9)
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.message).toContain("3 section(s)")

    const negative = toggleGuideSection(GUIDE, -1)
    expect(negative.ok).toBe(false)
  })

  test("a guide with no sections is refused, not rewritten", () => {
    const empty = "# Study guide — Empty\n\nNothing here yet.\n"
    const result = toggleGuideSection(empty, 0)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain("no sections")
  })
})
