/**
 * The shell's render layer.
 *
 * App owns state and key routing; this component owns the JSX. Keeping them in
 * separate files means a layout/component change cannot accidentally alter the
 * controller, and the controller can be tested without mounting the shell.
 */
import type { ChatState } from "../ui/chat/model"
import type { Course } from "../services/skills/course"
import type { PaneId } from "../ui/shell/panes"
import { paneFor, type PaneDeps } from "./panes"
import type { CommandEntry } from "../ui/shell/commands"
import type { ExplorerRow } from "../ui/shell/explorer"
import type { GeneratedRow } from "../ui/keymap/registry"
import type { Notice } from "../ui/shell/notice-stack"
import type { Choice } from "../ui/overlays/choice"
import type { Prompt } from "../ui/overlays/prompt"
import type { ScrollApi } from "../ui/scroll"
import type { ShellState } from "../ui/shell/state"
import type { ThemeId, ThemePalette } from "../ui/theme"
import { ThemeProvider, resolveTheme } from "../ui/theme"
import { AchievementPane } from "../ui/achievements/achievements"
import { KnowledgeWindow } from "../ui/knowledge/window"
import { EMPTY_KNOWLEDGE_GRAPH } from "../services/knowledge/graph"
import { ShellLayout, type UpdateBadge } from "../ui/shell/layout"
import { CourseReader } from "../ui/features/courses/course-reader-view"
import { StepsReader, type StepsView } from "../ui/reader/steps"
import { DeckPane, type Deck, type DeckView } from "../ui/reader/deck"

export type AppViewProps = {
  theme: ThemeId
  custom: Partial<ThemePalette> | null
  width: number
  height: number
  state: ShellState
  activeTarget: string | null
  buffer: string | null
  explorerRows: ExplorerRow[]
  explorerCursor: number
  explorerDetail: { label: string; detail: string } | null
  agentSidebar?: {
    project: string
    agents: import("../ui/shell/explorer").AgentSummary[]
    cursor: number
    defaultAgentId?: string
    activeAgentId?: string | null
  } | null
  paneTitle?: string
  hints: GeneratedRow[]
  overlayRows: GeneratedRow[]
  context: string
  tokens: number
  cost: number | null
  durationMs?: number | null
  /** The chat's tool mode chip, when the chat owns the status bar. */
  toolMode?: string
  chat?: ChatState
  onChatScrollReady: (api: ScrollApi | null) => void
  onChatScrollState: (scrolledUp: boolean) => void
  chatKey: string
  pane: PaneId
  paneDeps: () => PaneDeps
  course?: Course | null
  chapterCursor: number
  openChapter: { id: string; practical: boolean } | null
  chapterText: string
  readerOffset: number
  hintsHidden?: boolean
  /** The active session's `assignment-steps.md`, when it has one. */
  steps?: {
    raw: string
    view: StepsView
    snapshot: { checked: number; total: number }
    missing: boolean
    hasInstructions: boolean
    stale?: boolean
  }
  deck?: { deck: Deck; view: DeckView }
  readerTitle?: string
  readerLines?: string[]
  commandQuery: string
  commandIndex: number
  commandMessage: string | null
  commandMatches: CommandEntry[]
  /** A newer release, or the restart prompt after installing one. */
  update?: UpdateBadge | null
  prompt: Prompt | null
  choice: Choice | null
  notices: Notice[]
  now: number
  helpRows: GeneratedRow[]
  helpPage: number
}

export function AppView(props: AppViewProps) {
  return (
    <ThemeProvider theme={props.theme} custom={props.custom}>
      <ShellLayout
        width={props.width}
        height={props.height}
        theme={resolveTheme(props.theme, props.custom).palette}
        state={props.state}
        activeTarget={props.activeTarget}
        buffer={props.buffer}
        explorerRows={props.explorerRows}
        explorerCursor={props.explorerCursor}
        explorerDetail={props.explorerDetail}
        agentSidebar={props.agentSidebar}
        paneTitle={props.paneTitle}
        hints={props.hints}
        overlayRows={props.overlayRows}
        context={props.context}
        tokens={props.tokens}
        cost={props.cost}
        durationMs={props.durationMs}
        toolMode={props.toolMode}
        chat={props.chat}
        onChatScrollReady={props.onChatScrollReady}
        onChatScrollState={props.onChatScrollState}
        chatKey={props.chatKey}
        hintsHidden={props.hintsHidden}
        paneContent={(width, height) => {
          if (props.pane === "chat") return null
          // The achievement map owns a renderer image and an animation ticker.
          // Building it through `paneFor(...props.paneDeps())` here would read
          // every dependency in this reactive slot, so each cursor move would
          // replace the whole pane (new image, new ticker, visible flash).
          // Props below stay reactive getters, so the pane mounts once per
          // visit and only its data updates.
          if (props.pane === "achievements") {
            return (
              <AchievementPane
                theme={resolveTheme(props.theme, props.custom).palette}
                width={width}
                height={height}
                focused
                view={props.paneDeps().achievements}
                metrics={props.paneDeps().achievementMetrics}
                awards={props.paneDeps().achievementAwards}
              />
            )
          }
          // The Knowledge window owns an image pool, camera and animation
          // ticker too. Mounting it through paneFor would replace it on every
          // focus move and restart the camera from scratch.
          if (props.pane === "knowledge") {
            return (
              <KnowledgeWindow
                theme={resolveTheme(props.theme, props.custom).palette}
                width={width}
                height={height}
                focused
                graph={props.paneDeps().knowledgeGraph ?? EMPTY_KNOWLEDGE_GRAPH}
                state={props.paneDeps().knowledge}
                reducedMotion={props.paneDeps().knowledgeReducedMotion}
              />
            )
          }
          return paneFor(props.pane, width, height, props.paneDeps())
        }}
        readerTitle={props.readerTitle}
        readerLines={props.readerLines}
        readerContent={
          props.state.reader && props.deck ? (
            <DeckPane
              theme={resolveTheme(props.theme, props.custom).palette}
              width={Math.max(20, Math.floor(props.width * 0.5))}
              height={Math.max(4, props.height - 2)}
              focused={props.state.focus === "reader"}
              deck={props.deck.deck}
              view={props.deck.view}
            />
          ) : props.state.reader && props.course && !props.readerTitle ? (
            <CourseReader
              theme={resolveTheme(props.theme, props.custom).palette}
              width={Math.max(20, Math.floor(props.width * 0.5))}
              height={Math.max(4, props.height - 2)}
              course={props.course}
              cursor={props.chapterCursor}
              open={props.openChapter}
              text={props.chapterText}
              focused={props.state.focus === "reader"}
              offset={props.readerOffset}
            />
          ) : props.state.reader && props.steps && !props.readerTitle ? (
            <StepsReader
              theme={resolveTheme(props.theme, props.custom).palette}
              width={Math.max(20, Math.floor(props.width * 0.5))}
              height={Math.max(4, props.height - 2)}
              focused={props.state.focus === "reader"}
              raw={props.steps.raw}
              snapshot={props.steps.snapshot}
              view={props.steps.view}
              missing={props.steps.missing}
              hasInstructions={props.steps.hasInstructions}
              stale={props.steps.stale}
            />
          ) : undefined
        }
        commandQuery={props.commandQuery}
        commandIndex={props.commandIndex}
        commandMessage={props.commandMessage}
        commandMatches={props.commandMatches}
        update={props.update}
        prompt={props.prompt}
        choice={props.choice}
        notices={props.notices}
        now={props.now}
        helpRows={props.helpRows}
        helpPage={props.helpPage}
      />
    </ThemeProvider>
  )
}
