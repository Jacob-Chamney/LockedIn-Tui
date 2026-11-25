/**
 * Figure crops: bounds, argv, confinement and the on-disk index.
 *
 * The process itself is covered by the integration test when poppler is
 * installed; this file pins everything that can be checked without one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addFigure,
  annotateFigure,
  confineSource,
  isPng,
  pdftoppmArgs,
  readFigures,
  removeFigure,
  validateCrop,
} from "../../src/services/lockin/figures";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(TEMP_BASE, "figures-"));
  await mkdir(join(folder, "sources"), { recursive: true });
});

afterEach(async () => {
  await removeTemp(folder);
});

describe("validateCrop", () => {
  test("accepts a page or a whole crop", () => {
    expect(validateCrop({ page: 3 }).ok).toBe(true);
    const crop = validateCrop({ page: 2, x: 10, y: 20, width: 100, height: 60, dpi: 150 });
    expect(crop.ok).toBe(true);
    if (crop.ok) expect(crop.dpi).toBe(150);
  });

  test("refuses a partial crop, a bad page and a bad dpi", () => {
    expect(validateCrop({ page: 1, x: 10 }).ok).toBe(false);
    expect(validateCrop({ page: 0 }).ok).toBe(false);
    expect(validateCrop({ page: 1.5 }).ok).toBe(false);
    expect(validateCrop({ page: 1, dpi: 40 }).ok).toBe(false);
    expect(validateCrop({ page: 1, x: 0, y: 0, width: 0, height: 10 }).ok).toBe(false);
  });

  test("the argv is a list, never a shell string", () => {
    const args = pdftoppmArgs({
      page: 2,
      x: 5,
      y: 6,
      width: 100,
      height: 50,
      dpi: 110,
      sourcePath: "/a/b.pdf",
      outputPrefix: "/a/out",
    });
    expect(args).toEqual([
      "-png", "-r", "110", "-f", "2", "-l", "2", "-singlefile",
      "-x", "5", "-y", "6", "-W", "100", "-H", "50",
      "/a/b.pdf", "/a/out",
    ]);
  });
});

describe("confinement", () => {
  test("a copied source resolves; a traversal does not", () => {
    const inside = confineSource(folder, "sources/lecture.pdf");
    expect(inside.ok).toBe(true);
    expect(confineSource(folder, "../secret.pdf").ok).toBe(false);
    expect(confineSource(folder, "/etc/passwd").ok).toBe(false);
    expect(confineSource(folder, "sources/../../x.pdf").ok).toBe(false);
  });
});

describe("figure index", () => {
  test("a figure round-trips, annotates and removes", async () => {
    const added = await addFigure(folder, {
      source: "sources/lecture.pdf",
      crop: { page: 2, x: 10, y: 10, width: 40, height: 30 },
      caption: "Figure 2",
      note: "",
      bytes: PNG,
      now: new Date("2026-11-24T10:00:00.000Z"),
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.id).toBe("figure-1");
    expect(added.value.file).toBe("figure-1.png");

    const listed = await readFigures(folder);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value).toHaveLength(1);

    const annotated = await annotateFigure(folder, "figure-1", { note: "the slope is the rate" });
    expect(annotated.ok).toBe(true);
    if (annotated.ok) expect(annotated.value.note).toBe("the slope is the rate");

    const removed = await removeFigure(folder, "figure-1");
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.removed).toBe(true);
    const after = await readFigures(folder);
    if (!after.ok) throw new Error(after.error.message);
    expect(after.value).toEqual([]);
  });

  test("a PNG magic is required", () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  test("an unreadable index is reported, not reset", async () => {
    await writeFile(join(folder, "figures", "index.json"), "{oops", { encoding: "utf8" }).catch(
      async () => {
        await mkdir(join(folder, "figures"), { recursive: true });
        await writeFile(join(folder, "figures", "index.json"), "{oops", "utf8");
      },
    );
    const read = await readFigures(folder);
    expect(read.ok).toBe(false);
  });
});
