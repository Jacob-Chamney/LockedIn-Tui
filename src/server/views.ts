import type { ProjectAgent } from "../app/actions/projects";
import type { CoverageReport } from "../domain/coverage";
import type { Source } from "../domain/source";
import type { AgentProfile } from "../services/work/agents";
import { CHAT_ID } from "../services/work/chat";
import type { InstructionsSource } from "../domain/session";
import type { OpenResult } from "../services/lockin/manager";
import type { SessionMemoryView } from "./chat-memory";
import { oneLine } from "./rpc";

/**
 * One session's coverage report, as `review.queue` carries it.
 *
 * `report` is `computeCoverage` unchanged (`src/domain/coverage.ts`): the
 * session id and name are only an address, so the shell never re-derives a
 * count, a document list or a gap.
 */
export type SessionCoverageRow = {
  sessionId: string
  name: string
  report: CoverageReport
};

/** The steps half of a `session.open` projection. */
export type SessionStepsView = {
  done: number;
  total: number;
  exists: boolean;
  markdown: string;
};

/** One row of the `work.templates.list` template picker. */
export type AgentTemplateRowView = {
  id: string;
  name: string;
  role: string;
  summary: string;
  source: string;
  instructions: string;
  maxToolCalls: number;
  allowedTools: string[];
};

/** One agent row in the `work.list` project row. */
export type WorkProjectAgentView = {
  id: string;
  name: string;
  task: string;
  model: string;
  permissions: string;
};

/** One registered Work project as `work.list` returns it. */
export type WorkProjectRowView = {
  id: string;
  name: string;
  folder: string;
  mode: string;
  swarmName: string;
  archived: boolean;
  agents: WorkProjectAgentView[];
};

/** The `work.open` project detail the Flutter shell renders. */
export type WorkProjectDetailView = {
  id: string;
  name: string;
  root: string;
  rootMissing: boolean;
  mode: string;
  swarmName: string;
  archived: boolean;
  instructions: string;
  defaultAgent: string | null;
  agents: AgentProfile[];
  tasks: number;
  hasGit: boolean;
  lastOpened: string;
};

/** The whole `session.open` detail the Flutter shell renders. */
export type SessionDetailView = {
  id: string;
  name: string;
  created: string;
  archived: boolean;
  prompt: string;
  sources: Source[];
  steps: SessionStepsView;
  memory?: SessionMemoryView;
};


/**
 * The one-line description of an agent template, for a picker row.
 *
 * It is derived from the template's own instructions, never authored twice: the
 * row can only describe what instantiating the template would fill in.
 */
export function templateSummary(instructions: string): string {
  const text = oneLine(instructions);
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** The one source shape `session.open` and `source.list` both return. */
export function sourceRows(session: OpenResult["session"]): Source[] {
  return session.sources.map((source) => ({
    name: source.name,
    originalPath: source.originalPath,
    storedPath: source.storedPath,
    hash: source.hash,
    kind: source.kind,
  }));
}

/**
 * The provenance shape for the session's instruction file.
 *
 * `instructionsSource` is the copied original, not a second prompt: `name`,
 * `storedPath`, `hash` and `kind` come from the `sources/` copy, and
 * `extractedAt`/`characters`/`pages` record the last extraction. The shell
 * never gets `originalPath`, because it only needs the copy the session owns.
 */
export function instructionsRow(source: InstructionsSource): Record<string, unknown> {
  return {
    name: source.name,
    storedPath: source.storedPath,
    hash: source.hash,
    kind: source.kind,
    extractedAt: source.extractedAt,
    ...(source.characters === undefined ? {} : { characters: source.characters }),
    ...(source.pages === undefined ? {} : { pages: source.pages }),
  };
}

/** One project row, shared by `work.list` rows and `work.open` agents. */
export function projectAgentRows(agents: ProjectAgent[]): WorkProjectAgentView[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    task: agent.task,
    model: agent.model,
    permissions: agent.permissions,
  }));
}

/**
 * The next free `chat-<n>` id for a project.
 *
 * `src/services/work/chat.ts` keeps its own copy private; the protocol needs the
 * same rule for `work.chat.open` when the user has not chosen a chat yet, and
 * duplicating five lines here is cheaper than widening that module's surface for
 * this packet. The ids are always `chat-<n>` (`CHAT_ID`), so the two cannot
 * disagree on what a valid id looks like.
 */
export function nextProjectChatId(existing: readonly string[]): string {
  let highest = 0;
  for (const id of existing) {
    const match = CHAT_ID.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `chat-${highest + 1}`;
}

