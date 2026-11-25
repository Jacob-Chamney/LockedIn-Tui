/**
 * The swarm report data format: current ids, old positional reports, and the
 * one-line verify rewrite.
 */
import { describe, expect, test } from "bun:test";

import { parseSwarmReport, verifyReportTask } from "../../src/domain/swarm-report";

const CURRENT = [
  "---",
  "run: 2026-11-01T16-00-00Z",
  'objective: "Review the change"',
  "status: done",
  "agents: 2",
  "---",
  "",
  "## Plan",
  "",
  "- task-1 · Check the API — Reviewer",
  "- task-2 · Check the offset handling — Reviewer",
  "",
  "## Task results",
  "",
  "- [done] task-1 · Reviewer — read the routes",
  "- [verified] task-2 · Reviewer — read offsets",
  "",
].join("\n");

const OLD = [
  "---",
  "run: 2026-10-01T09-00-00Z",
  'objective: "Old run"',
  "status: done",
  "agents: 2",
  "---",
  "",
  "## Plan",
  "",
  "- Check the API — Reviewer",
  "- Check the offset handling — Reviewer",
  "",
  "## Task results",
  "",
  "- [done] Reviewer — read the routes",
  "- [failed] Reviewer — could not read offsets",
  "",
].join("\n");

describe("parseSwarmReport", () => {
  test("reads the current format with explicit task ids and titles", () => {
    expect(parseSwarmReport(CURRENT)).toEqual({
      run: "2026-11-01T16-00-00Z",
      objective: "Review the change",
      status: "done",
      tasks: [
        { id: "task-1", title: "Check the API", state: "done", summary: "read the routes" },
        {
          id: "task-2",
          title: "Check the offset handling",
          state: "verified",
          summary: "read offsets",
        },
      ],
    });
  });

  test("reads an old report by position, exactly the ids the service assigns", () => {
    expect(parseSwarmReport(OLD)).toEqual({
      run: "2026-10-01T09-00-00Z",
      objective: "Old run",
      status: "done",
      tasks: [
        { id: "task-1", title: "Check the API", state: "done", summary: "read the routes" },
        {
          id: "task-2",
          title: "Check the offset handling",
          state: "failed",
          summary: "could not read offsets",
        },
      ],
    });
  });

  test("a title may contain the separator and keeps its own words", () => {
    const report = parseSwarmReport(
      [
        "---",
        "run: r1",
        "status: done",
        "---",
        "",
        "## Plan",
        "",
        "- task-1 · Read the API — and the client — Reviewer",
        "",
        "## Task results",
        "",
        "- [done] task-1 · Reviewer — read",
        "",
      ].join("\n"),
    );
    expect(report?.tasks[0]?.title).toBe("Read the API — and the client");
  });

  test("a line with an unknown state or no separator is skipped, not fatal", () => {
    const report = parseSwarmReport(
      [
        "---",
        "run: r1",
        "status: done",
        "---",
        "",
        "## Plan",
        "",
        "- task-1 · One — Reviewer",
        "",
        "## Task results",
        "",
        "- [exploded] task-1 · Reviewer — no",
        "- [done] task-1 · Reviewer",
        "",
      ].join("\n"),
    );
    expect(report?.tasks).toEqual([
      { id: "task-1", title: "One", state: "done", summary: "" },
    ]);
  });

  test("a document that is not a report is null", () => {
    expect(parseSwarmReport("# Notes\n\nNot a report.\n")).toBeNull();
    expect(parseSwarmReport("")).toBeNull();
  });
});

describe("verifyReportTask", () => {
  test("replaces only the bracket of the named task", () => {
    const outcome = verifyReportTask(CURRENT, "task-1");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.already).toBe(false);
    expect(outcome.markdown).toContain("- [verified] task-1 · Reviewer — read the routes");
    // The other task and every other byte stay.
    expect(outcome.markdown).toContain("- [verified] task-2 · Reviewer — read offsets");
    expect(outcome.markdown.replace("[verified] task-1", "[done] task-1")).toBe(CURRENT);
  });

  test("an old positional report is verified by its position", () => {
    // task-2 failed, so it cannot be verified.
    const failed = verifyReportTask(OLD, "task-2");
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.message).toContain("failed, not done");

    const first = verifyReportTask(OLD, "task-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.markdown).toContain("- [verified] Reviewer — read the routes");
  });

  test("an already verified task is a no-op success", () => {
    const outcome = verifyReportTask(CURRENT, "task-2");
    expect(outcome).toEqual({ ok: true, markdown: CURRENT, already: true });
  });

  test("an unknown id is one refusal", () => {
    const outcome = verifyReportTask(CURRENT, "task-9");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("no task task-9");
  });
});
