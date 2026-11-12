/**
 * The pane router: one place that turns a pane id into a surface.
 *
 * It is presentational. State and actions stay in the App; this file receives
 * the current values and returns the component with its own empty-state data,
 * so a pane with no data renders an empty state rather than crashing.
 */
import type { PaneId } from "../ui/shell/state"
import { PANE_TITLES } from "../ui/shell/panes"
import { managerHints } from "../ui/managers/manager-actions"
import type { ChatState } from "../ui/chat/model"
import type { SettingsState, SettingsView } from "../ui/settings/settings-page"
import type { ThemesState } from "../ui/settings/themes"
import type { AgentSettingsState } from "../ui/features/agents/agent-settings-panel"
import type { SessionsState } from "../ui/features/sessions/sessions-model"
import type { SkillsState } from "../ui/features/skills/skills-model"
import type { AgentSummary, SwarmSummary } from "../ui/shell/explorer"
import type { PanelRow } from "../ui/panels/panel-list"
import type { Course } from "../services/skills/course"
import type { ActivityView } from "../ui/work/activity"
import type { KnowledgeState } from "../ui/knowledge/model"
import type { KnowledgeGraph } from "../services/knowledge/graph"
import type { TaskRegistry } from "../domain/tasks"
import type { StatsSummary } from "../stats/types"
import type { AchievementMetrics } from "../domain/achievements"
import type { AchievementView } from "../ui/achievements/achievements"
import type { PickerState } from "../services/lockin/picker"
import type { PickerView } from "../ui/features/sources/sources-model"
import type { ServerRow } from "../ui/features/plugins/plugins-model"
import type { ThemeId, ThemePalette } from "../ui/theme"

import { resolveTheme } from "../ui/theme"
import { ArchivePanel } from "../ui/features/archive"
import { ActivityPane } from "../ui/work/activity"
import { PluginsPanel } from "../ui/features/plugins"
import { SessionsPanel } from "../ui/features/sessions"
import { SkillsPanel } from "../ui/features/skills"
import { SourcesPanel } from "../ui/features/sources"
import { StatsPage } from "../ui/stats"
import { StepsReader } from "../ui/reader/steps"
import { TasksPanel } from "../ui/features/tasks"
import { WorkChatPane } from "../ui/work/chat"
import { ModelsScreenPanel, type ModelsScreen } from "../ui/settings/models"
import { SettingsPage, emptySettingsView } from "../ui/settings"
import { ThemesPane } from "../ui/settings/themes"
import { PanelList } from "../ui/panels/panel-list"
import { PanelWindow } from "../ui/panels/panel-window"
import { PanelEmpty } from "../ui/panels/panel-frame"
import { AgentSettingsPanel } from "../ui/features/agents/agent-settings-panel"
import { ChatSettingsPanel, type ChatSettingsRow } from "../ui/features/chat-settings/chat-settings-panel"
import { SessionSettingsPanel } from "../ui/features/session-settings/session-settings-panel"
import { PluginManagerPane, type PluginManagerState } from "../ui/settings/plugin-manager"
import type { SessionSettingsState } from "../ui/features/session-settings/session-settings-model"
import { initialStepsView } from "../ui/reader/steps"
import { initialView as initialPickerView } from "../ui/features/sources/sources-model"


/** Copy for the list surfaces that are menus over the current data. */
const LIST_COPY: Record<string, string> = {
  review: "Steps, cards and stages that are still open. Enter opens the session they belong to.",
  projects: "A project is a folder plus how you work in it: one agent, or a swarm.",
  swarms: "One swarm per project, staffed with agents. A swarm is created with its project.",
  agents: "Each agent has a role: a task, a model and the permissions it may use.",
}

const LIST_EMPTY: Record<string, { line: string; hint: string }> = {
  review: { line: "nothing is due for review", hint: "␣ l starts a session with steps" },
  projects: { line: "no projects yet", hint: "n creates one: name, folder, then chat or swarm" },
  swarms: { line: "no swarms yet", hint: "a swarm project creates its swarm when you make it" },
  agents: { line: "no agents in this swarm yet", hint: "n adds one: name it, then set its task and model" },
}

const LIST_HINTS: Record<string, string[]> = {
  review: ["j/k move", "Enter open", "Esc close"],
  projects: managerHints(),
  swarms: ["j/k move", "n new swarm", "Enter open", "Esc close"],
  agents: ["j/k move", "n new agent", "t template", "s default", "e edit", "Esc close"],
}

export type PaneDeps = {
  theme: ThemeId
  custom: Partial<ThemePalette> | null
  settings?: SettingsView
  manager: SessionsState
  skills: SkillsState
  chat: ChatState
  course: Course | null
  chapterCursor: number
  openChapter: { id: string; practical: boolean } | null
  chapterText: string
  bufferCount: number
  swarms: SwarmSummary[]
  openSwarm: string | null
  agentSettings: AgentSettingsState
  chatSettingsCursor: number
  /** Which chat controls apply to the active buffer. */
  chatSettingsRows: ChatSettingsRow[]
  sessionSettings: SessionSettingsState
  sessionName: string
  onSessionSettingsEditor: (editor: import("@opentui/core").TextareaRenderable | null) => void
  currentAgent: () => AgentSummary | undefined
  themeId: ThemeId
  liveCustomTheme: Partial<ThemePalette> | null
  themes: ThemesState
  settingsState: SettingsState
  /** Effect plugin manager rows. */
  pluginManager: PluginManagerState
  tasks: TaskRegistry
  taskCursor: number
  activity: ActivityView
  knowledge: KnowledgeState
  knowledgeGraph?: KnowledgeGraph | null
  knowledgeReducedMotion?: boolean
  statsSummary?: StatsSummary | null
  statsView: import("../ui/stats/stats").StatsView
  achievements: AchievementView
  achievementMetrics: AchievementMetrics
  achievementAwards: Record<string, string>
  archive: import("../ui/features/archive").ArchiveState
  sources: PickerState | null
  sourceView: PickerView | null
  existingSources: string[]
  sourceTitle?: string
  sourceManifestLabel?: string
  sourceAllowInstructions?: boolean
  activityRecords: import("../services/work/activity").ActivityRecord[]
  activitySkipped: number
  listRows: (id: string) => PanelRow[]
  listCursors: Record<string, number>
  /** True when the open buffer is a project/agent chat. */
  workActive: boolean
  /** The provider/model picker, opened from Settings. */
  modelsScreen: ModelsScreen
  /** Configured MCP servers with their live status and tools. */
  pluginRows: ServerRow[]
  pluginCursor: number
}

/** An empty picker: the pane renders its own "no files here" state. */
function emptyPicker() {
  return { root: "", home: "", cwd: "", entries: [], marks: [], prompt: "", limit: 25 }
}

/** An empty stats summary: the page invites work instead of showing zeros. */
function emptySummary() {
  return {
    range: "all" as const,
    scope: "all" as const,
    overview: { runs: 0, failed: 0, input: 0, output: 0 },
    costMicroUsd: null,
    costLabel: "cost unknown",
    models: [],
    tools: [],
    learning: { steps: 0, cardsKnown: 0, cardsMissed: 0, lessons: 0 },
    activity: [],
    bestStreak: 0,
    activeDays: 0,
    period: { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    diagnostic: null,
  }
}

type PaneRenderer = (deps: PaneDeps, width: number, height: number, palette: ThemePalette) => unknown

function listPane(id: PaneId, deps: PaneDeps, width: number, height: number, palette: ThemePalette): unknown {
  return (
    <PanelList
      theme={palette}
      width={width}
      height={height}
      title={PANE_TITLES[id]}
      meta={
        id === "review"
          ? `${deps.listRows(id).length} due`
          : id === "agents"
            ? `${deps.swarms.find((swarm) => swarm.id === deps.openSwarm)?.name ?? "no swarm"} · ${deps.listRows(id).length} agents`
            : undefined
      }
      detail={LIST_COPY[id] ?? ""}
      rows={deps.listRows(id)}
      cursor={deps.listCursors[id] ?? 0}
      empty={LIST_EMPTY[id] ?? { line: "nothing here yet", hint: "" }}
      hints={LIST_HINTS[id] ?? ["j/k move", "Esc close"]}
    />
  )
}

/**
 * The surface for one pane id. A missing entry is a pane with no renderer yet;
 * the router renders nothing rather than guessing at a neighbour's screen.
 */
const RENDERERS: Partial<Record<PaneId, PaneRenderer>> = {
  manager: (deps, width, height, palette) => (
    <SessionsPanel theme={palette} width={width} height={height} state={deps.manager} />
  ),
  skills: (deps, width, height, palette) => (
    <SkillsPanel theme={palette} width={width} height={height} state={deps.skills} />
  ),
  work: (deps, width, height, palette) =>
    deps.workActive ? (
      <WorkChatPane
        theme={palette}
        width={width}
        height={height}
        focused
        state={deps.chat}
        view={{ tools: [], proposal: null }}
      />
    ) : (
      <PanelWindow
        theme={palette}
        width={width}
        height={height}
        title="Work"
        meta="no project open"
        detail="Open a project to chat with its agents; writes and commands stay off until you enable them."
        hints={["␣ p projects", "Esc close"]}
      >
        <PanelEmpty
          theme={palette}
          line="no project chat is open"
          hint="␣ p opens Projects"
          width={Math.max(20, width - 6)}
        />
      </PanelWindow>
    ),
  sources: (deps, width, height, palette) => (
    <SourcesPanel
      theme={palette}
      width={width}
      height={height}
      focused
      state={(deps.sources ?? emptyPicker()) as never}
      existing={deps.existingSources}
      title={deps.sourceTitle}
      manifestLabel={deps.sourceManifestLabel}
      allowInstructions={deps.sourceAllowInstructions}
      view={deps.sourceView ?? initialPickerView}
    />
  ),
  reader: (_deps, width, height, palette) => (
    <StepsReader theme={palette} width={width} height={height} focused raw="" snapshot={{ checked: 0, total: 0 }} view={initialStepsView} />
  ),
  stats: (deps, width, height, palette) => (
    <StatsPage
      theme={palette}
      width={width}
      height={height}
      focused
      view={deps.statsView}
      summary={deps.statsSummary ?? emptySummary()}
    />
  ),
  archive: (deps, width, height, palette) => (
    <ArchivePanel theme={palette} width={width} height={height} focused state={deps.archive} />
  ),
  recent: (deps, width, height, palette) => (
    <PanelList
      theme={palette}
      width={width}
      height={height}
      title="Recent"
      meta={`${deps.listRows("recent").length} sessions`}
      detail="Previous lock-in, skill and project sessions. Enter opens the selected one."
      rows={deps.listRows("recent")}
      cursor={deps.listCursors.recent ?? 0}
      empty={{ line: "no previous sessions yet", hint: "start one from its menu" }}
      hints={["j/k move", "Enter open", "Esc close"]}
    />
  ),
  review: (deps, width, height, palette) => listPane("review", deps, width, height, palette),
  projects: (deps, width, height, palette) => listPane("projects", deps, width, height, palette),
  swarms: (deps, width, height, palette) => listPane("swarms", deps, width, height, palette),
  agents: (deps, width, height, palette) => listPane("agents", deps, width, height, palette),
  buffers: (deps, width, height, palette) => (
    <PanelList
      theme={palette}
      width={width}
      height={height}
      title="Buffers"
      meta={`${deps.bufferCount} open`}
      detail="Surfaces you are working in. Enter switches behind the menu; Esc closes it."
      rows={deps.listRows("buffers")}
      cursor={deps.listCursors.buffers ?? 0}
      empty={{ line: "no buffers", hint: "open a project, an agent or a skill session" }}
      hints={["j/k move", "Enter switch", "d close", "Esc close"]}
    />
  ),
  "chat-settings": (deps, width, height, palette) => (
    <ChatSettingsPanel
      theme={palette}
      width={width}
      height={height}
      value={{
        responseStyle: deps.settings?.responseStyle ?? "normal",
        tutorPolicy: deps.settings?.tutorPolicy ?? "direct",
        cursor: deps.chatSettingsCursor,
      }}
      rows={deps.chatSettingsRows}
    />
  ),
  "agent-settings": (deps, width, height, palette) => {
    const agent = deps.currentAgent()
    return agent ? (
      <AgentSettingsPanel theme={palette} width={width} height={height} focused agent={agent} state={deps.agentSettings} />
    ) : null
  },
  "session-settings": (deps, width, height, palette) => (
    <SessionSettingsPanel
      theme={palette}
      width={width}
      height={height}
      focused
      sessionName={deps.sessionName}
      state={deps.sessionSettings}
      onEditorReady={deps.onSessionSettingsEditor}
    />
  ),
  providers: (deps, width, height, palette) => (
    <ModelsScreenPanel
      theme={palette}
      width={width}
      height={height}
      focused
      screen={{ ...deps.modelsScreen, view: "providers" }}
    />
  ),
  models: (deps, width, height, palette) => (
    <ModelsScreenPanel
      theme={palette}
      width={width}
      height={height}
      focused
      screen={{ ...deps.modelsScreen, view: "models" }}
    />
  ),
  themes: (deps, width, height) => (
    <ThemesPane
      theme={resolveTheme(deps.themeId, deps.liveCustomTheme).palette}
      width={width}
      height={height}
      focused
      current={deps.themeId}
      state={deps.themes}
    />
  ),
  "plugin-manager": (deps, width, height, palette) => (
    <PluginManagerPane
      theme={palette}
      width={width}
      height={height}
      focused
      state={deps.pluginManager}
    />
  ),
  settings: (deps, width, height, palette) => (
    <SettingsPage
      theme={palette}
      width={width}
      height={height}
      focused
      view={deps.settings ?? emptySettingsView()}
      state={deps.settingsState}
    />
  ),
  plugins: (deps, width, height, palette) => (
    <PluginsPanel
      theme={palette}
      width={width}
      height={height}
      focused
      servers={deps.pluginRows}
      cursor={deps.pluginCursor}
      toolsOpen={false}
    />
  ),
  "task-centre": (deps, width, height, palette) => (
    <TasksPanel theme={palette} width={width} height={height} registry={deps.tasks} cursor={deps.taskCursor} now={Date.now()} />
  ),
  activity: (deps, width, height, palette) => (
    <ActivityPane
      theme={palette}
      width={width}
      height={height}
      focused
      view={deps.activity}
      records={deps.activityRecords}
      skipped={deps.activitySkipped}
    />
  ),
}

export function paneFor(id: PaneId, width: number, height: number, deps: PaneDeps): unknown {
  const palette = resolveTheme(deps.theme, deps.custom).palette
  return RENDERERS[id]?.(deps, width, height, palette) ?? null
}
