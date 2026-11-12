/** Per-pane keys, in the shell's priority order. */
import { blockCount } from "../../ui/reader/markdown-body"
import { hiddenCount, type ChatState } from "../../ui/chat/model"
import { cancelNotice } from "../../ui/features/tasks/tasks-panel"
import {
  arm as armSession,
  cancelPending as cancelSessionPending,
  confirm as confirmSession,
  warningFor as sessionWarning,
  type SessionsState,
} from "../../ui/features/sessions"
import {
  arm as armSkill,
  cancelPending as cancelSkill,
  confirm as confirmSkill,
  warningFor as skillWarning,
  type SkillsState,
} from "../../ui/features/skills"
import type { SettingsView } from "../../ui/settings"
import type { Prompt } from "../../ui/overlays/prompt"
import { confirmPending as confirmProjectPending, type PendingAction } from "../../ui/panels/pending"
import type { PanelRow } from "../../ui/panels/panel-list"
import type { ScrollApi } from "../../ui/scroll"
import { agentSidebarVisible, type ShellState } from "../../ui/shell/state"
import type { SwarmSummary } from "../../ui/shell/explorer"
import type { PickerState } from "../../services/lockin/picker"
import type { Course } from "../../services/skills/course"
import type { Workspace } from "../../storage/workspace"
import type { TaskRegistry } from "../../domain/tasks"
import type { ArchiveBackend, ArchiveError } from "../../archive/types"
import type { Result } from "../../domain/markdown"
import type { ChatController } from "../chat-controller"
import { HOME_BUFFER, type WorkBuffer } from "../buffers"
import { runSessionAction } from "../actions/archive"
import { managerIntent } from "../../ui/managers/manager-actions"
import { deleteSkillChat } from "../actions/skills"
import type { ShellPress } from "../keys/press"

export type PaneKeyDeps = {
  workspace?: Workspace
  createGithubArchive?: () => Promise<Result<ArchiveBackend, ArchiveError>>
  taskRegistry: () => TaskRegistry
  taskCursor: () => number
  taskCancelArmed: () => string | null
  setTaskCancelArmed: (id: string | null) => void
  notify: (text: string, level?: "info" | "warn" | "error") => void
  skillsState: () => SkillsState
  setSkillsState: (value: SkillsState | ((current: SkillsState) => SkillsState)) => void
  openCourse: (id: string, name: string) => Promise<void>
  openSkillChat: (goalId: string, goalName: string, chatId: string) => void
  newSkillChat: (goalId: string, goalName: string) => Promise<void>
  agentTemplates: () => Promise<Array<{ id: string; name: string; role: string }>>
  setAgentTemplateChoice: (
    templates: Array<{ id: string; name: string; role: string }>,
    projectId: string,
  ) => void
  setDefaultAgentForProject: (projectId: string, agentId: string) => Promise<void>
  reviewItems: () => import("../../domain/review").ReviewItem[]
  pluginRows: () => import("../../ui/features/mcp/mcp-model").ServerRow[]
  pluginCursor: () => number
  setPluginCursor: (value: number | ((cursor: number) => number)) => void
  connectPlugin: (id: string) => Promise<void>
  closePlugin: (id: string) => Promise<void>
  togglePlugin: (id: string) => Promise<void>
  refreshPlugins: () => Promise<unknown>
  archiveSkillGoal: (id: string, name: string) => Promise<void>
  exportSkillGoal: (id: string, name: string) => Promise<void>
  removeGoal: (id: string, name: string) => Promise<void>
  setPrompt: (prompt: Prompt | null) => void
  update: (state: ShellState) => void
  chatScroll: () => ScrollApi | null
  dims: () => { width: number; height: number }
  openChapter: () => { id: string; practical: boolean } | null
  chapterText: () => string
  setReaderOffset: (value: number | ((offset: number) => number)) => void
  course: () => Course | null
  setOpenChapter: (value: { id: string; practical: boolean } | null) => void
  setChapterText: (value: string) => void
  toggleChapter: (course: Course, chapterId: string, practical: boolean) => Promise<void>
  openChapterAt: (course: Course, chapterId: string, practical: boolean) => Promise<void>
  setChapterCursor: (updater: (cursor: number) => number) => void
  chapterCursor: () => number
  projects: () => Array<{ id: string; name: string; folder: string; mode: string; archived?: boolean }>
  projectPending: () => PendingAction | null
  setProjectPending: (value: PendingAction | null) => void
  archiveProject: (id: string, name: string) => void
  deleteProject: (id: string, name: string) => void
  exportProject: (id: string, name: string) => Promise<void>
  openSwarm: () => string | null
  setOpenSwarm: (id: string | null) => void
  sidebarCursor: () => number
  setSidebarCursor: (value: number | ((cursor: number) => number)) => void
  listCursors: () => Record<string, number>
  swarms: () => SwarmSummary[]
  setEditingAgent: (id: string | null) => void
  setAgentSettings: (value: { cursor: number }) => void
  buffers: () => WorkBuffer[]
  setCurrentBuffer: (id: string) => void
  currentBuffer: () => string
  switchBuffer: (buffer: WorkBuffer, keepMenu?: boolean) => void
  closeBuffer: (keepMenu?: boolean) => void
  releaseChat: (id: string) => void
  setBuffers: (buffers: WorkBuffer[]) => void
  chat: () => ChatState
  activeChat: ChatController
  activeAgent: () => string | null
  managerState: () => SessionsState
  setSessionsState: (value: SessionsState | ((current: SessionsState) => SessionsState)) => void
  settingsView: () => SettingsView | undefined
  dropSessionBuffer: (id: string) => void
  reloadArchive: () => Promise<void>
  sourceState: () => PickerState | null
  handleSourceInput: (press: ShellPress, event: { preventDefault: () => void }) => Promise<void> | void
  openBuffer: (buffer: WorkBuffer) => void
  activeProject: () => string | null
  listRows: (pane: string) => PanelRow[]
}

export function handlePaneKeys(
  state: ShellState,
  press: ShellPress,
  event: { preventDefault: () => void },
  deps: PaneKeyDeps,
): boolean {
  const {
    workspace, createGithubArchive, taskRegistry, taskCursor, setTaskCancelArmed, notify,
    skillsState, setSkillsState, openCourse, openSkillChat, newSkillChat, archiveSkillGoal, exportSkillGoal, removeGoal,
    setPrompt, update, chatScroll, dims, openChapter, chapterText, setReaderOffset, course,
    taskCancelArmed,
    setOpenChapter, setChapterText, toggleChapter, openChapterAt, setChapterCursor, chapterCursor,
    reviewItems, agentTemplates, setAgentTemplateChoice, setDefaultAgentForProject,
    pluginRows, pluginCursor, setPluginCursor, connectPlugin, closePlugin, togglePlugin, refreshPlugins,
    projects, projectPending, setProjectPending, archiveProject, deleteProject, exportProject,
    openSwarm, setOpenSwarm, listCursors, swarms, setEditingAgent, setAgentSettings,
    buffers, setCurrentBuffer, currentBuffer, switchBuffer, closeBuffer, releaseChat, setBuffers,
    chat, activeChat, activeAgent, managerState, setSessionsState, settingsView,
    dropSessionBuffer, reloadArchive, sourceState, handleSourceInput, openBuffer,
    activeProject, listRows,
  } = deps

    if (state.overlay === null && state.mode === "normal") {  // The shared manager verbs: `a`, `d` and `x` mean the same in every manager.
  const managerVerb = managerIntent(press.name)

      if (state.pane === "task-centre" && press.name === "c") {
        const task = taskRegistry().list()[taskCursor()]
        if (!task) {
          notify("no task selected", "warn")
        } else {
          const armed = taskCancelArmed()
          const outcome = taskRegistry().cancel(task.id, { confirmed: armed === task.id })
          setTaskCancelArmed(outcome === "needs-confirmation" ? task.id : null)
          notify(cancelNotice(outcome, task), outcome === "asked" ? undefined : "warn")
        }
        event.preventDefault()
        return true
      }
      if (state.pane === "skills" && press.name === "return" && skillsState().pane === "chats") {
        const skills = skillsState()
        const goal = skills.goals[skills.cursor]
        const chat = skills.chats[skills.chatCursor]
        if (goal && chat) openSkillChat(goal.id, goal.name || goal.id, chat.id)
        event.preventDefault()
        return true
      }
      if (state.pane === "skills" && press.name === "return") {
        const goal = skillsState().goals[skillsState().cursor]
        if (goal) {
          void openCourse(goal.id, goal.name)
          event.preventDefault()
          return true
        }
      }
      if (state.pane === "skills" && press.name === "d" && skillsState().pane === "chats") {
        const skills = skillsState()
        const goal = skills.goals[skills.cursor]
        const chat = skills.chats[skills.chatCursor]
        if (!goal || !chat) {
          notify("no chat selected", "warn")
        } else if (skills.chats.length <= 1) {
          notify("a goal keeps one chat · press n to start another before deleting this one", "warn")
        } else if (!workspace) {
          notify("a workspace is needed to delete a chat", "error")
        } else {
          void deleteSkillChat({ workspace, goalId: goal.id, chatId: chat.id })
            .then((result) => {
              if (!result.ok) {
                notify(result.message, "error")
                return
              }
              setSkillsState((state) => ({
                ...state,
                chats: state.chats.filter((entry) => entry.id !== chat.id),
                chatCursor: Math.max(0, Math.min(state.chatCursor, state.chats.length - 2)),
              }))
              notify(`deleted chat: ${chat.title}`)
            })
            .catch(() => notify("the chat could not be deleted", "error"))
        }
        event.preventDefault()
        return true
      }
      if (
        state.pane === "skills" &&
        skillsState().pane === "goals" &&
        (managerVerb === "archive" || managerVerb === "delete" || managerVerb === "export")
      ) {
        const kind = managerVerb
        const skills = skillsState()
        if (!skills.pending) {
          setSkillsState(armSkill(skills, kind))
          notify(skillWarning(skills, kind), "warn")
          event.preventDefault()
          return true
        }
        const outcome = confirmSkill(skills, kind)
        if (outcome.kind !== "call") {
          setSkillsState(cancelSkill(skills))
          notify(outcome.kind === "refused" ? outcome.reason : "nothing selected", "warn")
          event.preventDefault()
          return true
        }
        setSkillsState(cancelSkill(skills))
        const goal = skills.goals[skills.cursor]
        if (!goal) {
          event.preventDefault()
          return true
        }
        if (kind === "delete") void removeGoal(goal.id, goal.name)
        else if (kind === "archive") void archiveSkillGoal(goal.id, goal.name)
        else void exportSkillGoal(goal.id, goal.name)
        event.preventDefault()
        return true
      }
      if (state.pane === "skills" && press.name === "escape") {
        // Leaving Skills disarms a pending archive/delete/export.
        setSkillsState((state) => cancelSkill(state))
      }
      if (state.pane === "skills" && (press.name === "h" || press.name === "l")) {
        setSkillsState((state) => ({ ...state, pane: press.name === "h" ? "goals" : "chats" }))
        event.preventDefault()
        return true
      }
      if (state.pane === "skills" && press.name === "n" && skillsState().pane === "chats") {
        const skills = skillsState()
        const goal = skills.goals[skills.cursor]
        if (goal) void newSkillChat(goal.id, goal.name || goal.id)
        event.preventDefault()
        return true
      }
      if (state.pane === "skills" && press.name === "n") {
        setPrompt({ title: "New skill session", hint: "What do you want to learn? One sentence.", value: "", kind: "skill-goal" })
        event.preventDefault()
        return true
      }
      // The agent sidebar owns its keys while it has focus. It is a roster,
      // not a chat: j/k select, Enter edits, c opens that agent's chat.
      if (
        state.pane === "chat" &&
        state.focus === "agents" &&
        state.agentSidebar === true &&
        state.overlay === null
      ) {
        const swarm = deps.swarms().find((entry) => entry.projectId === deps.activeProject())
        const agents = swarm?.agents ?? []
        const projectId = swarm?.projectId ?? deps.activeProject() ?? ""
        const index = agents.length === 0 ? 0 : Math.min(deps.sidebarCursor(), agents.length - 1)
        const agent = agents[index]
        if (press.name === "down" || press.name === "j") {
          deps.setSidebarCursor((cursor) =>
            agents.length === 0 ? 0 : Math.min(agents.length - 1, cursor + 1),
          )
          event.preventDefault()
          return true
        }
        if (press.name === "up" || press.name === "k") {
          deps.setSidebarCursor((cursor) => Math.max(0, cursor - 1))
          event.preventDefault()
          return true
        }
        if (press.name === "escape") {
          update({ ...state, focus: "chat", mode: "normal" })
          event.preventDefault()
          return true
        }
        if (press.name === "c" && agent) {
          deps.openBuffer({
            id: `agent:${projectId}:${agent.id}`,
            label: agent.name,
            kind: "agent",
            ...(projectId ? { projectId } : {}),
            agentId: agent.id,
          })
          event.preventDefault()
          return true
        }
        if ((press.name === "return" || press.name === "e") && agent) {
          deps.setEditingAgent(agent.id)
          deps.setAgentSettings({ cursor: 0 })
          update({ ...state, pane: "agent-settings", mode: "normal" })
          event.preventDefault()
          return true
        }
        if (press.name === "s" && agent) {
          void deps.setDefaultAgentForProject(projectId, agent.id)
          event.preventDefault()
          return true
        }
        if (press.name === "n" && deps.openSwarm()) {
          deps.setPrompt({ title: "New agent", hint: "Name the role it plays.", value: "", kind: "agent" })
          event.preventDefault()
          return true
        }
        if (press.name === "t" && deps.openSwarm()) {
          void deps.agentTemplates().then((templates) => {
            if (templates.length === 0) {
              deps.notify("no agent templates are available", "warn")
              return
            }
            deps.setAgentTemplateChoice(templates, projectId)
          })
          event.preventDefault()
          return true
        }
      }

      // Tab cycles the panes that are actually visible: chat -> agents ->
      // reader -> chat. The reader and the agent sidebar stay visible; only one
      // of them owns j/k at a time.
      if (state.pane === "chat" && press.name === "tab" && !press.shift) {
        const canAgents = agentSidebarVisible(deps.dims().width, state)
        const canReader = state.reader
        if (canAgents || canReader) {
          const next =
            state.focus === "chat"
              ? canAgents
                ? "agents"
                : "reader"
              : state.focus === "agents"
                ? canReader
                  ? "reader"
                  : "chat"
                : "chat"
          update({ ...state, focus: next, mode: "normal" })
          event.preventDefault()
          return true
        }
      }

      // NORMAL j/k scrolls what has focus: the transcript on the chat side,
      // the document on the reader side. Page keys take a larger step.
      if (state.pane === "chat" && state.mode === "normal") {
        const down = press.name === "j" || press.name === "pagedown"
        const up = press.name === "k" || press.name === "pageup"
        if (down || up) {
          const step = press.name === "pageup" || press.name === "pagedown" ? 8 : 1
          if (state.focus === "chat") {
            chatScroll()?.scrollBy(down ? step : -step)
            event.preventDefault()
            return true
          }
          if (state.focus === "reader" && state.reader && openChapter()) {
            const visible = Math.max(1, dims().height - 6)
            const max = Math.max(0, blockCount(chapterText()) - visible)
            setReaderOffset((offset) => Math.max(0, Math.min(max, offset + (down ? step : -step))))
            event.preventDefault()
            return true
          }
        }
      }

      // The reader holds the course: a list, then a chapter, with the chat
      // still on the left. Only while the chat surface has focus: a modal menu
      // drawn over it (buffers, projects) owns the keys it shows.
      if (state.pane === "chat" && state.reader && course()) {
        const subject = course()!
        const open = openChapter()
        if (press.name === "escape") {
          if (open) {
            setOpenChapter(null)
            setChapterText("")
            setReaderOffset(0)
          } else {
            update({ ...state, reader: false, focus: "chat", mode: "normal" })
          }
          event.preventDefault()
          return true
        }
        if (state.focus === "reader") {
        if (open) {
          if (press.name === "c") {
            void toggleChapter(subject, open.id, false)
            event.preventDefault()
            return true
          }
          if (press.name === "p") {
            // Toggle: reading → practical, practical → reading.
            void openChapterAt(subject, open.id, !open.practical)
            event.preventDefault()
            return true
          }
          if (press.name === "b") {
            setOpenChapter(null)
            setChapterText("")
            setReaderOffset(0)
            event.preventDefault()
            return true
          }
        } else {
          if (press.name === "j" || press.name === "k") {
            const count = subject.chapters.length
            setChapterCursor((cursor) =>
              Math.max(0, Math.min(count - 1, cursor + (press.name === "j" ? 1 : -1))),
            )
            event.preventDefault()
            return true
          }
          if (press.name === "return") {
            const chapter = subject.chapters[chapterCursor()]
            if (chapter) void openChapterAt(subject, chapter.id, false)
            event.preventDefault()
            return true
          }
          if (press.name === "c") {
            const chapter = subject.chapters[chapterCursor()]
            if (chapter) void toggleChapter(subject, chapter.id, false)
            event.preventDefault()
            return true
          }
          if (press.name === "p") {
            const chapter = subject.chapters[chapterCursor()]
            if (chapter) void openChapterAt(subject, chapter.id, true)
            event.preventDefault()
            return true
          }
        }
        }
      }
      if (
        state.pane === "projects" &&
        (managerVerb === "archive" || managerVerb === "delete" || managerVerb === "export")
      ) {
        const row = listRows("projects")[listCursors().projects ?? 0]
        const project = projects().find((entry) => entry.id === row?.id)
        if (!project) {
          notify("no project selected", "warn")
        } else {
          const kind = managerVerb
          const armed = projectPending()
          if (!armed) {
            setProjectPending({ kind, id: project.id, name: project.name })
            const verb =
              kind === "archive" ? (project.archived ? "Restore" : "Archive") : kind === "delete" ? "Delete" : "Export"
            notify(`${verb} “${project.name}”? press ${press.name} again to confirm`, "warn")
          } else {
            const outcome = confirmProjectPending({ pending: armed, notice: null }, project, kind)
            if (outcome.kind !== "call") {
              setProjectPending(null)
              notify(outcome.kind === "refused" ? outcome.reason : "nothing selected", "warn")
            } else {
              setProjectPending(null)
              if (kind === "archive") archiveProject(project.id, project.name)
              else if (kind === "delete") deleteProject(project.id, project.name)
              else void exportProject(project.id, project.name)
            }
          }
        }
        event.preventDefault()
        return true
      }
      if (state.pane === "projects" && press.name === "escape") {
        setProjectPending(null)
      }
      if (state.pane === "projects" && press.name === "n") {
        setPrompt({ title: "New project", hint: "A name, a folder, then chat or swarm.", value: "", kind: "project-name" })
        event.preventDefault()
        return true
      }
      if (state.pane === "agents" && press.name === "t") {
        const open = openSwarm()
        const swarm = open ? swarms().find((entry) => entry.id === open) : undefined
        if (!swarm) {
          notify("open a swarm before seeding an agent", "warn")
          event.preventDefault()
          return true
        }
        void agentTemplates().then((templates) => {
          if (templates.length === 0) {
            notify("no agent templates are available", "warn")
            return
          }
          setAgentTemplateChoice(templates, swarm.projectId)
        })
        event.preventDefault()
        return true
      }
      if (state.pane === "agents" && press.name === "s") {
        const open = openSwarm()
        const swarm = open ? swarms().find((entry) => entry.id === open) : undefined
        const agent = swarm?.agents[listCursors().agents ?? 0]
        if (swarm && agent) void setDefaultAgentForProject(swarm.projectId, agent.id)
        event.preventDefault()
        return true
      }
      if (state.pane === "agents" && (press.name === "return" || press.name === "e")) {
        const open = openSwarm()
        const index = listCursors().agents ?? 0
        const agent = open ? swarms().find((swarm) => swarm.id === open)?.agents[index] : undefined
        if (agent) {
          setEditingAgent(agent.id)
          setAgentSettings({ cursor: 0 })
          update({ ...state, pane: "agent-settings", mode: "normal" })
          event.preventDefault()
          return true
        }
      }
      if (state.pane === "buffers" && press.name === "return") {
        const row = listRows("buffers")[listCursors().buffers ?? 0]
        const buffer = buffers().find((entry) => entry.id === row?.id)
        if (buffer) {
          if (buffer.id !== currentBuffer()) {
            setCurrentBuffer(buffer.id)
            // The menu stays up: Esc is what closes the manager.
            switchBuffer(buffer, true)
          }
          event.preventDefault()
          return true
        }
      }
      if (state.pane === "buffers" && press.name === "d") {
        const row = listRows("buffers")[listCursors().buffers ?? 0]
        const buffer = buffers().find((entry) => entry.id === row?.id)
        if (buffer) {
          if (buffer.id === currentBuffer()) closeBuffer(true)
          else {
            releaseChat(buffer.id)
            const next = buffers().filter((entry) => entry.id !== buffer.id)
            if (next.length <= 1) {
              setBuffers([HOME_BUFFER])
              setCurrentBuffer("home")
              switchBuffer(HOME_BUFFER)
            } else {
              setBuffers(next)
            }
          }
          event.preventDefault()
          return true
        }
      }
      // The transcript's own "press e to load" prompt owns e while it applies.
      if (state.pane === "chat" && state.focus === "chat" && press.name === "e" && hiddenCount(chat()) > 0) {
        activeChat.loadMore()
        event.preventDefault()
        return true
      }
      // Editing the agent you are chatting with is one key away.
      if (state.pane === "chat" && press.name === "e" && activeAgent()) {
        setEditingAgent(activeAgent())
        setAgentSettings({ cursor: 0 })
        update({ ...state, pane: "agent-settings", mode: "normal" })
        event.preventDefault()
        return true
      }
      if (
        state.pane === "manager" &&
        (managerVerb === "archive" || managerVerb === "delete" || managerVerb === "export")
      ) {
        const kind = managerVerb
        const sessions = managerState()
        if (!sessions.pending) {
          setSessionsState(armSession(sessions, kind))
          notify(sessionWarning(sessions, kind), "warn")
          event.preventDefault()
          return true
        }
        const outcome = confirmSession(sessions, kind)
        if (outcome.kind !== "call") {
          setSessionsState(cancelSessionPending(sessions))
          notify(outcome.kind === "refused" ? outcome.reason : "nothing selected", "warn")
          event.preventDefault()
          return true
        }
        const row = sessions.rows.find((entry) => entry.id === outcome.id)
        setSessionsState(cancelSessionPending(sessions))
        if (!workspace) {
          notify("a workspace is needed for that action", "error")
          event.preventDefault()
          return true
        }
        const github = settingsView()?.archiveBackend === "github" ? createGithubArchive : undefined
        if (settingsView()?.archiveBackend === "github" && github === undefined) {
          notify("the GitHub archive backend is not available in this build", "warn")
          event.preventDefault()
          return true
        }
        void runSessionAction({
          workspace,
          id: outcome.id,
          action: kind,
          archiveRoot: settingsView()?.archiveFolder ?? "",
          ...(github === undefined ? {} : { createGithubArchive: github }),
        })
          .then((result) => {
            if (!result.ok) {
              notify(result.message, "error")
              return
            }
            if (result.action === "export") {
              notify(`exported ${result.path}`)
              return
            }
            setSessionsState((state) => ({
              ...state,
              rows: state.rows.filter((entry) => entry.id !== outcome.id),
            }))
            dropSessionBuffer(outcome.id)
            void reloadArchive()
            notify(
              result.action === "delete"
                ? `deleted session: ${row?.name ?? outcome.id}`
                : result.backend === "github"
                  ? `archived session to GitHub: ${row?.name ?? outcome.id}`
                  : `archived session: ${row?.name ?? outcome.id}`,
            )
          })
          .catch(() => notify("the session action failed", "error"))
        event.preventDefault()
        return true
      }
      if (state.pane === "sources" && sourceState()) {
        void handleSourceInput(press, event)
        return true
      }
      if (state.pane === "plugins") {
        const rows = pluginRows()
        const bounded = (next: number) => Math.max(0, Math.min(rows.length - 1, next))
        if (press.name === "j" || press.name === "down") {
          setPluginCursor((cursor) => bounded(cursor + 1))
          event.preventDefault()
          return true
        }
        if (press.name === "k" || press.name === "up") {
          setPluginCursor((cursor) => bounded(cursor - 1))
          event.preventDefault()
          return true
        }
        const row = rows[pluginCursor()]
        if (row) {
          if (press.name === "return") {
            void connectPlugin(row.name)
            event.preventDefault()
            return true
          }
          if (press.name === "c") {
            void closePlugin(row.name)
            event.preventDefault()
            return true
          }
          if (press.name === "e") {
            void togglePlugin(row.name)
            event.preventDefault()
            return true
          }
        }
        if (press.name === "r") {
          void refreshPlugins()
          event.preventDefault()
          return true
        }
      }
      if (state.pane === "recent" && press.name === "return") {
        const row = listRows("recent")[listCursors().recent ?? 0]
        if (row) {
          const [kind, ...rest] = row.id.split(":")
          const id = rest.join(":")
          if (kind === "lockin") {
            const session = managerState().rows.find((entry) => entry.id === id)
            if (session) openBuffer({ id: `session:${session.id}`, label: session.name, kind: "session" })
          } else if (kind === "skill") {
            const goal = skillsState().goals.find((entry) => entry.id === id)
            if (goal) void openCourse(goal.id, goal.name)
          } else if (kind === "project") {
            const project = projects().find((entry) => entry.id === id)
            if (project) openBuffer({ id: `project:${project.id}`, label: project.name, kind: "project", projectId: project.id })
          }
        }
        event.preventDefault()
        return true
      }
      if (state.pane === "review" && press.name === "return") {
        const item = reviewItems()[listCursors().review ?? 0]
        if (item) {
          if (item.origin === "curriculum") {
            const goal = skillsState().goals.find((entry) => entry.id === item.contextId)
            if (goal) void openCourse(goal.id, goal.name || goal.id)
          } else {
            openBuffer({ id: `session:${item.contextId}`, label: item.context, kind: "session" } as never)
          }
        } else {
          const row = listRows("review")[listCursors().review ?? 0]
          if (row) openBuffer({ id: `session:${row.id}`, label: row.label, kind: "session" } as never)
        }
        event.preventDefault()
        return true
      }
      if (state.pane === "manager" && press.name === "n") {
        setPrompt({ title: "New lock-in session", hint: "Name it, then choose its sources.", value: "", kind: "lockin-name" })
        event.preventDefault()
        return true
      }
      if (state.pane === "manager" && press.name === "return") {
        const row = listRows("manager")[managerState().cursor]
        if (row) {
          openBuffer({
            id: `session:${row.id}`,
            label: row.label,
            kind: "session",
            ...(activeProject() ? { projectId: activeProject()! } : {}),
          } as never)
          notify(`opened session: ${row.label}`)
          event.preventDefault()
          return true
        }
      }
      if (state.pane === "projects" && press.name === "return") {
        const row = listRows("projects")[listCursors().projects ?? 0]
        const project = projects().find((entry) => entry.id === row?.id)
        if (project) {
          if (project.archived) {
            notify("this project is archived · press a twice to restore it", "warn")
          } else {
            openBuffer({
              id: `project:${project.id}`,
              label: project.name,
              kind: "project",
              projectId: project.id,
            })
          }
          event.preventDefault()
          return true
        }
      }
      if (state.pane === "swarms" && press.name === "n") {
        setPrompt({ title: "New swarm", hint: "Name it. You will add agents next.", value: "", kind: "swarm" })
        event.preventDefault()
        return true
      }
      if (state.pane === "agents" && press.name === "n") {
        const open = openSwarm()
        if (open) {
          setPrompt({ title: "New agent", hint: "Name the role it plays.", value: "", kind: "agent" })
          event.preventDefault()
          return true
        }
      }
      if (state.pane === "swarms" && press.name === "return") {
        const row = listRows("swarms")[listCursors().swarms ?? 0]
        if (row) {
          setOpenSwarm(row.id)
          update({ ...state, pane: "agents", mode: "normal" })
          event.preventDefault()
          return true
        }
      }
    }
    return false
  
}
