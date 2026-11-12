import { afterAll, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { BUDGET_ROW, best, evaluate, findHostArtifact, machineFacts, median, parseFirstFrameBudget } from "../../scripts/perf";
const ROOT = resolve(import.meta.dir, "..", "..")
const FIXTURES = resolve(import.meta.dir, "..", "fixtures", "perf")
const BUDGET_FIXTURE = resolve(FIXTURES, "budget-standard.md")
const PERF = resolve(ROOT, "scripts", "perf.ts")

const scratch: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-perf-test-"))
  scratch.push(dir)
  return dir
}

afterAll(async () => {
  for (const dir of scratch) await removeTemp(dir)
})

describe("perf: the budget has one source", () => {
  test("the documented budget parses to 160 ms", async () => {
    const budget = parseFirstFrameBudget(await readFile(BUDGET_FIXTURE, "utf8"))
    expect(budget.firstFrameMs).toBe(160)
    expect(budget.metric.startsWith(BUDGET_ROW)).toBe(true)
  })

  test("a tightened fixture parses to its own smaller value", async () => {
    const tight = parseFirstFrameBudget(await readFile(join(FIXTURES, "budget-tight.md"), "utf8"))
    expect(tight.firstFrameMs).toBe(40)
  })

  test("a malformed budget cell is rejected instead of silently ignored", async () => {
    const text = await readFile(join(FIXTURES, "budget-malformed.md"), "utf8")
    expect(() => parseFirstFrameBudget(text)).toThrow(/is not of the form/)
  })

  test("a document without the first-frame row is rejected", () => {
    expect(() => parseFirstFrameBudget("# nothing here\n")).toThrow(/has no "First frame/)
  })
})

describe("perf: evaluating a measurement", () => {
  test("a fast measurement passes and reports the spare time", () => {
    const verdict = evaluate(66, 150)
    expect(verdict.ok).toBe(true)
    expect(verdict.deltaMs).toBe(-84)
    expect(verdict.message).toContain("66 ms")
    expect(verdict.message).toContain("150 ms budget")
  })

  test("an over-budget measurement fails naming value, budget and delta", async () => {
    const measured = Number((await readFile(join(FIXTURES, "over-budget-ms.txt"), "utf8")).trim())
    expect(measured).toBe(400)

    const verdict = evaluate(measured, 150)
    expect(verdict.ok).toBe(false)
    expect(verdict.deltaMs).toBe(250)
    expect(verdict.message).toContain("400 ms exceeds")
    expect(verdict.message).toContain("150 ms budget")
    expect(verdict.message).toContain("by 250 ms")
  })

  test("a measurement exactly on the budget passes", () => {
    expect(evaluate(150, 150).ok).toBe(true)
    expect(evaluate(150.1, 150).ok).toBe(false)
  })

  test("the median is stable for odd and even sample counts", () => {
    expect(median([90, 70, 80])).toBe(80)
    expect(median([70, 80, 90, 100])).toBe(85)
    expect(median([77])).toBe(77)
  })

  test("the best sample ignores a stalled run", () => {
    expect(best([255, 801, 278, 605, 278])).toBe(255)
    expect(best([77])).toBe(77)
  })
})

describe("perf: finding the artifact", () => {
  test("no directory at all is not an error", async () => {
    expect(await findHostArtifact(join(await tempDir(), "missing"))).toBeNull()
  })

  test("an empty directory yields nothing to measure", async () => {
    expect(await findHostArtifact(await tempDir())).toBeNull()
  })

  test("the host artifact is chosen over a cross-built one", async () => {
    const dir = await tempDir()
    const hostSuffix = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
    await writeFile(join(dir, "lockedin-0.1.0-bun-darwin-arm64"), "x")
    await writeFile(join(dir, `lockedin-0.1.0-${hostSuffix}`), "x")
    await writeFile(join(dir, "SHA256SUMS"), "x")

    const found = await findHostArtifact(dir)
    expect(found).not.toBeNull()
    expect(found!.endsWith(`lockedin-0.1.0-${hostSuffix}`)).toBe(true)
  })

  test("non-artifact files are ignored entirely", async () => {
    const dir = await tempDir()
    await writeFile(join(dir, "release.json"), "{}")
    await writeFile(join(dir, "RELEASE-NOTES.md"), "# notes")
    expect(await findHostArtifact(dir)).toBeNull()
  })
})

describe("perf: the gate as a command", () => {
  function run(args: string[]) {
    const proc = Bun.spawnSync(["bun", "run", PERF, ...args], { cwd: ROOT })
    return {
      exit: proc.exitCode ?? 1,
      out: `${proc.stdout.toString()}${proc.stderr.toString()}`,
    }
  }

  test("no artifact skips with exit 0 and says how to build one", async () => {
    const empty = await tempDir()
    const { exit, out } = run([`--dir=${empty}`])
    expect(exit).toBe(0)
    expect(out).toContain("skip")
    expect(out).toContain("no host artifact")
    expect(out).toContain("scripts/build.ts")
  })

  test("the within-budget fixture exits 0", async () => {
    const measured = (await readFile(join(FIXTURES, "within-budget-ms.txt"), "utf8")).trim()
    const { exit, out } = run([`--compare=${measured}`])
    expect(exit).toBe(0)
    expect(out).toContain("is within the 160 ms budget")
  })

  test("the over-budget fixture exits 1 naming value, budget and delta", async () => {
    const measured = (await readFile(join(FIXTURES, "over-budget-ms.txt"), "utf8")).trim()
    const { exit, out } = run([`--compare=${measured}`])
    expect(exit).toBe(1)
    expect(out).toContain("400 ms exceeds the 160 ms budget by 240 ms")
  })

  test("the machine is recorded next to the number", () => {
    const facts = machineFacts()
    expect(facts.platform).toBe(`${process.platform}-${process.arch}`)
    expect(facts.bun).toBe(Bun.version)
    expect(facts.cores).toBeGreaterThan(0)

    const { exit, out } = run(["--compare=66", "--json"])
    expect(exit).toBe(0)
    const parsed = JSON.parse(out) as { medianMs: number; machine: { platforms?: string } }
    expect(parsed.medianMs).toBe(66)
  })

  test("the check gate runs the perf step after the tests, on every platform", async () => {
    const gate = await readFile(resolve(ROOT, "scripts", "check.ts"), "utf8")
    const perfIndex = gate.indexOf("scripts/perf.ts")
    const testsIndex = gate.indexOf('"test"')
    expect(perfIndex).toBeGreaterThan(testsIndex)

    // The POSIX wrapper delegates instead of duplicating the order.
    const wrapper = await readFile(resolve(ROOT, "scripts", "check.sh"), "utf8")
    expect(wrapper).toContain("bun run scripts/check.ts")
  })
})

describe("perf: the host factor", () => {
  test("a slower host gets a wider budget, and the factor is printed", () => {
    const verdict = evaluate(164.5, 150, 1.5)
    expect(verdict.ok).toBe(true)
    expect(verdict.budgetMs).toBe(225)
    expect(verdict.documentedMs).toBe(150)
    expect(verdict.message).toContain("1.5 host factor")
  })

  test("a real regression still fails on a slower host", () => {
    const verdict = evaluate(400, 150, 1.5)
    expect(verdict.ok).toBe(false)
    expect(verdict.deltaMs).toBe(175)
  })

  test("the default factor is the documented budget itself", () => {
    const verdict = evaluate(151, 150)
    expect(verdict.ok).toBe(false)
    expect(verdict.budgetMs).toBe(150)
  })

  test("a factor below 1 is rejected: it could only hide a regression", () => {
    expect(() => evaluate(100, 150, 0.5)).toThrow(/hostFactor/)
  })
})
