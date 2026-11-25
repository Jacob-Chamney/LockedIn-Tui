/**
 * The compaction summary for one session chat.
 *
 * `<session>/context.json`, beside `chat.jsonl`. It is a **view** used to build
 * the next request, not a second transcript: the log stays append-only, and
 * deleting this file simply sends the full history again.
 *
 * The write is atomic, and a corrupt file is reported rather than silently
 * ignored — sending the wrong summary is worse than skipping compaction.
 */
import { rename, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "../../domain/markdown";
import type { ContextPlan } from "../../domain/context";

export const CONTEXT_FILE = "context.json";

export type ContextStoreError = { kind: "storage"; path: string; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function contextPath(folder: string): string {
  return join(folder, CONTEXT_FILE);
}

export async function readContextPlan(
  folder: string,
): Promise<Result<ContextPlan | null, ContextStoreError>> {
  const path = contextPath(folder);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { ok: true, value: null };
    return {
      ok: false,
      error: {
        kind: "storage",
        path,
        message: `the context summary cannot be read (${messageOf(error)})`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: { kind: "storage", path, message: `context.json is not valid JSON (${messageOf(error)})` },
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: { kind: "storage", path, message: "context.json is not an object" } };
  }
  const record = parsed as Partial<ContextPlan> & { schema?: unknown };
  if (
    record.schema !== 1 ||
    typeof record.summary !== "string" ||
    typeof record.through !== "number" ||
    !Number.isFinite(record.through)
  ) {
    return {
      ok: false,
      error: { kind: "storage", path, message: "context.json does not have the summary shape" },
    };
  }
  return {
    ok: true,
    value: {
      summary: record.summary,
      through: Math.max(0, Math.floor(record.through)),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    },
  };
}

export async function writeContextPlan(
  folder: string,
  plan: ContextPlan,
): Promise<Result<ContextPlan, ContextStoreError>> {
  const path = contextPath(folder);
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  const body = `${JSON.stringify({ schema: 1, ...plan }, null, 2)}\n`;
  try {
    await writeFile(temporary, body, "utf8");
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
  return { ok: true, value: plan };
}

export async function clearContextPlan(
  folder: string,
): Promise<Result<null, ContextStoreError>> {
  try {
    await rm(contextPath(folder), { force: true });
  } catch (error) {
    return { ok: false, error: { kind: "storage", path: contextPath(folder), message: messageOf(error) } };
  }
  return { ok: true, value: null };
}
