/**
 * Syntax highlighting through Shiki.
 *
 * The engine is one process-wide highlighter with lazy grammars; these tests
 * pin the things a renderer depends on: the fence alias map, the palette
 * mapping (through the theme), the plain fallback, and the cache.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import {
  highlightCode,
  plainLines,
  resetSyntaxHighlighting,
  syntaxCacheSize,
  syntaxLanguage,
  syntaxLoadedLanguages,
  warmSyntax,
} from "../../src/services/syntax/highlight"
import { syntaxTheme } from "../../src/services/syntax/theme"
import { crimson } from "../../src/ui/theme"

const theme = syntaxTheme(crimson)
const fg = crimson.foreground.toLowerCase()

function colours(lines: Array<Array<{ text: string; color: string }>>, needle: string): string[] {
  return lines
    .flat()
    .filter((run) => run.text.includes(needle))
    .map((run) => run.color.toLowerCase())
}

describe("fence aliases", () => {
  test("common spellings resolve to one grammar", () => {
    expect(syntaxLanguage("c++")).toBe("cpp")
    expect(syntaxLanguage("C++")).toBe("cpp")
    expect(syntaxLanguage("sh")).toBe("bash")
    expect(syntaxLanguage("shell")).toBe("bash")
    expect(syntaxLanguage("yml")).toBe("yaml")
    expect(syntaxLanguage("ts")).toBe("typescript")
    expect(syntaxLanguage("golang")).toBe("go")
    expect(syntaxLanguage("rs")).toBe("rust")
  })

  test("plain fences mean no grammar", () => {
    expect(syntaxLanguage("")).toBe("")
    expect(syntaxLanguage("text")).toBe("")
    expect(syntaxLanguage("plaintext")).toBe("")
  })
})

describe("highlighting", () => {
  beforeEach(() => {
    resetSyntaxHighlighting()
  })

  test("C++ is highlighted with the app palette", async () => {
    const lines = await highlightCode('int main() { return "hi"; }', "cpp", theme, fg)
    expect(colours(lines, "int")).toContain(crimson.primary.toLowerCase())
    expect(colours(lines, "hi")).toContain(crimson.success.toLowerCase())
  })

  test("Python and Rust load on demand", async () => {
    const python = await highlightCode("def f(): return 1  # note", "python", theme, fg)
    expect(colours(python, "def")).toContain(crimson.primary.toLowerCase())
    expect(colours(python, "note")).toContain(crimson.muted.toLowerCase())

    const rust = await highlightCode('fn main() { let s = "x"; }', "rust", theme, fg)
    expect(colours(rust, "fn")).toContain(crimson.primary.toLowerCase())
    expect(colours(rust, "x")).toContain(crimson.success.toLowerCase())
  })

  test("an unknown language is plain text, never an error", async () => {
    const lines = await highlightCode("some words", "not-a-real-language", theme, fg)
    expect(lines).toEqual(plainLines("some words", fg))
  })

  test("a highlighted block is cached", async () => {
    const first = await highlightCode("let x = 1", "typescript", theme, fg)
    const size = syntaxCacheSize()
    const second = await highlightCode("let x = 1", "typescript", theme, fg)
    expect(second).toBe(first)
    expect(syntaxCacheSize()).toBe(size)
  })

  test("a different palette is a different cache entry", async () => {
    const other = syntaxTheme({ ...crimson, primary: "#00ff00", background: "#000000" })
    await highlightCode("int x;", "cpp", theme, fg)
    const before = syntaxCacheSize()
    await highlightCode("int x;", "cpp", other, fg)
    expect(syntaxCacheSize()).toBe(before + 1)
  })

  test("warming loads the common grammars ahead of the first block", async () => {
    resetSyntaxHighlighting()
    await warmSyntax(["php", "lua"], theme, { pauseMs: 0 })
    expect(syntaxLoadedLanguages()).toEqual(expect.arrayContaining(["php", "lua"]))
    // The grammar is already there, so the first highlight is a cache miss at
    // worst, not a module load.
    const lines = await highlightCode("<?php echo 1;", "php", theme, fg)
    expect(lines.flat().some((run) => run.color.toLowerCase() !== fg)).toBe(true)
  })

  test("plain lines keep empty rows", () => {
    expect(plainLines("a\n\nb", "#fff")).toEqual([
      [{ text: "a", color: "#fff" }],
      [],
      [{ text: "b", color: "#fff" }],
    ])
  })
})
