/**
 * Renders `docs/parity-audit.md` from the audit data.
 *
 * Used by the release test (which re-renders and compares, so the document and
 * the data cannot drift) and by the generator that writes the file. It is
 * deliberately pure and has no clock: same input, same bytes.
 */

export type Evidence = { test: string; contains: string }

export type ParityRow = {
  id: string
  section: string
  item: string
  status: "checked" | "unchecked" | "deferred"
  evidence?: Evidence
  owner?: string
  reason?: string
}

export type PlatformRun = {
  platform: "linux" | "macos" | "windows"
  status: "checked" | "not-executed"
  note?: string
  owner?: string
  reason?: string
}

export type ParityData = {
  generatedFrom: string
  machine: { os: string; bun: string; notes: string }
  platforms: PlatformRun[]
  rows: ParityRow[]
}

export type PerformanceRecord = {
  machine: { os: string; cpu: string; ramGb: number; bun: string }
  budgets: { metric: string; budget: string; measured: string; source: string }[]
  notMeasured: { metric: string; owner: string; reason: string }[]
  adrNotes: string[]
}

export function counts(data: ParityData): { checked: number; unchecked: number; deferred: number; total: number } {
  const total = data.rows.length
  const checked = data.rows.filter((row) => row.status === "checked").length
  const deferred = data.rows.filter((row) => row.status === "deferred").length
  return { checked, unchecked: total - checked - deferred, deferred, total }
}

/**
 * Rows that stop a release candidate.
 *
 * The packet's rule is that a primary item is only acceptable when it is checked
 * or *deferred* with an owner — an `unchecked` row is a gap however well it is
 * annotated, so every unchecked row counts here. `deferred` rows are excluded
 * because they name an owner and a decision.
 */
export function blockers(data: ParityData): ParityRow[] {
  return data.rows.filter((row) => row.status === "unchecked")
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|")
}

function evidenceCell(row: ParityRow): string {
  if (row.status !== "checked") return "—"
  if (!row.evidence) return "**missing**"
  return `\`${row.evidence.test}\` contains \`${cell(row.evidence.contains)}\``
}

function statusCell(row: ParityRow): string {
  switch (row.status) {
    case "checked":
      return "checked"
    case "deferred":
      return `deferred — ${cell(row.owner ?? "**no owner**")}: ${cell(row.reason ?? "**no reason**")}`
    case "unchecked":
      return `unchecked — ${cell(row.owner ?? "**no owner**")}: ${cell(row.reason ?? "**no reason**")}`
  }
}

export function renderAudit(data: ParityData, performance: PerformanceRecord | null): string {
  const totals = counts(data)
  const blocking = blockers(data)
  const lines: string[] = []

  lines.push("# Parity audit — release candidate")
  lines.push("")
  lines.push("Generated from `docs/product.md` §14. Do not edit by hand: this file is")
  lines.push("rendered from `tests/fixtures/release-audit/parity.json` and")
  lines.push("`tests/fixtures/release-audit/performance.json` by")
  lines.push("`tests/fixtures/release-audit/render.ts`, and")
  lines.push("`tests/release/parity.test.ts` fails if the file and the data disagree.")
  lines.push("")
  lines.push(`- Items in the checklist: **${totals.total}**`)
  lines.push(`- Checked with evidence: **${totals.checked}**`)
  lines.push(`- Unchecked: **${totals.unchecked}**`)
  lines.push(`- Deferred with an owner: **${totals.deferred}**`)
  lines.push(`- Blocking a release candidate: **${blocking.length}**`)
  lines.push("")
  lines.push("A row is `checked` only when it names evidence a reviewer can re-run: a")
  lines.push("test file plus a literal string that must appear in it. `grep -F '<literal>'")
  lines.push("'<test>'` is the whole check. A row with no such pointer is not checked,")
  lines.push("whatever the feature feels like.")
  lines.push("")
  lines.push("## 1. Parity checklist")
  lines.push("")

  let section = ""
  for (const row of data.rows) {
    if (row.section !== section) {
      section = row.section
      lines.push(`### ${section}`)
      lines.push("")
      lines.push("| ID | Item | Status | Evidence |")
      lines.push("|---|---|---|---|")
    }
    lines.push(`| ${row.id} | ${cell(row.item)} | ${statusCell(row)} | ${evidenceCell(row)} |`)
  }

  lines.push("")
  lines.push("## 2. Performance")
  lines.push("")

  if (!performance) {
    lines.push("No performance record was produced; see `tests/release/performance.test.ts`.")
  } else {
    lines.push(`Reference machine: ${performance.machine.os}, ${performance.machine.cpu},`)
    lines.push(`${performance.machine.ramGb} GB RAM, Bun ${performance.machine.bun}.`)
    lines.push("")
    lines.push("| Metric | Budget (`docs/testing.md` §5) | Measured | How |")
    lines.push("|---|---|---|---|")
    for (const row of performance.budgets) {
      lines.push(`| ${cell(row.metric)} | ${cell(row.budget)} | ${cell(row.measured)} | ${cell(row.source)} |`)
    }
    lines.push("")
    if (performance.notMeasured.length > 0) {
      lines.push("**Not measured** — named rather than implied:")
      lines.push("")
      for (const row of performance.notMeasured) {
        lines.push(`- ${row.metric} — ${row.reason} (owner: ${row.owner})`)
      }
      lines.push("")
    }
    if (performance.adrNotes.length > 0) {
      lines.push("**ADR notes for breaches above 20 %:**")
      lines.push("")
      for (const note of performance.adrNotes) lines.push(`- ${note}`)
      lines.push("")
    } else {
      lines.push("No breach above 20 % is recorded, so no ADR note is required.")
      lines.push("")
    }
  }

  lines.push("## 3. Platform and install runs")
  lines.push("")
  lines.push("| Platform | Status | Detail |")
  lines.push("|---|---|---|")
  for (const run of data.platforms) {
    const detail =
      run.status === "checked"
        ? (run.note ?? "executed")
        : `**not executed** — ${run.reason ?? "no reason given"} (owner: ${run.owner ?? "**no owner**"})`
    lines.push(`| ${run.platform} | ${run.status} | ${cell(detail)} |`)
  }
  lines.push("")
  lines.push("Linux runs `./scripts/check.sh` and the `tests/e2e` suites in this")
  lines.push("repository. macOS and Windows are not implied by that: neither platform")
  lines.push("was executed, and the audit says so.")
  lines.push("")
  lines.push("## 4. Blocking a release candidate")
  lines.push("")

  if (blocking.length === 0 && totals.unchecked === 0) {
    lines.push("None. Every checklist item is checked or deferred with a named owner.")
  } else {
    lines.push("The following items are unchecked and not deferred, so the release")
    lines.push("candidate is not ready:")
    lines.push("")
    for (const row of data.rows) {
      if (row.status !== "unchecked") continue
      lines.push(`- **${row.id} ${row.section} — ${row.item}**: ${row.reason ?? "no reason"} (owner: ${row.owner ?? "none"})`)
    }
    lines.push("")
    lines.push("An `unchecked` row with an owner is a known gap, not a silent omission;")
    lines.push("the parity test fails only when the owner or the reason is missing.")
  }
  lines.push("")

  return `${lines.join("\n")}`
}
