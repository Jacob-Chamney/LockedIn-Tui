/** Skill-session reads and writes used by the shell. */
import type { Course } from "../../services/skills/course"
import {
  coursePaths,
  createCourse,
  markChapter,
  readChapter,
  readCourse,
} from "../../services/skills/course"
import { deleteGoal } from "../../services/skills/delete"
import { listGoals } from "../../services/skills/progress"
import { deleteChat, listChats, openChat, readChat } from "../../services/skills/chats"
import { gatherSources } from "../../services/skills/gather"
import { createSkillsToolbox, skillsToolSpecs } from "../../services/skills/toolbox"
import type { Workspace } from "../../storage/workspace"
import type { ChatToolSource } from "./projects"

export type GoalListRow = {
  id: string
  name: string
  stage: { done: number; total: number }
  chapters?: { done: number; total: number }
  lastOpened: string
  chats: number
  archived: boolean
  broken?: string
}

export type SkillChatRow = { id: string; title: string; lastUsed: string; messages: number }

/**
 * The read-only toolbox and system context for one skill goal.
 *
 * A skill chat may cite only its own gathered sources; the toolbox is bound to
 * `<goals>/<id>/sources` and the context is that same set flattened. The wall is
 * the toolbox binding, not a sentence in the prompt.
 */
/** Copy picked files into a goal's `sources/`, skipping duplicates by hash. */
export async function gatherSkillSources(input: {
  workspace: Workspace
  goalId: string
  files: readonly string[]
  retrievedAt: string
}): Promise<{ ok: true; added: number; skipped: number } | { ok: false; message: string }> {
  const result = await gatherSources(
    { workspace: input.workspace, goalId: input.goalId, retrievedAt: input.retrievedAt },
    input.files.map((path) => ({ kind: "file" as const, path })),
  )
  if (!result.ok) return { ok: false, message: result.error.message }
  return { ok: true, added: result.value.added, skipped: result.value.skipped.length }
}

export function skillTools(input: { workspace: Workspace; goalId: string }): ChatToolSource {
  let box: ReturnType<typeof createSkillsToolbox> | null = null
  const toolbox = () => (box ??= createSkillsToolbox(input))
  return {
    // The toolbox's schema type is intentionally narrower than `ToolSpec`; the
    // specs are already validated by the toolbox, so the cast is structural.
    specs: skillsToolSpecs() as unknown as import("../../llm/tools").ToolSpec[],
    resolveTool: async (name, args) => {
      const tools = toolbox().tools
      switch (name) {
        case "list_sources": {
          const listed = await tools.listSources()
          return JSON.stringify(listed)
        }
        case "read_source": {
          const source = typeof args.name === "string" ? args.name : ""
          return JSON.stringify(await tools.readSource(source))
        }
        case "search_sources": {
          const term = typeof args.term === "string" ? args.term : ""
          return JSON.stringify(await tools.searchSources(term))
        }
        default:
          return JSON.stringify({
            ok: false,
            error: { kind: "blocked", message: `unknown tool "${name}"`, next: "Use list_sources, read_source or search_sources." },
          })
      }
    },
    context: async () => {
      const listed = await toolbox().tools.listSources()
      if (!listed.ok || listed.value.length === 0) {
        return [
          "You are helping inside a skill session.",
          "Teach the skill with your own explanations and examples, and use the web to check current facts and find good references.",
          "No learner sources have been gathered yet; say when a fact came from the web, and label your own explanations as (agent explanation).",
        ].join("\n")
      }
      const chunks: string[] = []
      let bytes = 0
      for (const source of listed.value) {
        if (source.unusable || bytes >= 120_000) continue
        const read = await toolbox().tools.readSource(source.name)
        if (!read.ok) continue
        const chunk = `## ${source.name}${source.origin ? ` (${source.origin})` : ""}\n\n${read.value.text}`
        if (bytes + chunk.length > 120_000) break
        chunks.push(chunk)
        bytes += chunk.length
      }
      if (chunks.length === 0) {
        return [
          "You are helping inside a skill session.",
          "Teach the skill with your own explanations and examples, and use the web to check current facts and find good references.",
          "The goal's gathered sources have no readable text; say when a fact came from the web, and label your own explanations as (agent explanation).",
        ].join("\n")
      }
      return [
        "You are helping inside a skill session.",
        "Teach the skill with your own explanations and examples, and use the web to check current facts and find good references.",
        "Use the gathered sources below for facts about the learner's own material; label anything beyond them as (agent explanation), and label web results as external.",
        "",
        chunks.join("\n\n"),
      ].join("\n")
    },
  }
}

export async function loadGoalRows(workspace: Workspace): Promise<GoalListRow[]> {
  const rows = await listGoals({ workspace })
  return rows.map((row) => ({
    id: row.id,
    name: row.name || row.id,
    stage: { done: row.stagesDone, total: row.stageCount },
    ...(row.chapters ? { chapters: row.chapters } : {}),
    lastOpened: row.lastOpenedAt,
    chats: row.chatCount,
    archived: row.archived,
    ...(row.broken ? { broken: row.reason ?? "cannot be read" } : {}),
  }))
}

export async function loadCourse(workspace: Workspace, id: string): Promise<Course | null> {
  const loaded = await readCourse(workspace, id)
  return loaded.ok ? loaded.value : null
}

export async function loadChapter(
  workspace: Workspace,
  course: Course,
  chapterId: string,
  practical: boolean,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const result = await readChapter(course, coursePaths(workspace, course), chapterId, practical)
  return result.ok ? { ok: true, text: result.value } : { ok: false, message: result.error.message }
}

export async function setChapterDone(
  workspace: Workspace,
  course: Course,
  chapterId: string,
  done: boolean,
): Promise<{ ok: true; course: Course } | { ok: false; message: string }> {
  const result = await markChapter({ workspace, course, chapterId, done })
  return result.ok ? { ok: true, course: result.value } : { ok: false, message: result.error.message }
}

export async function deleteSkillGoal(
  workspace: Workspace,
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await deleteGoal({ workspace, id, confirmed: true })
  return result.ok ? { ok: true } : { ok: false, message: result.error.message }
}

export async function loadSkillChats(workspace: Workspace, goalId: string): Promise<SkillChatRow[]> {
  const listed = await listChats(workspace, goalId)
  if (!listed.ok) return []
  return Promise.all(
    listed.value.map(async (id) => {
      const read = await readChat({ workspace, goalId, chatId: id })
      const records = read.ok ? read.value : []
      const first = records.find((record) => record.role === "user")?.content ?? id
      return {
        id,
        title: first.slice(0, 60),
        lastUsed: records.at(-1)?.at ?? "",
        messages: records.length,
      }
    }),
  )
}


export function createSkillCourse(input: Parameters<typeof createCourse>[0]): ReturnType<typeof createCourse> {
  return createCourse(input)
}


/** Create a fresh chat in a goal and return its id. */
export async function createSkillChat(input: {
  workspace: Workspace
  goalId: string
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const opened = await openChat({ workspace: input.workspace, goalId: input.goalId })
  return opened.ok ? { ok: true, id: opened.value.id } : { ok: false, message: opened.error.message }
}

export async function deleteSkillChat(input: {
  workspace: Workspace
  goalId: string
  chatId: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await deleteChat({ ...input, confirmed: true })
  return result.ok ? { ok: true } : { ok: false, message: result.error.message }
}

/** Names of the sources already gathered into one goal. */
export async function loadGoalSourceNames(workspace: Workspace, goalId: string): Promise<string[]> {
  const listed = await createSkillsToolbox({ workspace, goalId }).tools.listSources()
  return listed.ok ? listed.value.map((source) => source.name) : []
}
