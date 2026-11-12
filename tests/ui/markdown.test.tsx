/** The course Markdown renderer: the subset a chapter actually uses. */
import { describe, expect, test } from "bun:test"

const { parseMarkdown, inlineText } = await import("../../src/ui/reader/markdown-body")

describe("parsing", () => {
  test("headings, quotes, checkboxes, bullets, code and rules", () => {
    const blocks = parseMarkdown(
      [
        "# Title",
        "",
        "> Goal: learn cpp",
        "",
        "- [ ] read",
        "- [x] done",
        "- plain bullet",
        "",
        "```ts",
        "const x = 1",
        "```",
        "",
        "---",
        "",
        "A paragraph.",
      ].join("\n"),
    )
    expect(blocks).toContainEqual({ kind: "heading", level: 1, text: "Title" })
    expect(blocks).toContainEqual({ kind: "quote", text: "Goal: learn cpp" })
    const list = blocks.find((block) => block.kind === "list")
    expect(list).toEqual({
      kind: "list",
      items: [
        { text: "read", checked: false, depth: 0 },
        { text: "done", checked: true, depth: 0 },
        { text: "plain bullet", checked: null, depth: 0 },
      ],
    })
    expect(blocks).toContainEqual({ kind: "code", text: "const x = 1", language: "ts" })
    expect(blocks).toContainEqual({ kind: "rule" })
    expect(blocks).toContainEqual({ kind: "paragraph", text: "A paragraph." })
  })

  test("an unclosed fence still yields its code", () => {
    const blocks = parseMarkdown("```\nstill code")
    expect(blocks).toContainEqual({ kind: "code", text: "still code", language: "" })
  })
})

describe("inline", () => {
  test("emphasis and code markers are stripped, not shown", () => {
    expect(inlineText("a **bold** word")).toBe("a bold word")
    expect(inlineText("use `bun test` now")).toBe("use bun test now")
    expect(inlineText("[link](https://example.com)")).toBe("link")
  })
})

describe("code labels", () => {
  test("a named fence keeps its label, a bare fence has none", async () => {
    const { codeLabel } = await import("../../src/ui/reader/markdown-body")
    expect(codeLabel("cpp")).toBe("cpp")
    expect(codeLabel("  python ")).toBe("python")
    expect(codeLabel("")).toBeNull()
    expect(codeLabel("   ")).toBeNull()
  })
})

describe("syntax theme and inline style", () => {
  test("the palette maps to TextMate scopes", async () => {
    const { syntaxTheme } = await import("../../src/services/syntax/theme")
    const { crimson } = await import("../../src/ui/theme")
    const theme = syntaxTheme(crimson)
    const rule = (scope: string) =>
      theme.tokenColors.find((entry) =>
        Array.isArray(entry.scope) ? entry.scope.includes(scope) : entry.scope === scope,
      )?.settings
    expect(rule("keyword")?.foreground).toBe(crimson.primary)
    expect(rule("string")?.foreground).toBe(crimson.success)
    expect(rule("comment")?.foreground).toBe(crimson.muted)
    expect(rule("comment")?.fontStyle).toBe("italic")
    expect(rule("constant.numeric")?.foreground).toBe(crimson.accent)
  })

  test("inline runs keep their style and lose their markers", async () => {
    const { parseInline } = await import("../../src/ui/reader/markdown-body")
    expect(parseInline("a **bold** and *it* and `code`")).toEqual([
      { text: "a ", style: "plain" },
      { text: "bold", style: "bold" },
      { text: " and ", style: "plain" },
      { text: "it", style: "italic" },
      { text: " and ", style: "plain" },
      { text: "code", style: "code" },
    ])
    // An unclosed marker stays literal rather than swallowing the rest.
    expect(parseInline("2 * 3")).toEqual([{ text: "2 * 3", style: "plain" }])
  })
})
