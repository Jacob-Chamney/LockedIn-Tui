/** Skills manager overlay: goals on the left, chats for the open goal. */
import type { ThemePalette } from "../../theme";
import { PanelEmpty } from "../../panels/panel-frame";
import { FloatingWindow, WindowBody, WindowFooter, WindowHeader } from "../../panels/floating-window";
import { SelectList } from "../../panels/select-list";
import { managerHints } from "../../managers/manager-actions";
import { chatText, emptyCopy, emptyHint, goalText, selectedChat, warningFor, type SkillsState } from "./skills-model";
/** The named middle region of the Skill sessions window. */
export function SkillSessionList(props: { theme: ThemePalette; height: number; state: SkillsState }) {
  const palette = () => props.theme
  const goalsFocused = () => props.state.pane === "goals"
  if (props.state.goals.length === 0) {
    return (
      <WindowBody center>
        <PanelEmpty theme={palette()} line={emptyCopy(props.state)} hint={emptyHint(props.state)} />
      </WindowBody>
    )
  }
  return (
    <WindowBody>
      <SelectList
        theme={palette()}
        cursor={goalsFocused() ? props.state.cursor : -1}
        visibleCount={Math.max(1, Math.floor((props.height - 10) / 2))}
        rows={props.state.goals.map((goal) => ({
          id: goal.id,
          label: goalText(goal),
          tone: goal.broken ? "error" : goal.archived ? "muted" : "normal",
        }))}
      />
      <text fg={palette().secondary} wrapMode="none">
        {`CHATS · ${props.state.chats.length}`}
      </text>
      {props.state.chats.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {emptyCopy(props.state)}
        </text>
      ) : (
        <SelectList
          theme={palette()}
          cursor={goalsFocused() ? -1 : props.state.chatCursor}
          visibleCount={Math.max(1, Math.floor((props.height - 10) / 2))}
          rows={props.state.chats.map((chat) => ({ id: chat.id, label: chatText(chat) }))}
        />
      )}
      {selectedChat(props.state) ? (
        <text fg={palette().muted} wrapMode="none">
          {`selected chat: ${selectedChat(props.state)!.title}`}
        </text>
      ) : null}
    </WindowBody>
  )
}

export function SkillsPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  state: SkillsState
}) {
  const palette = () => props.theme
  const pending = () => props.state.pending
  return (
    <FloatingWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      header={
        <WindowHeader
          theme={palette()}
          title="Skill sessions"
          meta={`${props.state.goals.length} goals`}
          detail="Goals with milestones, sources and their own chats."
        />
      }
      footer={<WindowFooter theme={palette()} hints={managerHints()} width={props.width} />}
      pending={pending() ? warningFor(props.state, pending()!.kind) : null}
      notice={props.state.notice}
    >
      <SkillSessionList theme={palette()} height={props.height} state={props.state} />
    </FloatingWindow>
  )
}
