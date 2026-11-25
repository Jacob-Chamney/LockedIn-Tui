/**
 * The learning graph: a read-only projection of the artifacts this workspace
 * already owns.
 *
 * This is not an extraction pipeline and it never reads model prose to invent
 * nodes. Every node is a thing on disk — a goal, a teaching step, a copied
 * source, a lock-in session, its steps, a flashcard, a research brief, a figure
 * — and every edge is a relation we can prove from the files:
 *
 *   goal ─contains→ step          step ─cites→ source
 *   source ─bound-to→ goal        step ─tests→ (check verdict in detail)
 *   session ─contains→ task       session ─bound-to→ source
 *   card ─tests→ session          figure ─cropped-from→ source
 *   research ─answers→ goal
 *
 * A teaching step with no citation is marked `agent` (its prose is the model's
 * explanation), which is the same honesty rule as a lesson. Deleting the graph
 * costs nothing: it is derived on read.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseProgress } from "../../domain/progress";
import type { Workspace } from "../../storage/workspace";
import { parseDeck } from "../skills/outputs";
import { readMeta } from "../skills/progress";
import { readTeaching } from "../teaching/store";
import { listResearch } from "../teaching/research";
import { readFigures } from "../lockin/figures";
import { openSession } from "../lockin/manager";

export type LearningSide = "school" | "skills";

export type LearningNodeKind =
  | "goal"
  | "step"
  | "source"
  | "session"
  | "task"
  | "card"
  | "research"
  | "figure";

/** How a node's content is justified. */
export type Grounding = "source" | "agent" | "record";

export type LearningNode = {
  id: string;
  kind: LearningNodeKind;
  label: string;
  /** One short line of state; never a body. */
  detail: string;
  side: LearningSide;
  /** The goal or session name this node belongs to. */
  context: string;
  grounded: Grounding;
};

export type LearningEdgeKind =
  | "contains"
  | "bound-to"
  | "cites"
  | "tests"
  | "answers"
  | "cropped-from";

export type LearningEdge = {
  from: string;
  to: string;
  kind: LearningEdgeKind;
};

export type LearningGraph = {
  nodes: LearningNode[];
  edges: LearningEdge[];
  counts: Record<LearningNodeKind, number>;
  diagnostics: string[];
  /** True when the node cap was reached; the list is still usable. */
  truncated: boolean;
};

/** A graph with no rows, for a pane that mounts before its data arrives. */
export const EMPTY_LEARNING_GRAPH: LearningGraph = {
  nodes: [],
  edges: [],
  counts: {
    goal: 0,
    step: 0,
    source: 0,
    session: 0,
    task: 0,
    card: 0,
    research: 0,
    figure: 0,
  },
  diagnostics: [],
  truncated: false,
};

/** The display cap. A graph larger than this is a broken workspace, not a page. */
export const MAX_GRAPH_NODES = 2000;

type GoalSource = { name: string; storedPath: string; hash: string; kind: string };

async function folders(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceId(scope: string, source: GoalSource, index: number): string {
  const key = source.hash.trim() !== "" ? source.hash : source.storedPath.trim() || `source-${index}`;
  return `source:${scope}:${key}`;
}

function goalSources(meta: Record<string, unknown>): GoalSource[] {
  if (!Array.isArray(meta.sources)) return [];
  const sources: GoalSource[] = [];
  for (const entry of meta.sources) {
    if (!isRecord(entry)) continue;
    const name = typeof entry.name === "string" ? entry.name : "";
    if (name === "") continue;
    sources.push({
      name,
      storedPath: typeof entry.stored_path === "string" ? entry.stored_path : typeof entry.storedPath === "string" ? entry.storedPath : "",
      hash: typeof entry.hash === "string" ? entry.hash : "",
      kind: typeof entry.kind === "string" ? entry.kind : "file",
    });
  }
  return sources;
}

/** A short, stable label: the file name and its kind. */
function sourceLabel(source: GoalSource): string {
  return source.name;
}

function detailOf(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.trim() !== "").join(" · ");
}

/**
 * Build the graph from the workspace.
 *
 * A folder that cannot be read is a diagnostic and is skipped; one broken goal
 * never hides the rest. The result is sorted deterministically, so two reads of
 * an unchanged workspace are identical.
 */
export async function loadLearningGraph(workspace: Workspace): Promise<LearningGraph> {
  const nodes = new Map<string, LearningNode>();
  const edges: LearningEdge[] = [];
  const diagnostics: string[] = [];
  let truncated = false;

  const addNode = (node: LearningNode): boolean => {
    if (nodes.has(node.id)) return true;
    if (nodes.size >= MAX_GRAPH_NODES) {
      truncated = true;
      return false;
    }
    nodes.set(node.id, node);
    return true;
  };
  const addEdge = (edge: LearningEdge) => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
    if (edges.some((entry) => entry.from === edge.from && entry.to === edge.to && entry.kind === edge.kind)) return;
    edges.push(edge);
  };

  // --- Goal side -----------------------------------------------------------
  for (const folder of await folders(workspace.paths.goals)) {
    const id = folder.split(/[\\/]/).pop() ?? "";
    const metaResult = await readMeta(folder);
    if (!metaResult.ok) {
      diagnostics.push(`goal "${id}" could not be read: ${metaResult.error.message}`);
      continue;
    }
    const { meta, goal } = metaResult.value;
    const goalNodeId = `goal:${id}`;
    const name = (typeof meta.name === "string" && meta.name.trim() !== "" ? meta.name : goal.statement || id).trim();
    if (!addNode({ id: goalNodeId, kind: "goal", label: name, detail: "goal", side: "skills", context: name, grounded: "record" })) {
      continue;
    }
    const sources = goalSources(meta);
    const sourceByName = new Map<string, string>();
    for (const [index, source] of sources.entries()) {
      const nodeId = sourceId(id, source, index);
      addNode({
        id: nodeId,
        kind: "source",
        label: sourceLabel(source),
        detail: detailOf(source.kind, source.hash.startsWith("sha256:") ? source.hash.slice(0, 15) : source.hash),
        side: "skills",
        context: name,
        grounded: "source",
      });
      sourceByName.set(source.name.trim().toLowerCase(), nodeId);
      addEdge({ from: nodeId, to: goalNodeId, kind: "bound-to" });
    }

    const teaching = await readTeaching(folder);
    if (!teaching.ok) {
      diagnostics.push(`goal "${id}" teaching record: ${teaching.error.message}`);
    } else if (teaching.value !== null) {
      const record = teaching.value;
      const passed = new Set(record.checks.filter((check) => check.verdict === "correct").map((check) => check.stepId));
      for (const [index, step] of record.state.plan.entries()) {
        const stepNodeId = `step:${id}:${step.id}`;
        const citations =
          record.current?.stepId === step.id
            ? record.current.citations
            : record.checks.find((check) => check.stepId === step.id)?.citations;
        const cited = (citations ?? []).length > 0;
        addNode({
          id: stepNodeId,
          kind: "step",
          label: step.title,
          detail: detailOf(`${index + 1} of ${record.state.plan.length}`, passed.has(step.id) ? "held" : "open", cited ? "cited" : "agent explanation"),
          side: "skills",
          context: name,
          grounded: cited ? "source" : "agent",
        });
        addEdge({ from: goalNodeId, to: stepNodeId, kind: "contains" });
        for (const citation of citations ?? []) {
          const sourceNode = sourceByName.get(citation.name.trim().toLowerCase());
          if (sourceNode) addEdge({ from: stepNodeId, to: sourceNode, kind: "cites" });
        }
      }
    }

    const research = await listResearch(folder);
    if (!research.ok) {
      diagnostics.push(`goal "${id}" research: ${research.error.message}`);
    } else {
      for (const item of research.value) {
        const nodeId = `research:${id}:${item.id}`;
        addNode({
          id: nodeId,
          kind: "research",
          label: item.question,
          detail: `${item.sources.length} source${item.sources.length === 1 ? "" : "s"}`,
          side: "skills",
          context: name,
          grounded: "source",
        });
        addEdge({ from: nodeId, to: goalNodeId, kind: "answers" });
      }
    }
  }

  // --- School side ---------------------------------------------------------
  for (const folder of await folders(workspace.paths.schoolSessions)) {
    const id = folder.split(/[\\/]/).pop() ?? "";
    const opened = await openSession({ workspace, id });
    if (!opened.ok) {
      diagnostics.push(`session "${id}" could not be opened: ${opened.error.message}`);
      continue;
    }
    const session = opened.value.session;
    const sessionNodeId = `session:${id}`;
    if (!addNode({ id: sessionNodeId, kind: "session", label: session.name, detail: session.archived ? "archived" : "session", side: "school", context: session.name, grounded: "record" })) {
      continue;
    }

    const sourceByStoredPath = new Map<string, string>();
    for (const [index, source] of session.sources.entries()) {
      const nodeId = `source:${id}:${source.hash || source.storedPath || index}`;
      addNode({
        id: nodeId,
        kind: "source",
        label: source.name,
        detail: detailOf(source.kind, source.hash.startsWith("sha256:") ? source.hash.slice(0, 15) : source.hash),
        side: "school",
        context: session.name,
        grounded: "source",
      });
      sourceByStoredPath.set(source.storedPath, nodeId);
      addEdge({ from: nodeId, to: sessionNodeId, kind: "bound-to" });
    }

    const stepsPath = join(folder, "assignment-steps.md");
    try {
      const markdown = await readFile(stepsPath, "utf8");
      const parsed = parseProgress(markdown);
      if (!parsed.ok) {
        diagnostics.push(`session "${id}" steps: ${parsed.error.message}`);
      } else {
        for (const item of parsed.value.items) {
          const nodeId = `task:${id}:${item.index}`;
          addNode({
            id: nodeId,
            kind: "task",
            label: item.text,
            detail: item.checked ? "done" : "open",
            side: "school",
            context: session.name,
            grounded: "record",
          });
          addEdge({ from: sessionNodeId, to: nodeId, kind: "contains" });
        }
      }
    } catch {
      // No steps file is a valid session state, not a diagnostic.
    }

    const deckPath = join(workspace.paths.root, "school", "outputs", id, "flashcards.md");
    try {
      const deck = parseDeck(await readFile(deckPath, "utf8"));
      for (const [index, card] of deck.entries()) {
        const nodeId = `card:${id}:card-${index + 1}`;
        addNode({
          id: nodeId,
          kind: "card",
          label: card.question,
          detail: card.known ? "known" : card.missed ? "missed" : "unseen",
          side: "school",
          context: session.name,
          grounded: "record",
        });
        addEdge({ from: nodeId, to: sessionNodeId, kind: "tests" });
      }
    } catch {
      // No deck is valid.
    }

    const figures = await readFigures(folder);
    if (!figures.ok) {
      diagnostics.push(`session "${id}" figures: ${figures.error.message}`);
    } else {
      for (const figure of figures.value) {
        const nodeId = `figure:${id}:${figure.id}`;
        addNode({
          id: nodeId,
          kind: "figure",
          label: figure.caption.trim() === "" ? `figure ${figure.id}` : figure.caption,
          detail: `page ${figure.page}`,
          side: "school",
          context: session.name,
          grounded: "record",
        });
        const sourceNode = sourceByStoredPath.get(figure.source);
        if (sourceNode) addEdge({ from: nodeId, to: sourceNode, kind: "cropped-from" });
        else addEdge({ from: nodeId, to: sessionNodeId, kind: "bound-to" });
      }
    }
  }

  const orderedNodes = [...nodes.values()].sort((a, b) => {
    if (a.side !== b.side) return a.side < b.side ? -1 : 1;
    const context = a.context.localeCompare(b.context);
    if (context !== 0) return context;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });
  const orderedEdges = edges.sort((a, b) => {
    const from = a.from.localeCompare(b.from);
    if (from !== 0) return from;
    const to = a.to.localeCompare(b.to);
    if (to !== 0) return to;
    return a.kind.localeCompare(b.kind);
  });

  const counts: Record<LearningNodeKind, number> = {
    goal: 0,
    step: 0,
    source: 0,
    session: 0,
    task: 0,
    card: 0,
    research: 0,
    figure: 0,
  };
  for (const node of orderedNodes) counts[node.kind] += 1;

  return {
    nodes: orderedNodes,
    edges: orderedEdges,
    counts,
    diagnostics,
    truncated,
  };
}
