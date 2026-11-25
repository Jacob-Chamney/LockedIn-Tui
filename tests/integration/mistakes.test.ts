/**
 * Mistakes in a real workspace: the ledger file, the promotion note and its
 * provenance. Every write goes through the real note store, so this proves the
 * note lands in the school vault with its frontmatter intact and that a second
 * promotion is a no-op rather than a duplicate.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseDocument, readString, readStringArray, type Result } from "../../src/domain/markdown";
import { createLockInSession } from "../../src/services/lockin/create";
import {
  listMistakes,
  markMistake,
  promoteMistake,
  recordMistake,
} from "../../src/services/lockin/mistakes";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspace: Workspace;
let sessionId: string;
let folder: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "mistakes-integration-"));
  workspace = unwrap(await createWorkspace(join(base, "workspace")));
  const input = join(base, "lecture-4.md");
  await writeFile(input, "# Unit 4\n\nBoundary conditions.\n");
  const created = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T14:30:00Z",
      name: "Physics — Unit 4",
      files: [input],
    }),
  );
  sessionId = created.session.id;
  folder = created.folder;
});

afterEach(async () => {
  await removeTemp(base);
});

describe("the mistake ledger", () => {
  test("records entries in misconceptions.md and lists them in order", async () => {
    expect(unwrap(await listMistakes({ workspace, sessionId })).entries).toEqual([]);

    const first = unwrap(
      await recordMistake({
        workspace,
        sessionId,
        text: "Energy is conserved per object.",
        step: "Derive the energy balance",
      }),
    );
    expect(first.entries).toEqual([
      { index: 0, text: "Energy is conserved per object.", step: "Derive the energy balance", note: null },
    ]);

    const second = unwrap(
      await recordMistake({ workspace, sessionId, text: "A derivative is a fraction." }),
    );
    expect(second.entries.map((entry) => entry.text)).toEqual([
      "Energy is conserved per object.",
      "A derivative is a fraction.",
    ]);
    expect(second.entries[1]?.note).toBeNull();

    const raw = await readFile(join(folder, "misconceptions.md"), "utf8");
    expect(raw).toContain("- Energy is conserved per object.");
    expect(raw).toContain("  step: Derive the energy balance");
    expect(raw).toContain("- A derivative is a fraction.");
  });

  test("refuses blank, over-long and out-of-range input without writing", async () => {
    const blank = await recordMistake({ workspace, sessionId, text: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error.kind).toBe("invalid");

    const long = await recordMistake({ workspace, sessionId, text: "x".repeat(501) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.message).toContain("500");

    const missing = await promoteMistake({ workspace, sessionId, index: 0 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.message).toContain("there is no mistake at index 0");
    expect(await readdir(workspace.paths.schoolVault)).not.toContain("knowledge");
  });
});

describe("promotion", () => {
  beforeEach(async () => {
    unwrap(
      await recordMistake({
        workspace,
        sessionId,
        text: "Energy is conserved per object.",
        step: "Derive the energy balance",
      }),
    );
  });

  test("writes a labelled knowledge note with provenance", async () => {
    const promoted = unwrap(
      await promoteMistake({
        workspace,
        sessionId,
        index: 0,
        correction: "Energy is conserved for a closed system, not per object.",
      }),
    );
    expect(promoted.already).toBe(false);
    expect(promoted.note.path).toBe(
      `school/vault/knowledge/${promoted.note.path.split("/").at(-1)}`,
    );

    const absolute = join(workspace.root, promoted.note.path);
    const text = await readFile(absolute, "utf8");
    const parsed = parseDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(readString(parsed.value.data, "type")).toBe("knowledge");
    expect(readString(parsed.value.data, "origin")).toBe("session-mistake");
    expect(readString(parsed.value.data, "session")).toBe(sessionId);
    expect(readString(parsed.value.data, "status")).toBe("corrected");
    expect(readString(parsed.value.data, "step")).toBe("Derive the energy balance");
    expect(readStringArray(parsed.value.data, "topics")).toEqual(["Session mistakes"]);
    expect(readStringArray(parsed.value.data, "tags")).toEqual(["mistake"]);
    expect(parsed.value.body).toContain("not one of the session's sources");
    expect(parsed.value.body).toContain("Energy is conserved for a closed system");
  });

  test("marks the entry promoted and a second promotion writes nothing", async () => {
    const first = unwrap(await promoteMistake({ workspace, sessionId, index: 0 }));
    const listed = unwrap(await listMistakes({ workspace, sessionId }));
    expect(listed.entries[0]?.note?.path).toBe(first.note.path);

    const again = unwrap(await promoteMistake({ workspace, sessionId, index: 0 }));
    expect(again.already).toBe(true);
    expect(again.note.path).toBe(first.note.path);

    const notes = await readdir(join(workspace.paths.schoolVault, "knowledge"));
    expect(notes.filter((name) => name.endsWith(".md"))).toHaveLength(1);
  });

  test("an uncorrected mistake stays open and says the correction is missing", async () => {
    const promoted = unwrap(await promoteMistake({ workspace, sessionId, index: 0 }));
    const parsed = parseDocument(await readFile(join(workspace.root, promoted.note.path), "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(readString(parsed.value.data, "status")).toBe("open");
    expect(parsed.value.body).toContain("Not written yet.");
  });

  test("two mistakes get two distinct note names", async () => {
    unwrap(await recordMistake({ workspace, sessionId, text: "A derivative is a fraction." }));
    const a = unwrap(await promoteMistake({ workspace, sessionId, index: 0 }));
    const b = unwrap(await promoteMistake({ workspace, sessionId, index: 1 }));
    expect(a.note.path).not.toBe(b.note.path);
    expect(b.note.path).toContain("a-derivative-is-a-fraction");
  });
});

describe("review marking", () => {
  beforeEach(async () => {
    unwrap(
      await recordMistake({
        workspace,
        sessionId,
        text: "Energy is conserved per object.",
      }),
    )
    unwrap(await promoteMistake({ workspace, sessionId, index: 0 }))
  })

  test("known marks the note reviewed and leaves the body untouched", async () => {
    const first = unwrap(await markMistake({ workspace, sessionId, index: 0, result: "known" }))
    expect(first.misses).toBe(0)

    const listed = unwrap(await listMistakes({ workspace, sessionId }))
    const path = listed.entries[0]?.note?.path ?? ""
    const parsed = parseDocument(await readFile(join(workspace.root, path), "utf8"))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(readString(parsed.value.data, "status")).toBe("reviewed")
    expect(readString(parsed.value.data, "reviewed_at")).not.toBe("")
    expect(parsed.value.body).toContain("not one of the session's sources")
    expect(parsed.value.body).toContain("Not written yet.")
  })

  test("missed increments a durable count", async () => {
    expect(unwrap(await markMistake({ workspace, sessionId, index: 0, result: "missed" })).misses).toBe(1)
    expect(unwrap(await markMistake({ workspace, sessionId, index: 0, result: "missed" })).misses).toBe(2)

    const listed = unwrap(await listMistakes({ workspace, sessionId }))
    const path = listed.entries[0]?.note?.path ?? ""
    const parsed = parseDocument(await readFile(join(workspace.root, path), "utf8"))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.data.misses).toBe(2)
    expect(readString(parsed.value.data, "last_missed")).not.toBe("")
    // Still open: a miss is not a review pass.
    expect(readString(parsed.value.data, "status")).toBe("open")
  })

  test("an entry that was never promoted cannot be marked", async () => {
    const marked = await markMistake({ workspace, sessionId, index: 4, result: "known" })
    expect(marked.ok).toBe(false)
    if (!marked.ok) expect(marked.error.message).toContain("no promoted mistake 4")
  })
})
