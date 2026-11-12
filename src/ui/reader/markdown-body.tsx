/**
 * A Markdown renderer for the palette we have.
 *
 * Why not OpenTUI's `markdown` renderable? It exists, but in this build it paints
 * nothing through the renderer the app and its tests use — a chapter came out
 * blank, so it could not be verified or screenshotted. So this renders the
 * subset a course uses, with inline emphasis and code highlighted by Shiki from
 * one palette.
 */
import { For, createEffect, createMemo, createSignal } from "solid-js"
import type { ThemePalette } from "../theme"
import { plainLines, type SyntaxLine } from "../../services/syntax/lines"
import { syntaxTheme } from "../../services/syntax/theme"

/* --------------------------------- blocks --------------------------------- */

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: Array<{ text: string; checked: boolean | null; depth: number }> }
  | { kind: "code"; text: string; language: string }
  | { kind: "rule" }
  | { kind: "blank" }
  | { kind: "paragraph"; text: string }

/** Split Markdown into the blocks the renderer draws. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const blocks: MarkdownBlock[] = []
  let inCode = false
  let code: string[] = []
  let language = ""
  let list: Array<{ text: string; checked: boolean | null; depth: number }> = []

  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list })
      list = []
    }
  }

  for (const line of lines) {
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      if (inCode) {
        blocks.push({ kind: "code", text: code.join("\n"), language })
        code = []
        language = ""
        inCode = false
      } else {
        flushList()
        inCode = true
        language = fence[1] ?? ""
      }
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushList()
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() })
      continue
    }
    if (/^\s*---+$/.test(line)) {
      flushList()
      blocks.push({ kind: "rule" })
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      flushList()
      blocks.push({ kind: "quote", text: line.replace(/^\s*>\s?/, "") })
      continue
    }
    const item = line.match(/^(\s*)[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/)
    if (item) {
      const depth = Math.floor(item[1]!.length / 2)
      const checked = item[2] === undefined ? null : item[2].toLowerCase() === "x"
      list.push({ text: item[3]!.trim(), checked, depth })
      continue
    }
    if (line.trim() === "") {
      flushList()
      blocks.push({ kind: "blank" })
      continue
    }
    flushList()
    blocks.push({ kind: "paragraph", text: line.trimEnd() })
  }

  flushList()
  if (inCode) blocks.push({ kind: "code", text: code.join("\n"), language })
  return blocks
}

/* --------------------------------- inline --------------------------------- */

export type InlineStyle = "plain" | "bold" | "italic" | "code" | "link"
export type InlineToken = { text: string; style: InlineStyle }

/**
 * `**bold**`, `*italic*`, `` `code` `` and `[label](url)` become styled runs.
 * A marker that never closes is left as literal text rather than swallowed.
 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let plain = ""
  const flush = () => {
    if (plain !== "") {
      tokens.push({ text: plain, style: "plain" })
      plain = ""
    }
  }

  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)
    const code = rest.match(/^`([^`]+)`/)
    if (code) {
      flush()
      tokens.push({ text: code[1]!, style: "code" })
      index += code[0].length
      continue
    }
    const bold = rest.match(/^\*\*([^*]+)\*\*/)
    if (bold) {
      flush()
      tokens.push({ text: bold[1]!, style: "bold" })
      index += bold[0].length
      continue
    }
    const italic = rest.match(/^\*([^*]+)\*/)
    if (italic) {
      flush()
      tokens.push({ text: italic[1]!, style: "italic" })
      index += italic[0].length
      continue
    }
    const link = rest.match(/^\[([^\]]+)\]\(([^)]*)\)/)
    if (link) {
      flush()
      tokens.push({ text: link[1]!, style: "link" })
      index += link[0].length
      continue
    }
    plain += text[index]
    index += 1
  }
  flush()
  return tokens
}

/** The text of an inline run, for tests and plain fallbacks. */
export function inlineText(text: string): string {
  return parseInline(text)
    .map((token) => token.text)
    .join("")
}

/* --------------------------------- render --------------------------------- */

function Inline(props: { theme: ThemePalette; text: string; align?: "left" | "center" }) {
  const palette = () => props.theme
  return (
    <text fg={palette().foreground} wrapMode="word" textAlign={props.align ?? "left"}>
      {parseInline(props.text).map((token) => {
        if (token.style === "bold") return <b>{token.text}</b>
        if (token.style === "italic") return <i>{token.text}</i>
        if (token.style === "code") return <u>{` ${token.text} `}</u>
        if (token.style === "link") return <u>{token.text}</u>
        return <span>{token.text}</span>
      })}
    </text>
  )
}

/** How many scroll steps a document has, for the reader's clamp. */
export function blockCount(text: string): number {
  return parseMarkdown(text).length
}

/** The label above a fenced block, or null when the fence named no language. */
export function codeLabel(language: string): string | null {
  const text = language.trim()
  return text === "" ? null : text
}

/** One fenced block, highlighted by Shiki from the current palette. */
function CodeBlock(props: { theme: ThemePalette; block: Extract<MarkdownBlock, { kind: "code" }> }) {
  const palette = () => props.theme
  const language = () => codeLabel(props.block.language)
  const theme = createMemo(() => syntaxTheme(palette()))
  const [lines, setLines] = createSignal<SyntaxLine[]>(plainLines(props.block.text, palette().foreground))
  let generation = 0

  // Highlight asynchronously: plain text is on screen for the first frame of a
  // new block, the coloured runs replace it as soon as the grammar is ready.
  // A newer edit wins over a slower, older highlight.
  createEffect(() => {
    const code = props.block.text
    const fence = props.block.language
    const syntax = theme()
    const current = ++generation
    // Shiki is imported on demand: its grammar bundle must not sit on the
    // startup path.
    void import("../../services/syntax/highlight")
      .then((engine) => engine.highlightCode(code, fence, syntax, palette().foreground))
      .then((next) => {
        if (current === generation) setLines(next)
      })
  })

  return (
    <box
      flexDirection="column"
      border={["left"]}
      borderColor={palette().line}
      paddingX={1}
      marginY={1}
      backgroundColor={palette().surface}
    >
      {language() ? (
        <text fg={palette().muted} wrapMode="none">
          {language()}
        </text>
      ) : null}
      <For each={lines()}>
        {(line) => (
          <text wrapMode="none">
            <For each={line}>
              {(run) => <span style={{ fg: run.color }}>{run.text}</span>}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}

export function MarkdownBody(props: {
  theme: ThemePalette
  text: string
  width: number
  height: number
  /** Render a window of blocks, for a caller that scrolls by block. */
  scrollable?: boolean
  /** First block to render when `scrollable`; the reader drives this. */
  offset?: number
  /** Natural-height use (chat) opts out of filling the parent. */
  grow?: boolean
  /** Centre prose inside a bubble; lists and code stay left-aligned. */
  align?: "left" | "center"
}) {
  const palette = () => props.theme
  const blocks = () => {
    const parsed = parseMarkdown(props.text)
    if (!props.scrollable) return parsed
    const offset = Math.max(0, props.offset ?? 0)
    return parsed.slice(offset, offset + Math.max(1, props.height))
  }
  return (
    <box
      flexDirection="column"
      flexGrow={props.scrollable || props.grow === false ? undefined : 1}
      minHeight={props.scrollable || props.grow === false ? undefined : 0}
      flexShrink={props.scrollable ? 0 : undefined}
    >
      {blocks().map((block) => {
        if (block.kind === "blank") return <text wrapMode="none"> </text>
        if (block.kind === "rule") {
          return (
            <text fg={palette().line} wrapMode="none">
              {"─".repeat(Math.max(0, props.width - 4))}
            </text>
          )
        }
        if (block.kind === "heading") {
          const colour = block.level === 1 ? palette().primary : palette().secondary
          // Space above a heading, so sections breathe.
          return (
            <box flexDirection="column" marginTop={1}>
              <text fg={colour} wrapMode="word" textAlign={props.align ?? "left"}>
                <b>{inlineText(block.text)}</b>
              </text>
            </box>
          )
        }
        if (block.kind === "quote") {
          return (
            <box flexDirection="row">
              <text fg={palette().primary} wrapMode="none">
                {"▌ "}
              </text>
              <text fg={palette().muted} wrapMode="word">
                {inlineText(block.text)}
              </text>
            </box>
          )
        }
        if (block.kind === "list") {
          return (
            <box flexDirection="column">
              {block.items.map((item) => {
                const mark = item.checked === null ? "•" : item.checked ? "✓" : "☐"
                const colour =
                  item.checked === null
                    ? palette().foreground
                    : item.checked
                      ? palette().primary
                      : palette().foreground
                return (
                  <box flexDirection="row" paddingLeft={2 + item.depth * 2}>
                    <text fg={colour} wrapMode="none">
                      {`${mark} `}
                    </text>
                    <Inline theme={palette()} text={item.text} />
                  </box>
                )
              })}
            </box>
          )
        }
        if (block.kind === "code") {
          return <CodeBlock theme={palette()} block={block} />
        }
        return <Inline theme={palette()} text={block.text} align={props.align} />
      })}
    </box>
  )
}
