/**
 * The real pdftoppm path: a page render and a crop produce a PNG.
 *
 * A machine without poppler skips with the install hint; CI installs it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addFigure,
  isPng,
  readFigureBytes,
  renderFigure,
} from "../../src/services/lockin/figures";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const hasPoppler = Bun.which("pdftoppm", { PATH: process.env.PATH ?? "" }) !== null;

/** A one-page PDF with a Helvetica "Hello"; poppler repairs the missing xref. */
const PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 20 50 Td (Hello) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
trailer
<< /Root 1 0 R /Size 6 >>
%%EOF
`;

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(TEMP_BASE, "figures-it-"));
  await mkdir(join(folder, "sources"), { recursive: true });
  await writeFile(join(folder, "sources", "lecture.pdf"), PDF);
});

afterEach(async () => {
  await removeTemp(folder);
});

describe("pdftoppm", () => {
  test.skipIf(!hasPoppler)("renders a full page and a crop", async () => {
    const page = await renderFigure({
      page: 1,
      sourcePath: join(folder, "sources", "lecture.pdf"),
      outputPrefix: join(folder, "page"),
      dpi: 110,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(isPng(page.value)).toBe(true);
    expect(page.value.length).toBeGreaterThan(100);

    const crop = await renderFigure({
      page: 1,
      x: 0,
      y: 0,
      width: 80,
      height: 50,
      sourcePath: join(folder, "sources", "lecture.pdf"),
      outputPrefix: join(folder, "crop"),
      dpi: 110,
    });
    expect(crop.ok).toBe(true);
    if (crop.ok) expect(isPng(crop.value)).toBe(true);

    const added = await addFigure(folder, {
      source: "sources/lecture.pdf",
      crop: { page: 1, x: 0, y: 0, width: 80, height: 50 },
      caption: "Hello",
      note: "",
      bytes: crop.ok ? crop.value : page.value,
      now: new Date(),
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const bytes = await readFigureBytes(folder, added.value);
    expect(bytes.ok).toBe(true);
  });

  test("a missing tool is one actionable refusal", async () => {
    const result = await renderFigure({
      page: 1,
      sourcePath: join(folder, "sources", "lecture.pdf"),
      outputPrefix: join(folder, "none"),
      dpi: 110,
      tool: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("tool-missing");
    expect(result.error.message).toContain("poppler");
  });
});
