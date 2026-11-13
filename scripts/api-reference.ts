/**
 * Generate the SDK reference page from `sdk/index.ts`.
 *
 *   bun run api:reference
 *
 * The generated page lives in `wiki/API-Reference.md`; the API-reference test
 * fails when it is stale, so a signature change cannot silently drift.
 */
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import ts from "typescript"

const ROOT = resolve(import.meta.dir, "..")
const SDK = join(ROOT, "sdk", "index.ts")
const PAGE = join(ROOT, "wiki", "API-Reference.md")

function docOf(node: ts.Node): string {
  const parts = ts.getJSDocCommentsAndTags(node)
  const comments: string[] = []
  for (const part of parts) {
    const comment = (part as { comment?: unknown }).comment
    if (typeof comment === "string" && comment.trim()) comments.push(comment.trim())
    if (Array.isArray(comment)) {
      const text = comment.map((item) => (typeof item === "string" ? item : item.text ?? "")).join("")
      if (text.trim()) comments.push(text.trim())
    }
  }
  return comments.join(" ").replace(/\s+/g, " ").trim()
}

function signatureOf(node: ts.FunctionDeclaration, source: ts.SourceFile): string {
  const params = node.parameters
    .map((parameter) => parameter.getText(source).replace(/\s+/g, " ").trim())
    .join(", ")
  const type = node.type ? `: ${node.type.getText(source).replace(/\s+/g, " ").trim()}` : ""
  return `export function ${node.name?.text ?? "anonymous"}(${params})${type}`
}

function isExported(node: ts.Node): boolean {
  return Boolean(ts.getModifiers(node as ts.HasModifiers)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

export function renderApiReference(sourceText: string): string {
  const source = ts.createSourceFile("sdk/index.ts", sourceText, ts.ScriptTarget.Latest, true)
  const functions: string[] = []
  const types: string[] = []
  const constants: string[] = []

  for (const statement of source.statements) {
    if (!isExported(statement)) continue
    const name = (statement as { name?: ts.Identifier }).name?.text
    if (!name) continue
    const doc = docOf(statement)
    const note = doc ? `\n  ${doc}` : ""
    if (ts.isFunctionDeclaration(statement)) {
      functions.push(`### \`${signatureOf(statement, source)}\`\n${note}`)
    } else if (ts.isTypeAliasDeclaration(statement)) {
      types.push(`### \`${name}\`\n${note}`)
    } else if (ts.isVariableStatement(statement)) {
      constants.push(`### \`${name}\`\n${note}`)
    }
  }

  const section = (title: string, items: string[]) =>
    items.length > 0 ? `## ${title}\n\n${items.join("\n\n")}\n` : ""
  return [
    "# SDK API reference",
    "",
    "Generated from `sdk/index.ts`; run `bun run api:reference` after changing the SDK.",
    "",
    "All names are exported by `@lockedin/sdk`. The host still validates every manifest and scene node at runtime.",
    "",
    section("Functions", functions),
    "",
    section("Types", types),
    "",
    section("Constants", constants),
  ]
    .filter((part) => part !== "")
    .join("\n")
    .trimEnd()
    .concat("\n")
}

if (import.meta.main) {
  const source = await Bun.file(SDK).text()
  const page = renderApiReference(source)
  await writeFile(PAGE, page, "utf8")
  console.log(`wrote ${PAGE}`)
}
