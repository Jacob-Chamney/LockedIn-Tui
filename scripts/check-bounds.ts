#!/usr/bin/env bun
/**
 * Boundary and naming check.
 *
 * The architecture document promises two things that a type checker cannot
 * enforce: dependencies point one way, and files in `ui/features` are named for
 * their role. This fails the gate instead of letting either drift.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join, normalize } from "node:path"

const ROOT = "src"
const LOWER = ["domain", "services", "storage", "llm", "archive", "plugins", "security"]
const UI_OR_APP = ["ui", "app"]

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

function layerOf(path: string): string | null {
  const normal = path.replaceAll("\\", "/")
  for (const layer of LOWER) if (normal.startsWith(`${ROOT}/${layer}/`)) return layer
  if (normal.startsWith(`${ROOT}/ui/`)) return "ui"
  if (normal.startsWith(`${ROOT}/app/`)) return "app"
  return null
}

function specifiers(text: string): string[] {
  const out: string[] = []
  const patterns = [/from\s+["']([^"']+)["']/g, /import\s*\(\s*["']([^"']+)["']/g, /require\s*\(\s*["']([^"']+)["']/g]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) if (match[1]) out.push(match[1])
  }
  return out
}

const problems: string[] = []

for (const file of files(ROOT)) {
  const from = layerOf(file)
  if (!from) continue
  for (const spec of specifiers(readFileSync(file, "utf8"))) {
    if (!spec.startsWith(".")) continue
    const target = normalize(join(file, "..", spec))
    const to = layerOf(target)
    if (to === null) continue
    if (from === "domain" && to !== "domain") {
      problems.push(`${file}: domain imports ${to} (${spec})`)
    }
    if (LOWER.includes(from) && UI_OR_APP.includes(to)) {
      problems.push(`${file}: ${from} imports ${to} (${spec})`)
    }
  }
}

// Feature folders name their files for their role: a component is a panel or a
// view, a pure module is a model or a key table, and index re-exports.
for (const file of files("src/ui/features")) {
  const name = basename(file)
  if (name === "index.ts") continue
  if (name.endsWith(".tsx") && !/-(panel|view)\.tsx$/.test(name)) {
    problems.push(`${file}: components in ui/features must end -panel.tsx or -view.tsx`)
  }
  if (name.endsWith(".ts") && !/-(model|keys)\.ts$/.test(name)) {
    problems.push(`${file}: pure modules in ui/features must end -model.ts or -keys.ts`)
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log("bounds ok")
