/**
 * The root layout: top bar, Explorer, main, reader, status bar, overlay.
 *
 * A frame is a pure function of the state it is given: the headless harness
 * cannot re-render after mount (spike S1 findings), so the shell renders
 * values, not accessors, and tests mount one App per state.
 */
import { Show } from "solid-js";
import type { GeneratedRow } from "../keymap/registry";
import type { ThemePalette } from "../theme";
import { Explorer, type ExplorerRow } from "./explorer";
import { AgentsSidebar } from "./agents-sidebar";
import { LeaderMenu } from "../overlays/leader";
import { CommandBar } from "../overlays/command";
import { PromptOverlay, type Prompt } from "../overlays/prompt";
import { ChoiceOverlay, type Choice } from "../overlays/choice";
import { PluginRequestOverlay, type PluginRequest } from "../overlays/plugin-request";
import { NoticeStack, type Notice } from "./notice-stack";
import { HelpScreen } from "../overlays/help";
import { type CommandEntry } from "./commands";
import { StatusBar } from "./status";
import { ChatPane } from "../chat";
import type { ChatState } from "../chat";
import type { ScrollApi } from "../scroll";
import { chatColumn, isModal, paneGeometry, paneTone, popupHeight, type ShellState } from "./state";
export type UpdateBadge = {
  version: string
  state: "available" | "updating" | "restart"
}

export type LayoutProps = {
  theme: ThemePalette
  width: number
  height: number
  state: ShellState
  /** The surface's own name, for the breadcrumb and the status bar. */
  paneTitle?: string
  /** Footer hints for the active surface, already resolved from the registry. */
  paneHints?: string[]
  /** The project/swarm/session the user is inside, shown in the breadcrumb. */
  activeTarget?: string | null
  /** `2/3` when more than one buffer is open. */
  buffer?: string | null
  /** Explorer rows and cursor; the shell owns the selection. */
  explorerRows?: ExplorerRow[]
  explorerCursor?: number
  /** The selected explorer item's detail card, drawn over the main pane. */
  explorerDetail?: { label: string; detail: string } | null
  /** The open project's agent roster, docked on the right. */
  agentSidebar?: {
    project: string
    agents: import("./explorer").AgentSummary[]
    cursor: number
    defaultAgentId?: string
    activeAgentId?: string | null
  } | null
  /** A one-word note beside the mode, e.g. `read-only`. */
  paneNote?: string
  /** The chat's tool mode (PLAN/BUILD/LEARN). */
  toolMode?: string
  hints: GeneratedRow[]
  overlayRows: GeneratedRow[]
  context: string
  tokens: number
  /** `null` when no price is known; the status bar prints `cost unknown`. */
  cost: number | null
  durationMs?: number | null
  chat?: ChatState
  /** The transcript's scroller, for NORMAL-mode j/k. */
  onChatScrollReady?: (api: ScrollApi | null) => void
  /** Whether the transcript is scrolled away from the bottom. */
  onChatScrollState?: (scrolledUp: boolean) => void
  /** The open buffer id; changing it resets the shared transcript scroller. */
  chatKey?: string
  /** `ui.hide_hints`: the chat's hint rows are hidden. */
  hintsHidden?: boolean
  /** A session home shown in place of the chat welcome while it has no chat. */
  chatEmptyContent?: unknown
  /** The reader exists only when a document is open (design §2.2, P1-SH-04). */
  readerTitle?: string
  readerLines?: string[]
  /** A component for the reader pane (a chapter), instead of text lines. */
  readerContent?: unknown
  rows?: ExplorerRow[]
  /**
   * The mounted surface, supplied by the composition root. It receives the
   * space it actually gets: the main column for a full pane, the interior of the
   * popup for a modal one.
   */
  paneContent?: (width: number, height: number) => unknown
  /** Command-bar state; the shell supplies matches from the registry. */
  commandQuery?: string
  commandIndex?: number
  commandMessage?: string | null
  commandMatches?: CommandEntry[]
  /** A one-line prompt for a new swarm or agent. */
  prompt?: Prompt | null
  /** A highlighted chooser, e.g. chat vs swarm. */
  choice?: Choice | null
  /** A host-owned confirm/prompt/menu raised by a plugin command. */
  pluginRequest?: PluginRequest | null
  /** A chip a plugin asked to publish in the status bar. */
  pluginStatus?: { text: string; tone?: "info" | "warn" | "error" } | null
  /** A newer release, shown in the top bar; `:update` installs it. */
  update?: UpdateBadge | null
  /** Top-right messages; they fade after ten seconds. */
  notices?: Notice[]
  now?: number
  helpRows?: GeneratedRow[]
  helpPage?: number
}

const defaultChat: ChatState = {
  username: "friend",
  model: null,
  vision: false,
  capabilities: { responseStyle: false, tutorPolicy: false },
  status: "idle",
  responseStyle: "normal",
  tutorPolicy: "direct",
  messages: [],
  streamed: "",
  composer: "",
  attachments: [],
  pastes: [],
  scrolledUp: false,
  toolMode: "build",
  toolModeLocked: false,
  toolsAvailable: false,
  mounted: 12,
  thinkingOpen: false,
}


/**
 * Top bar: the wordmark, the path to where you are, and the model in force.
 *
 * The previous LockedIn read `CHILL › Chat` on the left and the model (or a
 * warning) on the right; the breadcrumb is what tells you which surface you are
 * looking at, so it now tracks the pane instead of being hardcoded to chat.
 */
export function TopBar(props: {
  theme: ThemePalette
  model?: string | null
  context?: string
  paneTitle?: string
  /** The active project or session, between the scope and the pane. */
  active?: string | null
  /** Buffer position, e.g. `2/3`. */
  buffer?: string | null
  /** Total width, so a long path or model id truncates instead of clipping. */
  width?: number
  /** A newer release, or the restart prompt after installing one. */
  update?: UpdateBadge | null
}) {
  const palette = () => props.theme
  const fit = (text: string, max: number) =>
    max <= 0 ? "" : text.length <= max ? text : max === 1 ? "…" : `${text.slice(0, max - 1)}…`
  // `WORK › Demo project › Chat`, the order `docs/ui-notes.md` documents.
  const trail = () =>
    [(props.context ?? "CHILL").toUpperCase(), props.active ?? null, props.paneTitle ?? "Chat"]
      .filter(Boolean)
      .join(" › ")
  const updateText = () => {
    const update = props.update
    if (!update) return null
    if (update.state === "restart") return `↻ restart for ${update.version}`
    if (update.state === "updating") {
      return update.version ? `↑ updating ${update.version}…` : "↑ updating…"
    }
    return `↑ ${update.version} · :update`
  }
  /** Right-side content is fixed-width; the breadcrumb gets what remains. */
  const rightWidth = () =>
    (updateText()?.length ?? 0) +
    (props.buffer ? props.buffer.length + 2 : 0) +
    (props.model ? Math.min(40, props.model.length) : "▌ no model configured".length) +
    4
  const trailMax = () => Math.max(8, (props.width ?? 120) - rightWidth() - 10)
  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      paddingX={1}
      backgroundColor={palette().surface}
      justifyContent="space-between"
    >
      <box flexDirection="row" flexShrink={1}>
        <text fg={palette().primary} wrapMode="none">
          <b>LOCKEDIN</b>
        </text>
        <text fg={palette().muted} wrapMode="none">
          {` › ${fit(trail(), trailMax())}`}
        </text>
      </box>
      <box flexDirection="row" flexShrink={0}>
        {updateText() ? (
          <text
            fg={
              props.update?.state === "restart"
                ? palette().warning
                : props.update?.state === "updating"
                  ? palette().muted
                  : palette().primary
            }
            wrapMode="none"
          >
            {`${updateText()}  `}
          </text>
        ) : null}
        {props.buffer ? (
          <text fg={palette().muted} wrapMode="none">
            {`${props.buffer}  `}
          </text>
        ) : null}
        {props.model ? (
          <text fg={palette().muted} wrapMode="none">
            {fit(props.model, Math.max(8, 40 - (updateText()?.length ?? 0)))}
          </text>
        ) : (
          <text fg={palette().warning} wrapMode="none">
            ▌ no model configured
          </text>
        )}
      </box>
    </box>
  )
}

export function ReaderPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  title: string
  lines: string[]
}) {
  const palette = () => props.theme
  const headings = () => props.lines.filter((l) => l.startsWith("##")).join("\n")
  const body = () => props.lines.filter((l) => !l.startsWith("##")).join("\n")
  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={palette().panel}
      paddingX={1}
    >
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} ${props.title}`}
      </text>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {headings()}
      </text>
      <text fg={props.focused ? palette().foreground : palette().muted} wrapMode="none">
        {body()}
      </text>
    </box>
  )
}

export function ShellLayout(props: LayoutProps) {
  const palette = () => props.theme
  /**
   * These depend on the state, so they must be read inside the JSX. Computing
   * them once into a const froze them at mount: a pane that became a chooser
   * left its popup behind, and the geometry never followed a pane switch.
   */
  const geometry = () => paneGeometry(props.width, props.state)
  const column = () => chatColumn(props.width, props.state)
  const readerLines = () => props.readerLines ?? []
  const hasReader = () => geometry().reader > 0 && (props.readerContent !== undefined || readerLines().length > 0)
  const modal = () => isModal(props.state.pane)
  const bodyHeight = () => Math.max(1, props.height - 2)

  /**
   * A chooser floats: centred, bounded, over the chat it interrupts. Picking an
   * item is a detour, not a place — the full window is reserved for the thing
   * you are actually working in (Chill, a session, the reader).
   */
  const popup = () => {
    const width = Math.max(24, Math.min(90, Math.floor(props.width * 0.72)))
    const height = popupHeight(props.state.pane, bodyHeight())
    return { width, height }
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={palette().background}>
      <TopBar
        theme={props.theme}
        model={props.chat?.model ?? null}
        context={props.context}
        paneTitle={props.paneTitle}
        active={props.activeTarget ?? null}
        buffer={props.buffer ?? null}
        width={props.width}
        update={props.update}
      />
      <box height={Math.max(1, props.height - 2)} flexShrink={0} flexDirection="row">
        {geometry().explorer > 0 ? (
          <Explorer
            theme={props.theme}
            width={geometry().explorer}
            height={Math.max(1, props.height - 2)}
            focused={paneTone(props.state, "explorer") === "focus"}
            rows={props.explorerRows ?? []}
            cursor={props.explorerCursor ?? 0}
          />
        ) : null}
        {/* The chat column is capped at 110 and centred in the main area; without
            this spacer it sat against the left edge and its centred content was
            off by (main - 110) / 2 on any wide terminal. */}
        {props.state.pane === "chat" || modal() ? <box width={column().left} flexShrink={0} /> : null}
        {/* The chat stays mounted behind a pane so its state survives a round trip,
            and stays visible (dimmed) behind a chooser. */}
        <ChatPane
          theme={props.theme}
          width={props.state.pane === "chat" || modal() ? column().width : 0}
          height={props.state.pane === "chat" || modal() ? bodyHeight() : 0}
          focused={props.state.pane === "chat" && paneTone(props.state, "chat") === "focus"}
          state={props.chat ?? defaultChat}
          mode={props.state.mode}
          onScrollReady={props.onChatScrollReady}
          onScrollState={props.onChatScrollState}
          resetKey={props.chatKey}
          hintsHidden={props.hintsHidden}
          emptyContent={props.chatEmptyContent}
        />
        {props.explorerDetail && geometry().explorer > 0 ? (
          <box
            position="absolute"
            top={1}
            left={geometry().explorer}
            width={Math.min(48, Math.max(24, props.width - geometry().explorer - 2))}
            flexDirection="column"
            border={["left", "right", "top", "bottom"]}
            borderColor={palette().primary}
            backgroundColor={palette().panel}
            paddingX={1}
          >
            <text fg={palette().foreground} wrapMode="none">
              <b>{props.explorerDetail.label}</b>
            </text>
            <text fg={palette().muted} wrapMode="word">
              {props.explorerDetail.detail}
            </text>
          </box>
        ) : null}
        {props.state.pane !== "chat" && !modal() ? (
          <box
            width={geometry().main}
            height={bodyHeight()}
            flexDirection="column"
            paddingX={1}
            paddingTop={1}
          >
            <box flexGrow={1} minHeight={0} flexDirection="column">
              {(props.paneContent?.(geometry().main - 2, bodyHeight() - 2) ?? null) as never}
            </box>
          </box>
        ) : null}
        {modal() ? (
          <>
            {/* No blur in a terminal: the backdrop is the page itself at low
                opacity, which darkens everything the popup does not cover. */}
            <box
              position="absolute"
              top={0}
              left={0}
              width={props.width}
              height={props.height}
              backgroundColor={palette().background}
              opacity={0.6}
            />
            {/* A full-body row that centres its child: rounding can never
                leave the popup a cell off, and it is centred on both axes. */}
            <box
              position="absolute"
              top={0}
              left={0}
              width={props.width}
              height={bodyHeight()}
              flexDirection="row"
              justifyContent="center"
              alignItems="center"
            >
            <box
              width={popup().width}
              height={popup().height}
              flexDirection="column"
              backgroundColor={palette().surface}
              paddingX={2}
              paddingTop={1}
            >
              <box flexGrow={1} minHeight={0} flexDirection="column">
                {(props.paneContent?.(popup().width - 4, popup().height - 1) ?? null) as never}
              </box>
            </box>
            </box>
          </>
        ) : null}
        {hasReader() ? (
          props.readerContent !== undefined ? (
            <box width={geometry().reader} height={Math.max(1, props.height - 2)} flexDirection="column">
              {(props.readerContent ?? null) as never}
            </box>
          ) : (
            <ReaderPane
              theme={props.theme}
              width={geometry().reader}
              height={Math.max(1, props.height - 2)}
              focused={paneTone(props.state, "reader") === "focus"}
              title={props.readerTitle ?? "reader"}
              lines={readerLines()}
            />
          )
        ) : null}
        {props.agentSidebar && geometry().agents > 0 ? (
          <AgentsSidebar
            theme={props.theme}
            width={geometry().agents}
            height={Math.max(1, props.height - 2)}
            focused={paneTone(props.state, "agents") === "focus"}
            project={props.agentSidebar.project}
            agents={props.agentSidebar.agents}
            cursor={props.agentSidebar.cursor}
            defaultAgentId={props.agentSidebar.defaultAgentId}
            activeAgentId={props.agentSidebar.activeAgentId}
          />
        ) : null}
      </box>
      <StatusBar
        theme={props.theme}
        width={props.width}
        pane={props.state.focus}
        paneTitle={props.paneTitle}
        note={props.paneNote}
        toolMode={props.toolMode}
        mode={props.state.mode}
        overlay={props.state.overlay}
        context={props.context}
        hints={props.hints}
        tokens={props.tokens}
        cost={props.cost}
        durationMs={props.durationMs}
        pluginStatus={props.pluginStatus}
      />
      {props.state.overlay === "command" ? (
        <CommandBar
          theme={props.theme}
          width={props.width}
          height={props.height}
          query={props.commandQuery ?? ""}
          index={props.commandIndex ?? 0}
          message={props.commandMessage ?? null}
          matches={props.commandMatches ?? []}
        />
      ) : null}
      <Show when={props.prompt}>
        {(prompt) => (
          <PromptOverlay theme={props.theme} width={props.width} height={props.height} prompt={prompt()} />
        )}
      </Show>
      {props.notices && props.notices.length > 0 ? (
        <NoticeStack theme={props.theme} width={props.width} notices={props.notices} now={props.now ?? Date.now()} rightOffset={geometry().reader + geometry().agents} />
      ) : null}
      <Show when={props.choice}>
        {(choice) => (
          <ChoiceOverlay theme={props.theme} width={props.width} height={props.height} choice={choice()} />
        )}
      </Show>
      <Show when={props.pluginRequest}>
        {(request) => (
          <PluginRequestOverlay
            theme={props.theme}
            width={props.width}
            height={props.height}
            request={request()}
          />
        )}
      </Show>
      {props.state.overlay === "help" ? (
        <HelpScreen
          theme={props.theme}
          width={props.width}
          height={props.height}
          rows={props.helpRows ?? props.hints}
          page={props.helpPage ?? 0}
        />
      ) : null}
      {props.state.overlay === "leader" ? (
        <LeaderMenu
          theme={props.theme}
          rows={props.overlayRows}
          width={props.width}
          height={props.height}
        />
      ) : null}
    </box>
  )
}
