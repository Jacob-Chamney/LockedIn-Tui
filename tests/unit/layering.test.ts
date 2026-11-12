/**
 * Dependency direction is a rule, not a habit.
 *
 * Logic (domain/services/storage/llm) never imports the UI or the app layer.
 * Panels never import the app controller. Actions are the only place allowed to
 * connect a service to the shell, and they do not render.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const SRC = join(ROOT, "src")

function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...files(path))
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path)
  }
  return out
}

function importsOf(path: string): string[] {
  const text = readFileSync(path, "utf8")
  return [...text.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]!)
}

function violations(dir: string, forbidden: RegExp): string[] {
  return files(join(SRC, dir)).flatMap((file) =>
    importsOf(file)
      .filter((specifier) => forbidden.test(specifier))
      .map((specifier) => `${relative(SRC, file)} -> ${specifier}`),
  )
}

describe("layering", () => {
  test("logic never imports the UI, the app, Solid or OpenTUI", () => {
    const bad = /(^|\/)(ui|app)\/|^solid-js|^@opentui/
    const found = ["domain", "services", "storage", "llm"].flatMap((dir) => violations(dir, bad))
    expect(found).toEqual([])
  })

  test("panels never import the app layer", () => {
    expect(violations("ui", /(^|\/)app\//)).toEqual([])
  })

  test("actions never render", () => {
    expect(violations("app/actions", /(^|\/)ui\/|^solid-js|^@opentui/)).toEqual([])
  })

  test("App only imports service types, never an implementation", () => {
    const app = readFileSync(join(SRC, "app", "App.tsx"), "utf8")
    const serviceImports = app
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("import ") && line.includes('from "../services/'))
    expect(serviceImports.length).toBeGreaterThan(0)
    for (const line of serviceImports) expect(line.startsWith("import type ")).toBe(true)
    expect(app).not.toContain('await import("../services/')
    expect(app).not.toContain('void import("../services/')
  })
})
