/**
 * Figures cropped out of a session's own PDF.
 *
 * A lecture slide's diagram is often the clearest explanation in the source, and
 * copying it by hand loses the page provenance. This service renders one page
 * (or one crop of it) with `pdftoppm`, stores the PNG inside the session and
 * records the page, the crop box, a caption and a note beside it.
 *
 * Security: the PDF must be one of the session's own copied sources, the path is
 * resolved and confined, the page and crop are bounded integers, and the process
 * is spawned with an argv list — no shell. The output must be a PNG and is size
 * capped.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import type { Result } from "../../domain/markdown";

export const FIGURES_DIR = "figures";
export const FIGURE_INDEX = "index.json";
export const MAX_FIGURE_BYTES = 8 * 1024 * 1024;
export const MIN_DPI = 72;
export const MAX_DPI = 200;
export const DEFAULT_DPI = 110;
export const MAX_PAGE = 500;

export type FigureCrop = {
  page: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  dpi?: number;
};

export type SessionFigure = {
  id: string;
  /** Session-relative stored path of the source PDF. */
  source: string;
  page: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  caption: string;
  note: string;
  file: string;
  createdAt: string;
};

export type FigureError =
  | { kind: "validation"; message: string }
  | { kind: "tool-missing"; message: string }
  | { kind: "malformed"; message: string }
  | { kind: "storage"; path: string; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function figuresDir(sessionFolder: string): string {
  return join(sessionFolder, FIGURES_DIR);
}

export function figureIndexPath(sessionFolder: string): string {
  return join(figuresDir(sessionFolder), FIGURE_INDEX);
}

/** True for a PNG's first eight bytes. */
export function isPng(bytes: Uint8Array): boolean {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= 8 && magic.every((byte, index) => bytes[index] === byte);
}

/**
 * Validate a crop request. Numbers are bounded integers; a partial crop is
 * refused rather than guessed, so a figure cannot silently move.
 */
export function validateCrop(
  input: FigureCrop,
): { ok: true; crop: FigureCrop; dpi: number } | { ok: false; message: string } {
  const page = input.page;
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return { ok: false, message: `page must be a whole number from 1 to ${MAX_PAGE}` };
  }
  const crop = { page };
  const pairs: Array<[keyof FigureCrop, number | undefined]> = [
    ["x", input.x],
    ["y", input.y],
    ["width", input.width],
    ["height", input.height],
  ];
  const present = pairs.filter(([, value]) => value !== undefined).length;
  if (present !== 0 && present !== 4) {
    return { ok: false, message: "a crop needs x, y, width and height together" };
  }
  for (const [key, value] of pairs) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, message: `${key} must be a whole number of pixels` };
    }
    if ((key === "width" || key === "height") && value < 1) {
      return { ok: false, message: `${key} must be at least 1 pixel` };
    }
    if (value > 10_000) {
      return { ok: false, message: `${key} is larger than 10000 px` };
    }
    (crop as Record<string, unknown>)[key] = value;
  }
  const dpi = input.dpi ?? DEFAULT_DPI;
  if (!Number.isInteger(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) {
    return { ok: false, message: `dpi must be a whole number from ${MIN_DPI} to ${MAX_DPI}` };
  }
  return { ok: true, crop, dpi };
}

export type RenderInput = FigureCrop & {
  /** Absolute path to the copied PDF. */
  sourcePath: string;
  /** Absolute prefix for the output; pdftoppm writes `<prefix>.png`. */
  outputPrefix: string;
  dpi: number;
  tool?: string | null;
};

/** `pdftoppm`'s argv for one page or one crop. Never a shell string. */
export function pdftoppmArgs(input: RenderInput): string[] {
  const args = ["-png", "-r", String(input.dpi), "-f", String(input.page), "-l", String(input.page), "-singlefile"];
  if (
    input.x !== undefined &&
    input.y !== undefined &&
    input.width !== undefined &&
    input.height !== undefined
  ) {
    args.push("-x", String(input.x), "-y", String(input.y), "-W", String(input.width), "-H", String(input.height));
  }
  args.push(input.sourcePath, input.outputPrefix);
  return args;
}

/** Render one page/crop. The caller validates first; this only runs the tool. */
export async function renderFigure(
  input: RenderInput,
): Promise<Result<Uint8Array, FigureError>> {
  const tool =
    input.tool === null
      ? null
      : typeof input.tool === "string"
        ? input.tool
        : Bun.which("pdftoppm", { PATH: process.env.PATH ?? "" });
  if (tool === null) {
    return {
      ok: false,
      error: {
        kind: "tool-missing",
        message:
          "figures need `pdftoppm` (poppler) on PATH. Install poppler-utils " +
          "(Debian/Ubuntu) or poppler (Homebrew), then try again.",
      },
    };
  }
  const run = Bun.spawnSync({
    cmd: [tool, ...pdftoppmArgs(input)],
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${input.outputPrefix}.png`;
  if (run.exitCode !== 0) {
    await rm(output, { force: true }).catch(() => {});
    const detail = run.stderr.toString().trim().split("\n")[0] ?? "";
    return {
      ok: false,
      error: {
        kind: "malformed",
        message: `the PDF page could not be rendered${detail === "" ? "" : `: ${detail}`}`,
      },
    };
  }
  try {
    const bytes = await readFile(output);
    if (bytes.length > MAX_FIGURE_BYTES) {
      return {
        ok: false,
        error: { kind: "malformed", message: `the figure is larger than ${MAX_FIGURE_BYTES / 1024 / 1024} MB` },
      };
    }
    if (!isPng(bytes)) {
      return { ok: false, error: { kind: "malformed", message: "pdftoppm did not produce a PNG" } };
    }
    return { ok: true, value: bytes };
  } catch (error) {
    return { ok: false, error: { kind: "malformed", message: messageOf(error) } };
  } finally {
    // The caller keeps the bytes; the render's temporary file never survives.
    await rm(output, { force: true }).catch(() => {});
  }
}

type FigureIndex = { schema: 1; figures: SessionFigure[] };

export async function readFigures(
  sessionFolder: string,
): Promise<Result<SessionFigure[], FigureError>> {
  const path = figureIndexPath(sessionFolder);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { ok: true, value: [] };
    return { ok: false, error: { kind: "storage", path, message: messageOf(error) } };
  }
  try {
    const parsed = JSON.parse(text) as Partial<FigureIndex>;
    if (parsed.schema !== 1 || !Array.isArray(parsed.figures)) {
      return { ok: false, error: { kind: "storage", path, message: "the figure index has the wrong shape" } };
    }
    return {
      ok: true,
      value: parsed.figures.filter(
        (figure): figure is SessionFigure =>
          typeof figure === "object" &&
          figure !== null &&
          typeof figure.id === "string" &&
          typeof figure.file === "string" &&
          typeof figure.source === "string" &&
          Number.isInteger(figure.page),
      ),
    };
  } catch (error) {
    return { ok: false, error: { kind: "storage", path, message: `the figure index is not valid JSON` } };
  }
}

async function writeFigures(
  sessionFolder: string,
  figures: readonly SessionFigure[],
): Promise<Result<SessionFigure[], FigureError>> {
  const path = figureIndexPath(sessionFolder);
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await mkdir(figuresDir(sessionFolder), { recursive: true });
    await writeFile(temporary, `${JSON.stringify({ schema: 1, figures }, null, 2)}\n`, "utf8");
    const handle = await import("node:fs/promises").then((fs) => fs.open(temporary, "r+"));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    return { ok: false, error: { kind: "storage", path, message: messageOf(error) } };
  }
  return { ok: true, value: [...figures] };
}

/** Keep a copied PDF inside the session's own `sources/`. */
export function confineSource(sessionFolder: string, storedPath: string): { ok: true; path: string } | { ok: false; message: string } {
  const root = resolve(sessionFolder, "sources");
  const path = resolve(sessionFolder, storedPath);
  const rel = relative(root, path);
  if (rel.startsWith("..") || rel === "" || rel.includes("\0")) {
    return { ok: false, message: "the figure source must be a copied file inside this session's sources" };
  }
  return { ok: true, path };
}

export async function addFigure(
  sessionFolder: string,
  input: {
    source: string;
    crop: FigureCrop;
    caption: string;
    note: string;
    bytes: Uint8Array;
    now: Date;
  },
): Promise<Result<SessionFigure, FigureError>> {
  const existing = await readFigures(sessionFolder);
  if (!existing.ok) return existing;
  let next = 1;
  for (const figure of existing.value) {
    const match = /^figure-(\d+)$/.exec(figure.id);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  const id = `figure-${next}`;
  const file = `${id}.png`;
  const path = join(figuresDir(sessionFolder), file);
  try {
    await mkdir(figuresDir(sessionFolder), { recursive: true });
    const temporary = `${path}.tmp-${crypto.randomUUID()}`;
    await writeFile(temporary, input.bytes);
    await rename(temporary, path);
  } catch (error) {
    return { ok: false, error: { kind: "storage", path, message: messageOf(error) } };
  }
  const figure: SessionFigure = {
    id,
    source: input.source,
    page: input.crop.page,
    ...(input.crop.x === undefined
      ? {}
      : { x: input.crop.x, y: input.crop.y, width: input.crop.width, height: input.crop.height }),
    caption: input.caption,
    note: input.note,
    file,
    createdAt: input.now.toISOString(),
  };
  const written = await writeFigures(sessionFolder, [...existing.value, figure]);
  if (!written.ok) {
    await rm(path, { force: true }).catch(() => {});
    return written;
  }
  return { ok: true, value: figure };
}

export async function annotateFigure(
  sessionFolder: string,
  id: string,
  patch: { caption?: string; note?: string },
): Promise<Result<SessionFigure, FigureError>> {
  const listed = await readFigures(sessionFolder);
  if (!listed.ok) return listed;
  const index = listed.value.findIndex((figure) => figure.id === id);
  if (index === -1) return { ok: false, error: { kind: "malformed", message: `there is no figure "${id}"` } };
  const next = listed.value.map((figure) =>
    figure.id === id
      ? {
          ...figure,
          ...(patch.caption === undefined ? {} : { caption: patch.caption }),
          ...(patch.note === undefined ? {} : { note: patch.note }),
        }
      : figure,
  );
  const written = await writeFigures(sessionFolder, next);
  if (!written.ok) return written;
  return { ok: true, value: next[index]! };
}

export async function removeFigure(
  sessionFolder: string,
  id: string,
): Promise<Result<{ removed: boolean }, FigureError>> {
  const listed = await readFigures(sessionFolder);
  if (!listed.ok) return listed;
  const figure = listed.value.find((entry) => entry.id === id);
  if (!figure) return { ok: true, value: { removed: false } };
  const written = await writeFigures(
    sessionFolder,
    listed.value.filter((entry) => entry.id !== id),
  );
  if (!written.ok) return written;
  await rm(join(figuresDir(sessionFolder), figure.file), { force: true }).catch(() => {});
  return { ok: true, value: { removed: true } };
}

export async function readFigureBytes(
  sessionFolder: string,
  figure: SessionFigure,
): Promise<Result<Uint8Array, FigureError>> {
  const path = join(figuresDir(sessionFolder), basename(figure.file));
  try {
    const bytes = await readFile(path);
    if (!isPng(bytes)) {
      return { ok: false, error: { kind: "malformed", message: `${figure.file} is not a PNG` } };
    }
    return { ok: true, value: bytes };
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "storage",
        path,
        message: codeOf(error) === "ENOENT" ? `${figure.id} has no image file` : messageOf(error),
      },
    };
  }
}
