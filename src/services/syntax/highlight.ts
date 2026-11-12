/**
 * Syntax highlighting, one engine for every fence.
 *
 * Shiki carries the language grammars (~340 bundled, loaded lazily) and returns
 * tokens with colours from the theme we derive from the app palette. There is no
 * download step and no per-platform native parser: a language is either in the
 * bundle or the block renders as plain text.
 *
 * The service is pure: no UI types, no signals. The renderer passes a theme and
 * gets lines of runs back.
 */
import { createHighlighter } from "shiki/bundle/full"
import { plainLines, type SyntaxLine } from "./lines"
import type { SyntaxTheme } from "./theme"

export { plainLines, type SyntaxLine, type SyntaxRun } from "./lines"

type Engine = Awaited<ReturnType<typeof createHighlighter>>

/** Fence labels whose grammar has a different id. */
const ALIASES: Record<string, string> = {
  "c++": "cpp",
  cxx: "cpp",
  "c#": "csharp",
  cs: "csharp",
  "f#": "fsharp",
  fs: "fsharp",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "shellscript",
  py: "python",
  python3: "python",
  rs: "rust",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  kt: "kotlin",
  kts: "kotlin",
  golang: "go",
  rb: "ruby",
  ps1: "powershell",
  pwsh: "powershell",
  tex: "latex",
  objc: "objective-c",
  "objective-c++": "objective-cpp",
}

/** The fence label normalised to a grammar id. Empty means "plain text". */
export function syntaxLanguage(language: string): string {
  const text = language.trim().toLowerCase()
  if (text === "" || text === "text" || text === "plain" || text === "plaintext") return ""
  return ALIASES[text] ?? text
}

let engine: Promise<Engine> | null = null
const loadedLanguages = new Set<string>()
const loadedThemes = new Set<string>()
const cache = new Map<string, SyntaxLine[]>()
/** Enough for a long document without growing without bound. */
const CACHE_LIMIT = 240

function hash(text: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(16)
}

async function highlighter(): Promise<Engine> {
  engine ??= createHighlighter({ langs: [], themes: [] })
  return engine
}

async function ensureTheme(instance: Engine, theme: SyntaxTheme): Promise<void> {
  if (loadedThemes.has(theme.name)) return
  await instance.loadTheme(theme as never)
  loadedThemes.add(theme.name)
}

async function ensureLanguage(instance: Engine, language: string): Promise<boolean> {
  if (language === "") return false
  if (loadedLanguages.has(language)) return true
  try {
    await instance.loadLanguage(language as never)
    loadedLanguages.add(language)
    return true
  } catch {
    return false
  }
}

/**
 * Highlight one block. Always resolves: an unknown language, a grammar that
 * fails to load or an engine that never initialises falls back to plain text.
 */
export async function highlightCode(
  code: string,
  language: string,
  theme: SyntaxTheme,
  foreground: string,
): Promise<SyntaxLine[]> {
  const id = syntaxLanguage(language)
  const key = `${theme.name}|${id}|${hash(code)}`
  const cached = cache.get(key)
  if (cached) return cached

  let lines: SyntaxLine[]
  try {
    const instance = await highlighter()
    await ensureTheme(instance, theme)
    if (!(await ensureLanguage(instance, id))) {
      lines = plainLines(code, foreground)
    } else {
      const tokens = instance.codeToTokensBase(code, { lang: id as never, theme: theme.name as never })
      lines = tokens.map((line) =>
        line.map((token) => ({ text: token.content, color: token.color ?? foreground })),
      )
    }
  } catch {
    lines = plainLines(code, foreground)
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, lines)
  return lines
}

/**
 * Warm the engine and a set of grammars in the background.
 *
 * A code block's first frame is plain text until its grammar is loaded. That is
 * a tick when the grammar is already warm, so the app warms the common set after
 * the first frame: one grammar at a time, yielding between them so painting is
 * never held up. Best effort — a failure only means the block highlights on
 * first use, as before.
 */
export async function warmSyntax(
  languages: readonly string[],
  theme: SyntaxTheme,
  options: { pauseMs?: number } = {},
): Promise<void> {
  try {
    const instance = await highlighter()
    await ensureTheme(instance, theme)
    const pause = options.pauseMs ?? 12
    for (const language of languages) {
      const id = syntaxLanguage(language)
      if (id === "") continue
      const loaded = await ensureLanguage(instance, id)
      if (!loaded) continue
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause))
    }
  } catch {
    // Highlighting is decoration; a warm-up failure must never surface.
  }
}

export function syntaxLoadedLanguages(): string[] {
  return [...loadedLanguages]
}

/** Test seam: forget the engine, loaded grammars and cached blocks. */
export function resetSyntaxHighlighting(): void {
  engine = null
  loadedLanguages.clear()
  loadedThemes.clear()
  cache.clear()
}

export function syntaxCacheSize(): number {
  return cache.size
}
