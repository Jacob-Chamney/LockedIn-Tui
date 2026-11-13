/**
 * Composition root for the shell.
 *
 * Owns the one keymap registry, the mode machine and the key plumbing. Screens
 * render state and dispatch intents; they never match keys themselves.
 *
 * The shell renders from a fixed `initial` state: the headless harness cannot
 * repaint after mount, so tests mount one App per state and drive transitions
 * through the pure machine (`reduce`) and through `dispatch`.
 */
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { decodePasteBytes, type TextareaRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { TaskRegistry } from "../domain/tasks";
import { createDefaultActions, type Dispatcher } from "../ui/keymap/defaults";
import { KeymapRegistry, generatedRows, parseBinding, type Action, type KeymapRegistry as Registry, type Scope } from "../ui/keymap/registry";
import { resolveKey, resolveLeaderKey } from "../ui/keymap/resolve";
import { filterCommands } from "../ui/shell/commands";
import { initialPluginManager, movePluginCursor, renamePluginItem, togglePluginItem } from "../ui/settings/plugin-manager";
import { PluginStateStore } from "../ui/plugins/plugin-state";
import { applyConfig } from "../ui/keymap/persist";
import { emptySettingsView } from "../ui/settings";
import type { SettingsView } from "../ui/settings";
import { initialSessions, move as moveManager } from "../ui/features/sessions";
import { initialSkills, moveGoal, moveChat } from "../ui/features/skills";
import { initialActivity } from "../ui/work/activity";
import { moveTheme, themeEntries } from "../ui/settings/themes";
import type { PanelRow } from "../ui/panels/panel-list";
import { AGENT_MODELS, AGENT_PERMISSIONS, AGENT_FIELDS, initialAgentSettings, type AgentField } from "../ui/features/agents/agent-settings-panel";
import { createAppPlugins, resolvePluginOptions, type ParticleHostEntry, type SceneHostEntry } from "../ui/plugins/app-plugins";
import { effectDebug } from "../ui/plugins/debug";
import { CustomParticleHost } from "../ui/plugins/particle-host";
import { bundledPluginRoots, particlePathsFromEnv, pluginDirsFromConfig, loadParticleFiles, loadPlugins, scanPluginDirs, watchPlugins } from "../ui/plugins/loader";
import { copyToClipboard } from "../ui/plugins/clipboard";
import { SandboxWorkerPlugin } from "../ui/plugins/sandbox/client";
import type { SceneState } from "../ui/plugins/scene/model";
import { dirty as sessionSettingsDirty, initialSessionSettings, move as moveSessionSettings, selectedRow as selectedSessionSettingsRow, type SessionSettingsState } from "../ui/features/session-settings/session-settings-model";
import { chatSettingRows, nextChatSetting, type ChatSettingsRow } from "../ui/features/chat-settings/chat-settings-panel";
import type { SwarmSummary } from "../ui/shell/explorer";
import type { Prompt } from "../ui/overlays/prompt";
import type { Choice } from "../ui/overlays/choice";
import type { Course } from "../services/skills/course";
import { loadSessionRows } from "./actions/sessions";
import { loadReview } from "./actions/review";
import { loadProjectChanges } from "./actions/changes";
import { buildOutput, loadDeck, markDeckCard, readOutput, type LoadedDeck, type OutputKind } from "./actions/outputs";
import type { PluginRuntime } from "./actions/plugins";
import type { ServerRow } from "../ui/features/mcp/mcp-model";
import type { PluginRequest } from "../ui/overlays/plugin-request";
import { addSessionSources, appendSessionMisconception, generateSessionDocument, importSessionInstructionsFile, loadParkedQuestionCount, loadSessionInstructions, loadSessionPrompt, loadSessionQuestions, loadSessionSourceNames, loadSessionSteps, parkSessionQuestion, reExtractSessionInstructions, recordSessionConfidence, regenerateSessionSteps, saveIntakeLevel, saveSessionInstructions, sessionNeedsStepRefresh, sessionTools, stepFailureMessage, toggleSessionStep } from "./actions/lockin";
import { gatherSkillSources } from "./actions/skills";
import { createSkillChat, createSkillCourse, deleteSkillGoal, loadChapter, loadCourse, loadGoalRows, loadGoalSourceNames, loadSkillChats, setChapterDone, skillTools } from "./actions/skills";
import { loadActivity, loadKnowledge, loadStats } from "./actions/background";
import { loadAchievementSnapshot } from "./actions/achievements";
import { createLockIn, pickerApi, previewPickerFile } from "./actions/lockin";
import { loadArchiveRows, runGoalAction } from "./actions/archive";
import { initialArchive, move as moveArchiveState, type ArchiveState } from "../ui/features/archive";
import type { ActivityRecord } from "../services/work/activity";
import { runProjectExport } from "./actions/work";
import { archiveProject as archiveProjectRecord, createProject as createProjectRecord, createAgentFromTemplate, createProjectAgent, deleteProject as deleteProjectRecord, loadAgentTemplates, loadProjectAgents, loadProjects, loadWorkHome, setProjectDefaultAgent, setProjectMode, type WorkHomeData, makeAgentId, makeProjectId, projectTools, updateProjectAgent } from "./actions/projects";
import { NOTICE_FADE_MS, NOTICE_TICK_MS, noticeDuration, pruneNotices, type Notice, type NoticeLevel } from "../ui/shell/notice-stack";
import type { UpdateBadge } from "../ui/shell/layout";

/**
 * Languages the app warms after the first frame.
 *
 * Not the whole bundle: each grammar is a dynamic import plus a compile, and the
 * point is only to make the common fences instant on first sight. Everything
 * else loads on demand the first time it appears.
 */
const SYNTAX_WARM_LANGUAGES = [
  "javascript",
  "typescript",
  "tsx",
  "python",
  "rust",
  "go",
  "cpp",
  "c",
  "java",
  "kotlin",
  "csharp",
  "bash",
  "json",
  "yaml",
  "toml",
  "sql",
  "html",
  "css",
  "markdown",
  "diff",
  "xml",
  "dockerfile",
  "lua",
  "ruby",
  "php",
  "swift",
  "zig",
] as const;

import type { UpdateInfo, UpdateService } from "../services/update";
import { explorerRows as explorerRowsFor, firstItem, moveExplorer, selectedItem } from "../ui/shell/explorer";
import { initialSettingsState, moveSetting, settingsGroups } from "../ui/settings";
import type { PaneId } from "../ui/shell/state";
import type { PickerEntry, PickerState } from "../services/lockin/picker";
import { blockedReason as pickerBlockedReason, currentEntry as pickerCurrentEntry, errorLine as pickerErrorLine, initialView as initialPickerView, isPathQuery, move as movePicker, type PickerView } from "../ui/features/sources/sources-model";
import { intentFor as pickerIntentFor } from "../ui/features/sources/sources-keys";
import type { StatsSummary } from "../stats/types";
import { initialStatsView, type StatsView } from "../ui/stats/stats";
import type { KnowledgeGraph } from "../services/knowledge/graph";
import { firstChildOf, initialKnowledge, moveFocus, navigationOrder, parentOf, rootOf, searchJump, type KnowledgeState } from "../ui/knowledge/model";
import { directionTarget } from "../ui/knowledge/scene";
import type { PaneDeps } from "./panes";
import { PANE_TITLES } from "../ui/shell/panes";
import { paneGeometry } from "../ui/shell/state";
import { AppView } from "./AppView";
import { normalisePress, typedText } from "./keys/press";
import { blockCount } from "../ui/reader/markdown-body";
import { createModelsController } from "./models-controller";
import { handleOverlayKeys } from "./key-routes/overlays";
import { handleSettingsKeys } from "./key-routes/settings";
import { handleExplorerKeys } from "./key-routes/explorer";
import { handleInsertKeys } from "./key-routes/insert";
import { handlePaneKeys } from "./key-routes/panes";
import { applyViewPatch, nestedPatch } from "./settings-patch";
import { chatModeFor, chatPathFor, HOME_BUFFER, scopeForBuffer, type WorkBuffer } from "./buffers";
import type { ScrollApi } from "../ui/scroll";
import { isImagePaste, TOOL_MODE_LABEL, type ChatState } from "../ui/chat/model";
import { currentAchievement, cycleFilter, initialAchievementView, jumpAchievement, moveAchievementList, moveAchievementNode, type AchievementView } from "../ui/achievements/achievements";
import { clampCursor as clampStepCursor, currentStep as currentStepAt, initialStepsView, move as moveStep, rowsFor as stepRowsFor, type StepsView } from "../ui/reader/steps";
import { parseProgress } from "../domain/progress";
import type { ReviewItem } from "../domain/review";
import { EMPTY_METRICS, achievementUnlocked, shareText, type AchievementMetrics } from "../domain/achievements";
import type { AgentTemplate } from "../services/work/templates";
import { choose as chooseCard, currentCard as currentDeckCard, flip as flipDeck, initialDeckView, intentFor as deckIntent, mark as markCard, move as moveDeck, toggleMissedOnly, type Deck as DeckData, type DeckView } from "../ui/reader/deck";
import { createChatController, type ChatController, type SessionUsage, type UsagePort } from "./chat-controller";
import { createJsonlHistoryPort } from "../storage/chat-history";
import type { RunScope } from "../llm/usage";
import { resolveTheme, type ThemeId, type ThemePalette } from "../ui/theme";
import { PANE_FOR_ACTION, actionIsUsable, initialShellState, isModal, normalizeFocus, reduce, type ShellState } from "../ui/shell/state";

/** Commands that only a lock-in session can run. */
const LOCKIN_CHAT_COMMANDS = [
  ":regenerate-steps",
  ":next",
  ":park",
  ":questions",
  ":calibrate",
  ":contract",
  ":contradictions",
  ":check",
  ":mistake",
  ":rate",
  ":learning-web",
] as const

/** The local command list for a surface; only what applies there. */
function chatCommandHelp(kind: "chat" | "project" | "agent" | "session" | "skill" | "achievements"): string {
  const lines = ["Chat commands are local: they use a colon and never reach the model.", ""]
  if (kind === "chat") {
    lines.push(":clear              empty the Chill transcript and its local history")
    return lines.join("\n")
  }
  if (kind === "skill") {
    lines.push(":chat-settings      response length and tutor policy for this session")
    return lines.join("\n")
  }
  if (kind !== "session") {
    lines.push(":chat-settings      response length for this chat")
    return lines.join("\n")
  }
  lines.push(
    ":chat-settings      response length for this session",
    ":regenerate-steps   rebuild the assignment steps",
    ":next               jump to the next unchecked step",
    ":park <question>    save a question for later",
    ":questions          open parked questions",
    ":calibrate          set a starting level for this session",
    ":contract           extract the assignment's done-when checklist",
    ":contradictions     compare sources for conflicts",
    ":check <attempt>    review an attempt",
    ":mistake <text>     record a misconception",
    ":rate 1-5           record confidence on the current step",
    ":learning-web       allow one web-backed lock-in turn",
  )
  return lines.join("\n")
}
export type ShellInitial = Partial<ShellState> & {
  readerLines?: string[]
  readerTitle?: string
  chat?: import("../ui/chat/model").ChatState
}

export type ShellApi = {
  state: () => ShellState
  registry: Registry
  dispatch: (id: string) => void
  hints: ReturnType<typeof generatedRows>
  /** Actions whose handler ran, in order — proof the handler is wired. */
  intents: readonly string[]
  frame: () => ShellState
}

/** The machine's filesystem root, even if a caller passes a relative path. */
function filesystemRoot(path: string): string {
  return parse(resolve(path)).root || sep
}

/** Without a linked model there is nothing to send; the pane says so. */
function fallbackController(
  username: string,
  scope: RunScope,
  usage?: UsagePort,
  onUsageError?: (message: string) => void,
): ChatController {
  return createChatController({
    scope,
    ...(usage ? { usage } : {}),
    ...(onUsageError ? { onUsageError } : {}),
    service: {
      active: () => [],
      cancel: () => {},
      // eslint-disable-next-line require-yield
      async *send() {
        return
      },
    },
    budget: {
      key: () => "none",
      isOverridden: () => false,
      overrideOnce: () => {},
      check: () => ({ block: null, state: { spent: 0, limit: 0, period: "day" } as never }),
    },
    history: { load: async () => [], save: async () => {} },
    config: () => ({ model: null, maxToolCalls: 8, maxTokens: 16000, chillHistoryLimit: 20 }),
    username,
  })
}

export function App(props: {
  initial?: ShellInitial
  theme?: ThemeId
  custom?: Partial<ThemePalette> | null
  /** Injected by the composition root; tests pass a fake. */
  controller?: ChatController
  /** Build a controller for one buffer's own history. */
  createChat?: (
    history: import("./chat-controller").HistoryPort,
    scope?: RunScope,
    mode?: import("../llm/chat").ChatMode,
    context?: () => Promise<string>,
    tools?: import("./actions/projects").ChatToolSource,
  ) => ChatController
  /** Persists one settings patch through the composition root. */
  onConfigPatch?: (patch: Record<string, unknown>) => unknown
  /** Configured MCP servers; absent in preview shells. */
  pluginRuntime?: PluginRuntime
  /** One completion, for guide/deck generation; absent without a model. */
  generate?: (prompt: string) => Promise<string>
  /** Validates a provider key and returns the models that key can see. */
  linkProvider?: (input: {
    providerId: string
    key: string
    baseUrl?: string
  }) => Promise<import("../llm/validate").LlmResult<import("../llm/validate").LinkOutcome>>
  /** Fetch models for an already-linked key without asking for it again. */
  modelsForProvider?: (providerId: string) => Promise<
    import("../llm/validate").LlmResult<import("../llm/validate").LinkOutcome>
  >
  /** Providers whose key is already in the keychain. */
  linkedProviders?: () => Promise<string[]>
  /** GitHub archive backend factory; absent when it cannot be configured. */
  createGithubArchive?: () => Promise<
    import("../domain/markdown").Result<import("../archive/types").ArchiveBackend, import("../archive/types").ArchiveError>
  >
  /** The loaded configuration, built by the composition root (WP-809). */
  settings?: SettingsView
  /** The workspace, for courses and anything else the shell reads on demand. */
  workspace?: import("../storage/workspace").Workspace
  /** The workspace's sessions, loaded by the composition root before the first frame. */
  sessions?: import("../ui/features/sessions/sessions-model").SessionRow[]
  /** The workspace's goals, same. */
  goals?: import("../ui/features/skills/skills-model").GoalRow[]
  /** Test seam: the home directory the finder searches. */
  sourceHome?: string
  /** Test seam: the async loaders, defaulting to the real services. */
  loadSessions?: () => Promise<import("../ui/features/sessions/sessions-model").SessionRow[]>
  loadGoals?: () => Promise<import("../ui/features/skills/skills-model").GoalRow[]>
  /** Writes ui.theme in config.toml; the shell owns no file I/O. */
  onThemeChange?: (id: string) => unknown
  /** Test seam: loading a course without touching disk. */
  loadCourse?: (id: string) => Promise<Course | null>
  /** Test seam: creating a lock-in without copying files. */
  createLockIn?: (input: {
    name: string
    files: string[]
    prompt: string
  }) => Promise<{ ok: true; session: { id: string; name: string } } | { ok: false; message: string }>
  /** Test seam: deleting a skill without touching disk. */
  deleteGoal?: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>
  /** A model-written plan for a new skill; the template is used without one. */
  generatePlan?: import("../services/skills/course").PlanGenerator
  /** Test seams for course reading, so a harness can drive it without disk I/O. */
  readChapterText?: (course: Course, chapterId: string, practical: boolean) => Promise<{ ok: true; text: string } | { ok: false; message: string }>
  saveChapterDone?: (course: Course, chapterId: string, done: boolean) => Promise<{ ok: true; course: Course } | { ok: false; message: string }>
  /** Which side this chat belongs to; the controller never guesses. */
  chatScope?: RunScope
  /** Persists one usage run per terminal turn. */
  usageStore?: UsagePort
  /** Reported once if the counters cannot be written. */
  onUsageError?: (message: string) => void
  /** Creates the release updater on demand; absent in source and test shells. */
  update?: () => Promise<UpdateService>
  /** Runs the post-update restart; `prepare` restores the terminal first. */
  restart?: (prepare: () => void) => { ok: boolean; message?: string }
  /** Saved keybind maps from config, applied to the registry on start. */
  keybinds?: {
    keybinds: Record<string, string>
    fixed_keybinds: Record<string, string>
  }
  api?: (api: ShellApi) => void
}) {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  /** Dev-only effects layer; null unless LOCKEDIN_PLUGINS is set. */
  let appEffects: import("../ui/plugins/app-plugins").AppPlugins | null = null
  /** Reloads the sandboxed hosts after the settings switch changes. */
  let reloadParticleHosts: (() => void) | null = null
  /** Plugin roots for the manager; set once the effects layer mounts. */
  let pluginRoots: (() => Promise<string[]>) | null = null
  const [pluginManager, setPluginManager] = createSignal(initialPluginManager)
  /** Runtime failures keyed by plugin id, shown in the manager. */
  const [pluginErrors, setPluginErrors] = createSignal<Record<string, string>>({})
  /** Per-plugin persistent state; in-memory only when no data dir is known. */
  const pluginState = props.settings?.dataDir
    ? new PluginStateStore(join(props.settings.dataDir, "plugins"))
    : null


  const intents: string[] = []
  // Handlers are the app's effect seam: they record the intent and never call
  // back into dispatch (that would recurse).
  const dispatcher: Dispatcher = (id) => {
    intents.push(id)
  }
  const registry = new KeymapRegistry(createDefaultActions(dispatcher))
  if (props.keybinds) applyConfig(registry, { ui: props.keybinds })

  const started = (): ShellState => {
    const base = { ...initialShellState, ...props.initial }
    return normalizeFocus(base, dims().width)
  }

  /**
   * The shell state is a signal, not a plain variable.
   *
   * It used to be `let current = started()`, reassigned inside the key handler —
   * which changed the state and repainted nothing, because nothing tracked it.
   * Every test had mounted one App per state, so the whole suite passed while the
   * live app was frozen on its first frame.
   */
  const [current, setCurrent] = createSignal<ShellState>(started())
  const update = (next: ShellState) => setCurrent(next)

  /**
   * The sides this shell hosts. One leader serves both, so a key resolves
   * against the chat's own side first and the other second; the invariant suite
   * proves no leader key collides between sides, so this cannot shadow a
   * binding — it only means `Space p` (work) still reaches work while the chat
   * is on the learning side.
   */
  const sides = (): Scope[] => (props.chatScope === "work" ? ["work", "learn"] : ["learn", "work"])

  const [helpPage, setHelpPage] = createSignal(0)

  /** Only bindings that can do something here are listed. */
  const usableRows = (scope: Scope) =>
    generatedRows(registry, scope).filter((row) => row.group === "plugin" || actionIsUsable(row.id))
  /**
   * What the leader offers *here*.
   *
   * The menu is a list of places you can go from where you are, not a catalogue:
   * the surface you are already in is not offered, tools that live behind the
   * Explorer (tasks, theme, keys) are not offered, and the buffer manager only
   * exists once there is more than the home buffer. A project buffer adds its
   * agents and swarms.
   */
  const leaderIds = (): string[] => {
    const pane = current().pane
    const ids = ["navigator", "sessions", "goals", "work-projects", "stats", "archives", "knowledge", "settings"]
    if (pane !== "chat" || currentBuffer() !== "home") ids.push("chat")
    if (buffers().length > 1) {
      ids.push("buffers")
      ids.push("buffer-close")
    }
    if (
      course() ||
      current().reader ||
      activeBuffer().kind === "session" ||
      props.initial?.readerTitle ||
      props.initial?.readerLines?.length
    ) {
      ids.push("reader")
    }
    if (openSwarm()) {
      ids.push("work-agents")
      ids.push("work-swarms")
    } else if (swarms().length > 0) {
      ids.push("work-swarms")
    }
    return ids
  }

  const hints = () => usableRows(sides()[0]!)

  const paneTitle = () => PANE_TITLES[current().pane]

  /** The breadcrumb scope: the buffer's side, not just the current pane. */
  const contextLabel = () => {
    const buffer = activeBuffer()
    if (buffer.kind === "session") return "learn"
    if (buffer.kind === "skill") return "skills"
    if (buffer.kind === "achievements") return "meta"
    if (buffer.kind === "project" || buffer.kind === "agent") return "work"
    if (activeProject() && ["projects", "swarms", "agents"].includes(view().pane)) return "productivity"
    return "chill"
  }

  /**
   * What you are working inside, if anything: a project (and its swarm), or a
   * session. Shown in the breadcrumb so the active context is never a guess.
   */
  const activeTarget = () => {
    const buffer = activeBuffer()
    if (buffer.kind === "session" || buffer.kind === "skill") return buffer.label
    const project = projects().find((entry) => entry.id === activeProject())
    const agentId = activeAgent()
    const agent = project?.swarmId
      ? swarms().find((entry) => entry.id === project.swarmId)?.agents.find((entry) => entry.id === agentId)
      : undefined
    if (!project) return agent ? `agent: ${agent.name}` : null
    return agent ? `${project.name} · ${agent.name}` : project.name
  }

  /** The open project's agent roster, for the right-hand sidebar. */
  const agentSidebarData = () => {
    const buffer = activeBuffer()
    if (buffer.kind !== "project" && buffer.kind !== "agent") return null
    const project = projects().find((entry) => entry.id === activeProject())
    const swarm = project?.swarmId
      ? swarms().find((entry) => entry.id === project.swarmId)
      : undefined
    if (!project || !swarm) return null
    const agents = swarm.agents
    const cursor = agents.length === 0 ? 0 : Math.min(sidebarCursor(), agents.length - 1)
    return {
      project: project.name,
      agents,
      cursor,
      ...(workHome()?.name === project.name && workHome()?.defaultAgentId
        ? { defaultAgentId: workHome()!.defaultAgentId }
        : {}),
      activeAgentId: activeAgent(),
    }
  }


  /** The leader list: the rows that apply in this context, in registry order. */
  const leaderRows = () => {
    const wanted = new Set(leaderIds())
    return shellRows().filter((row) => wanted.has(row.id) || row.group === "plugin")
  }

  /** The help overlay lists every row the shell can run, from every side. */
  const rows = () => shellRows()

  /** Every action the shell can run, from every side it hosts, deduplicated. */
  function shellRows() {
    const seen = new Set<string>()
    const out: ReturnType<typeof generatedRows> = []
    for (const side of sides()) {
      for (const row of usableRows(side)) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        out.push(row)
      }
    }
    return out
  }

  /**
   * Move the active surface's cursor.
   *
   * `j`/`k` and the arrow keys both land here; a list that cannot move has no
   * selection to highlight, which is what made the menus feel dead.
   */
  function moveCursor(delta: number) {
    if (current().focus === "explorer") {
      setExplorerCursor((cursor) => moveExplorer(explorerRows(), cursor, delta))
      return
    }
    const pane = current().pane
    if (pane === "manager") setSessionsState((state) => moveManager(state, delta))
    else if (pane === "skills") {
      setSkillsState((state) => (state.pane === "goals" ? moveGoal(state, delta) : moveChat(state, delta)))
    } else if (pane === "settings") {
      setSettingsState((state) => moveSetting(state, delta, settingsGroups(settingsView() ?? emptySettingsView())))
    } else if (pane === "archive") {
      setArchiveState((state) => moveArchiveState(state, delta))
    } else if (pane === "task-centre") {
      const count = taskRegistry().list().length
      setTaskCursor((cursor) => Math.max(0, Math.min(count - 1, cursor + delta)))
    } else if (pane === "activity") {
      setActivityView((view) => ({ ...view, cursor: Math.max(0, view.cursor + delta) }))
    } else if (pane === "buffers") {
      const count = buffers().length
      setListCursors((cursors) => {
        const at = cursors.buffers ?? 0
        return { ...cursors, buffers: Math.max(0, Math.min(count - 1, at + delta)) }
      })
    } else if (pane === "chat" && current().focus === "reader" && current().reader && course()) {
      const count = course()?.chapters.length ?? 0
      setChapterCursor((cursor) => Math.max(0, Math.min(count - 1, cursor + delta)))
    } else if (pane === "agent-settings") {
      setAgentSettings((state) => ({ cursor: Math.max(0, Math.min(AGENT_FIELDS.length - 1, state.cursor + delta)) }))
    } else if (pane === "themes") {
      setThemesState((state) => ({ cursor: moveTheme(state.cursor, delta, themeEntries().length) }))
    } else if (pane === "recent" || ["review", "projects", "swarms", "agents"].includes(pane)) {
      const count = listRows(pane).length
      setListCursors((cursors) => {
        const at = cursors[pane] ?? 0
        return { ...cursors, [pane]: Math.max(0, Math.min(count - 1, at + delta)) }
      })
    }
  }

  /** One entry point: compute the next state, then run the action's handler. */
  /**
   * Build a session's steps the first time it opens without them. One attempt
   * per session per app run, so a provider failure does not loop on every
   * reopen; R is still the explicit retry.
   */
  function buildStepsForSession(id: string, bufferId: string) {
    const workspace = props.workspace
    if (!workspace || !props.generate || stepsBuilding || autoStepsTried.has(id)) return
    autoStepsTried.add(id)
    stepsBuilding = true
    if (currentBuffer() === bufferId) setStepsView({ ...initialStepsView, notice: "Building steps…" })
    void regenerateSessionSteps({ workspace, id, generate: props.generate })
      .then((result) => {
        stepsBuilding = false
        if (currentBuffer() !== bufferId) return
        if (!result.ok) {
          const message = stepFailureMessage(result.error.message)
          setStepsView({ ...initialStepsView, notice: message })
          notify(message, "error")
          return
        }
        setStepsText(result.value.markdown)
        setStepsStale(false)
        setStepsView(initialStepsView)
        notify("steps generated")
      })
      .catch((error) => {
        stepsBuilding = false
        if (currentBuffer() !== bufferId) return
        const message = stepFailureMessage(error)
        setStepsView({ ...initialStepsView, notice: message })
        notify(message, "error")
      })
  }

  /** Show the original assignment instructions in the reader. */
  async function openSessionInstructions() {
    const buffer = activeBuffer()
    const workspace = props.workspace
    if (buffer.kind !== "session" || !workspace) return
    const id = buffer.id.replace(/^session:/, "")
    const text = await loadSessionPrompt(workspace, id)
    if (activeBuffer().id !== buffer.id) return
    if (text === null || text.trim() === "") {
      notify("this session has no assignment instructions", "warn")
      return
    }
    setReaderDoc({ title: "Assignment instructions · i back", lines: text.split("\n") })
    setStepsView(initialStepsView)
    update({ ...current(), reader: true, focus: "reader", mode: "normal", overlay: null })
  }

  async function loadSessionSettingsFor(id: string, bufferId: string): Promise<void> {
    const workspace = props.workspace
    if (!workspace) return
    sessionSettingsSessionId = id
    setSessionSettings((state) => ({ ...state, busy: true, error: null, notice: null }))
    const loaded = await loadSessionInstructions(workspace, id)
    if (activeBuffer().id !== bufferId) return
    if (!loaded.ok) {
      setSessionSettings({ ...initialSessionSettings, error: loaded.error.message })
      return
    }
    setSessionSettings({
      ...initialSessionSettings,
      data: loaded.value,
      draft: loaded.value.prompt,
    })
  }

  function startSessionSettingsEdit(): void {
    const state = sessionSettings()
    if (!state.data) return
    sessionSettingsEditor = null
    setSessionSettings({
      ...state,
      mode: "edit",
      draft: state.data.prompt,
      notice: null,
      error: null,
      discardArmed: false,
    })
  }

  function cancelSessionSettingsEdit(): void {
    const state = sessionSettings()
    const currentText = sessionSettingsEditor?.plainText ?? state.draft
    const changed = currentText !== (state.data?.prompt ?? "")
    if ((changed || sessionSettingsDirty(state)) && !state.discardArmed) {
      setSessionSettings({
        ...state,
        discardArmed: true,
        error: "unsaved changes · press Esc again to discard",
      })
      return
    }
    setSessionSettings({
      ...state,
      mode: "view",
      draft: state.data?.prompt ?? "",
      error: null,
      discardArmed: false,
    })
  }

  async function saveCurrentSessionInstructions(): Promise<void> {
    const state = sessionSettings()
    const workspace = props.workspace
    const buffer = activeBuffer()
    if (!state.data || !workspace || buffer.kind !== "session" || state.busy) return
    const id = buffer.id.replace(/^session:/, "")
    const text = sessionSettingsEditor?.plainText ?? state.draft
    setSessionSettings({ ...state, busy: true, error: null, notice: null })
    const saved = await saveSessionInstructions({ workspace, id, text })
    if (activeBuffer().id !== buffer.id) return
    if (!saved.ok) {
      setSessionSettings({ ...sessionSettings(), busy: false, error: saved.error.message })
      return
    }
    setSessionSettings({
      ...sessionSettings(),
      busy: false,
      mode: "view",
      data: sessionSettings().data
        ? { ...sessionSettings().data!, prompt: saved.value.prompt }
        : { prompt: saved.value.prompt, instructions: null, originalPresent: false },
      draft: saved.value.prompt,
      notice: "instructions saved · :regenerate-steps in chat rebuilds the steps",
      error: null,
      discardArmed: false,
    })
  }

  async function reExtractCurrentInstructions(): Promise<void> {
    const state = sessionSettings()
    const workspace = props.workspace
    const buffer = activeBuffer()
    if (!state.data?.instructions || !workspace || buffer.kind !== "session" || state.busy) return
    const id = buffer.id.replace(/^session:/, "")
    setSessionSettings({ ...state, busy: true, error: null, notice: null })
    const extracted = await reExtractSessionInstructions(workspace, id)
    if (activeBuffer().id !== buffer.id) return
    if (!extracted.ok) {
      setSessionSettings({ ...sessionSettings(), busy: false, error: extracted.error.message })
      return
    }
    setSessionSettings({
      ...sessionSettings(),
      busy: false,
      data: sessionSettings().data
        ? { ...sessionSettings().data!, prompt: extracted.value.prompt, instructions: extracted.value.instructions }
        : null,
      draft: extracted.value.prompt,
      notice: `instructions re-extracted from ${extracted.value.instructions.name}`,
      error: null,
      discardArmed: false,
    })
  }

  /** The controls the active chat offers; Chill offers none. */
  function chatSettingsRowsFor(): ChatSettingsRow[] {
    return chatSettingRows(activeChat.state().capabilities)
  }

  /** Open the window only where something applies; Chill says why instead. */
  function openChatSettings(): void {
    const rows = chatSettingsRowsFor()
    if (rows.length === 0) {
      notify("chat settings apply to sessions, not Chill", "warn")
      return
    }
    setChatSettingsCursor(0)
    update({ ...current(), pane: "chat-settings", explorer: false, focus: "chat", mode: "normal", overlay: null })
  }

  async function cycleChatSetting(): Promise<void> {
    const field = chatSettingsRowsFor()[chatSettingsCursor()]
    if (!field) return
    const view = settingsView() ?? emptySettingsView()
    const current = field === "style" ? view.responseStyle : view.tutorPolicy
    const values = field === "style" ? (["brief", "normal", "detailed"] as const) : (["direct", "guided", "socratic"] as const)
    const next = nextChatSetting(current, values)
    const patch =
      field === "style"
        ? { "ui.response_style": next }
        : { "ui.tutor_policy": next }
    const saved = await props.onConfigPatch?.(nestedPatch(patch))
    if (saved !== null && typeof saved === "object" && "ok" in saved && (saved as { ok: boolean }).ok === false) {
      const error = (saved as { error?: { message?: string } }).error
      notify(error?.message ?? "the chat setting could not be saved", "error")
      return
    }
    setSettingsView((value) => applyViewPatch(value ?? emptySettingsView(), patch))
    for (const controller of chatControllers.values()) controller.syncConfig()
    activeChat.syncConfig()
    notify(`${field === "style" ? "response style" : "tutor policy"}: ${next}`)
  }

  async function openInstructionsFile(): Promise<void> {
    const buffer = activeBuffer()
    const workspace = props.workspace
    if (buffer.kind !== "session" || !workspace) {
      notify("open a lock-in session first", "warn")
      return
    }
    const api = await loadPickerApi()
    const made = await api.createPicker({ root: filesystemRoot(workspace.paths.input), home: pickerHome(), limit: 1 })
    if (!made.ok) {
      notify(made.error.message, "error")
      return
    }
    await startSourcePicker(made.value)
    setPickerMode({ kind: "instructions", sessionId: buffer.id.replace(/^session:/, "") })
    update({ ...current(), pane: "sources", explorer: false, focus: "chat", mode: "normal", overlay: null })
  }

  function runSessionSettingsAction(): void {
    const state = sessionSettings()
    const row = selectedSessionSettingsRow(state)
    if (!row || !row.enabled) {
      notify("that action is not available right now", "warn")
      return
    }
    if (row.id === "edit") startSessionSettingsEdit()
    else if (row.id === "file") void openInstructionsFile()
    else void reExtractCurrentInstructions()
  }

  function openReaderText(title: string, text: string): void {
    setReaderDoc({ title: `${title} · i back`, lines: text.split("\n") })
    update({ ...current(), reader: true, focus: "reader", mode: "normal", overlay: null })
  }

  /**
   * A chat command is local: it is never sent to the model and never written to
   * `chat.jsonl`. Model-backed commands use the generation service directly.
   */
  function chatCommandFor(text: string): { handled: boolean; run?: () => Promise<void> } {
    const typed = text.trim()
    if (!typed.startsWith(":")) return { handled: false }
    const name = typed.split(/\s+/)[0]!.toLowerCase()
    if (typed === ":help") {
      openReaderText("Chat commands", chatCommandHelp(activeBuffer().kind))
      return { handled: true }
    }
    if (typed === ":chat-settings") {
      openChatSettings()
      return { handled: true }
    }
    if (/^:(brief|normal|detailed|direct|guided|socratic)$/.test(typed)) {
      const kind = activeBuffer().kind
      notify(
        kind === "chat"
          ? "response style applies to sessions, not Chill"
          : kind === "skill"
            ? "change response style and tutor policy in Settings → Chat settings"
            : "change response style in Settings → Chat settings",
        "warn",
      )
      return { handled: true }
    }

    const buffer = activeBuffer()
    const workspace = props.workspace
    if (buffer.kind !== "session") {
      notify(
        (LOCKIN_CHAT_COMMANDS as readonly string[]).includes(name)
          ? `${name} belongs to a lock-in session`
          : `unknown command ${name} · :help lists what works here`,
        "warn",
      )
      return { handled: true }
    }

    const id = buffer.id.replace(/^session:/, "")
    const bufferId = buffer.id
    const generate = props.generate
    const currentStepText = () =>
      currentStepAt(stepRowsFor(stepsText() ?? ""), stepsView().cursor)?.text

    if (typed === ":regenerate-steps") {
      if (!workspace || !generate) {
        notify("link a model to regenerate steps", "warn")
        return { handled: true }
      }
      if (stepsBuilding) {
        notify("steps are already being built", "warn")
        return { handled: true }
      }
      return {
        handled: true,
        run: async () => {
          stepsBuilding = true
          setStepsView({ ...initialStepsView, notice: "Building steps…" })
          const result = await regenerateSessionSteps({ workspace, id, generate })
          stepsBuilding = false
          if (activeBuffer().id !== bufferId) return
          if (!result.ok) {
            const message = stepFailureMessage(result.error.message)
            setStepsView({ ...initialStepsView, notice: message })
            notify(message, "error")
            return
          }
          setStepsText(result.value.markdown)
          setStepsStale(false)
          setStepsView(initialStepsView)
          notify(
            result.value.lost > 0
              ? `steps regenerated · kept ${result.value.kept} checked, dropped ${result.value.lost}`
              : "steps regenerated",
          )
        },
      }
    }

    if (typed === ":next") {
      const rows = stepRowsFor(stepsText() ?? "")
      const next = rows.findIndex((row) => row.kind === "step" && !row.checked)
      if (next === -1) {
        notify("every step is checked", "info")
      } else {
        setStepsView({ ...initialStepsView, cursor: next })
        update({ ...current(), reader: true, focus: "reader", mode: "normal", overlay: null })
        notify("next step ready", "info")
      }
      return { handled: true }
    }

    if (typed === ":questions") {
      return {
        handled: true,
        run: async () => {
          if (!workspace) return
          const text = await loadSessionQuestions(workspace, id)
          if (activeBuffer().id !== bufferId) return
          if (text === null) notify("no parked questions", "info")
          else openReaderText("Parked questions", text)
        },
      }
    }

    if (typed === ":calibrate") {
      setChoiceCommit({ kind: "intake-level" })
      setChoice({
        title: "Starting level",
        hint: "Calibrates step detail and explanation depth; it is not a test.",
        options: [
          { label: "New to this", detail: "more prerequisites and smaller steps", value: "beginner" },
          { label: "Some familiarity", detail: "normal step detail", value: "intermediate" },
          { label: "Confident", detail: "fewer prerequisites, faster pace", value: "advanced" },
        ],
        index: 1,
      })
      return { handled: true }
    }

    if (typed.startsWith(":park ")) {
      const question = typed.slice(":park ".length).trim()
      if (question === "") {
        notify("write the question after :park", "warn")
        return { handled: true }
      }
      const step = currentStepText()
      return {
        handled: true,
        run: async () => {
          if (!workspace) return
          const result = await parkSessionQuestion({ workspace, id, text: question, ...(step ? { step } : {}) })
          if (!result.ok) notify(result.error.message, "error")
          else notify(`parked question · ${result.value} waiting · :questions`, "info")
        },
      }
    }

    if (typed.startsWith(":mistake ")) {
      const mistake = typed.slice(":mistake ".length).trim()
      if (mistake === "") {
        notify("write the misconception after :mistake", "warn")
        return { handled: true }
      }
      const step = currentStepText()
      return {
        handled: true,
        run: async () => {
          if (!workspace) return
          const result = await appendSessionMisconception({ workspace, id, text: mistake, ...(step ? { step } : {}) })
          if (!result.ok) notify(result.error.message, "error")
          else notify("misconception recorded", "info")
        },
      }
    }

    if (typed.startsWith(":rate ")) {
      const rating = Number(typed.slice(":rate ".length).trim())
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        notify("use :rate 1-5", "warn")
        return { handled: true }
      }
      const step = currentStepText()
      return {
        handled: true,
        run: async () => {
          if (!workspace) return
          const result = await recordSessionConfidence({ workspace, id, rating, ...(step ? { step } : {}) })
          if (!result.ok) notify(result.error.message, "error")
          else notify(`confidence recorded: ${rating}/5`, "info")
        },
      }
    }

    if (typed === ":contract" || typed === ":contradictions" || typed.startsWith(":check ")) {
      if (!workspace || !generate) {
        notify("link a model to run this command", "warn")
        return { handled: true }
      }
      const kind = typed === ":contract" ? "contract" : typed === ":contradictions" ? "contradictions" : "check"
      const attempt = typed.startsWith(":check ") ? typed.slice(":check ".length).trim() : undefined
      if (kind === "check" && (attempt === undefined || attempt === "")) {
        notify("write your attempt after :check", "warn")
        return { handled: true }
      }
      return {
        handled: true,
        run: async () => {
          notify(kind === "check" ? "reviewing attempt…" : `building ${kind}…`, "info")
          const result = await generateSessionDocument({
            workspace,
            id,
            kind,
            generate,
            ...(attempt === undefined ? {} : { attempt }),
          })
          if (activeBuffer().id !== bufferId) return
          if (!result.ok) {
            notify(result.error.message, "error")
            return
          }
          if (kind === "contract") {
            setStepsStale(true)
            notify("contract saved · :regenerate-steps to adapt the plan", "info")
          }
          const title = kind === "contract" ? "Deliverable contract" : kind === "contradictions" ? "Source contradictions" : "Attempt review"
          openReaderText(title, result.value.text)
        },
      }
    }

    if (typed === ":learning-web" || typed.startsWith(":learning-web ")) {
      return { handled: false }
    }
    notify("unknown chat command · :help lists them", "warn")
    return { handled: true }
  }

  /**
   * Make a buffer current: its project/agent/skill become the active context.
   *
   * `keepMenu` is for the buffer manager: picking a buffer switches what is
   * behind the menu, so the menu can stay up until Esc (an editor's buffer list
   * works the same way).
   */
  function switchBuffer(buffer: WorkBuffer, keepMenu = false) {
    activateChat(buffer.id)
    setSidebarCursor(0)
    // Reader data belongs to the buffer that loaded it; clear before branching
    // so a skill/project cannot inherit a session's steps.
    setWorkHome(null)
    setStepsText(null)
    setStepsView(initialStepsView)
    const sidebarProject = projects().find((entry) => entry.id === buffer.projectId)
    const showAgents =
      (buffer.kind === "project" || buffer.kind === "agent") && sidebarProject?.swarmId != null
    const land = (reader: boolean) =>
      update({
        ...current(),
        pane: keepMenu ? "buffers" : "chat",
        reader,
        explorer: false,
        agentSidebar: showAgents,
        focus: reader ? "reader" : "chat",
        mode: "normal",
        overlay: null,
      })

    if (buffer.kind === "achievements") {
      setCourse(null)
      setOpenChapter(null)
      setChapterText("")
      setReaderDoc(null)
      setDeckData(null)
      setDeckView(initialDeckView)
      setActiveProject(null)
      setActiveAgent(null)
      setOpenSwarm(null)
      update({
        ...current(),
        pane: "achievements",
        reader: false,
        explorer: false,
        agentSidebar: false,
        focus: "chat",
        mode: "normal",
        overlay: null,
      })
      return
    }

    if (buffer.kind === "skill") {
      setReaderDoc(null)
      setDeckData(null)
      setDeckView(initialDeckView)
      setActiveProject(null)
      setActiveAgent(null)
      setOpenSwarm(null)
      const loaded = buffer.courseId ? skillCourses()[buffer.courseId] : undefined
      // Back to the chapter list, the way reopening a document does.
      setCourse(loaded ? { ...loaded } : null)
      setChapterCursor(0)
      setOpenChapter(null)
      setChapterText("")
      setReaderOffset(0)
      land(buffer.chatId === undefined && loaded !== undefined)
      return
    }

    if (buffer.kind !== "project" && buffer.kind !== "agent") {
      setWorkHome(null)
    }
    if (buffer.kind !== "session") {
      setStepsText(null)
      setStepsView(initialStepsView)
    } else if (props.workspace) {
      const id = buffer.id.replace(/^session:/, "")
      const workspace = props.workspace
      void loadSessionSteps(workspace, id)
        .then(async (text) => {
          if (currentBuffer() !== buffer.id) return
          setStepsText(text)
          setStepsView(initialStepsView)
          const [stale, parked] = await Promise.all([
            sessionNeedsStepRefresh(workspace, id),
            loadParkedQuestionCount(workspace, id),
          ])
          if (currentBuffer() !== buffer.id) return
          setStepsStale(stale)
          if (stale) {
            setStepsView({
              ...initialStepsView,
              notice: "steps are older than the current instructions or sources · press R to regenerate",
            })
          } else if (parked > 0) {
            notify(`${parked} parked question${parked === 1 ? "" : "s"} · :questions`, "info")
          }
          if (text === null || text.trim() === "") buildStepsForSession(id, buffer.id)
        })
        .catch(() => {
          if (currentBuffer() === buffer.id) {
            setStepsText(null)
            setStepsStale(false)
          }
        })
    }
    setCourse(null)
    setOpenChapter(null)
    setChapterText("")
    setReaderDoc(null)
    setDeckData(null)
    setDeckView(initialDeckView)
    if (buffer.kind === "chat") {
      setActiveProject(null)
      setActiveAgent(null)
      setOpenSwarm(null)
      land(false)
      return
    }
    const project = projects().find((entry) => entry.id === buffer.projectId)
    if ((buffer.kind === "project" || buffer.kind === "agent") && props.workspace && buffer.projectId) {
      void loadWorkHome(props.workspace, buffer.projectId)
        .then((home) => {
          if (currentBuffer() !== buffer.id) return
          setWorkHome(home)
        })
        .catch(() => {
          if (currentBuffer() === buffer.id) setWorkHome(null)
        })
    }
    setActiveProject(buffer.projectId ?? null)
    setActiveAgent(buffer.agentId ?? null)
    setOpenSwarm(project?.swarmId ?? null)
    // A session is worked in beside its steps: chat and reader together, the
    // way a skill session opens with its course. Projects land on their chat.
    land(buffer.kind === "session")
  }

  function openBuffer(buffer: WorkBuffer, keepMenu = false) {
    setBuffers((list) => (list.some((entry) => entry.id === buffer.id) ? list : [...list, buffer]))
    setCurrentBuffer(buffer.id)
    switchBuffer(buffer, keepMenu)
  }

  function releaseChat(id: string) {
    if (id === "home") return
    const ctrl = chatControllers.get(id)
    if (!ctrl) return
    ctrl.dispose()
    chatControllers.delete(id)
    for (const [taskId, owner] of chatTasks) if (owner === ctrl) chatTasks.delete(taskId)
    if (activeChat === ctrl) activeChat = controller
  }

  function closeBuffer(keepMenu = false) {
    const list = buffers()
    if (list.length <= 1) {
      releaseChat(list[0]!.id)
      setBuffers([HOME_BUFFER])
      setCurrentBuffer("home")
      // With only the home buffer there is no menu to keep.
      switchBuffer(HOME_BUFFER)
      return
    }
    const at = bufferIndex()
    releaseChat(list[at]!.id)
    const next = list.filter((_, index) => index !== at)
    const target = next[Math.min(at, next.length - 1)]!
    setBuffers(next)
    setCurrentBuffer(target.id)
    switchBuffer(target, keepMenu && next.length > 1)
  }

  function closeOtherBuffers() {
    const keep = activeBuffer()
    for (const buffer of buffers()) if (buffer.id !== keep.id) releaseChat(buffer.id)
    setBuffers([keep])
    setCurrentBuffer(keep.id)
    switchBuffer(keep)
  }

  function closeAllBuffers() {
    for (const buffer of buffers()) if (buffer.id !== "home") releaseChat(buffer.id)
    setBuffers([HOME_BUFFER])
    setCurrentBuffer("home")
    switchBuffer(HOME_BUFFER)
  }

  function stepBuffer(delta: number) {
    const list = buffers()
    if (list.length === 0) return
    const at = (bufferIndex() + delta + list.length) % list.length
    const target = list[at]!
    setCurrentBuffer(target.id)
    switchBuffer(target)
  }

  /** The agent the settings window is on. */
  function currentAgent() {
    const open = openSwarm()
    if (!open) return undefined
    return swarms().find((swarm) => swarm.id === open)?.agents.find((agent) => agent.id === editingAgent())
  }

  /** Enter on a settings field: a prompt for text, a choice for model/permissions. */
  function openAgentField(field: AgentField, agent: { id: string; name: string }) {
    if (field === "name") {
      setPrompt({ title: "Agent name", hint: "What it is called in the swarm.", value: agent.name, kind: "agent-name" })
      return
    }
    if (field === "task") {
      setPrompt({ title: `Task for ${agent.name}`, hint: "One sentence: what is this agent responsible for?", value: "", kind: "agent-task-edit" })
      return
    }
    if (field === "model") {
      const current = currentAgent()?.model || "inherit"
      setChoice({
        title: "Model",
        hint: "Inherit follows the project's model.",
        options: AGENT_MODELS.map((model) => ({ label: model, value: model })),
        index: Math.max(0, AGENT_MODELS.indexOf(current as never)),
      })
      setChoiceCommit({ kind: "agent-model" })
      return
    }
    const current = currentAgent()?.permissions ?? "read-only"
    setChoice({
      title: "Permissions",
      hint: "read-only reads, write edits files, commands may run them.",
      options: AGENT_PERMISSIONS.map((value) => ({ label: value, value })),
      index: Math.max(0, AGENT_PERMISSIONS.indexOf(current as never)),
    })
    setChoiceCommit({ kind: "agent-permissions" })
  }

  /** What a choice is for, since the chooser itself is generic. */
  type ChoiceCommit =
    | { kind: "project-mode" }
    | { kind: "agent-model" }
    | { kind: "agent-permissions" }
    | { kind: "agent-template"; templates: AgentTemplate[]; projectId: string }
    | { kind: "lockin-instructions" }
    | { kind: "intake-level" }
  const [choiceCommit, setChoiceCommit] = createSignal<ChoiceCommit>({ kind: "project-mode" })

  /** Read a chapter's guide (or practical) and show it. */
  async function openChapterAt(subject: Course, chapterId: string, practical: boolean) {
    const workspace = props.workspace
    if (!workspace) return
    const bufferId = activeBuffer().id
    if (props.readChapterText) {
      const injected = await props.readChapterText(subject, chapterId, practical)
      if (activeBuffer().id !== bufferId) return
      if (!injected.ok) {
        notify(injected.message, "error")
        return
      }
      setOpenChapter({ id: chapterId, practical })
      setChapterText(injected.text)
      setReaderOffset(0)
      // Same place the real read goes: the reader beside the chat. A seam must
      // not put the chapter in a different pane than the app does.
      update({ ...current(), pane: "chat", reader: true, focus: "reader", mode: "normal" })
      return
    }
    const result = await loadChapter(workspace, subject, chapterId, practical)
    if (activeBuffer().id !== bufferId) return
    if (!result.ok) {
      notify(result.message, "error")
      return
    }
    setOpenChapter({ id: chapterId, practical })
    setChapterText(result.text)
    setReaderOffset(0)
    update({ ...current(), pane: "chat", reader: true, focus: "reader", mode: "normal" })
  }

  async function refreshPlugins(): Promise<ServerRow[]> {
    const runtime = props.pluginRuntime
    if (!runtime) return []
    const rows = await runtime.refresh().catch(() => [])
    setPluginRows(rows)
    setPluginCursor((cursor) => Math.max(0, Math.min(cursor, rows.length - 1)))
    return rows
  }

  /** Reload the review queue; returns the nudge line, if any. */
  async function refreshReview(): Promise<string | null> {
    const workspace = props.workspace
    if (!workspace) return null
    const loaded = await loadReview(workspace).catch(() => null)
    if (loaded === null) return null
    setReviewItems(loaded.items)
    return loaded.nudge.suggestions[0]?.message ?? null
  }

  /** Reload the lock-in list after a create/delete. */
  async function refreshSessions() {
    const workspace = props.workspace
    if (props.loadSessions) {
      setSessionsState(initialSessions(await props.loadSessions()))
      return
    }
    if (!workspace) return
    void loadSessionRows(workspace)
      .then((rows) => setSessionsState(initialSessions(rows)))
      .catch(() => {})
  }

  function pickerHome(): string {
    return props.sourceHome ?? homedir()
  }

  async function loadPickerApi() {
    return pickerApi()
  }

  /** Name -> picker. Creation itself waits for the review screen. */
  async function reloadArchive() {
    const settings = settingsView()
    const github = settings?.archiveBackend === "github" ? props.createGithubArchive : undefined
    if (settings?.archiveBackend === "github" && github === undefined) return
    const loaded = await loadArchiveRows({
      archiveRoot: settings?.archiveFolder ?? "",
      backend: settings?.archiveBackend === "github" ? "github" : "folder",
      ...(props.workspace?.root === undefined ? {} : { workspaceRoot: props.workspace.root }),
      ...(github === undefined ? {} : { createGithubArchive: github }),
    })
    if (!loaded.ok) return
    setArchiveState({
      ...initialArchive(loaded.rows),
      backend: settings?.archiveBackend === "github" ? "github" : "folder",
    })
  }

  async function openSourcePicker(name: string) {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to create a lock-in session", "error")
      return
    }
    const api = await loadPickerApi()
    const made = await api.createPicker({ root: filesystemRoot(workspace.paths.input), home: pickerHome() })
    if (!made.ok) {
      notify(made.error.message, "error")
      return
    }
    await startSourcePicker(made.value)
    setPickerMode({ kind: "create" })
    setPendingSessionName(name)
    update({ ...current(), pane: "sources", explorer: false, focus: "chat", mode: "normal", overlay: null })
  }

  /** Start at the workspace input folder but rooted at the filesystem root. */
  async function startSourcePicker(state: PickerState, existing: string[] = []): Promise<void> {
    const api = await loadPickerApi()
    const input = props.workspace?.paths.input
    const next = input ? await api.navigate(state, input) : null
    setSourceState(next !== null && next.ok ? next.value : state)
    setSourceView(initialPickerView)
    setExistingSources(existing)
    stopSourceSearch()
  }

  /** Open the same picker against an existing session's sources. */
  async function openAddSources(sessionId: string) {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to add sources", "error")
      return
    }
    const api = await loadPickerApi()
    const made = await api.createPicker({ root: filesystemRoot(workspace.paths.input), home: pickerHome() })
    if (!made.ok) {
      notify(made.error.message, "error")
      return
    }
    await startSourcePicker(made.value, await loadSessionSourceNames(workspace, sessionId))
    setPickerMode({ kind: "add", sessionId })
    update({ ...current(), pane: "sources", explorer: false, focus: "chat", mode: "normal", overlay: null })
  }

  /** The same picker, gathering into a skill goal's sources. */
  async function openGatherSources(goalId: string, goalName: string) {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to add sources", "error")
      return
    }
    const api = await loadPickerApi()
    const made = await api.createPicker({ root: filesystemRoot(workspace.paths.input), home: pickerHome() })
    if (!made.ok) {
      notify(made.error.message, "error")
      return
    }
    await startSourcePicker(made.value, await loadGoalSourceNames(workspace, goalId))
    setPickerMode({ kind: "gather", goalId, goalName })
    update({ ...current(), pane: "sources", explorer: false, focus: "chat", mode: "normal", overlay: null })
  }

  async function createLockInFromPicker(
    goal: string,
    name: string,
    picker: PickerState,
    instructionsFile?: string,
  ) {
    const requested = {
      name,
      prompt: goal,
      files: [...picker.marks],
      ...(instructionsFile === undefined ? {} : { instructionsFile }),
    }
    const made = props.createLockIn
      ? await props.createLockIn(requested)
      : await createLockIn({ workspace: props.workspace!, created: new Date(), ...requested })
    if (!made.ok) {
      // Keep the selection: a failed create must not make the user pick again.
      const message = "message" in made ? made.message : made.error.message
      setPendingSessionName(name)
      if (instructionsFile === undefined) {
        setSourceState(picker)
        setSourceView(initialPickerView)
        setPickerMode({ kind: "create" })
      } else {
        // Stay on the instruction picker with its mark intact so the user can
        // retry the same file or choose another one.
        setPendingSourcePicker(picker)
        setSourceView((view) => ({ ...view, error: message, blocked: null }))
      }
      update({ ...current(), pane: "sources", explorer: false, focus: "chat", mode: "normal", overlay: null })
      notify(message, "error")
      return
    }
    const session = "value" in made ? made.value.session : made.session
    setSourceState(null)
    setSourceView(initialPickerView)
    setExistingSources([])
    stopSourceSearch()
    setPendingSourcePicker(null)
    setPendingSessionName("")
    setPickerMode({ kind: "create" })
    await refreshSessions()
    notify(`lock-in session created: ${session.name}`)
    openBuffer({
      id: `session:${session.id}`,
      label: session.name,
      kind: "session",
    })
  }

  /** Choose one file to use as the assignment instructions before creation. */
  async function openLockInInstructionsPicker(): Promise<void> {
    const workspace = props.workspace
    const sources = sourceState()
    if (!workspace || !sources) {
      notify("choose the session sources first", "warn")
      return
    }
    const api = await loadPickerApi()
    const made = await api.createPicker({ root: filesystemRoot(workspace.paths.input), home: pickerHome(), limit: 1 })
    if (!made.ok) {
      notify(made.error.message, "error")
      return
    }
    setPendingSourcePicker(sources)
    await startSourcePicker(made.value)
    setPickerMode({ kind: "lockin-instructions", name: pendingSessionName() || "lock-in session" })
    update({ ...current(), pane: "sources", explorer: false, focus: "chat", mode: "normal", overlay: null })
  }

  function stopSourceSearch(): void {
    if (sourceSearchTimer) {
      clearTimeout(sourceSearchTimer)
      sourceSearchTimer = null
    }
    sourceSearchAbort?.abort()
    sourceSearchAbort = null
    sourceSearchId += 1
  }

  /**
   * A keystroke only queues a search. The 150 ms window keeps a home-wide walk
   * from starting on every character, and aborting the previous controller
   * stops a stale walk instead of letting it finish behind the new one.
   */
  function queueSourceSearch(state: PickerState, query: string, immediate = false): void {
    if (sourceSearchTimer) {
      clearTimeout(sourceSearchTimer)
      sourceSearchTimer = null
    }
    sourceSearchAbort?.abort()
    sourceSearchAbort = null
    // Invalidate the in-flight walk before the debounce starts, so a result
    // that resolves during the window cannot repaint the new query.
    sourceSearchId += 1
    const text = query.trim()
    setSourceView((view) => ({
      ...view,
      query,
      searching: text !== "",
      error: null,
      cursor: 0,
      pathResult: null,
      results: [],
      visited: 0,
      capped: false,
    }))
    const run = () => {
      sourceSearchTimer = null
      void runSourceSearch(state, query)
    }
    if (immediate) run()
    else sourceSearchTimer = setTimeout(run, 150)
  }

  async function runSourceSearch(state: PickerState, query: string): Promise<void> {
    const id = ++sourceSearchId
    sourceSearchAbort?.abort()
    const controller = new AbortController()
    sourceSearchAbort = controller
    const text = query.trim()
    setSourceView((view) => ({
      ...view,
      query,
      searching: text !== "",
      error: null,
      cursor: 0,
      pathResult: null,
      visited: 0,
      capped: false,
    }))
    if (text === "") {
      setSourceView((view) => ({ ...view, results: [], searching: false }))
      return
    }

    const api = await loadPickerApi()
    const scopeRoot = sourceView().scope === "home" ? state.home : state.cwd
    // Every query is searched and also tried as a path; resolving an existing
    // file pins it above the ranked matches instead of making the user guess
    // whether a slash made it a path or a filter.
    const resolved = await api.resolvePickerPath(state, text)
    if (id !== sourceSearchId || controller.signal.aborted) return
    const pinned = resolved?.ok ? await api.entryAt(state, resolved.value.path, scopeRoot) : null
    if (id !== sourceSearchId || controller.signal.aborted) return

    const found = await api.searchFiles(state, text, { scopeRoot, signal: controller.signal })
    if (id !== sourceSearchId || controller.signal.aborted) return
    if (sourceSearchAbort === controller) sourceSearchAbort = null
    if (!found.ok) {
      setSourceView((view) => ({
        ...view,
        searching: false,
        results: [],
        pathResult: null,
        error: pickerErrorLine(found.error),
      }))
      return
    }
    const marked = new Set((sourceState() ?? state).marks)
    const decorate = (entry: PickerEntry): PickerEntry => ({ ...entry, marked: marked.has(entry.path) })
    setSourceView((view) => ({
      ...view,
      searching: false,
      results: found.value.entries.map(decorate),
      pathResult: pinned?.ok ? decorate(pinned.value) : null,
      visited: found.value.visited,
      capped: found.value.capped,
      cursor: 0,
      error:
        isPathQuery(text) && !resolved.ok && found.value.entries.length === 0
          ? pickerErrorLine(resolved.error)
          : null,
    }))
  }

  async function handleSourceInput(press: ReturnType<typeof normalisePress>, event: Parameters<Parameters<typeof useKeyboard>[0]>[0]) {
    const state = sourceState()
    if (!state) return
    const api = await loadPickerApi()
    const setError = (message: string) => setSourceView((view) => ({ ...view, error: message }))
    const view = sourceView()

    /** Enter continues from review, and confirms a file selected in browse. */
    const confirmSourceSelection = async () => {
      const active = sourceState() ?? state
      const mode = pickerMode()
      if (mode.kind === "gather") {
        if (active.marks.length === 0) {
          setSourceView((view) => ({ ...view, blocked: "mark at least one file", error: null }))
          return
        }
        const workspace = props.workspace
        if (workspace) {
          setSourceState(null)
          setExistingSources([])
          stopSourceSearch()
          setSourceView(initialPickerView)
          setPickerMode({ kind: "create" })
          update({ ...current(), pane: "chat", focus: "chat", mode: "normal" })
          void gatherSkillSources({
            workspace,
            goalId: mode.goalId,
            files: active.marks,
            retrievedAt: new Date().toISOString(),
          }).then((result) => {
            if (!result.ok) {
              notify(result.message, "error")
              return
            }
            notify(`gathered ${result.added} source${result.added === 1 ? "" : "s"}${result.skipped > 0 ? `, ${result.skipped} already there` : ""}`)
            void refreshGoals()
          })
        }
      } else if (mode.kind === "add") {
        if (active.marks.length === 0) {
          setSourceView((view) => ({ ...view, blocked: "mark at least one file", error: null }))
          return
        }
        const workspace = props.workspace
        if (workspace) {
          setSourceState(null)
          setExistingSources([])
          stopSourceSearch()
          setSourceView(initialPickerView)
          update({ ...current(), pane: "chat", focus: "chat", mode: "normal" })
          void addSessionSources({ workspace, id: mode.sessionId, files: active.marks }).then((result) => {
            if (!result.ok) {
              notify(result.error.message, "error")
              return
            }
            notify(`added ${result.value.added} source${result.value.added === 1 ? "" : "s"}${result.value.skipped > 0 ? `, ${result.value.skipped} already there` : ""}`)
            void refreshSessions()
          })
        }
      } else if (mode.kind === "instructions") {
        if (active.marks.length !== 1) {
          setSourceView((view) => ({
            ...view,
            blocked: "choose exactly one file as the assignment instructions",
            error: null,
          }))
          return
        }
        const workspace = props.workspace
        if (workspace) {
          const file = active.marks[0]!
          setSourceState(null)
          setExistingSources([])
          stopSourceSearch()
          setSourceView(initialPickerView)
          setPickerMode({ kind: "create" })
          sessionSettingsSessionId = mode.sessionId
          sessionSettingsSkipLoad = mode.sessionId
          const previousSettings = sessionSettings()
          update({ ...current(), pane: "session-settings", explorer: false, focus: "chat", mode: "normal", overlay: null })
          setSessionSettings({ ...previousSettings, busy: true, error: null, notice: null })
          void importSessionInstructionsFile({ workspace, id: mode.sessionId, file }).then((result) => {
            if (!result.ok) {
              setSessionSettings({ ...previousSettings, busy: false, error: result.error.message })
              return
            }
            setSessionSettings({
              ...initialSessionSettings,
              data: {
                prompt: result.value.prompt,
                instructions: result.value.instructions,
                originalPresent: true,
              },
              draft: result.value.prompt,
              notice: `instructions loaded from ${result.value.instructions.name}${result.value.added ? "" : " · already a source"}`,
            })
            void refreshSessions()
          })
        }
      } else if (mode.kind === "lockin-instructions") {
        if (active.marks.length !== 1) {
          setSourceView((view) => ({
            ...view,
            blocked: "choose exactly one file as the assignment instructions",
            error: null,
          }))
          return
        }
        const sources = pendingSourcePicker()
        if (!sources) {
          setSourceView((view) => ({
            ...view,
            blocked: "the session sources were lost; go back and choose them again",
            error: null,
          }))
          return
        }
        const file = active.marks[0]!
        void createLockInFromPicker("", mode.name, sources, file)
        event.preventDefault()
        return
      } else {
        setChoiceCommit({ kind: "lockin-instructions" })
        setChoice({
          title: "Assignment instructions",
          hint: "Write the assignment, or copy a PDF/DOCX/text file into the session.",
          options: [
            { label: "Write instructions", detail: "type or paste the assignment", value: "prompt" },
            { label: "Choose a file", detail: "PDF, DOCX or text · browsed like sources", value: "file" },
          ],
          index: 0,
        })
      }
    }

    /** Reset to browse without losing the chosen search scope. */
    const resetBrowse = (scope: PickerView["scope"]): PickerView => ({ ...initialPickerView, scope })

    const navigateTo = async (path: string): Promise<void> => {
      stopSourceSearch()
      const next = await api.navigate(state, path)
      if (!next.ok) {
        setError(pickerErrorLine(next.error))
        return
      }
      setSourceState(next.value)
      setSourceView((currentView) => ({
        ...resetBrowse(currentView.scope),
        blocked: pickerBlockedReason(next.value, currentView),
      }))
    }

    /**
     * Mark one file. A single-file picker replaces the previous choice instead
     * of reporting the source cap; a multi-file picker toggles on Space and
     * keeps an existing mark on Enter.
     */
    const markFile = async (path: string, keepQuery: boolean, toggle = true): Promise<void> => {
      let working = state
      const single = working.limit === 1
      const already = working.marks.includes(path)
      if (single) {
        if (!already) {
          const previous = working.marks[0]
          if (previous !== undefined) {
            const cleared = api.mark(working, previous)
            if (!cleared.ok) {
              setError(pickerErrorLine(cleared.error))
              return
            }
            working = cleared.value
          }
          const next = api.mark(working, path)
          if (!next.ok) {
            setError(pickerErrorLine(next.error))
            return
          }
          working = next.value
        }
        setSourceState(working)
      } else if (!(already && !toggle)) {
        const next = api.mark(working, path)
        if (!next.ok) {
          setError(pickerErrorLine(next.error))
          return
        }
        working = next.value
        setSourceState(working)
      }

      if (keepQuery) {
        setSourceView((currentView) => ({
          ...currentView,
          error: null,
          blocked: pickerBlockedReason(working, currentView),
          results: currentView.results.map((entry) => ({
            ...entry,
            marked: working.marks.includes(entry.path),
          })),
          pathResult: currentView.pathResult
            ? { ...currentView.pathResult, marked: working.marks.includes(currentView.pathResult.path) }
            : null,
        }))
        return
      }

      // Reveal the chosen file in its own directory so the mark is visible.
      stopSourceSearch()
      const folder = dirname(path)
      const navigated = await api.navigate(working, folder)
      const landed = navigated.ok ? navigated.value : working
      setSourceState(landed)
      const at = landed.entries.findIndex((entry) => entry.path === path)
      setSourceView((currentView) => ({
        ...resetBrowse(currentView.scope),
        cursor: at >= 0 ? at : 0,
        blocked: pickerBlockedReason(landed, currentView),
      }))
    }

    /** Apply the highlighted result: open a directory, or choose a file. */
    const applyCurrent = async (): Promise<void> => {
      let entry = pickerCurrentEntry(state, sourceView())
      const typed = sourceView().query.trim()
      if (!entry && typed !== "") {
        // Enter must work before the debounced search has produced a row.
        const resolved = await api.resolvePickerPath(state, typed)
        if (resolved.ok) {
          const base = sourceView().scope === "home" ? state.home : state.cwd
          const described = await api.entryAt(state, resolved.value.path, base)
          if (described.ok) entry = described.value
        } else if (isPathQuery(typed)) {
          setError(pickerErrorLine(resolved.error))
          return
        }
      }
      if (!entry) {
        if (isPathQuery(typed)) setError("That path is not a file or directory.")
        else if (typed === "") setSourceView((currentView) => ({ ...currentView, editing: false }))
        // A non-empty filter with no result keeps the input, so a typo can be
        // corrected instead of dropping the user back into the browser.
        return
      }
      if (entry.kind === "directory") {
        await navigateTo(entry.path)
        return
      }
      await markFile(entry.path, state.limit === 1, false)
      if (state.limit === 1) await confirmSourceSelection()
    }

    const removeMarked = async (index: number): Promise<void> => {
      const path = state.marks[index]
      if (path === undefined) return
      const next = api.mark(state, path)
      if (!next.ok) {
        setError(pickerErrorLine(next.error))
        return
      }
      setSourceState(next.value)
      const marks = new Set(next.value.marks)
      setSourceView((currentView) => {
        const last = Math.max(0, next.value.marks.length - 1)
        return {
          ...currentView,
          error: null,
          cursor: Math.max(0, Math.min(last, currentView.cursor)),
          sourcesCursor: Math.max(0, Math.min(last, currentView.sourcesCursor)),
          blocked: pickerBlockedReason(next.value, currentView),
          results: currentView.results.map((entry) => ({
            ...entry,
            marked: marks.has(entry.path),
          })),
          pathResult: currentView.pathResult
            ? { ...currentView.pathResult, marked: marks.has(currentView.pathResult.path) }
            : null,
        }
      })
    }

    const reveal = async (path: string): Promise<void> => {
      stopSourceSearch()
      const navigated = await api.navigate(state, dirname(path))
      if (!navigated.ok) {
        setError(pickerErrorLine(navigated.error))
        return
      }
      setSourceState(navigated.value)
      const at = navigated.value.entries.findIndex((entry) => entry.path === path)
      setSourceView((currentView) => ({
        ...resetBrowse(currentView.scope),
        focus: "list",
        cursor: at >= 0 ? at : 0,
      }))
    }

    const markFolderCurrent = async (): Promise<void> => {
      const entry = pickerCurrentEntry(state, sourceView())
      if (entry?.kind !== "directory") {
        notify("put the cursor on a folder to mark it", "warn")
        return
      }
      const next = await api.markFolder(state, entry.path)
      if (!next.ok) {
        setError(pickerErrorLine(next.error))
        return
      }
      setSourceState(next.value)
      const marks = new Set(next.value.marks)
      setSourceView((currentView) => ({
        ...currentView,
        error: null,
        blocked: pickerBlockedReason(next.value, currentView),
        results: currentView.results.map((entry) => ({
          ...entry,
          marked: marks.has(entry.path),
        })),
        pathResult: currentView.pathResult
          ? { ...currentView.pathResult, marked: marks.has(currentView.pathResult.path) }
          : null,
      }))
    }

    const startSearch = (text = ""): void => {
      setSourceView((currentView) => ({
        ...currentView,
        editing: true,
        query: text,
        results: [],
        pathResult: null,
        cursor: 0,
        error: null,
        searching: false,
        visited: 0,
        capped: false,
      }))
      if (text.trim() !== "") queueSourceSearch(state, text)
    }

    const toggleScope = (): void => {
      const next = sourceView().scope === "home" ? "folder" : "home"
      setSourceView((currentView) => ({ ...currentView, scope: next, cursor: 0 }))
      if (sourceView().query.trim() !== "") queueSourceSearch(state, sourceView().query, true)
    }

    // Ctrl+F changes the search scope without leaving the input.
    if (press.name === "f" && press.ctrl) {
      toggleScope()
      event.preventDefault()
      return
    }

    // The right-hand manifest has its own small key set.
    if (view.focus === "sources" && !view.editing) {
      if (press.name === "tab" || press.name === "escape") {
        setSourceView((currentView) => ({ ...currentView, focus: "list" }))
      } else if (press.name === "j" || press.name === "down") {
        setSourceView((currentView) => ({
          ...currentView,
          sourcesCursor: Math.min(Math.max(0, state.marks.length - 1), currentView.sourcesCursor + 1),
        }))
      } else if (press.name === "k" || press.name === "up") {
        setSourceView((currentView) => ({
          ...currentView,
          sourcesCursor: Math.max(0, currentView.sourcesCursor - 1),
        }))
      } else if (press.name === "d" || press.name === "backspace" || press.name === "delete") {
        await removeMarked(sourceView().sourcesCursor)
      } else if (press.name === "return") {
        const path = state.marks[sourceView().sourcesCursor]
        if (path !== undefined) await reveal(path)
      }
      event.preventDefault()
      return
    }

    if (press.name === "return" && view.step === "review") {
      await confirmSourceSelection()
      event.preventDefault()
      return
    }

    if (view.step === "review" && (press.name === "d" || press.name === "backspace" || press.name === "delete")) {
      await removeMarked(view.cursor)
      event.preventDefault()
      return
    }

    if (press.name === "/" && !view.editing) {
      startSearch()
      event.preventDefault()
      return
    }

    if (view.editing) {
      if (press.name === "escape") {
        if (view.query.trim() !== "") {
          stopSourceSearch()
          setSourceView((currentView) => ({
            ...currentView,
            query: "",
            results: [],
            pathResult: null,
            cursor: 0,
            searching: false,
            visited: 0,
            capped: false,
            error: null,
          }))
        } else {
          setSourceView((currentView) => ({ ...currentView, editing: false, results: [], pathResult: null, cursor: 0 }))
        }
      } else if (press.name === "backspace" || press.name === "delete") {
        const query = Array.from(view.query).slice(0, -1).join("")
        if (query.trim() === "") {
          stopSourceSearch()
          setSourceView((currentView) => ({
            ...currentView,
            query,
            results: [],
            pathResult: null,
            cursor: 0,
            searching: false,
            visited: 0,
            capped: false,
          }))
        } else queueSourceSearch(state, query)
      } else if (press.name === "u" && press.ctrl) {
        stopSourceSearch()
        setSourceView((currentView) => ({
          ...currentView,
          query: "",
          results: [],
          pathResult: null,
          cursor: 0,
          searching: false,
          visited: 0,
          capped: false,
        }))
      } else if (press.name === "w" && press.ctrl) {
        const query = view.query.replace(/\s*\S+\s*$/, "")
        if (query.trim() === "") {
          stopSourceSearch()
          setSourceView((currentView) => ({
            ...currentView,
            query,
            results: [],
            pathResult: null,
            cursor: 0,
            searching: false,
            visited: 0,
            capped: false,
          }))
        } else queueSourceSearch(state, query)
      } else if (press.name === "return") {
        await applyCurrent()
      } else if (press.name === "down" || press.name === "up") {
        setSourceView(movePicker(state, view, press.name === "down" ? 1 : -1))
      } else if (press.name === "tab") {
        setSourceView((currentView) => ({ ...currentView, focus: "sources", editing: false }))
      } else {
        const character = typedText(press, event)
        if (character !== null) queueSourceSearch(state, view.query + character)
      }
      event.preventDefault()
      return
    }

    const intent = pickerIntentFor(press.name, { shift: press.shift })
    if (!intent) return
    if (intent === "move-down" || intent === "move-up") {
      setSourceView((currentView) => movePicker(state, currentView, intent === "move-down" ? 1 : -1))
    } else if (intent === "top") {
      setSourceView((currentView) => movePicker(state, currentView, -9999))
    } else if (intent === "bottom") {
      setSourceView((currentView) => movePicker(state, currentView, 9999))
    } else if (intent === "enter-directory") {
      const entry = pickerCurrentEntry(state, sourceView())
      if (entry?.kind === "directory") {
        await navigateTo(entry.path)
      } else if (entry && state.limit === 1) {
        await markFile(entry.path, true, false)
        await confirmSourceSelection()
      } else {
        setSourceView((currentView) => ({
          ...currentView,
          step: "review",
          focus: "list",
          cursor: 0,
          error: null,
          blocked: pickerBlockedReason(state, currentView),
        }))
      }
    } else if (intent === "leave-directory") {
      await navigateTo("..")
    } else if (intent === "toggle-mark") {
      const entry = pickerCurrentEntry(state, sourceView())
      if (entry?.kind === "file") await markFile(entry.path, true)
      else if (entry?.kind === "directory") notify("A marks the whole folder", "warn")
    } else if (intent === "mark-folder") {
      await markFolderCurrent()
    } else if (intent === "review") {
      setSourceView((currentView) => ({
        ...currentView,
        step: "review",
        focus: "list",
        cursor: 0,
        error: null,
        blocked: pickerBlockedReason(state, currentView),
      }))
    } else if (intent === "focus-sources") {
      setSourceView((currentView) => ({
        ...currentView,
        focus: "sources",
        sourcesCursor: Math.max(0, Math.min(currentView.sourcesCursor, state.marks.length - 1)),
      }))
    } else if (intent === "remove-source") {
      // `d` removes only inside the manifest; in the file list it does nothing.
    } else if (intent === "cancel") {
      if (pickerMode().kind === "lockin-instructions") {
        const restore = pendingSourcePicker()
        if (restore) {
          setSourceState(restore)
          setSourceView({ ...initialPickerView, step: "review" })
          setPendingSourcePicker(null)
          setPickerMode({ kind: "create" })
        } else {
          stopSourceSearch()
          setSourceState(null)
          setExistingSources([])
          setPendingSessionName("")
          setPickerMode({ kind: "create" })
          update({ ...current(), pane: "chat", focus: "chat", mode: "normal" })
        }
      } else if (sourceView().step === "review") {
        setSourceView((currentView) => resetBrowse(currentView.scope))
      } else {
        stopSourceSearch()
        setSourceState(null)
        setExistingSources([])
        setPendingSessionName("")
        setPickerMode({ kind: "create" })
        update({ ...current(), pane: "chat", focus: "chat", mode: "normal" })
      }
    }
    event.preventDefault()
  }

  /** Reload the skill list from disk, so a delete or create shows up. */
  async function refreshGoals() {
    const workspace = props.workspace
    if (props.loadGoals) {
      setSkillsState(initialSkills(await props.loadGoals()))
      return
    }
    if (!workspace) return
    void loadGoalRows(workspace)
      .then((rows) => setSkillsState(initialSkills(rows)))
      .catch(() => {})
  }

  /**
   * Open a skill session's course in the reader.
   *
   * The list is goals; the chapters live in `goals/<id>/meta.json`. A goal with
   * no course says so rather than opening an empty reader.
   */
  async function openCourse(id: string, name: string) {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to open a skill session", "error")
      return
    }
    const injected = props.loadCourse ? await props.loadCourse(id) : null
    if (props.loadCourse && injected === null) {
      notify(`${name} has no course yet`, "warn")
      return
    }
    let opened: Course
    if (props.loadCourse && injected) {
      opened = injected
    } else {
      const loaded = await loadCourse(workspace, id)
      if (loaded === null) {
        notify(`${name} has no course yet`, "warn")
        return
      }
      opened = loaded
    }
    rememberCourse(opened)
    openBuffer({ id: `skill:${id}`, label: name, kind: "skill", courseId: id })
  }

  /** Build (when missing) and show a skill goal's guide or deck in the reader. */
  async function openOutput(kind: OutputKind): Promise<void> {
    const buffer = activeBuffer()
    const workspace = props.workspace
    if (buffer.kind !== "skill" || !workspace) {
      notify("open a skill session first; outputs belong to its goal", "warn")
      return
    }
    const goalId = buffer.courseId ?? buffer.id.replace(/^skill:/, "")
    const bufferId = buffer.id
    const openDeck = async () => {
      const loaded = await loadDeck(workspace, goalId, buffer.label)
      if (loaded === null || activeBuffer().id !== bufferId) return false
      setDeckData(loaded)
      setDeckView(initialDeckView)
      setReaderDoc(null)
      update({ ...current(), reader: true, focus: "reader", mode: "normal", overlay: null })
      return true
    }
    const existing = await readOutput(workspace, goalId, kind)
    if (activeBuffer().id !== bufferId) return
    if (existing !== null) {
      if (kind === "deck") {
        if (await openDeck()) return
        if (activeBuffer().id !== bufferId) return
      }
      setReaderDoc({ title: existing.title, lines: existing.lines })
      setDeckData(null)
      update({ ...current(), reader: true, focus: "reader", mode: "normal", overlay: null })
      return
    }
    if (!props.generate) {
      notify("link a model to build this output", "warn")
      return
    }
    notify(`building ${kind}…`)
    const built = await buildOutput({ workspace, goalId, kind, generate: props.generate })
    if (activeBuffer().id !== bufferId) return
    if (!built.ok) {
      notify(built.error.message, "error")
      return
    }
    if (kind === "deck") {
      if (await openDeck()) return
      if (activeBuffer().id !== bufferId) return
    }
    setReaderDoc({ title: built.value.title, lines: built.value.lines })
    setDeckData(null)
    update({ ...current(), reader: true, focus: "reader", mode: "normal", overlay: null })
  }

  /** Load the project's git summary and show it in the reader. */
  async function openChanges(): Promise<void> {
    const buffer = activeBuffer()
    const workspace = props.workspace
    const projectId = buffer.projectId
    if (workspace === undefined || projectId === undefined) {
      notify("open a project first, then ask for its changes", "warn")
      return
    }
    const bufferId = buffer.id
    const result = await loadProjectChanges({ workspace, projectId })
    if (activeBuffer().id !== bufferId) return
    if (!result.ok) {
      notify(result.message, "warn")
      return
    }
    setDeckData(null)
    setReaderDoc(result.value)
    update({ ...current(), reader: true, focus: "reader", mode: "normal", overlay: null })
  }

  /** Open the full-window achievement inventory in its own buffer. */
  function openAchievements(): void {
    openBuffer({ id: "achievements", label: "Achievements", kind: "achievements" })
    const dir = settingsView()?.dataDir
    if (dir) {
      void loadAchievementSnapshot({ dataDir: dir, workspace: props.workspace })
        .then((snapshot) => {
          setAchievementMetrics(snapshot.metrics)
          setAchievementAwards(snapshot.awards)
          if (snapshot.warning) {
            setAchievementView((view) => ({ ...view, notice: snapshot.warning }))
          }
        })
        .catch(() => {})
    }
  }

  /** Open one chat inside a goal, not the goal's default chat. */
  function openSkillChat(goalId: string, goalName: string, chatId: string): void {
    openBuffer({
      id: `skill:${goalId}:${chatId}`,
      label: goalName,
      kind: "skill",
      courseId: goalId,
      chatId,
    })
  }

  /** Drop a lock-in session's buffer (its folder moved or went away). */
  function dropSessionBuffer(id: string) {
    const bufferId = `session:${id}`
    const list = buffers()
    const at = list.findIndex((entry) => entry.id === bufferId)
    if (at < 0) return
    const next = list.filter((entry) => entry.id !== bufferId)
    const fallback = next.length > 0 ? next : [HOME_BUFFER]
    const wasCurrent = currentBuffer() === bufferId
    releaseChat(bufferId)
    setBuffers(fallback)
    if (wasCurrent) {
      const target = fallback[Math.min(at, fallback.length - 1)]!
      setCurrentBuffer(target.id)
      switchBuffer(target)
    }
  }

  /** Drop every buffer for a skill goal (its folder is gone). */
  function dropSkillBuffer(id: string) {
    const list = buffers()
    const at = list.findIndex((entry) => entry.courseId === id || entry.id === `skill:${id}`)
    if (at < 0) return
    const removed = list.filter((entry) => entry.courseId === id || entry.id === `skill:${id}`)
    for (const entry of removed) releaseChat(entry.id)
    const next = list.filter((entry) => !removed.includes(entry))
    const fallback = next.length > 0 ? next : [HOME_BUFFER]
    const wasCurrent = removed.some((entry) => entry.id === currentBuffer())
    setBuffers(fallback)
    setSkillCourses((all) => {
      const copy = { ...all }
      delete copy[id]
      return copy
    })
    if (wasCurrent) {
      const target = fallback[Math.min(at, fallback.length - 1)]!
      setCurrentBuffer(target.id)
      switchBuffer(target)
    }
  }

  /** Close every buffer that belongs to a project, keeping the manager open. */
  function closeProjectBuffers(projectId: string): void {
    const pane = current().pane
    const list = buffers()
    const removed = list.filter(
      (buffer) => buffer.projectId === projectId || buffer.id === `project:${projectId}`,
    )
    if (removed.length === 0) return
    for (const buffer of removed) releaseChat(buffer.id)
    const next = list.filter((buffer) => !removed.some((entry) => entry.id === buffer.id))
    setBuffers(next.length > 0 ? next : [HOME_BUFFER])
    if (removed.some((buffer) => buffer.id === currentBuffer())) {
      const target = next[0] ?? HOME_BUFFER
      setCurrentBuffer(target.id)
      switchBuffer(target)
      // Acting from the Projects manager should leave the manager open.
      if (pane === "projects") update({ ...current(), pane: "projects", mode: "normal", overlay: null })
    }
  }

  /** Toggle a project's archive flag; archived projects close their buffers. */
  function archiveProject(id: string, name: string): void {
    const project = projects().find((entry) => entry.id === id)
    if (!project) return
    const archived = project.archived !== true
    setProjects((list) => list.map((entry) => (entry.id === id ? { ...entry, archived } : entry)))
    if (archived) {
      if (activeProject() === id) setActiveProject(null)
      setActiveAgent(null)
      setOpenSwarm(null)
      closeProjectBuffers(id)
    }
    const workspace = props.workspace
    if (workspace) {
      void archiveProjectRecord({ workspace, id, archived }).then((result) => {
        if (result.ok) return
        setProjects((list) => list.map((entry) => (entry.id === id ? { ...entry, archived: !archived } : entry)))
        notify(`project not ${archived ? "archived" : "restored"}: ${result.error.message}`, "error")
      })
    }
    notify(`${archived ? "archived" : "restored"} project: ${name}`)
  }

  /** Remove a project's metadata, swarm and buffers; the folder on disk is untouched. */
  function deleteProject(id: string, name: string): void {
    const before = projects()
    setProjects((list) => list.filter((entry) => entry.id !== id))
    setSwarms((list) => list.filter((swarm) => swarm.projectId !== id))
    if (activeProject() === id) setActiveProject(null)
    setActiveAgent(null)
    setOpenSwarm(null)
    closeProjectBuffers(id)
    const workspace = props.workspace
    if (workspace) {
      void deleteProjectRecord({ workspace, id }).then((result) => {
        if (result.ok) return
        setProjects(before)
        notify(`project not deleted: ${result.error.message}`, "error")
      })
    }
    notify(`deleted project: ${name}`)
  }

  /** Write the project definition to `exports/project-<id>.zip`; never the folder. */
  async function exportProject(id: string, name: string): Promise<void> {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to export a project", "error")
      return
    }
    const project = projects().find((entry) => entry.id === id)
    if (!project) return
    const swarm = swarms().find((entry) => entry.id === project.swarmId)
    const result = await runProjectExport({
      workspace,
      project: {
        id: project.id,
        name: project.name,
        folder: project.folder,
        mode: project.mode,
        archived: project.archived === true,
        agents: (swarm?.agents ?? []).map((agent) => ({
          name: agent.name,
          task: agent.task,
          model: agent.model,
          permissions: agent.permissions,
        })),
      },
    })
    if (!result.ok) {
      notify(result.message, "error")
      return
    }
    notify(`exported project: ${name}: ${result.path}`)
  }

  function closeSkillSession(id: string): void {
    if (course()?.id === id) {
      setCourse(null)
      setOpenChapter(null)
      setChapterText("")
      setReaderOffset(0)
      update({ ...current(), reader: false })
    }
    dropSkillBuffer(id)
  }

  async function archiveSkillGoal(id: string, name: string): Promise<void> {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to archive a skill session", "error")
      return
    }
    const github = settingsView()?.archiveBackend === "github" ? props.createGithubArchive : undefined
    if (settingsView()?.archiveBackend === "github" && github === undefined) {
      notify("the GitHub archive backend is not available in this build", "warn")
      return
    }
    const result = await runGoalAction({
      workspace,
      id,
      action: "archive",
      archiveRoot: settingsView()?.archiveFolder ?? "",
      ...(github === undefined ? {} : { createGithubArchive: github }),
    })
    if (!result.ok) {
      notify(result.message, "error")
      return
    }
    setSkillsState((state) => ({
      ...state,
      goals: state.goals.filter((goal) => goal.id !== id),
      cursor: Math.max(0, Math.min(state.cursor, state.goals.length - 2)),
    }))
    closeSkillSession(id)
    notify(`archived skill session: ${name}`)
  }

  async function exportSkillGoal(id: string, name: string): Promise<void> {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to export a skill session", "error")
      return
    }
    const result = await runGoalAction({
      workspace,
      id,
      action: "export",
      archiveRoot: settingsView()?.archiveFolder ?? "",
    })
    if (!result.ok || result.action !== "export") {
      notify(result.ok ? "the export did not produce a file" : result.message, "error")
      return
    }
    notify(`exported ${name}: ${result.path}`)
  }

  /** Delete a skill session: its folder and the course inside it. */
  async function removeGoal(id: string, name: string) {
    const workspace = props.workspace
    if (!workspace) {
      notify("a workspace is needed to delete a skill session", "error")
      return
    }
    if (props.deleteGoal) {
      const injected = await props.deleteGoal(id)
      if (!injected.ok) {
        notify(injected.message, "error")
        return
      }
    } else {
      const result = await deleteSkillGoal(workspace, id)
      if (!result.ok) {
        notify(result.message, "error")
        return
      }
    }
    closeSkillSession(id)
    await refreshGoals()
    notify(`deleted skill session: ${name}`)
  }

  /** `c` marks the chapter read; `p` opens its practical. */
  async function toggleChapter(subject: Course, chapterId: string, practical: boolean) {
    const workspace = props.workspace
    if (!workspace) return
    const goalId = subject.id
    const chapter = subject.chapters.find((entry) => entry.id === chapterId)
    if (!chapter) return
    if (practical) {
      await openChapterAt(subject, chapterId, true)
      return
    }
    if (props.saveChapterDone) {
      const injected = await props.saveChapterDone(subject, chapterId, !chapter.done)
      if (course()?.id !== goalId) return
      if (!injected.ok) {
        notify(injected.message, "error")
        return
      }
      setCourse(injected.course)
      rememberCourse(injected.course)
      rememberProgress(injected.course)
      notify(`${chapter.title}: ${chapter.done ? "not complete" : "complete"}`)
      return
    }
    const result = await setChapterDone(workspace, subject, chapterId, !chapter.done)
    if (course()?.id !== goalId) return
    if (!result.ok) {
      notify(result.message, "error")
      return
    }
    setCourse(result.course)
    rememberCourse(result.course)
    rememberProgress(result.course)
    notify(`${chapter.title}: ${chapter.done ? "not complete" : "complete"}`)
  }

  /**
   * The leader's list is the contract: a chord that is not offered in this
   * context does nothing. Direct keys (`i`, `Esc`, arrows, help) are not leader
   * chords and are always live.
   */
  function leaderAllows(id: string): boolean {
    const action = registry.action(id)
    if (!action) return true
    const binding = registry.bindingFor(id)
    if (binding?.kind !== "leader") return true
    // The menu is a subset of what the shell can do. A hidden chord that is
    // otherwise usable (new lock-in, tasks, review) must still run. `reader` is
    // the exception: without a course it has no content to show.
    if (id === "reader") return leaderIds().includes(id)
    if (action.group === "plugin") return true
    return leaderIds().includes(id) || actionIsUsable(id)
  }

  function dispatch(id: string) {
    if (id === "quit") {
      renderer.destroy()
      return
    }
    if (id === "plugin-focus-next" || id === "plugin-focus-prev") {
      const target = appEffects?.cycleFocus(id === "plugin-focus-next" ? 1 : -1) ?? null
      if (target) notify(`plugin window: ${target.split("/").slice(1).join("/")}`)
      else notify("no focusable plugin windows", "warn")
      return
    }
    if (id === "plugins") {
      void refreshPlugins()
    }
    if (id === "update") {
      update({ ...current(), overlay: null, leaderPending: false, mode: "normal" })
      void runUpdate()
      return
    }
    if (id === "review") {
      void refreshReview().then((message) => {
        if (message) notify(message, "info")
      })
    }
    if (id === "lock-in") {
      // The chord was resolved inside the leader popup; close it before the
      // prompt takes the keyboard.
      update({ ...current(), overlay: null, leaderPending: false, mode: "normal" })
      setPrompt({ title: "New lock-in session", hint: "Name it, then choose its sources.", value: "", kind: "lockin-name" })
      return
    }
    if (id === "clear") {
      update({ ...current(), overlay: null, leaderPending: false, mode: "normal" })
      if (currentBuffer() !== "home") {
        notify(":clear is for Chill · this chat keeps its transcript", "warn")
        return
      }
      const cleared = activeChat.clearTranscript()
      notify(cleared.ok ? "chat cleared" : `not cleared · ${cleared.reason}`, cleared.ok ? "info" : "warn")
      return
    }
    if (id === "buffer-close") {
      closeBuffer()
      return
    }
    if (id === "buffer-close-others") {
      closeOtherBuffers()
      return
    }
    if (id === "buffer-close-all" || id === "home") {
      closeAllBuffers()
      return
    }
    if (id === "buffer-next") {
      stepBuffer(1)
      return
    }
    if (id === "buffer-prev") {
      stepBuffer(-1)
      return
    }
    if (id === "buffer-list") {
      update(reduce(current(), {
        type: "command-message",
        message: buffers()
          .map((buffer, index) => `${index + 1}:${buffer.id === currentBuffer() ? "*" : " "}${buffer.label}`)
          .join("  "),
      }))
      return
    }
    const action = registry.action(id)
    if (id === "achievements") {
      update({ ...current(), overlay: null, leaderPending: false, mode: "normal" })
      openAchievements()
      return
    }
    if (id === "add-sources") {
      const buffer = activeBuffer()
      if (buffer.kind === "session") void openAddSources(buffer.id.replace(/^session:/, ""))
      else if (buffer.kind === "skill") {
        void openGatherSources(
          buffer.courseId ?? buffer.id.replace(/^skill:/, ""),
          buffer.label,
        )
      } else notify("open a lock-in or skill session first, then add sources", "warn")
      return
    }
    if (id === "flashcards" || id === "session-outputs") {
      update({ ...current(), overlay: null, leaderPending: false, mode: "normal" })
      void openOutput(id === "flashcards" ? "deck" : "guide")
      return
    }
    if (id === "work-changes") {
      void openChanges()
      return
    }
    if (id === "work-sessions" || id === "work-new") {
      notify(`${action?.label ?? id} is not wired in this build`, "warn")
      return
    }
    if (id === "chat-settings") {
      openChatSettings()
      return
    }
    if (id === "session-settings" && activeBuffer().kind !== "session") {
      // The window edits one lock-in session's instructions; without one there
      // is nothing to show, so refuse with the next step instead of an error pane.
      notify("open a lock-in session to edit its instructions", "warn")
      return
    }
    if (!action) {
      // Surfaces without a key of their own (themes, archive, the work menus)
      // still open: the routing table is the authority, not the registry.
      if (PANE_FOR_ACTION[id] !== undefined) {
        update(reduce(current(), { type: "action", id }))
      }
      return
    }
    update(reduce(current(), { type: "action", id }))
    if (id === "down") moveCursor(1)
    else if (id === "up") moveCursor(-1)
    action.run?.({ actionId: id, scope: action.scope, mode: current().mode })
  }

  /** Resolve a key against each hosted side, primary first. */
  function resolveDirect(press: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) {
    for (const scope of sides()) {
      const hit = resolveKey({ registry, mode: current().mode, scope }, press)
      if (hit.kind !== "none") return hit
    }
    return { kind: "none" } as const
  }

  function resolveLeader(press: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) {
    for (const scope of sides()) {
      const hit = resolveLeaderKey({ registry, mode: "normal", scope }, press)
      if (hit.kind !== "none") return hit
    }
    return { kind: "none" } as const
  }

  /** A modal with no Enter handler of its own still leaves on Enter. */
  function handleModalEnter(
    state: ReturnType<typeof current>,
    press: ReturnType<typeof normalisePress>,
    event: Parameters<Parameters<typeof useKeyboard>[0]>[0],
  ): boolean {
    // A chooser with no Enter handler of its own still leaves on Enter.
    if (state.overlay === null && state.mode === "normal" && isModal(state.pane) && press.name === "return") {
      const next = reduce(state, { type: "open-item" })
      if (next.pane !== state.pane) {
        update(next)
        event.preventDefault()
        return true
      }
    }
    return false
  }

  /** Direct keys first, then the leader chord, exactly as the registry says. */
  function handleResolvedKeys(
    state: ReturnType<typeof current>,
    press: ReturnType<typeof normalisePress>,
    event: Parameters<Parameters<typeof useKeyboard>[0]>[0],
  ): boolean {
    const hit = resolveDirect(press)
    if (hit.kind === "leader-pending") {
      update(reduce(state, { type: "leader-open" }))
      event.preventDefault()
      return true
    }
    if (hit.kind === "action") {
      if (leaderAllows(hit.action.id)) dispatch(hit.action.id)
      else notify(`${hit.action.label} is not available here`, "warn")
      event.preventDefault()
    }
    return false
  }

  /** NORMAL-mode keys for the chat, the reader and every pane. */
  function handleOverlayInput(
    state: ReturnType<typeof current>,
    press: ReturnType<typeof normalisePress>,
    event: Parameters<Parameters<typeof useKeyboard>[0]>[0],
  ): boolean {
    // OpenCode-style: Shift+Tab cycles the chat's tool calling between plan and
    // build. Learning chats pin `learn` and answer with why they cannot switch.
    if (
      press.name === "tab" &&
      press.shift &&
      state.overlay === null &&
      prompt() === null &&
      choice() === null &&
      state.pane === "chat" &&
      state.focus === "chat" &&
      chat().toolsAvailable
    ) {
      const result = activeChat.toggleToolMode()
      if (result.ok) notify(`tool mode: ${result.mode}`)
      else notify(result.reason, "warn")
      event.preventDefault()
      return true
    }
    const openChoice = choice()
    if (openChoice) {
      if (press.name === "escape") {
        setChoice(null)
        setChoiceCommit({ kind: "project-mode" })
        event.preventDefault()
        return true
      }
      if (press.name === "down" || press.name === "j") {
        setChoice({ ...openChoice, index: Math.min(openChoice.options.length - 1, openChoice.index + 1) })
        event.preventDefault()
        return true
      }
      if (press.name === "up" || press.name === "k") {
        setChoice({ ...openChoice, index: Math.max(0, openChoice.index - 1) })
        event.preventDefault()
        return true
      }
      const numeric = /^[1-9]$/.test(press.name) ? Number(press.name) - 1 : -1
      // Project mode has a familiar mnemonic: s = single, w = swarm.
      const mode = press.name === "s" ? "chat" : press.name === "w" ? "swarm" : null
      const byValue = mode === null
        ? -1
        : openChoice.options.findIndex((option) => option.value === mode)
      const letter = press.name.length === 1
        ? openChoice.options.findIndex((option) => option.label.toLowerCase().startsWith(press.name))
        : -1
      const shortcut = numeric >= 0 ? numeric : byValue >= 0 ? byValue : letter
      if (press.name === "return" || (shortcut >= 0 && shortcut < openChoice.options.length)) {
        const chosen = shortcut >= 0 && shortcut < openChoice.options.length ? shortcut : openChoice.index
        const option = openChoice.options[chosen] ?? openChoice.options[0]
        const commit = choiceCommit()
        if (commit.kind === "lockin-instructions") {
          setChoice(null)
          setChoiceCommit({ kind: "project-mode" })
          if (option?.value === "file") {
            void openLockInInstructionsPicker()
          } else {
            setPrompt({
              title: "Goal or assignment",
              hint: "What should this session accomplish? Enter creates it.",
              value: "",
              kind: "lockin-goal",
            })
          }
          event.preventDefault()
          return true
        }
        if (commit.kind === "intake-level") {
          setChoice(null)
          setChoiceCommit({ kind: "project-mode" })
          const workspace = props.workspace
          const buffer = activeBuffer()
          const level = option?.value
          if (workspace && buffer.kind === "session" && (level === "beginner" || level === "intermediate" || level === "advanced")) {
            const id = buffer.id.replace(/^session:/, "")
            void saveIntakeLevel(workspace, id, level).then((saved) => {
              if (!saved.ok) notify(saved.error.message, "error")
              else {
                setStepsStale(true)
                notify(`starting level: ${level} · :regenerate-steps to adapt the plan`, "info")
              }
            })
          }
          event.preventDefault()
          return true
        }
        if (commit.kind === "agent-template") {
          const template = commit.templates[chosen]
          setChoice(null)
          setChoiceCommit({ kind: "project-mode" })
          const workspace = props.workspace
          const projectId = commit.projectId
          if (!template || !workspace) {
            notify("no project is open for this agent", "warn")
            event.preventDefault()
            return true
          }
          if (template && workspace && projectId) {
            void createAgentFromTemplate({
              workspace,
              projectId,
              templateId: template.id,
            }).then((result) => {
              if (!result.ok) {
                notify(result.error.message, "error")
                return
              }
              notify(`agent seeded from ${template.name}`)
              void loadProjectAgents(workspace, projectId).then((agents) => {
                setSwarms((list) =>
                  list.map((swarm) => (swarm.projectId === projectId ? { ...swarm, agents } : swarm)),
                )
                void loadWorkHome(workspace, projectId)
                  .then((home) => setWorkHome(home))
                  .catch(() => {})
              })
            })
          }
          event.preventDefault()
          return true
        }
        if (commit.kind === "agent-model" || commit.kind === "agent-permissions") {
          const id = editingAgent()
          const open = openSwarm()
          const value = option?.value ?? ""
          if (id && open) {
            setSwarms((list) =>
              list.map((swarm) =>
                swarm.id === open
                  ? {
                      ...swarm,
                      agents: swarm.agents.map((agent) =>
                        agent.id === id
                          ? commit.kind === "agent-model"
                            ? { ...agent, model: value === "inherit" ? "" : value }
                            : { ...agent, permissions: value as "read-only" | "write" | "commands" }
                          : agent,
                      ),
                    }
                  : swarm,
              ),
            )
            persistAgent(open, id)
          }
          setChoice(null)
          setChoiceCommit({ kind: "project-mode" })
          event.preventDefault()
          return true
        }
        const project = draft()
        const name = project?.name ?? "project"
        const folder = project?.folder ?? ""
        const id = makeProjectId(name, takenProjectIds())
        const mode = option?.value === "swarm" ? "swarm" : "chat"
        const swarmId = mode === "swarm" ? `swarm-${id}` : null
        setChoice(null)
        setProjects((list) => [
          ...list,
          { id, name, folder, mode, swarmId, swarmName: mode === "swarm" ? name : "" },
        ])
        // Do not open the project buffer until its meta.json exists. A composer
        // that accepts a send during the write would only produce a
        // "not registered" error.
        void persistNewProject({ id, name, folder, mode }).then((saved) => {
          if (!saved) return
          setActiveProject(id)
          openBuffer({
            id: `project:${id}`,
            label: name,
            kind: "project",
            projectId: id,
          })
          if (mode === "swarm" && swarmId !== null) {
            setSwarms((list) => [...list, { id: swarmId, name, projectId: id, agents: [] }])
            setOpenSwarm(swarmId)
            // The Agents screen stays visible behind the naming prompt: Esc then
            // leaves you on the list with the agents you just named.
            update({ ...current(), pane: "agents", explorer: false, focus: "chat", mode: "normal", overlay: null })
            setPrompt({ title: `Agent in ${name}`, hint: "Name it, then Enter. Esc when the swarm is staffed.", value: "", kind: "agent" })
          }
        })
        event.preventDefault()
        return true
      }
      return true
    }

    const active = prompt()
    if (active) {
      if (press.name === "escape") {
        const wasAgent = active.kind === "agent"
        setPrompt(null)
        setChoice(null)
        if (wasAgent) notify("swarm staffed · Space e then e on an agent to configure it")
        event.preventDefault()
        return true
      }
      if (press.name === "backspace" || press.name === "delete") {
        setPrompt({ ...active, value: Array.from(active.value).slice(0, -1).join("") })
        event.preventDefault()
        return true
      }
      if (press.name === "return") {
        if (active.kind === "provider-key" && active.provider) {
          const key = active.value.trim()
          if (key === "") {
            setPrompt({ ...active, hint: "Paste a key first, then press Enter." })
          } else {
            setPrompt(null)
            void models.submitPrompt(active.provider, key)
          }
          event.preventDefault()
          return true
        }
        const name = active.value.trim()
        if (active.kind === "lockin-goal") {
          const picker = sourceState()
          const sessionName = pendingSessionName() || "lock-in session"
          setPrompt(null)
          setSourceState(null)
          setSourceView(initialPickerView)
          setExistingSources([])
          stopSourceSearch()
          setPendingSessionName("")
          update({ ...current(), pane: "chat", focus: "chat", mode: "normal", overlay: null })
          if (!picker) {
            notify("choose at least one source before creating the session", "warn")
            event.preventDefault()
            return true
          }
          void createLockInFromPicker(name, sessionName, picker)
          event.preventDefault()
          return true
        }
        if (active.kind === "lockin-name") {
          if (name !== "") {
            setPrompt(null)
            void openSourcePicker(name)
          }
          event.preventDefault()
          return true
        }
        if (active.kind === "skill-prior") {
          const workspace = props.workspace
          if (!workspace) {
            notify("a workspace is needed to create a skill session", "error")
            setPrompt(null)
            event.preventDefault()
            return true
          }
          void createSkillCourse({
            workspace,
            goal: skillGoal(),
            prior: name,
            created: new Date(),
            takenIds: skillsState().goals.map((goal) => goal.id),
            ...(props.generatePlan ? { generate: props.generatePlan } : {}),
          }).then((made) => {
            if (!made.ok) {
              notify(made.error.message, "error")
              return true
            }
            setCourse({ ...made.value })
            setChapterCursor(0)
            setOpenChapter(null)
            setReaderOffset(0)
            update({ ...current(), pane: "chat", reader: true, explorer: false, focus: "reader", mode: "normal", overlay: null })
            notify(`skill session created: ${made.value.goal}`)
            if (props.generatePlan && made.value.plan === "template") {
              notify("the model plan could not be used; the template was written", "warn")
            }
            void refreshGoals()
          })
          setPrompt(null)
          event.preventDefault()
          return true
        }
        if (name !== "") {
          if (active.kind === "project-name") {
            setDraft({ name, folder: "" })
            setPrompt({ title: "Project folder", hint: "Register an existing folder, or let Enter create this one.", value: `~/Projects/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, preselect: true, kind: "project-folder" })
            event.preventDefault()
            return true
          }
          if (active.kind === "project-folder") {
            setDraft((current) => ({ name: current?.name ?? "project", folder: name }))
            setPrompt(null)
            setChoiceCommit({ kind: "project-mode" })
            setChoice({
              title: "How does this project work?",
              hint: "A single agent, or a swarm you staff with agents.",
              options: [
                { label: "Single agent", detail: "one chat, one model", value: "chat" },
                { label: "Swarm of agents", detail: "a team, one agent per role", value: "swarm" },
              ],
              index: 0,
            })
            event.preventDefault()
            return true
          }
          if (active.kind === "project-mode") {
            const project = draft()
            const mode = name.toLowerCase().startsWith("s") ? "swarm" : "chat"
            const projectName = project?.name ?? name
            const folder = project?.folder ?? ""
            const id = makeProjectId(projectName, takenProjectIds())
            const swarmId = mode === "swarm" ? `swarm-${id}` : null
            setProjects((list) => [...list, { id, name: projectName, folder, mode, swarmId }])
            persistNewProject({ id, name: projectName, folder, mode })
            setActiveProject(id)
            if (swarmId !== null) {
              setSwarms((list) => [...list, { id: swarmId, name: projectName, projectId: id, agents: [] }])
              setOpenSwarm(swarmId)
              setPrompt({ title: `Agent in ${projectName}`, hint: "Name it, then Enter. Esc when the swarm is staffed.", value: "", kind: "agent" })
            } else {
              setPrompt(null)
              update({ ...current(), pane: "chat", mode: "normal" })
            }
            event.preventDefault()
            return true
          }
          if (active.kind === "skill-goal") {
            setSkillGoal(name)
            setPrompt({
              title: "What do you already know?",
              hint: "Optional. Enter with nothing to start from scratch.",
              value: "",
              kind: "skill-prior",
            })
            event.preventDefault()
            return true
          }
          if (active.kind === "agent-name" || active.kind === "agent-task-edit") {
            const id = editingAgent()
            const open = openSwarm()
            if (id && open) {
              setSwarms((list) =>
                list.map((swarm) => {
                  if (swarm.id !== open) return swarm
                  return {
                    ...swarm,
                    agents: swarm.agents.map((agent) =>
                      agent.id === id
                        ? active.kind === "agent-name"
                          ? { ...agent, name }
                          : { ...agent, task: name }
                        : agent,
                    ),
                  }
                }),
              )
              persistAgent(open, id)
            }
            setPrompt(null)
            event.preventDefault()
            return true
          }
          if (active.kind === "agent-model" || active.kind === "agent-task") {
            const open = openSwarm()
            const index = listCursors().agents ?? 0
            const agentId = open
              ? swarms().find((swarm) => swarm.id === open)?.agents[index]?.id
              : undefined
            if (open) {
              setSwarms((list) =>
                list.map((swarm) => {
                  if (swarm.id !== open) return swarm
                  const agents = swarm.agents.map((agent, at) =>
                    at === index
                      ? active.kind === "agent-model"
                        ? { ...agent, model: name }
                        : { ...agent, task: name }
                      : agent,
                  )
                  return { ...swarm, agents }
                }),
              )
              if (agentId) persistAgent(open, agentId)
            }
            setPrompt(null)
            event.preventDefault()
            return true
          }
          if (active.kind === "swarm") {
            const projectId = activeProject()
            if (!projectId) {
              notify("open a project first; a swarm belongs to a project", "warn")
              setPrompt(null)
              event.preventDefault()
              return true
            }
            const id = `swarm-${projectId}`
            const workspace = props.workspace
            if (workspace === undefined) {
              notify("a workspace is needed to save a swarm", "error")
              setPrompt(null)
              event.preventDefault()
              return true
            }
            // Persist the mode and name before painting the attached swarm, so
            // a failed write cannot leave the UI on a swarm that a restart loses.
            void setProjectMode({ workspace, id: projectId, mode: "swarm", name }).then((result) => {
              if (!result.ok) {
                notify(`project mode not saved: ${result.error.message}`, "error")
                setPrompt(null)
                return
              }
              if (!swarms().some((swarm) => swarm.id === id)) {
                setSwarms((list) => [...list, { id, name, projectId, agents: [] }])
              }
              setProjects((list) =>
                list.map((project) =>
                  project.id === projectId
                    ? { ...project, mode: "swarm", swarmId: id, swarmName: name }
                    : project,
                ),
              )
              setOpenSwarm(id)
              update({
                ...current(),
                pane: "agents",
                explorer: false,
                agentSidebar: true,
                focus: "chat",
                mode: "normal",
                overlay: null,
              })
              // Straight into staffing it: the point of a swarm is its agents.
              setPrompt({ title: `Agent in ${name}`, hint: "Name it, then Enter. Esc when the swarm is staffed.", value: "", kind: "agent" })
            })
            event.preventDefault()
            return true
          }
          const open = openSwarm()
          const swarm = open ? swarms().find((entry) => entry.id === open) : undefined
          const clash = swarm?.agents.some((agent) => agent.name.toLowerCase() === name.toLowerCase())
          if (clash) {
            notify(`agent “${name}” already exists in ${swarm?.name ?? "this swarm"}`, "error")
            setPrompt({ ...active, value: "" })
            event.preventDefault()
            return true
          }
          if (open) {
            const target = swarms().find((swarm) => swarm.id === open)
            const agentId = makeAgentId(name, target?.agents.map((agent) => agent.id) ?? [])
            setSwarms((list) =>
              list.map((swarm) =>
                swarm.id === open
                  ? {
                      ...swarm,
                      agents: [
                        ...swarm.agents,
                        {
                          id: agentId,
                          name,
                          task: "",
                          model: "",
                          permissions: "read-only" as const,
                        },
                      ],
                    }
                  : swarm,
              ),
            )
            persistNewAgent(open, agentId)
            setPrompt({ ...active, value: "" })
            event.preventDefault()
            return true
          }
        }
}
      const character = typedText(press, event)
      if (character !== null) {
        setPrompt({
          ...active,
          value: active.preselect ? character : active.value + character,
          preselect: false,
        })
        event.preventDefault()
      }
      return true
    }
    return false
  }

  useKeyboard((event) => {
    if (event.eventType === "release") return
    const press = normalisePress(event)
    appEffects?.keypress(press.name)
    // Quit is global: prompts, choosers, insert mode and overlays must not
    // swallow the one chord that always leaves the app.
    if (press.ctrl && press.name === "q") {
      renderer.destroy()
      event.preventDefault()
      return
    }
    if (pluginRequest() && handlePluginRequestKey(press, event)) return
    const state = current()

    /**
     * The key router, in priority order. Each step returns true when it handled
     * the key; the first true wins. This order is the contract: overlays own the
     * keyboard while open, the reader owns its pane before generic pane keys,
     * and the leader/direct resolver runs last.
     */
    if (handleOverlayInput(state, press, event)) return
    if (state.pane === "chat-settings" && state.overlay === null) {
      if (press.name === "escape") {
        update({ ...state, pane: "chat", focus: "chat", mode: "normal", overlay: null })
        event.preventDefault()
        return
      }
      const count = chatSettingsRowsFor().length
      if (press.name === "j" || press.name === "down") {
        setChatSettingsCursor((cursor) => Math.min(Math.max(0, count - 1), cursor + 1))
        event.preventDefault()
        return
      }
      if (press.name === "k" || press.name === "up") {
        setChatSettingsCursor((cursor) => Math.max(0, cursor - 1))
        event.preventDefault()
        return
      }
      if (press.name === "return" || press.name === "space") {
        if (count > 0) void cycleChatSetting()
        event.preventDefault()
        return
      }
    }
    if (state.pane === "session-settings" && state.overlay === null) {
      const settings = sessionSettings()
      if (settings.mode === "edit") {
        if (press.ctrl && press.name === "s") {
          event.preventDefault()
          void saveCurrentSessionInstructions()
          return
        }
        if (press.name === "escape") {
          event.preventDefault()
          cancelSessionSettingsEdit()
          return
        }
        // The focused textarea owns every other key.
        return
      }
      if (press.name === "escape") {
        update({ ...state, pane: "chat", focus: "chat", mode: "normal", overlay: null })
        event.preventDefault()
        return
      }
      if (press.name === "j" || press.name === "down") {
        setSessionSettings((value) => moveSessionSettings(value, 1))
        event.preventDefault()
        return
      }
      if (press.name === "k" || press.name === "up") {
        setSessionSettings((value) => moveSessionSettings(value, -1))
        event.preventDefault()
        return
      }
      if (press.name === "return" || press.name === "e") {
        runSessionSettingsAction()
        event.preventDefault()
        return
      }
      if (press.name === "f") {
        void openInstructionsFile()
        event.preventDefault()
        return
      }
      if (press.name === "r") {
        void reExtractCurrentInstructions()
        event.preventDefault()
        return
      }
    }
    if (
      handleInsertKeys(state, press, event, {
        chat,
        activeChat,
        update,
        taskRegistry: taskRegistry(),
        chatTasks,
        command: chatCommandFor,
        notify,
        onSend: () => appEffects?.send(),
      })
    ) {
      return
    }
    // A deck owns the reader keys while it is open.
    if (
      state.overlay === null &&
      prompt() === null &&
      choice() === null &&
      state.reader &&
      state.focus === "reader" &&
      deckData() !== null
    ) {
      const deck = deckForUi()
      if (deck !== null) {
        const intent = deckIntent(press.name, { shift: press.shift })
        const set = (view: DeckView) => {
          setDeckView(view)
          event.preventDefault()
        }
        if (intent === "close") {
          update({ ...state, reader: false, focus: "chat" })
          event.preventDefault()
          return
        }
        if (intent === "down") return set(moveDeck(deck, deckView(), 1))
        if (intent === "up") return set(moveDeck(deck, deckView(), -1))
        if (intent === "flip") return set(flipDeck(deckView()))
        if (intent === "missed-only") return set(toggleMissedOnly(deck, deckView()))
        if (intent === "missed" || intent === "known") {
          const outcome = markCard(deck, deckView(), intent)
          if ("notice" in outcome) return set(outcome.view)
          setDeckView(outcome.view)
          const workspace = props.workspace
          if (workspace) {
            const goalId = activeBuffer().courseId ?? activeBuffer().id.replace(/^skill:/, "")
            const index = Number(outcome.cardId.replace("card-", "")) - 1
            void markDeckCard({ workspace, goalId, index, mark: outcome.mark }).then((result) => {
              if (result.ok) setDeckData(result.value)
            })
          }
          event.preventDefault()
          return
        }
        if (intent === "choose") {
          // Navigation walks the visible list (missed-only filters cards), so
          // choosing must use the same list.
          const card = currentDeckCard(deck, deckView())
          const index = Number(press.name) - 1
          if (card) {
            const outcome = chooseCard(card, index)
            if (outcome.kind === "refused") {
              setDeckView({ ...deckView(), notice: outcome.reason })
              event.preventDefault()
              return
            }
            const workspace = props.workspace
            if (workspace) {
              const goalId = activeBuffer().courseId ?? activeBuffer().id.replace(/^skill:/, "")
              const cardIndex = Number(card.id.replace("card-", "")) - 1
              void markDeckCard({ workspace, goalId, index: cardIndex, mark: outcome.kind }).then((result) => {
                if (result.ok) setDeckData(result.value)
              })
            }
            setDeckView({ ...deckView(), chosen: index, notice: null })
            event.preventDefault()
            return
          }
        }
      }
    }

    // A lock-in session's steps own the reader keys while it has focus.
    if (
      state.overlay === null &&
      prompt() === null &&
      choice() === null &&
      state.reader &&
      state.focus === "reader" &&
      !course() &&
      activeBuffer().kind === "session"
    ) {
      // A missing file is a real state: the reader shows the build hint and R
      // must still be able to create the file.
      const raw = stepsText() ?? ""
      {
        if (readerDoc() !== null) {
          if (press.name === "i" || press.name === "escape") {
            setReaderDoc(null)
            setStepsView(initialStepsView)
            update({ ...state, reader: true, focus: "reader" })
          }
          event.preventDefault()
          return
        }
        const rows = stepRowsFor(raw)
        const view = stepsView()
        const cursor = clampStepCursor(rows, view.cursor)
        const moveTo = (next: number) => {
          setStepsView({ ...view, cursor: next })
          event.preventDefault()
        }
        if (press.name === "escape") {
          if (view.pendingRegenerate) return setStepsView({ ...view, pendingRegenerate: false, notice: null })
          update({ ...state, reader: false, focus: "chat" })
          event.preventDefault()
          return
        }
        if (press.shift && press.name === "r") {
          if (!view.pendingRegenerate) {
            setStepsView({
              ...view,
              pendingRegenerate: true,
              notice: "Press R again to regenerate; steps checked by the same text stay checked, changed ones are lost.",
            })
            event.preventDefault()
            return
          }
          if (stepsBuilding) {
            notify("steps are already being built", "warn")
            event.preventDefault()
            return
          }
          const workspace = props.workspace
          if (!workspace || !props.generate) {
            notify("link a model to regenerate steps", "warn")
            event.preventDefault()
            return
          }
          const bufferId = activeBuffer().id
          const sessionId = bufferId.replace(/^session:/, "")
          stepsBuilding = true
          setStepsView({ ...initialStepsView, notice: "Building steps…" })
          event.preventDefault()
          void regenerateSessionSteps({
            workspace,
            id: sessionId,
            generate: props.generate,
          }).then((result) => {
            stepsBuilding = false
            // A buffer switch while the model runs must not install this
            // session's steps into another one.
            if (activeBuffer().id !== bufferId) return
            if (!result.ok) {
              const message = stepFailureMessage(result.error.message)
              setStepsView({ ...initialStepsView, notice: message })
              notify(message, "error")
              return
            }
            setStepsText(result.value.markdown)
            setStepsStale(false)
            setStepsView(initialStepsView)
            notify(
              result.value.lost > 0
                ? `steps regenerated · kept ${result.value.kept} checked, dropped ${result.value.lost}`
                : "steps regenerated",
            )
          }).catch((error) => {
            stepsBuilding = false
            if (activeBuffer().id !== bufferId) return
            const message = stepFailureMessage(error)
            setStepsView({ ...initialStepsView, notice: message })
            notify(message, "error")
          })
          return
        }
        if (press.name === "i") {
          void openSessionInstructions()
          event.preventDefault()
          return
        }
        if (press.name === "j" || press.name === "down") return moveTo(moveStep(rows, cursor, 1))
        if (press.name === "k" || press.name === "up") return moveTo(moveStep(rows, cursor, -1))
        if (press.name === "d") return moveTo(clampStepCursor(rows, Math.min(rows.length - 1, cursor + 10)))
        if (press.name === "u") return moveTo(clampStepCursor(rows, Math.max(0, cursor - 10)))
        if (press.name === "g") return moveTo(clampStepCursor(rows, press.shift ? rows.length - 1 : 0))
        if (press.name === "a") {
          const step = currentStepAt(rows, cursor)
          if (!step) {
            notify("select a step first", "warn")
          } else {
            activeChat.askAboutStep(step.text)
            update({ ...state, focus: "chat", mode: "insert", overlay: null })
          }
          event.preventDefault()
          return
        }
        if (press.name === "x") {
          const step = currentStepAt(rows, cursor)
          const workspace = props.workspace
          if (step && workspace) {
            const id = activeBuffer().id.replace(/^session:/, "")
            void toggleSessionStep(workspace, id, step.index).then((result) => {
              if (result.ok) setStepsText(result.value)
              else notify(result.error.message, "error")
            })
          }
          event.preventDefault()
          return
        }
      }
    }
    // The achievement inventory owns its own grid keys while its buffer is open.
    if (state.pane === "achievements" && state.overlay === null) {
      const view = achievementView()
      const metrics = achievementMetrics()
      const terminal = dims()
      const geometry = paneGeometry(terminal.width, state)
      const columns = Math.max(20, geometry.main - 2)
      const rows = Math.max(3, terminal.height - 8)
      const pixels = Boolean(renderer.capabilities?.kitty_graphics || renderer.capabilities?.sixel)
      const move = (direction: "up" | "down" | "left" | "right"): AchievementView =>
        pixels
          ? moveAchievementNode(view, direction, metrics, columns, rows)
          : moveAchievementList(view, direction, metrics)
      if (press.name === "escape") {
        closeBuffer()
        event.preventDefault()
        return
      }
      if (press.name === "k" || press.name === "up") {
        setAchievementView(move("up"))
        event.preventDefault()
        return
      }
      if (press.name === "j" || press.name === "down") {
        setAchievementView(move("down"))
        event.preventDefault()
        return
      }
      if (press.name === "h" || press.name === "left") {
        setAchievementView(move("left"))
        event.preventDefault()
        return
      }
      if (press.name === "l" || press.name === "right") {
        setAchievementView(move("right"))
        event.preventDefault()
        return
      }
      if (press.name === "g") {
        setAchievementView(jumpAchievement(view, press.shift ? "last" : "first", metrics))
        event.preventDefault()
        return
      }
      if (press.name === "f") {
        setAchievementView(cycleFilter(view, metrics))
        event.preventDefault()
        return
      }
      if (press.name === "s") {
        const achievement = currentAchievement(view, metrics)
        if (!achievement) {
          setAchievementView({ ...view, notice: "no achievement selected" })
        } else if (!achievementUnlocked(achievement, metrics)) {
          setAchievementView({ ...view, notice: "this achievement is still locked" })
        } else {
          const copied = renderer.copyToClipboardOSC52(shareText(achievement))
          if (copied) {
            setAchievementView({ ...view, notice: null })
            notify(`share card copied: ${achievement.name}`)
          } else {
            setAchievementView({ ...view, notice: "clipboard unavailable in this terminal" })
          }
        }
        event.preventDefault()
        return
      }
    }

    // The knowledge window owns its keys: a graph and a reader share one
    // selection, so no other pane verb may steal j/k/h/l while it is open.
    if (
      state.pane === "knowledge" &&
      state.overlay === null &&
      state.mode === "normal" &&
      !press.ctrl &&
      !press.meta
    ) {
      const graph = knowledgeGraph()
      const current = knowledgeState()
      const stop = () => event.preventDefault()
      if (!graph) {
        if (press.name === "escape") {
          update({ ...state, pane: "chat", mode: "normal" })
          stop()
          return
        }
        setKnowledgeState({ ...current, notice: "knowledge is still loading" })
        stop()
        return
      }

      if (current.searching) {
        if (press.name === "escape") {
          setKnowledgeState({ ...current, searching: false, query: "", notice: null })
          stop()
          return
        }
        if (press.name === "return") {
          setKnowledgeState(searchJump(graph, current))
          stop()
          return
        }
        if (press.name === "backspace") {
          setKnowledgeState({ ...current, query: current.query.slice(0, -1) })
          stop()
          return
        }
        const text = typedText(press, event as never)
        if (text) setKnowledgeState({ ...current, query: current.query + text })
        stop()
        return
      }

      if (current.reading) {
        if (press.name === "escape" || press.name === "backspace") {
          setKnowledgeState({ ...current, reading: null, readingOffset: 0 })
          stop()
          return
        }
        const down = press.name === "j" || press.name === "down" || press.name === "pagedown"
        const up = press.name === "k" || press.name === "up" || press.name === "pageup"
        if (down || up) {
          const step = press.name === "pagedown" || press.name === "pageup" ? 8 : 1
          const note = graph.notes.find((entry) => entry.id === current.reading)
          // The reader shows `height - 11` blocks; stop at the last full page
          // instead of scrolling into blank space.
          const visible = Math.max(1, dims().height - 11)
          const max = note ? Math.max(0, blockCount(note.body) - visible) : 0
          setKnowledgeState({
            ...current,
            readingOffset: Math.max(0, Math.min(max, current.readingOffset + (down ? step : -step))),
          })
          stop()
          return
        }
        stop()
        return
      }

      if (press.name === "escape") {
        update({ ...state, pane: "chat", mode: "normal" })
        stop()
        return
      }

      const order = navigationOrder(graph)
      const at = order.findIndex((item) => item.id === current.focus)
      const item = at >= 0 ? order[at] : order[0]

      const graphics = Boolean(renderer.capabilities?.kitty_graphics || renderer.capabilities?.sixel)
      const terminal = dims()
      const geometry = paneGeometry(terminal.width, state)
      const columns = Math.max(20, geometry.main - 2)
      const bodyRows = Math.max(3, terminal.height - 8)
      // Spatial arrows in the pixel graph, tree movement in the list fallback.
      const spatial = (direction: "up" | "down" | "left" | "right"): string | null =>
        graphics && !current.list
          ? directionTarget(graph, current.focus, direction, columns, bodyRows)
          : null
      const focusOn = (id: string | null | undefined, otherwise: KnowledgeState): void => {
        setKnowledgeState(id ? { ...otherwise, focus: id, notice: null } : otherwise)
      }

      if (press.name === "j" || press.name === "down" || (press.name === "tab" && !press.shift)) {
        focusOn(spatial("down"), moveFocus(graph, current, 1))
        stop()
        return
      }
      if (press.name === "k" || press.name === "up" || (press.name === "tab" && press.shift)) {
        focusOn(spatial("up"), moveFocus(graph, current, -1))
        stop()
        return
      }
      if (press.name === "g") {
        const target = rootOf(graph, current.focus)
        if (target) setKnowledgeState({ ...current, focus: target })
        stop()
        return
      }
      if (press.name === "v") {
        setKnowledgeState({ ...current, list: !current.list })
        stop()
        return
      }
      if (press.name === "/") {
        setKnowledgeState({ ...current, searching: true, query: "", notice: null })
        stop()
        return
      }
      if (press.name === "backspace") {
        const target = current.focus ? parentOf(graph, current.focus) : null
        focusOn(target, current)
        stop()
        return
      }
      if (press.name === "h" || press.name === "left") {
        const target = current.focus ? parentOf(graph, current.focus) : null
        focusOn(spatial("left") ?? target, current)
        stop()
        return
      }
      if (press.name === "l" || press.name === "right") {
        const target = current.focus ? firstChildOf(graph, current.focus) : null
        focusOn(spatial("right") ?? target, current)
        stop()
        return
      }
      if (press.name === "return") {
        if (item?.kind === "note") {
          setKnowledgeState({ ...current, reading: item.id, readingOffset: 0 })
        } else if (item) {
          setKnowledgeState({ ...current, focus: item.id, list: false })
        }
        stop()
        return
      }

      if (press.name === "space" || press.name === "?") {
        // Leader and help stay global; everything else is the graph's.
      } else {
        stop()
        return
      }
    }

    if (
      handleExplorerKeys(state, press, event, {
        selection: explorerSelection,
        setEditingAgent,
        setAgentSettings,
        update,
        projects,
        activeProject,
        openBuffer,
        openAchievements,
      })
    ) {
      return
    }

    if (
      handleSettingsKeys(state, press, event, {
        models,
        setSessionsState,
        agentSettings,
        currentAgent,
        openAgentField,
        openChatSettings,
        update,
        settingsState,
        setSettingsState,
        settingsView,
        setSettingsView,
        ...(props.onConfigPatch ? { onConfigPatch: props.onConfigPatch } : {}),
        themeEntries,
        themesState,
        setTheme,
        setCustomTheme,
        ...(props.onThemeChange ? { onThemeChange: props.onThemeChange } : {}),
        leaderAllows,
        resolveLeader,
        dispatch,
        notify,
        openPluginManager: () => void openPluginManager(),
        movePluginManager,
        togglePluginManager: () => void togglePluginManager(),
      })
    ) {
      return
    }

    if (
      handleOverlayKeys(state, press, event, {
        registry,
        dispatch,
        update,
        setHelpPage,
        destroy: () => renderer.destroy(),
      })
    ) {
      return
    }

    if (
      handlePaneKeys(state, press, event, {
        workspace: props.workspace,
        createGithubArchive: props.createGithubArchive,
        taskRegistry,
        taskCursor,
        taskCancelArmed,
        setTaskCancelArmed,
        notify,
        skillsState,
        setSkillsState,
        openCourse,
        openSkillChat,
        newSkillChat: async (goalId, goalName) => {
          const workspace = props.workspace
          if (!workspace) {
            notify("a workspace is needed to start a chat", "error")
            return
          }
          const created = await createSkillChat({ workspace, goalId })
          if (!created.ok) {
            notify(created.message, "error")
            return
          }
          openSkillChat(goalId, goalName, created.id)
          const chats = await loadSkillChats(workspace, goalId)
          setSkillsState((state) => ({
            ...state,
            pane: "chats",
            chats,
            chatCursor: Math.max(0, chats.length - 1),
          }))
          notify("new chat started")
        },
        agentTemplates: async () => {
          if (!props.workspace) return []
          const loaded = await loadAgentTemplates(props.workspace)
          for (const issue of loaded.issues) {
            notify(`agent template ${issue.file}: ${issue.message}`, "warn")
          }
          return loaded.templates.map((template) => ({
            id: template.id,
            name: template.name,
            role: template.role,
          }))
        },
        setAgentTemplateChoice: (templates, projectId) => {
          setChoiceCommit({
            kind: "agent-template",
            templates: templates as AgentTemplate[],
            projectId,
          })
          setChoice({
            title: "Agent template",
            hint: "Seeds a profile; commands are never granted by a template.",
            options: templates.map((template) => ({
              label: template.name,
              detail: template.role,
              value: template.id,
            })),
            index: 0,
          })
        },
        setDefaultAgentForProject: async (projectId, agentId) => {
          const workspace = props.workspace
          if (!workspace) return
          const result = await setProjectDefaultAgent({ workspace, projectId, id: agentId })
          if (!result.ok) {
            notify(result.error.message, "error")
            return
          }
          notify("default agent set")
          void loadWorkHome(workspace, projectId).then((home) => setWorkHome(home)).catch(() => {})
        },
        reviewItems,
        pluginRows,
        pluginCursor,
        setPluginCursor,
        connectPlugin: async (id: string) => {
          const runtime = props.pluginRuntime
          if (!runtime) return
          setPluginRows(await runtime.connect(id).catch(() => pluginRows()))
        },
        closePlugin: async (id: string) => {
          const runtime = props.pluginRuntime
          if (!runtime) return
          setPluginRows(await runtime.close(id).catch(() => pluginRows()))
        },
        togglePlugin: async (id: string) => {
          const runtime = props.pluginRuntime
          const row = pluginRows().find((entry) => entry.name === id)
          if (!runtime || !row) return
          const enabled = !row.enabled
          setPluginRows(await runtime.setEnabled(id, enabled).catch(() => pluginRows()))
          await props.onConfigPatch?.({ plugins: { servers: { [id]: { enabled } } } })
        },
        refreshPlugins,
        archiveSkillGoal,
        exportSkillGoal,
        removeGoal,
        setPrompt,
        update,
        chatScroll,
        dims,
        openChapter,
        chapterText,
        setReaderOffset,
        course,
        setOpenChapter,
        setChapterText,
        toggleChapter,
        openChapterAt,
        setChapterCursor,
        chapterCursor,
        projects,
        projectPending,
        setProjectPending,
        archiveProject,
        deleteProject,
        exportProject,
        openSwarm,
        setOpenSwarm,
        sidebarCursor,
        setSidebarCursor,
        listCursors,
        swarms,
        setEditingAgent,
        setAgentSettings,
        buffers,
        setCurrentBuffer,
        currentBuffer,
        switchBuffer,
        closeBuffer,
        releaseChat,
        setBuffers,
        chat,
        activeChat,
        activeAgent,
        managerState,
        setSessionsState,
        settingsView,
        dropSessionBuffer,
        reloadArchive,
        sourceState,
        handleSourceInput: (press, event) => handleSourceInput(press, event as never),
        openBuffer,
        activeProject,
        listRows,
      })
    ) {
      return
    }

    if (handleModalEnter(state, press, event)) return

    handleResolvedKeys(state, press, event)
  })

  props.api?.({
    state: current,
    frame: started,
    registry,
    dispatch,
    hints: hints(),
    intents,
  })

  /**
   * Read inside JSX, never once in the component body: a signal read at the top
   * of a component subscribes nothing, so `view.pane` would freeze at the first
   * frame even though the state kept changing.
   */
  const view = () => current()

  /** Everything the pane router needs, read fresh from the signals. */
  const paneDeps = (): PaneDeps => ({
    theme: theme(),
    custom: customTheme(),
    settings: settingsView(),
    manager: managerState(),
    skills: skillsState(),
    chat: chat(),
    course: course(),
    chapterCursor: chapterCursor(),
    openChapter: openChapter(),
    chapterText: chapterText(),
    bufferCount: buffers().length,
    swarms: swarms(),
    openSwarm: openSwarm(),
    agentSettings: agentSettings(),
    chatSettingsCursor: chatSettingsCursor(),
    chatSettingsRows: chatSettingsRowsFor(),
    sessionSettings: sessionSettings(),
    sessionName: activeBuffer().kind === "session" ? activeBuffer().label : "",
    onSessionSettingsEditor: (editor) => {
      sessionSettingsEditor = editor
    },
    currentAgent,
    themeId: theme(),
    liveCustomTheme: customTheme(),
    themes: themesState(),
    settingsState: settingsState(),
    tasks: taskRegistry(),
    taskCursor: taskCursor(),
    activity: activityView(),
    knowledge: knowledgeState(),
    knowledgeGraph: knowledgeGraph(),
    knowledgeReducedMotion: process.env.LOCKEDIN_REDUCED_MOTION === "1",
    statsSummary: statsSummary(),
    statsView: statsView(),
    achievements: achievementView(),
    achievementMetrics: achievementMetrics(),
    achievementAwards: achievementAwards(),
    archive: archiveState(),
    sources: sourceState(),
    sourceView: sourceView(),
    existingSources: existingSources(),
    sourceTitle:
      pickerMode().kind === "instructions" || pickerMode().kind === "lockin-instructions"
        ? "Instructions file"
        : pickerMode().kind === "gather"
          ? "Gather sources"
          : undefined,
    sourceManifestLabel:
      pickerMode().kind === "instructions" || pickerMode().kind === "lockin-instructions"
        ? "INSTRUCTIONS"
        : undefined,
    sourceAllowInstructions: pickerMode().kind === "create",
    activityRecords: activityRecords(),
    activitySkipped: activitySkipped(),
    listRows,
    listCursors: listCursors(),
    workActive: activeBuffer().kind === "project" || activeBuffer().kind === "agent",
    pluginRows: pluginRows(),
    pluginCursor: pluginCursor(),
    pluginManager: pluginManager(),
    modelsScreen: models.screen(),
  })

  const controller: ChatController =
    props.controller ??
    fallbackController(
      "friend",
      // The preview shell has no target; the composition root must pass one.
      props.chatScope ?? "work",
      props.usageStore,
      props.onUsageError,
    )

  /**
   * The chat is a signal too. The controller emits after every change, so a
   * streamed answer, the composer and the usage counters all repaint.
   */
  const [chat, setChat] = createSignal<ChatState>(controller.state())
  const [usage, setUsage] = createSignal<SessionUsage>(controller.usage())

  const chatControllers = new Map<string, ChatController>()
  let activeChat = controller

  function controllerFor(id: string): ChatController {
    if (id === "home") return controller
    const existing = chatControllers.get(id)
    if (existing) return existing
    const buffer = buffers().find((entry) => entry.id === id)
    const path = buffer ? chatPathFor(buffer, props.workspace) : null
    if (!buffer || !path || !props.createChat) return controller
    const project =
      buffer.kind === "project" || buffer.kind === "agent"
        ? projects().find((entry) => entry.id === buffer.projectId)
        : undefined
    const tools =
      project && props.workspace
        ? projectTools({
            workspace: props.workspace,
            id: project.id,
            name: project.name,
            folder: project.folder,
          })
        : buffer.kind === "skill" && props.workspace
          ? skillTools({
              workspace: props.workspace,
              goalId: buffer.courseId ?? buffer.id.replace(/^skill:/, ""),
            })
          : buffer.kind === "session" && props.workspace
            ? sessionTools(props.workspace, buffer.id.replace(/^session:/, ""))
            : null
    const context = tools ? tools.context : undefined
    const ctrl = props.createChat(
      createJsonlHistoryPort(path, settingsView()?.historyLimit ?? 20),
      scopeForBuffer(buffer, props.chatScope ?? "school"),
      chatModeFor(buffer),
      context,
      tools ?? undefined,
    )
    chatControllers.set(id, ctrl)
    ctrl.subscribe((next) => {
      if (currentBuffer() === id) {
        setChat(next)
        setUsage(ctrl.usage())
      }
    })
    void ctrl.load()
    return ctrl
  }

  function activateChat(id: string) {
    activeChat = controllerFor(id)
    activeChat.syncConfig()
    activeChat.setScrolledUp(false)
    setChat(activeChat.state())
    setUsage(activeChat.usage())
  }

  /**
   * A paste is a block, not a burst of typed characters. Text becomes a chip
   * with its line count; an image is labelled `[img]` because there is no path
   * to upload. Prompts accept pasted text as ordinary input.
   */
  usePaste((event) => {
    const text = decodePasteBytes(event.bytes)
    const mime = event.metadata?.mimeType ?? ""
    const image = isImagePaste(event.bytes, mime)
    const active = prompt()
    if (active) {
      if (!image && text.length > 0) setPrompt({ ...active, value: active.value + text })
      return
    }
    const state = current()
    if (state.overlay !== null || state.mode !== "insert" || state.focus !== "chat" || state.pane !== "chat") return
    if (image) activeChat.pasteImage()
    else if (text.length > 0) activeChat.pasteText(text)
  })
  onCleanup(() => {
    void props.pluginRuntime?.dispose()
  })

  onMount(() => {
    const stop = controller.subscribe((next) => {
      if (currentBuffer() !== "home") return
      setChat(next)
      setUsage(controller.usage())
    })
    void controller.load()
    onCleanup(stop)
  })

  onMount(() => {
    // Warm the syntax engine and the languages a course usually shows, so the
    // first code block is not plain text for a beat. Deferred like the rest of
    // the secondary loads, and off the startup path.
    const warm = setTimeout(() => {
      const palette = resolveTheme(theme(), customTheme()).palette
      void Promise.all([
        import("../services/syntax/highlight"),
        import("../services/syntax/theme"),
      ]).then(([syntax, themes]) =>
        syntax.warmSyntax(SYNTAX_WARM_LANGUAGES, themes.syntaxTheme(palette)),
      )
    }, 400)
    onCleanup(() => clearTimeout(warm))
    // Archive, activity and stats are secondary: load them after the first
    // frame so startup is not competing with three dynamic imports.
    const later = setTimeout(() => {
    void reloadArchive().catch(() => {})
    if (props.workspace?.data?.activity) {
      void loadActivity(props.workspace!)
        .then((loaded) => {
          if (!loaded) return
          setActivityRecords(loaded.records)
          setActivitySkipped(loaded.skipped)
        })
        .catch(() => {})
    }
    const dir = settingsView()?.dataDir
    if (dir) {
      void loadStats(dir)
        .then((summary) => setStatsSummary(summary))
        .catch(() => {})
    }
    }, 100)
    onCleanup(() => clearTimeout(later))
    // Notices repaint at 20 Hz only while a bubble is fading; outside the
    // fade window a slower tick is enough to prune and keep the clock moving.
    let noticeTimer: ReturnType<typeof setTimeout> | null = null
    const tickNotices = () => {
      noticeTimer = null
      const now = Date.now()
      setNowMs(now)
      const list = notices()
      const next = pruneNotices(list, now)
      if (next.length !== list.length) setNotices(next)
      if (next.length === 0) return
      const fading = next.some(
        (notice) => now - notice.at >= noticeDuration(notice) - NOTICE_FADE_MS,
      )
      noticeTimer = setTimeout(tickNotices, fading ? NOTICE_TICK_MS : 100)
    }
    const startNoticeTimer = () => {
      if (noticeTimer !== null) return
      noticeTimer = setTimeout(tickNotices, NOTICE_TICK_MS)
    }
    const stopNoticeTimer = () => {
      if (noticeTimer === null) return
      clearTimeout(noticeTimer)
      noticeTimer = null
    }
    createEffect(() => {
      if (notices().length > 0) startNoticeTimer()
      else stopNoticeTimer()
    })
    onCleanup(stopNoticeTimer)
  })

  /** Plugin actions registered with the one key table for this session. */
  let pluginActionIds: string[] = []

  /** Swap dynamically registered plugin actions after a load or reload. */
  function mountPluginActions(actions: readonly Action[]): void {
    for (const id of pluginActionIds) registry.unregister(id)
    pluginActionIds = []
    for (const action of actions) {
      const result = registry.register(action)
      if (result.ok) pluginActionIds.push(action.id)
      else effectDebug(`plugin command ${action.id}: ${result.message}`)
    }
    // Saved overrides for plugin ids could not apply before registration.
    if (props.keybinds) applyConfig(registry, { ui: props.keybinds })
    renderer.requestRender()
  }

  /** Open the effect plugin manager and inspect every discovered plugin. */
  async function openPluginManager(): Promise<void> {
    update({ ...current(), pane: "plugin-manager", mode: "normal", overlay: null })
    setPluginManager({ ...initialPluginManager, mode: "plugins", loading: true })
    const roots = pluginRoots ? await pluginRoots() : []
    const loaded = await loadPlugins(roots)
    const disabled = new Set(settingsView()?.disabledPlugins ?? [])
    setPluginManager({
      ...initialPluginManager,
      cursor: 0,
      loading: false,
      notice: loaded.errors[0] ?? null,
      items: loaded.plugins.map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        manifestName: plugin.manifest.name,
        bundled: basename(plugin.dir).endsWith(".lockedin"),
        enabled: !disabled.has(plugin.manifest.id),
        error: pluginErrors()[plugin.manifest.id],
      })),
    })
    const palette = resolveTheme(theme(), customTheme()).palette
    // Read the name the code assigns. A disabled plugin is still inspected in
    // the sandbox and disposed immediately; the display name is all we keep.
    for (const plugin of loaded.plugins) {
      try {
        const host = await SandboxWorkerPlugin.create({
          bundle: plugin.bundle,
          manifest: plugin.manifest,
          palette,
        })
        const name = host.pluginName
        const error = host.failed ? (host.lastError ?? "plugin failed to load") : undefined
        host.dispose()
        setPluginManager((state) => renamePluginItem(state, plugin.manifest.id, name, error))
      } catch (error) {
        setPluginManager((state) =>
          renamePluginItem(
            state,
            plugin.manifest.id,
            plugin.manifest.name,
            String(error instanceof Error ? error.message : error).slice(0, 120),
          ),
        )
      }
    }
  }

  function movePluginManager(delta: number): void {
    setPluginManager((state) => movePluginCursor(state, delta))
  }

  async function togglePluginManager(): Promise<void> {
    const state = pluginManager()
    const item = state.items[state.cursor]
    if (!item) return
    const disabled = new Set(settingsView()?.disabledPlugins ?? [])
    if (item.enabled) disabled.add(item.id)
    else disabled.delete(item.id)
    const next = [...disabled].sort()
    const patch: Record<string, unknown> = { "ui.plugins.disabled": next }
    try {
      const saved = await props.onConfigPatch?.(nestedPatch(patch))
      if (saved && typeof saved === "object" && "ok" in saved && saved.ok === false) {
        const error = (saved as { error?: { message?: string } }).error
        setPluginManager((current) => ({ ...current, notice: error?.message ?? "the plugin setting could not be saved" }))
        return
      }
    } catch (error) {
      setPluginManager((current) => ({
        ...current,
        notice: String(error instanceof Error ? error.message : error).slice(0, 120),
      }))
      return
    }
    setSettingsView((view) => (view ? { ...view, disabledPlugins: next } : view))
    setPluginManager((current) => togglePluginItem(current, item.id))
    reloadParticleHosts?.()
    notify(`${item.name}: ${item.enabled ? "disabled" : "enabled"}`)
  }

  /** Read-only state handed to sandboxed scene and command plugins. */
  function sceneState(): SceneState {
    return {
      mode: view().mode,
      pane: view().pane,
      focus: view().focus,
      focused: view().focus === view().pane,
      width: dims().width,
      height: dims().height,
    }
  }

  /** The palette in force; the picker applies and persists it. */
  const [theme, setTheme] = createSignal<ThemeId>(props.theme ?? "lockedin")
  const [customTheme, setCustomTheme] = createSignal<Partial<ThemePalette> | null>(props.custom ?? null)

  // Dev-only effects. Off unless LOCKEDIN_PLUGINS is set; reduced motion wins.
  onMount(() => {
    let stopped = false
    let unwatch: (() => void) | null = null
    const report = (errors: readonly string[]) => {
      for (const error of errors) effectDebug(`load error: ${error}`)
    }
    const palette = () => resolveTheme(theme(), customTheme()).palette

    // Pointer targets are resolved from the painted scene; grants decide
    // whether the terminal is put into mouse-reporting mode.
    renderer.root.onMouseDown = (event) => {
      if (event.button !== 0) return
      appEffects?.pointer("press", event.x, event.y)
      appEffects?.pointer("click", event.x, event.y)
    }
    renderer.root.onMouseMove = (event) => {
      appEffects?.pointer("hover", event.x, event.y)
    }
    renderer.root.onMouseDrag = (event) => {
      appEffects?.pointer("move", event.x, event.y)
    }
    renderer.root.onMouseUp = (event) => {
      if (event.button === 0) appEffects?.pointer("release", event.x, event.y)
    }
    renderer.root.onMouseScroll = (event) => {
      if (event.scroll) appEffects?.pointer("wheel", event.x, event.y, event.scroll)
    }

    /**
     * First-party systems and plain user files stay in-process; plugin
     * directories (manifest + entry) run in a sandboxed worker.
     */
    const buildHosts = async (pluginDirs: readonly string[]): Promise<{
      particles: ParticleHostEntry[]
      scenes: SceneHostEntry[]
      actions: Action[]
    }> => {
      const paths = await particlePathsFromEnv()
      const loaded = paths.length > 0 ? await loadParticleFiles(paths) : { systems: [], errors: [] }
      report(loaded.errors)
      const particles: ParticleHostEntry[] = loaded.systems.map((entry) => ({
        id: entry.system.id,
        host: new CustomParticleHost(1, 1, palette(), entry.system),
      }))
      const scenes: SceneHostEntry[] = []
      const actions: Action[] = []
      const plugins = await loadPlugins(pluginDirs)
      report(plugins.errors)
      const disabled = new Set(settingsView()?.disabledPlugins ?? [])
      for (const plugin of plugins.plugins) {
        if (disabled.has(plugin.manifest.id)) continue
        const id = plugin.manifest.id
        try {
          const store = pluginState ? await pluginState.load(id) : {}
          const host = await SandboxWorkerPlugin.create({
            bundle: plugin.bundle,
            manifest: plugin.manifest,
            palette: palette(),
            store,
          })
          host.onStoreChange = (data) => pluginState?.schedule(id, data)
          host.onFailure = (message) => {
            setPluginErrors((map) => ({ ...map, [id]: message }))
            notify(`${host.pluginName}: ${message}`, "error")
            setPluginManager((state) =>
              state.items.some((item) => item.id === id)
                ? renamePluginItem(state, id, host.pluginName, message)
                : state,
            )
          }
          if (host.hasParticles) particles.push({ id: plugin.manifest.id, host })
          if (host.hasScene) scenes.push({ id: plugin.manifest.id, host })
          for (const command of plugin.manifest.permissions.commands ?? []) {
            if (!host.commandIds.includes(command.id)) continue
            const parsed = command.keys ? parseBinding(command.keys) : null
            const binding = parsed !== null && !("reason" in parsed) ? parsed : undefined
            host.onCommandResult = (result) => {
              let message = result.message
              let ok = result.ok
              if (result.status !== undefined) setPluginStatus(result.status)
              const target = (value: string | undefined): string | undefined =>
                value && host.commandIds.includes(value) ? value : undefined
              if (result.confirm) {
                const command = target(result.confirm.command)
                if (command) {
                  closePluginRequest()
                  pluginRequestRun = () => host.command(command, sceneState())
                  setPluginRequest({
                    kind: "confirm",
                    message: result.confirm.message,
                    confirmLabel: result.confirm.confirmLabel ?? "Yes",
                    cancelLabel: result.confirm.cancelLabel ?? "No",
                  })
                }
              }
              if (result.prompt) {
                const command = target(result.prompt.command)
                if (command) {
                  closePluginRequest()
                  pluginRequestRun = (input) => host.command(command, sceneState(), undefined, input)
                  setPluginRequest({
                    kind: "prompt",
                    message: result.prompt.message,
                    value: "",
                    ...(result.prompt.placeholder ? { placeholder: result.prompt.placeholder } : {}),
                  })
                }
              }
              if (result.menu) {
                const command = target(result.menu.command)
                if (command) {
                  closePluginRequest()
                  pluginRequestRun = (input) => host.command(command, sceneState(), undefined, input)
                  setPluginRequest({
                    kind: "menu",
                    title: result.menu.title,
                    options: result.menu.options,
                    index: 0,
                  })
                }
              }
              if (result.copy !== undefined) {
                if (plugin.manifest.permissions.clipboard === true && copyToClipboard(result.copy)) {
                  message = message ? `${message} · copied` : "copied to clipboard"
                } else {
                  message = "clipboard is unavailable"
                  ok = false
                }
              }
              const level = result.level === "warn" || result.level === "error" ? result.level : "info"
              const duration =
                typeof result.duration === "number" ? result.duration * 1000 : undefined
              const interaction =
                result.confirm !== undefined ||
                result.prompt !== undefined ||
                result.menu !== undefined ||
                result.status !== undefined
              if (message) notify(message, ok ? level : "error", duration)
              else if (!result.pointer && !interaction) {
                notify(ok ? command.title : `${command.title} failed`, ok ? "info" : "error")
              }
            }
            actions.push({
              id: command.id,
              label: command.title,
              group: "plugin",
              scope: "global",
              ...(binding ? { defaultBinding: binding } : {}),
              run: () => {
                if (current().overlay === "command") {
                  update({ ...current(), overlay: null, leaderPending: false, mode: "normal" })
                }
                host.command(command.id, sceneState())
              },
            })
          }
        } catch (error) {
          report([`${plugin.dir}: ${error instanceof Error ? error.message : String(error)}`])
        }
      }
      return { particles, scenes, actions }
    }

    /** Plugin roots: env folders for the dev harness, plus config folders when mounted. */
    const configDirs = (): readonly string[] => {
      const view = settingsView()
      return view?.pluginDirs ?? []
    }

    void (async () => {
      const options = resolvePluginOptions()
      const userPlugins = options.enabled && options.particles
      const envDirs = userPlugins ? await pluginDirsFromConfig() : []
      const pluginDirs = async (): Promise<string[]> => [
        ...new Set([
          ...envDirs,
          ...(userPlugins
            ? [
                ...(await scanPluginDirs(configDirs())),
                ...(await scanPluginDirs(bundledPluginRoots())),
              ]
            : []),
        ]),
      ]
      const hosts = userPlugins
        ? await buildHosts(await pluginDirs())
        : { particles: [], scenes: [], actions: [] }
      setPluginErrors({})
      if (stopped) {
        for (const entry of hosts.particles) entry.host.dispose?.()
        for (const entry of hosts.scenes) entry.host.dispose?.()
        return
      }
      appEffects = createAppPlugins(renderer, palette, process.env, {
        hosts: hosts.particles,
        scenes: hosts.scenes,
        state: sceneState,
      })
      appEffects?.start()
      mountPluginActions(hosts.actions)
      if (!userPlugins) return

      const reload = async () => {
        void pluginState?.flush()
        const next = await buildHosts(await pluginDirs())
        if (stopped) {
          for (const entry of next.particles) entry.host.dispose?.()
          for (const entry of next.scenes) entry.host.dispose?.()
          return
        }
        appEffects?.setHosts(next.particles)
        appEffects?.setSceneHosts(next.scenes)
        mountPluginActions(next.actions)
        effectDebug(`reloaded ${next.particles.length + next.scenes.length} host(s)`)
      }

      pluginRoots = pluginDirs
      reloadParticleHosts = () => {
        void reload()
      }

      // Editing an effect file, manifest or entry swaps the running hosts.
      unwatch = watchPlugins(process.env, () => {
        void reload()
      }, 120, [...envDirs, ...configDirs(), ...bundledPluginRoots()])
    })()
    onCleanup(() => {
      stopped = true
      void pluginState?.flush()
      pluginRoots = null
      reloadParticleHosts = null
      unwatch?.()
      unwatch = null
      renderer.root.onMouseDown = undefined
      renderer.root.onMouseMove = undefined
      renderer.root.onMouseDrag = undefined
      renderer.root.onMouseUp = undefined
      renderer.root.onMouseScroll = undefined
      appEffects?.stop()
      appEffects = null
    })
  })
  const [themesState, setThemesState] = createSignal({
    // Open on the palette in force, not at the top of an alphabetical list.
    cursor: Math.max(
      0,
      themeEntries().findIndex((entry) => entry.id === (props.theme ?? "lockedin")),
    ),
  })

  /** Swarms and their agents; the right sidebar shows an open swarm's agents. */
  const [swarms, setSwarms] = createSignal<SwarmSummary[]>([])
  const [openSwarm, setOpenSwarm] = createSignal<string | null>(null)
  /** Cursor in the right-hand agent roster. */
  const [sidebarCursor, setSidebarCursor] = createSignal(0)
  const [prompt, setPrompt] = createSignal<Prompt | null>(null)
  const [choice, setChoice] = createSignal<Choice | null>(null)
  const [editingAgent, setEditingAgent] = createSignal<string | null>(null)
  const [agentSettings, setAgentSettings] = createSignal(initialAgentSettings)
  const [course, setCourse] = createSignal<Course | null>(null)
  const [chapterCursor, setChapterCursor] = createSignal(0)
  const [skillGoal, setSkillGoal] = createSignal("")
  const [openChapter, setOpenChapter] = createSignal<{ id: string; practical: boolean } | null>(null)
  const [chapterText, setChapterText] = createSignal<string>("")
  const [notices, setNotices] = createSignal<Notice[]>([])
  const [pluginRequest, setPluginRequest] = createSignal<PluginRequest | null>(null)
  const [pluginStatus, setPluginStatus] = createSignal<{
    text: string
    tone?: "info" | "warn" | "error"
  } | null>(null)
  let pluginRequestRun: ((input?: string) => void) | null = null
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null)
  const [updatePhase, setUpdatePhase] = createSignal<"idle" | "checking" | "downloading" | "restart">("idle")
  let updateChecked = false
  let updateService: UpdateService | null = null

  async function loadUpdateService(): Promise<UpdateService | null> {
    if (!props.update) return null
    updateService ??= await props.update()
    return updateService
  }
  /** Scrollboxes the shell drives from NORMAL mode. */
  const [chatScroll, setChatScroll] = createSignal<ScrollApi | null>(null)
  /** First rendered block of the open chapter; j/k walks it. */
  const [readerOffset, setReaderOffset] = createSignal(0)
  /** A lock-in session's steps file; null until loaded or when it has none. */
  const [stepsText, setStepsText] = createSignal<string | null>(null)
  const [stepsStale, setStepsStale] = createSignal(false)
  const [stepsView, setStepsView] = createSignal<StepsView>(initialStepsView)
  const [sessionSettings, setSessionSettings] = createSignal<SessionSettingsState>(initialSessionSettings)
  let sessionSettingsEditor: TextareaRenderable | null = null
  let sessionSettingsSessionId: string | null = null
  let sessionSettingsSkipLoad: string | null = null
  /** Guards against holding R down and starting overlapping generations. */
  let stepsBuilding = false
  /** Sessions whose steps were auto-built once; a failed attempt waits for R. */
  const autoStepsTried = new Set<string>()
  /** Whether the source picker is creating a session or adding to one. */
  const [pickerMode, setPickerMode] = createSignal<
    | { kind: "create" }
    | { kind: "add"; sessionId: string }
    | { kind: "gather"; goalId: string; goalName: string }
    | { kind: "instructions"; sessionId: string }
    | { kind: "lockin-instructions"; name: string }
  >({ kind: "create" })
  /** The source picker saved while the wizard browses for an instructions file. */
  const [pendingSourcePicker, setPendingSourcePicker] = createSignal<PickerState | null>(null)
  const [reviewItems, setReviewItems] = createSignal<ReviewItem[]>([])
  const [pluginRows, setPluginRows] = createSignal<ServerRow[]>([])
  const [pluginCursor, setPluginCursor] = createSignal(0)
  const [readerDoc, setReaderDoc] = createSignal<{ title: string; lines: string[] } | null>(null)
  const [deckData, setDeckData] = createSignal<LoadedDeck | null>(null)
  const [deckView, setDeckView] = createSignal<DeckView>(initialDeckView)
  const [workHome, setWorkHome] = createSignal<WorkHomeData | null>(null)
  const deckForUi = (): DeckData | null => {
    const data = deckData()
    if (data === null) return null
    return {
      id: "deck",
      name: data.name,
      built: true,
      cards: data.cards.map((card, index) => ({ id: `card-${index + 1}`, ...card })),
    }
  }
  const stepsSnapshot = () => {
    const parsed = parseProgress(stepsText() ?? "")
    return parsed.ok
      ? { checked: parsed.value.checked, total: parsed.value.total }
      : { checked: 0, total: 0 }
  }
  const [nowMs, setNowMs] = createSignal(Date.now())

  /** Show a message in the top-right for ten seconds. */
  function closePluginRequest(): void {
    setPluginRequest(null)
    pluginRequestRun = null
  }

  function runPluginRequest(input?: string): void {
    const run = pluginRequestRun
    closePluginRequest()
    run?.(input)
  }

  function handlePluginRequestKey(
    press: ReturnType<typeof normalisePress>,
    event: { preventDefault: () => void; sequence?: string },
  ): boolean {
    const request = pluginRequest()
    if (!request) return false
    if (press.name === "escape") {
      closePluginRequest()
      event.preventDefault()
      return true
    }
    if (request.kind === "confirm") {
      if (press.name === "return" || press.name === "enter" || press.name === "y") {
        runPluginRequest()
      } else if (press.name === "n") {
        closePluginRequest()
      }
      event.preventDefault()
      return true
    }
    if (request.kind === "menu") {
      if (press.name === "j" || press.name === "down") {
        setPluginRequest({ ...request, index: Math.min(request.options.length - 1, request.index + 1) })
      } else if (press.name === "k" || press.name === "up") {
        setPluginRequest({ ...request, index: Math.max(0, request.index - 1) })
      } else if (press.name === "return" || press.name === "enter") {
        runPluginRequest(request.options[request.index])
      }
      event.preventDefault()
      return true
    }
    if (press.name === "return" || press.name === "enter") {
      runPluginRequest(request.value)
    } else if (press.name === "backspace") {
      setPluginRequest({ ...request, value: Array.from(request.value).slice(0, -1).join("") })
    } else {
      const text = typedText(press, event)
      if (text) setPluginRequest({ ...request, value: request.value + text })
    }
    event.preventDefault()
    return true
  }

  function notify(text: string, level: NoticeLevel = "info", duration?: number) {
    const at = Date.now()
    setNotices((list) =>
      [
        ...list,
        {
          id: `n${at}-${list.length}`,
          text,
          level,
          at,
          ...(duration === undefined ? {} : { duration }),
        },
      ].slice(-4),
    )
  }

  const updateBadge = (): UpdateBadge | null => {
    const phase = updatePhase()
    const info = updateInfo()
    if (phase === "restart") return { version: info?.version ?? "", state: "restart" }
    if (phase === "checking" || phase === "downloading") {
      return { version: info?.version ?? "", state: "updating" }
    }
    return info ? { version: info.version, state: "available" } : null
  }

  /** Set while the post-update restart is pending. */
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = null
  })

  /** `:update`: check, download, verify and replace the running binary. */
  async function runUpdate() {
    if (!props.update) {
      notify("updates are only available in an installed release build", "warn")
      return
    }
    if (updatePhase() === "checking" || updatePhase() === "downloading") {
      notify("an update is already running", "info")
      return
    }
    setUpdatePhase("checking")
    try {
      const service = await loadUpdateService()
      if (!service) throw new Error("the updater is not available")
      let info = updateInfo()
      if (!info) {
        updateChecked = true
        const checked = await service.check()
        if (checked.kind === "current") {
          setUpdatePhase("idle")
          notify(`LockedIn ${checked.latest} is up to date`, "info")
          return
        }
        if (checked.kind === "unavailable") {
          setUpdatePhase("idle")
          notify(checked.message, "warn")
          return
        }
        info = checked.info
        setUpdateInfo(info)
      }
      setUpdatePhase("downloading")
      notify(`downloading LockedIn ${info.version}…`, "info")
      const result = await service.install(info)
      if (result.kind === "updated") {
        setUpdateInfo({ ...info, version: result.version })
        setUpdatePhase("restart")
        const restart = props.restart
        if (!restart) {
          notify(`updated to ${result.version} · restart LockedIn`, "info")
          return
        }
        notify(`updated to ${result.version} · restarting…`, "info")
        // Let the notice paint before the process is replaced.
        restartTimer = setTimeout(() => {
          restartTimer = null
          const outcome = restart(() => renderer.destroy())
          if (!outcome.ok) notify(outcome.message ?? "restart LockedIn to run the new version", "warn")
        }, 700)
        return
      }
      setUpdatePhase("idle")
      if (result.kind === "current") {
        setUpdateInfo(null)
        notify(`LockedIn ${result.version} is up to date`, "info")
      } else {
        notify(result.message, result.kind === "error" ? "error" : "warn")
      }
    } catch (error) {
      setUpdatePhase("idle")
      notify(`could not update: ${error instanceof Error ? error.message : String(error)}`, "error")
    }
  }

  onMount(() => {
    const service = props.update
    if (!service) return
    // Keep the first frame free of network and filesystem work. A release check
    // a second after launch is indistinguishable to the user.
    const timer = setTimeout(() => {
      if (updateChecked) return
      updateChecked = true
      void loadUpdateService()
        .then((service) =>
          service?.check().then((result) => {
            if (result.kind !== "available") return
            setUpdateInfo(result.info)
            notify(`LockedIn ${result.info.version} is available · :update`, "info")
          }),
        )
        .catch(() => {})
    }, 1_000)
    onCleanup(() => clearTimeout(timer))
  })

  /** The ids a new project must not reuse. */
  const takenProjectIds = () => projects().map((project) => project.id)

  /**
   * Persist a project in the background. The row and its buffer are painted
   * first, so a slow disk never makes project creation feel synchronous; a
   * failed write removes the optimistic row and says why.
   */
  async function persistNewProject(input: { id: string; name: string; folder: string; mode: "chat" | "swarm" }): Promise<boolean> {
    const workspace = props.workspace
    // A workspace-less shell is a preview/test surface; it has nowhere to write,
    // so the optimistic buffer still opens and the caller sees the UX.
    if (!workspace) return true
    const result = await createProjectRecord({ workspace, ...input })
    if (result.ok) {
      // Registration resolves `~` and symlinks; paint that root before the
      // buffer opens, so the first chat scope is usable.
      setProjects((list) =>
        list.map((project) =>
          project.id === input.id ? { ...project, folder: result.value.folder } : project,
        ),
      )
      return true
    }
    // Registration is optimistic: the row was painted first. A failed write
    // must take it back, along with any swarm/prompt created around it.
    closeProjectBuffers(input.id)
    setProjects((list) => list.filter((project) => project.id !== input.id))
    setSwarms((list) => list.filter((swarm) => swarm.projectId !== input.id))
    setActiveProject(null)
    setActiveAgent(null)
    if (openSwarm() === `swarm-${input.id}`) setOpenSwarm(null)
    if (prompt()?.kind === "agent") setPrompt(null)
    update({ ...current(), pane: "projects", mode: "normal", overlay: null })
    notify(`project not saved: ${result.error.message}`, "error")
    return false
  }

  /** Persist one agent after an optimistic row edit. */
  function persistNewAgent(swarmId: string, agentId: string): void {
    const workspace = props.workspace
    const swarm = swarms().find((entry) => entry.id === swarmId)
    const agent = swarm?.agents.find((entry) => entry.id === agentId)
    if (!workspace || !swarm || !agent) return
    void createProjectAgent({
      workspace,
      projectId: swarm.projectId,
      id: agent.id,
      agent,
    }).then((result) => {
      if (result.ok) return
      setSwarms((list) =>
        list.map((entry) =>
          entry.id === swarmId
            ? { ...entry, agents: entry.agents.filter((candidate) => candidate.id !== agentId) }
            : entry,
        ),
      )
      notify(`agent not saved: ${result.error.message}`, "error")
    })
  }

  /** Persist an existing agent after an optimistic edit. */
  function persistAgent(swarmId: string, agentId: string): void {
    const workspace = props.workspace
    const swarm = swarms().find((entry) => entry.id === swarmId)
    const agent = swarm?.agents.find((entry) => entry.id === agentId)
    if (!workspace || !swarm || !agent) return
    void updateProjectAgent({
      workspace,
      projectId: swarm.projectId,
      id: agent.id,
      agent,
    }).then((result) => {
      if (!result.ok) notify(`agent not saved: ${result.error.message}`, "error")
    })
  }

  /** A project is a folder with a way of working: one chat, or a swarm. */
  type Project = {
    id: string
    name: string
    folder: string
    mode: "chat" | "swarm"
    swarmId: string | null
    swarmName?: string
    archived?: boolean
  }
  const [projects, setProjects] = createSignal<Project[]>([])
  const [activeProject, setActiveProject] = createSignal<string | null>(null)
  const [activeAgent, setActiveAgent] = createSignal<string | null>(null)
  const [projectPending, setProjectPending] = createSignal<
    { kind: "archive" | "delete"; id: string; name: string } | null
  >(null)

  /**
   * Buffers, the way an editor treats windows: the Chill chat is the home
   * buffer and opening a project (or an agent of it) pushes another. `:q`
   * closes the one you are in, `:qo` the rest, `:qa` all.
   */
  const [buffers, setBuffers] = createSignal<WorkBuffer[]>([HOME_BUFFER])
  /**
   * The course behind each skill buffer, so switching away and back reopens the
   * session you left rather than an empty reader.
   */
  const [skillCourses, setSkillCourses] = createSignal<Record<string, Course>>({})
  function rememberCourse(next: Course) {
    setSkillCourses((all) => ({ ...all, [next.id]: next }))
  }

  /** Keep the Skills row's chapter count in step with the reader. */
  function rememberProgress(next: Course) {
    setSkillsState((state) => ({
      ...state,
      goals: state.goals.map((goal) =>
        goal.id === next.id && goal.chapters
          ? {
              ...goal,
              chapters: {
                done: next.chapters.filter((chapter) => chapter.done).length,
                total: next.chapters.length,
              },
            }
          : goal,
      ),
    }))
  }
  const [currentBuffer, setCurrentBuffer] = createSignal("home")
  const bufferIndex = () => Math.max(0, buffers().findIndex((buffer) => buffer.id === currentBuffer()))
  const activeBuffer = () => buffers()[bufferIndex()] ?? HOME_BUFFER
  const [draft, setDraft] = createSignal<{ name: string; folder: string } | null>(null)

  /** Loaded lists, the same state the managers and the Explorer read. */
  const [managerState, setSessionsState] = createSignal(initialSessions(props.sessions ?? []))
  const [skillsState, setSkillsState] = createSignal(initialSkills(props.goals ?? []))

  async function loadChatsFor(goalId: string) {
    const workspace = props.workspace
    if (!workspace) return
    try {
      const rows = await loadSkillChats(workspace, goalId)
      setSkillsState((state) => ({
        ...state,
        chats: rows,
        chatCursor: Math.min(state.chatCursor, Math.max(0, rows.length - 1)),
      }))
    } catch {
      // A chat list that cannot be read leaves the empty column; it is not fatal.
    }
  }

  /** Explorer rows come from the workspace, and the shell owns the cursor. */
  const explorerRows = () => {
    const buffer = activeBuffer()
    return explorerRowsFor({
      session: buffer.kind === "session" ? { name: buffer.label } : null,
      skill: buffer.kind === "skill" ? { name: buffer.label } : null,
    })
  }
  const [explorerCursor, setExplorerCursor] = createSignal(firstItem(explorerRows()))
  const explorerSelection = () => selectedItem(explorerRows(), explorerCursor())

  /**
   * A session or skill buffer adds a context section to the Explorer. Move the
   * cursor there when that buffer opens, so the pane shows which surface is
   * active; other buffers keep whatever selection the user left.
   */
  createEffect(() => {
    const buffer = activeBuffer()
    if (buffer.kind !== "session" && buffer.kind !== "skill") return
    const wanted = buffer.kind === "session" ? "lockin:chat" : "skill:chat"
    const rows = untrack(explorerRows)
    const index = rows.findIndex((row) => row.kind === "item" && row.key === wanted)
    if (index >= 0) setExplorerCursor(index)
  })

  /**
   * The lists are loaded after the first frame, not before it: boot used to
   * await them and the startup gate caught the cost (+60 ms on CI). The props
   * above stay as overrides for tests and screenshots.
   */
  onMount(() => {
    const workspace = props.workspace
    if (!workspace && !props.loadSessions && !props.loadGoals) return
    let live = true
    const sessions = props.loadSessions ?? (() => loadSessionRows(workspace!))
    void sessions()
      .then((rows) => {
        if (live) setSessionsState(initialSessions(rows))
      })
      .catch(() => {})
    const goals = props.loadGoals ?? (() => loadGoalRows(workspace!))
    void goals()
      .then((rows) => {
        if (live) setSkillsState(initialSkills(rows))
      })
      .catch(() => {})
    // Projects are registered on disk; a restart lists the same rows and the
    // same agent profiles, and a project's chat path never changes between runs.
    if (workspace) {
      void refreshReview()
      void refreshPlugins()
      void loadProjects(workspace)
        .then((loaded) => {
          if (!live || loaded.length === 0) return
          setProjects(
            loaded.map((project) => ({
              id: project.id,
              name: project.name,
              folder: project.folder,
              mode: project.mode,
              swarmName: project.swarmName,
              archived: project.archived,
              swarmId: project.mode === "swarm" ? `swarm-${project.id}` : null,
            })),
          )
          setSwarms(
            loaded
              .filter((project) => project.mode === "swarm")
              .map((project) => ({
                id: `swarm-${project.id}`,
                name: project.swarmName || project.name,
                projectId: project.id,
                agents: project.agents,
              })),
          )
        })
        .catch(() => {})
    }
    onCleanup(() => {
      live = false
    })
  })

  /** List cursors for the surfaces that have one. */
  const [settingsState, setSettingsState] = createSignal(initialSettingsState)
  const [chatSettingsCursor, setChatSettingsCursor] = createSignal(0)
  const [settingsView, setSettingsView] = createSignal<SettingsView | undefined>(props.settings)
  const models = createModelsController({
    settings: () => settingsView(),
    openPane: (pane) => update({ ...current(), pane, mode: "normal", overlay: null }),
    backToSettings: () => update({ ...current(), pane: "settings", mode: "normal", overlay: null }),
    setPrompt: (value) => setPrompt(value),
    notify,
    saveConfig: async (patch) => {
      const saved = await props.onConfigPatch?.(nestedPatch(patch))
      if (
        saved !== null &&
        typeof saved === "object" &&
        "ok" in saved &&
        (saved as { ok: boolean }).ok === false
      ) {
        const error = (saved as { error?: { message?: string } }).error
        throw new Error(error?.message ?? "the config could not be saved")
      }
      setSettingsView((view) => (view ? applyViewPatch(view, patch) : view))
    },
    ...(props.linkProvider ? { linkProvider: props.linkProvider } : {}),
    ...(props.modelsForProvider ? { modelsForProvider: props.modelsForProvider } : {}),
    ...(props.linkedProviders ? { linkedProviders: props.linkedProviders } : {}),
  })
  const [taskCursor, setTaskCursor] = createSignal(0)
  const [taskCancelArmed, setTaskCancelArmed] = createSignal<string | null>(null)
  const [taskRegistry] = createSignal(new TaskRegistry())
  /** task id -> the controller that owns the turn, so cancel hits the right one. */
  const chatTasks = new Map<string, ChatController>()
  taskRegistry().setCancelPort((id) => chatTasks.get(id)?.cancel())
  const [activityView, setActivityView] = createSignal(initialActivity)
  const [statsSummary, setStatsSummary] = createSignal<StatsSummary | null>(null)
  const [achievementView, setAchievementView] = createSignal<AchievementView>(initialAchievementView)
  const [achievementMetrics, setAchievementMetrics] = createSignal<AchievementMetrics>(EMPTY_METRICS)
  const [achievementAwards, setAchievementAwards] = createSignal<Record<string, string>>({})
  const [statsView] = createSignal<StatsView>(initialStatsView)
  const [knowledgeState, setKnowledgeState] = createSignal<KnowledgeState>(initialKnowledge)
  const [knowledgeGraph, setKnowledgeGraph] = createSignal<KnowledgeGraph | null>(null)
  // Load the graph when the window opens, not at startup. Re-entering the
  // window reloads, so notes created earlier in the session are present.
  let lastPane: PaneId | null = null
  createEffect(() => {
    const pane = current().pane
    if (pane === "session-settings" && lastPane !== "session-settings" && props.workspace) {
      const buffer = activeBuffer()
      if (buffer.kind === "session") {
        const id = buffer.id.replace(/^session:/, "")
        if (sessionSettingsSkipLoad === id) {
          sessionSettingsSkipLoad = null
        } else if (sessionSettingsSessionId !== id || sessionSettings().data === null) {
          void loadSessionSettingsFor(id, buffer.id)
        }
      } else {
        setSessionSettings({
          ...initialSessionSettings,
          error: "open a lock-in session to edit its instructions",
        })
      }
    }
    if (pane === "knowledge" && lastPane !== "knowledge" && props.workspace) {
      void loadKnowledge(props.workspace)
        .then((graph) => {
          if (!graph) return
          setKnowledgeGraph(graph)
          setKnowledgeState((state) => {
            const known =
              state.focus !== null && navigationOrder(graph).some((item) => item.id === state.focus)
            return known ? state : { ...state, focus: navigationOrder(graph)[0]?.id ?? null }
          })
        })
        .catch(() => {
          setKnowledgeState((state) => ({
            ...state,
            notice: "knowledge could not be loaded",
          }))
        })
    }
    lastPane = pane
  })
  const [archiveState, setArchiveState] = createSignal<ArchiveState>(initialArchive([]))
  const [sourceState, setSourceState] = createSignal<PickerState | null>(null)
  const [sourceView, setSourceView] = createSignal<PickerView>(initialPickerView)
  const [existingSources, setExistingSources] = createSignal<string[]>([])
  let sourceSearchId = 0
  let sourceSearchTimer: ReturnType<typeof setTimeout> | null = null
  let sourceSearchAbort: AbortController | null = null
  let previewId = 0
  let previewTimer: ReturnType<typeof setTimeout> | null = null
  let previewAbort: AbortController | null = null

  /** The file whose preview should be loaded; null for none or a directory. */
  const pickerSelection = createMemo(() => {
    if (current().pane !== "sources") return null
    const state = sourceState()
    if (!state) return null
    const view = sourceView()
    // The right-hand selection pane owns the preview while it is focused.
    if (view.focus === "sources") return state.marks[view.sourcesCursor] ?? null
    const entry = pickerCurrentEntry(state, view)
    return entry?.kind === "file" ? entry.path : null
  })

  async function loadPreview(path: string | null): Promise<void> {
    const id = ++previewId
    previewAbort?.abort()
    previewAbort = null
    if (path === null) {
      setSourceView((view) => ({ ...view, preview: null, previewing: false, previewError: null }))
      return
    }
    setSourceView((view) => ({ ...view, previewing: true, previewError: null }))
    const controller = new AbortController()
    previewAbort = controller
    try {
      const result = await previewPickerFile(path, { signal: controller.signal })
      if (id !== previewId || controller.signal.aborted) return
      if (!result.ok) {
        setSourceView((view) => ({
          ...view,
          preview: null,
          previewing: false,
          previewError: pickerErrorLine(result.error),
        }))
        return
      }
      setSourceView((view) => ({
        ...view,
        preview: result.value,
        previewing: false,
        previewError: null,
      }))
    } catch (error) {
      if (id !== previewId) return
      setSourceView((view) => ({
        ...view,
        preview: null,
        previewing: false,
        previewError: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  createEffect(
    on(
      pickerSelection,
      (path) => {
        if (previewTimer) clearTimeout(previewTimer)
        previewTimer = setTimeout(() => {
          previewTimer = null
          void loadPreview(path)
        }, 80)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (previewTimer) clearTimeout(previewTimer)
    previewAbort?.abort()
    stopSourceSearch()
  })

  const [pendingSessionName, setPendingSessionName] = createSignal("")
  const [activityRecords, setActivityRecords] = createSignal<ActivityRecord[]>([])
  const [activitySkipped, setActivitySkipped] = createSignal(0)
  const [listCursors, setListCursors] = createSignal<Record<string, number>>({})

  let loadedChatGoal: string | null = null
  createEffect(() => {
    const state = skillsState()
    if (current().pane !== "skills" || state.pane !== "goals" || state.goals.length === 0) return
    const goal = state.goals[state.cursor]
    if (!goal || loadedChatGoal === goal.id) return
    loadedChatGoal = goal.id
    void loadChatsFor(goal.id)
  })

  /** Rows for the list surfaces that are menus over the current data. */
  const listRows = (pane: string): PanelRow[] => {
    if (pane === "manager") {
      return managerState().rows.map((row) => ({
        id: row.id,
        label: row.name,
        detail: `${row.sources} source${row.sources === 1 ? "" : "s"} · ${row.steps.done}/${row.steps.total} steps`,
      }))
    }
    if (pane === "buffers") {
      return buffers().map((buffer) => ({
        id: buffer.id,
        label: buffer.label,
        detail: `${buffer.kind}${buffer.id === currentBuffer() ? " · current" : ""}`,
      }))
    }
    if (pane === "recent") {
      return [
        ...managerState().rows.map((row) => ({
          id: `lockin:${row.id}`,
          label: `lock-in · ${row.name}`,
          detail: `${row.sources} source${row.sources === 1 ? "" : "s"} · ${row.steps.done}/${row.steps.total} steps`,
        })),
        ...skillsState().goals.map((goal) => ({
          id: `skill:${goal.id}`,
          label: `skill · ${goal.name}`,
          detail: `${goal.chapters ? `${goal.chapters.done}/${goal.chapters.total} chapters` : `${goal.stage.done}/${goal.stage.total} stages`} · ${goal.chats} chat${goal.chats === 1 ? "" : "s"}`,
        })),
        ...projects().map((project) => ({
          id: `project:${project.id}`,
          label: `project · ${project.name}`,
          detail: `${project.mode}${project.folder ? ` · ${project.folder}` : ""}`,
        })),
      ]
    }
    if (pane === "review") {
      // With no workspace (a preview or an injected test shell) there is no
      // queue to read; derive the same rows from the loaded sessions so the
      // surface still works.
      if (reviewItems().length === 0) {
        return managerState().rows
          .filter((session) => session.steps.total > 0 && session.steps.done < session.steps.total)
          .map((session) => ({
            id: session.id,
            label: session.name,
            detail: `${session.steps.total - session.steps.done} of ${session.steps.total} steps to review`,
          }))
      }
      return reviewItems().map((item) => ({
        id: item.id,
        label: item.label,
        detail: `${item.context} · ${item.reason}${item.count > 1 ? ` · ${item.count} times` : ""}`,
      }))
    }
    if (pane === "projects") {
      return projects().map((project) => {
        const swarm = swarms().find((entry) => entry.id === project.swarmId)
        return {
          id: project.id,
          label: project.name,
          detail:
            (project.archived ? "[archived] " : "") +
            (project.mode === "swarm"
              ? `swarm · ${swarm?.agents.length ?? 0} agent${(swarm?.agents.length ?? 0) === 1 ? "" : "s"} · ${project.folder}`
              : `single agent · ${project.folder}`),
        }
      })
    }
    if (pane === "swarms") {
      return swarms().map((swarm) => {
        const project = projects().find((entry) => entry.id === swarm.projectId)
        return {
          id: swarm.id,
          label: swarm.name,
          detail:
            `${swarm.agents.length} agent${swarm.agents.length === 1 ? "" : "s"}` +
            (project ? ` · ${project.name}` : " · unattached"),
        }
      })
    }
    if (pane === "agents") {
      const open = swarms().find((swarm) => swarm.id === openSwarm())
      if (!open) return []
      return open.agents.map((agent) => ({
        id: agent.id,
        label: agent.name,
        detail:
          `${agent.model || "model: inherit"} · ${agent.permissions} · ` +
          `${agent.task || "no task yet"}`,
      }))
    }
    return []
  }

  return (
    <AppView
      theme={theme()}
      custom={customTheme()}
      width={dims().width}
      height={dims().height}
      state={view()}
      activeTarget={activeTarget()}
      buffer={buffers().length > 1 ? `${bufferIndex() + 1}/${buffers().length}` : null}
      explorerRows={explorerRows()}
      explorerCursor={explorerCursor()}
      explorerDetail={
        view().focus === "explorer" && explorerSelection()
          ? { label: explorerSelection()!.label, detail: explorerSelection()!.detail }
          : null
      }
      paneTitle={paneTitle()}
      hints={hints()}
      overlayRows={leaderRows()}
      context={contextLabel()}
      tokens={usage().tokens}
      cost={usage().costMicroUsd}
      durationMs={usage().durationMs}
      toolMode={
        view().pane === "chat" &&
        view().focus === "chat" &&
        view().overlay === null &&
        chat().toolsAvailable &&
        contextLabel() !== "learn"
          ? TOOL_MODE_LABEL[chat().toolMode]
          : undefined
      }
      chat={props.initial?.chat ?? chat()}
      onChatScrollReady={setChatScroll}
      onChatScrollState={(up) => activeChat.setScrolledUp(up)}
      chatKey={activeBuffer().id}
      hintsHidden={settingsView()?.hideHints ?? false}
      agentSidebar={agentSidebarData()}
      pane={view().pane}
      paneDeps={paneDeps}
      course={course()}
      chapterCursor={chapterCursor()}
      openChapter={openChapter()}
      chapterText={chapterText()}
      readerOffset={readerOffset()}
      steps={
        activeBuffer().kind === "session"
          ? {
              raw: stepsText() ?? "",
              view: stepsView(),
              snapshot: stepsSnapshot(),
              missing: stepsText() === null || (stepsText() as string).trim() === "",
              hasInstructions: true,
              stale: stepsStale(),
            }
          : undefined
      }
      deck={deckForUi() ? { deck: deckForUi()!, view: deckView() } : undefined}
      readerTitle={readerDoc()?.title ?? props.initial?.readerTitle}
      readerLines={readerDoc()?.lines ?? props.initial?.readerLines}
      commandQuery={view().commandQuery}
      commandIndex={view().commandIndex}
      commandMessage={view().commandMessage}
      commandMatches={filterCommands(registry, view().commandQuery)}
      update={updateBadge()}
      prompt={prompt()}
      choice={choice()}
      pluginRequest={pluginRequest()}
      pluginStatus={pluginStatus()}
      notices={notices()}
      now={nowMs()}
      helpRows={rows()}
      helpPage={helpPage()}
    />
  )
}
