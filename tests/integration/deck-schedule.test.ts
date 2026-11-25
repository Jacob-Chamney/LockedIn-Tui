/**
 * The flashcard schedule on disk: atomic, missing-safe, corrupt-safe.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { newSchedule, reviewCard } from "../../src/domain/scheduler";
import {
  SCHEDULE_FILE,
  readSchedule,
  schedulePath,
  writeSchedule,
} from "../../src/services/skills/schedule";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(TEMP_BASE, "deck-schedule-"));
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await removeTemp(dir);
});

const NOW = new Date("2026-11-24T10:00:00.000Z");

describe("deck schedule", () => {
  test("a missing file is an empty schedule, not an error", async () => {
    const read = await readSchedule(dir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual([]);
  });

  test("a schedule round-trips every field", async () => {
    const card = reviewCard(newSchedule("what is a register", NOW), "hard", NOW);
    const written = await writeSchedule(dir, [card]);
    expect(written.ok).toBe(true);
    const read = await readSchedule(dir);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value).toHaveLength(1);
    expect(read.value[0]).toEqual(card);
  });

  test("a corrupt file is named, not silently reset", async () => {
    await writeFile(schedulePath(dir), "{oops", "utf8");
    const read = await readSchedule(dir);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.message).toContain("valid JSON");
    // The bad file is left for the user, never overwritten by a read.
    expect(await readFile(schedulePath(dir), "utf8")).toBe("{oops");
  });

  test("a write replaces the file atomically and leaves no temp file", async () => {
    const first = newSchedule("a", NOW);
    const second = reviewCard(newSchedule("b", NOW), "good", NOW);
    await writeSchedule(dir, [first]);
    const written = await writeSchedule(dir, [first, second]);
    expect(written.ok).toBe(true);
    const onDisk = JSON.parse(await readFile(join(dir, SCHEDULE_FILE), "utf8"));
    expect(onDisk.schema).toBe(1);
    expect(onDisk.cards).toHaveLength(2);
    const leftovers = (await import("node:fs/promises")).readdir(dir);
    expect((await leftovers).some((name) => name.includes(".tmp-"))).toBe(false);
  });
});
