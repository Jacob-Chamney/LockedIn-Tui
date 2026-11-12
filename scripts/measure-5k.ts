#!/usr/bin/env bun
/**
 * Release measurement: first painted frame of a compiled artifact with a
 * 5,000-note workspace (docs/testing.md §5, budget ≤400 ms).
 *
 *   bun run scripts/measure-5k.ts --binary=dist/lockedin-bun-linux-x64
 *
 * Creates a throwaway workspace and index, then launches the binary under a
 * pty three times. It prints the samples and exits 1 when the median exceeds
 * the budget. It does not build the artifact.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { closeIndex, openIndex, rebuild } from "../src/storage/index"
import { createWorkspace } from "../src/storage/workspace"

const BUDGET_MS = 400
const NOTES = 5000
const base = await mkdtemp(join(tmpdir(), "lockedin-5k-"))

function argument(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

const binary = resolve(argument("binary") ?? join("dist", "lockedin-bun-linux-x64"))

async function seedNotes(vault: string): Promise<void> {
  const dir = join(vault, "concepts")
  await mkdir(dir, { recursive: true })
  await Promise.all(
    Array.from({ length: NOTES }, (_, index) =>
      writeFile(
        join(dir, `note-${String(index).padStart(4, "0")}.md`),
        `---\ntitle: Note ${index}\ntype: concept\ntags: [perf]\n---\n\n# Note ${index}\n\nBoundary conditions for unit ${index}, integral ${index * 7}.\n`,
      ),
    ),
  )
}

async function firstFrame(workspace: string, dataDir: string, cwd: string, home: string): Promise<number | null> {
  const proc = Bun.spawn(
    [
      "script",
      "-qfec",
      `env -i HOME=${home} LOCKEDIN_DATA_DIR=${dataDir} PATH=/usr/bin:/bin ./lockedin --workspace ${workspace}`,
      "/dev/null",
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
  const started = performance.now()
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let seen = ""
  let elapsed: number | null = null
  const deadline = started + 6000
  while (performance.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    seen += decoder.decode(value, { stream: true })
    if (seen.includes("LOCKEDIN")) {
      elapsed = performance.now() - started
      break
    }
  }
  proc.kill()
  await proc.exited
  return elapsed === null ? null : Number(elapsed.toFixed(0))
}

try {
  const home = join(base, "home")
  await mkdir(home, { recursive: true })
  const data = join(base, "data")
  const created = await createWorkspace(join(base, "ws"), { dataDir: data })
  if (!created.ok) throw new Error(JSON.stringify(created.error))
  await seedNotes(created.value.paths.schoolVault)
  const index = openIndex(created.value.paths, "school")
  if (!index.ok) throw new Error(JSON.stringify(index.error))
  const rebuilt = rebuild(index.value)
  closeIndex(index.value)
  if (!rebuilt.ok) throw new Error(JSON.stringify(rebuilt.error))

  const local = join(base, "lockedin")
  await Bun.write(local, await Bun.file(binary).arrayBuffer())
  await Bun.$`chmod +x ${local}`.quiet()
  const samples: number[] = []
  for (let run = 0; run < 3; run++) {
    const frame = await firstFrame(created.value.paths.root, data, base, home)
    if (frame !== null) samples.push(frame)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] ?? null
  console.log(JSON.stringify({ binary, notes: NOTES, samples, median, budgetMs: BUDGET_MS }))
  if (median === null || median > BUDGET_MS) process.exitCode = 1
} finally {
  await rm(base, { recursive: true, force: true })
}
