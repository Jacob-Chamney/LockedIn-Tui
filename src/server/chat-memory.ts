import { normalisePoint } from "../services/lockin/memory";
import type { ChatState } from "./chat-wire";

/**
 * The per-turn cap for extracted session memory (`docs/product.md` §4.5).
 *
 * These are the extractor's own bounds. The store applies its own, narrower
 * per-turn cap inside `recordTurn`; a point the extractor emits but the store
 * bounds away is simply not kept this turn.
 */
export const MEMORY_POINTS_PER_TURN = 5;
export const MEMORY_POINT_CHARS = 200;

/** A fenced code block: the fence line and everything up to the closing fence. */
const FENCE_LINE = /^\s*(?:```|~~~)/;
/** A Markdown list item, bulleted or numbered; the indent is kept in the match. */
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;

/**
 * Strip one line's Markdown so a memory point is plain prose.
 *
 * Emphasis markers, inline-code backticks, link/image targets and heading or
 * quote prefixes carry no meaning once the answer is a bullet in `memory.md`,
 * so they are removed; the text inside them is kept.
 */
export function cleanPointLine(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    // Single-character emphasis, only where it wraps a word rather than a
    // snake_case name or an arithmetic `2 * 3`.
    .replace(/(^|[^\w])[*_]([^*_\s][^*_]*?)[*_](?=[^\w]|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s{0,3}>\s?/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shorten one point to a single line within `MEMORY_POINT_CHARS`. */
export function boundPoint(point: string): string {
  const single = point.replace(/\s+/g, " ").trim();
  return single.length > MEMORY_POINT_CHARS
    ? `${single.slice(0, MEMORY_POINT_CHARS - 1)}…`
    : single;
}

/**
 * The deterministic key points of one completed answer.
 *
 * No model call and no cost: the answer's own prose is the input, so the same
 * text always yields the same points. Fenced code is dropped (it is not a
 * sentence a learner reviews), list items are preferred over prose, and
 * otherwise the first sentences are taken. Each point is one line of at most
 * `MEMORY_POINT_CHARS`, empties and duplicates are dropped, and the document
 * order is preserved.
 *
 * Exported for the protocol's own unit tests; it is not part of the wire
 * contract.
 */
export function extractMemoryPoints(text: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (FENCE_LINE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    lines.push(raw);
  }

  const bullets: string[] = [];
  const prose: string[] = [];
  for (const raw of lines) {
    const bullet = LIST_LINE.exec(raw);
    if (bullet !== null) {
      bullets.push(bullet[1] ?? "");
      continue;
    }
    // A heading, a table row or a blank line is structure, not a sentence: it
    // must not be glued onto the prose that follows it.
    if (/^\s*#{1,6}\s+/.test(raw) || /^\s*\|/.test(raw) || raw.trim() === "") continue;
    prose.push(raw);
  }

  const candidates = bullets.length > 0 ? bullets : prose.join(" ").split(/(?<=[.!?])\s+/);

  const seen = new Set<string>();
  const points: string[] = [];
  for (const candidate of candidates) {
    if (points.length >= MEMORY_POINTS_PER_TURN) break;
    const point = boundPoint(cleanPointLine(candidate));
    if (point === "") continue;
    const key = normalisePoint(point);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }
  return points;
}

/** The last completed assistant answer, never a streamed partial or a tool step. */
export function finalAnswerText(state: ChatState): string {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message === undefined) continue;
    if (message.role === "assistant" && message.outcome === "done" && message.text.trim() !== "") {
      return message.text;
    }
  }
  return "";
}

export type StoredMemory = { points: string[]; folded: string[]; updated: string };

/** The session memory shape `session.open` returns; `null` when none is stored. */
/** The memory half of a `session.open` projection (history, never a source). */
export type SessionMemoryView = {
  points: string[];
  folded: string[];
  updated: string;
};

export function memoryRow(memory: StoredMemory | null): SessionMemoryView | null {
  if (memory === null) return null;
  return { points: [...memory.points], folded: [...memory.folded], updated: memory.updated };
}

