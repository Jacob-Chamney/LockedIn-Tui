/**
 * Chill chat pane.
 *
 * Renders state and dispatches intents; it never imports storage, security or
 * LLM internals, never calls a tool and never writes a note.
 *
 * Layout follows the previous LockedIn: a centred welcome (wordmark, tagline,
 * greeting, key hints) when the transcript is empty, role-labelled messages when
 * it is not, and a boxed composer under both. The pane owns no key handling; the
 * shell routes keys to the controller.
 */
import { createEffect, onCleanup } from "solid-js";
import { type ScrollBoxRenderable } from "@opentui/core";
import { contrastRatio, type ThemePalette } from "../theme";
import type { ScrollApi } from "../scroll";
import { MarkdownBody } from "../reader/markdown-body";
import { LOGO_MIN_WIDTH, LOCKED_IN_LOGO, LOCKED_IN_TAGLINE } from "../shell/brand";
import { Bubble, useAfterFirstFrame, useCellSize } from "./bubble";
import { useThinkingPulse } from "./pulse";
import { bubbleColumns } from "./bubble-geometry";
import { COMPOSER_CURSOR, PLACEHOLDER, STOP_LINE, THINKING_LINE, canSend, chipLabel, composerRows, composerText, greeting, hiddenCount, hints as hintList, mountedMessages, newMessagesMarker, pasteLabel, pasteRows, stopMarker, streamingText, thinkingLine, waitingForModel, type ChatState, type Message } from "./model";
export function ChatPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: ChatState
  hintsHidden?: boolean
  hintsCollapsed?: boolean
  /** Shell mode: NORMAL invites `i`, INSERT shows the composer placeholder. */
  mode?: "insert" | "normal"
  /** Hand the transcript scroller to the shell for NORMAL-mode keys. */
  onScrollReady?: (api: ScrollApi | null) => void
  /** Tell the caller whether the user is reading above the bottom. */
  onScrollState?: (scrolledUp: boolean) => void
  /** Changes when the buffer changes; the transcript starts at the newest row. */
  resetKey?: string
  /** Shown instead of the welcome while the buffer has no messages. */
  emptyContent?: unknown
  /** Test/embed override for the terminal's pixel cell size. */
  cellSize?: { width: number; height: number } | null
}) {
  let scroller: ScrollBoxRenderable | undefined
  const handOver = (node: ScrollBoxRenderable | undefined) => {
    scroller = node
    if (!node) {
      props.onScrollReady?.(null)
      return
    }
    const hideBars = () => {
      node.verticalScrollBar.visible = false
      node.horizontalScrollBar.visible = false
    }
    hideBars()
    const atBottom = () => node.scrollTop + node.viewport.height >= node.scrollHeight - 1
    props.onScrollReady?.({
      scrollBy: (delta) => {
        node.scrollBy(delta)
        hideBars()
        props.onScrollState?.(!atBottom())
      },
      scrollToBottom: () => node.scrollTo(Infinity),
      atBottom,
    })
  }
  onCleanup(() => props.onScrollReady?.(null))
  // One scroll node is shared by every buffer; without this, switching from a
  // long transcript to a short one leaves the old offset and sticky follow.
  createEffect(() => {
    void props.resetKey
    queueMicrotask(() => {
      scroller?.scrollTo(Infinity)
      if (scroller) {
        scroller.verticalScrollBar.visible = false
        scroller.horizontalScrollBar.visible = false
      }
      props.onScrollState?.(false)
    })
  })

  /**
   * Follow the newest row as the transcript grows. `stickyScroll` handles a
   * user scroll, but a streaming reply can add rows without a scroll event, so
   * pin the scroller here unless the user has deliberately scrolled up.
   */
  createEffect(() => {
    void props.state.messages.length
    void props.state.streamed
    void props.state.status
    void props.height
    void props.width
    if (props.state.scrolledUp) return
    queueMicrotask(() => {
      scroller?.scrollTo(Infinity)
      if (scroller) {
        scroller.verticalScrollBar.visible = false
        scroller.horizontalScrollBar.visible = false
      }
      props.onScrollState?.(false)
    })
  })
  const palette = () => props.theme
  const detectedCell = useCellSize()
  const cell = () => (props.cellSize !== undefined ? props.cellSize : detectedCell())
  const laidOut = useAfterFirstFrame()
  /** The waiting line breathes; a still screen is one setting away. */
  const thinkingInk = useThinkingPulse(
    () => waitingForModel(props.state),
    () => palette().muted,
    () => palette().foreground,
  )
  const body = () => (props.focused ? palette().foreground : palette().muted)
  const compact = () => props.height < 24 || props.width < 90
  /** Only the response controls this surface offers, plus the key hint. */
  const strip = () => {
    const parts: string[] = []
    if (props.state.capabilities?.responseStyle) parts.push(`style: ${props.state.responseStyle}`)
    if (props.state.capabilities?.tutorPolicy) parts.push(`tutor: ${props.state.tutorPolicy}`)
    if (!compact()) parts.push("Enter send · Esc normal")
    return parts.join(" · ")
  }
  /** Prefer whichever semantic text token reads best on the user bubble. */
  const userInk = () => {
    const onBackground = contrastRatio(palette().background, palette().primary)
    const onForeground = contrastRatio(palette().foreground, palette().primary)
    return onBackground >= onForeground ? palette().background : palette().foreground
  }
  const bubbleBackground = (role: Message["role"]) =>
    role === "user" ? palette().primary : palette().panel
  const bubbleInk = (role: Message["role"]) => (role === "user" ? userInk() : body())
  /** Inactive pane: Markdown dims with the rest of the transcript. */
  const ink = () =>
    props.focused
      ? palette()
      : {
          ...palette(),
          foreground: palette().muted,
          secondary: palette().muted,
          primary: palette().muted,
          accent: palette().muted,
        }
  const fullWidth = () => Math.max(20, props.width - 2)
  /** Text columns inside the composer's margin, border and padding. */
  const composerWidth = () => Math.max(1, props.width - 6)
  /** Content-sized, so the caps read as corners instead of a wide rectangle. */
  const messageWidth = (message: Message) => bubbleColumns(message.text, fullWidth(), message.role)
  const assistantBubbleWidth = () => bubbleColumns(streamingText(props.state), fullWidth(), "assistant")
  /** The body pads one cell each side; the caps add no width. */
  const bubbleContentWidth = (message: Message) => Math.max(8, messageWidth(message) - 2)
  const send = () => canSend(props.state)
  /**
   * "Nothing to send" is not a warning: an empty composer is the normal state.
   * Only a real block (no model, no key) earns the warning line.
   */
  const blockedSend = () => {
    const result = send()
    return !result.ok && result.reason !== "nothing to send"
  }
  /**
   * While a reply streams, the controller has already appended an empty
   * assistant message; the streaming block renders it instead, so the transcript
   * does not show an empty duplicate.
   */
  const messages = () => {
    const mounted = mountedMessages(props.state)
    if (props.state.status !== "streaming") return mounted
    const last = mounted.at(-1)
    return last && last.role === "assistant" && last.text.length === 0 ? mounted.slice(0, -1) : mounted
  }
  const empty = () => props.state.messages.length === 0 && props.state.status !== "streaming"
  const hints = () => hintList(props.state, { hidden: props.hintsHidden, collapsed: props.hintsCollapsed })
  /** Two rows keep five hints readable at 80 columns, where one row truncates. */
  const hintRows = () => {
    const all = hints()
    const half = Math.ceil(all.length / 2)
    return [all.slice(0, half), all.slice(half)].filter((row) => row.length > 0)
  }

  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={palette().background}
    >
      {props.state.status === "blocked" && props.state.blocked ? (
        <box paddingX={1} flexShrink={0}>
          <text fg={palette().warning} wrapMode="none">
            {`▌ ${props.state.blocked.reason} — ${props.state.blocked.fix}`}
          </text>
        </box>
      ) : null}

      {hiddenCount(props.state) > 0 ? (
        <text fg={palette().muted} wrapMode="none" paddingX={1}>
          {`▲ press e to load ${hiddenCount(props.state)} older messages`}
        </text>
      ) : null}

      {/* The empty state is centred over the whole pane, so it takes an
          out-of-flow box and a spacer keeps the composer pinned to the bottom.
          On a very short terminal the welcome renders in flow instead, where
          overlapping the composer would be worse than sitting high. */}
      {empty() && props.emptyContent ? (
        <box flexGrow={1} minHeight={0} flexDirection="column">
          {props.emptyContent as never}
        </box>
      ) : null}

      {empty() && !props.emptyContent && props.height >= 20 ? (
        /* Centred in the pane, not just in the space above the composer: the
           welcome is the whole screen while there is no transcript. */
        <box
          position="absolute"
          top={0}
          left={0}
          width={props.width}
          height={props.height}
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          paddingX={1}
        >
          {props.width >= LOGO_MIN_WIDTH ? (
            LOCKED_IN_LOGO.map((line) => (
              <text fg={palette().primary} wrapMode="none">
                {line}
              </text>
            ))
          ) : (
            <text fg={palette().primary} wrapMode="none">
              <b>LOCKED IN</b>
            </text>
          )}
          <box height={1} />
          <text fg={palette().muted} wrapMode="none">
            {LOCKED_IN_TAGLINE}
          </text>
          <box height={1} />
          <text fg={palette().primary} wrapMode="none">
            {greeting(props.state)}
          </text>
          <box height={1} />
          {hintRows().map((row) => (
            <text fg={palette().primary} wrapMode="none">
              {row.join(" · ")}
            </text>
          ))}
        </box>
      ) : null}

      {empty() && !props.emptyContent && props.height < 20 ? (
        <box flexGrow={1} minHeight={0} flexDirection="column" alignItems="center" justifyContent="center" paddingX={1}>
          {props.width >= LOGO_MIN_WIDTH ? (
            LOCKED_IN_LOGO.map((line) => (
              <text fg={palette().primary} wrapMode="none">
                {line}
              </text>
            ))
          ) : (
            <text fg={palette().primary} wrapMode="none">
              <b>LOCKED IN</b>
            </text>
          )}
          <box height={1} />
          <text fg={palette().muted} wrapMode="none">
            {LOCKED_IN_TAGLINE}
          </text>
          <box height={1} />
          <text fg={palette().primary} wrapMode="none">
            {greeting(props.state)}
          </text>
        </box>
      ) : null}

      {empty() && props.emptyContent ? null : (
      <scrollbox
        ref={(node) => handOver(node as ScrollBoxRenderable)}
        flexGrow={1}
        minHeight={0}
        scrollY
        stickyScroll={!props.state.scrolledUp}
        stickyStart="bottom"
        scrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ visible: false }}
        paddingX={1}
        paddingTop={2}
        flexDirection="column"
      >
        {messages().map((message) => (
          <box
            width={fullWidth()}
            flexDirection="column"
            alignItems={message.role === "user" ? "flex-end" : "flex-start"}
          >
            <text fg={message.role === "user" ? palette().primary : palette().muted} wrapMode="none">
              {message.role === "user" ? "you" : "locked in"}
            </text>
            <box marginBottom={compact() ? 0 : 1}>
              <Bubble
                width={messageWidth(message)}
                fill={bubbleBackground(message.role)}
                background={palette().background}
                cell={cell()}
                ready={laidOut()}
              >
                {message.role === "assistant" ? (
                  <MarkdownBody
                    theme={ink()}
                    text={message.text}
                    width={bubbleContentWidth(message)}
                    height={0}
                    grow={false}
                    align="center"
                  />
                ) : (
                  <text fg={bubbleInk(message.role)} wrapMode="word" textAlign="center">
                    {message.text}
                  </text>
                )}
                {message.truncated ? (
                  <text fg={palette().warning} wrapMode="word" textAlign="center">
                    {"! reply truncated at the output limit · continue, or raise the ceiling in config"}
                  </text>
                ) : null}
                {thinkingLine(message) ? (
                  <text fg={palette().muted} wrapMode="none" textAlign="center">
                    {thinkingLine(message)!}
                  </text>
                ) : null}
                {message.outcome === "stopped" ? (
                  <text fg={palette().warning} wrapMode="none" textAlign="center">
                    {"◼ Stopped"}
                  </text>
                ) : null}
                {message.outcome === "failed" && message.error ? (
                  <text fg={palette().error} wrapMode="none" textAlign="center">
                    {`× ${message.error}`}
                  </text>
                ) : null}
              </Bubble>
            </box>
          </box>
        ))}

        {props.state.status === "streaming" ? (
          <box width={fullWidth()} flexDirection="column" alignItems="flex-start">
            <text fg={palette().muted} wrapMode="none">
              locked in
            </text>
            <box marginBottom={compact() ? 0 : 1}>
              <Bubble width={assistantBubbleWidth()} fill={palette().panel} background={palette().background} cell={cell()} ready={laidOut()}>
                {waitingForModel(props.state) ? (
                  <text fg={thinkingInk()} wrapMode="none" textAlign="center">
                    {THINKING_LINE}
                  </text>
                ) : (
                  <MarkdownBody
                    theme={ink()}
                    text={streamingText(props.state)}
                    width={Math.max(8, assistantBubbleWidth() - 2)}
                    height={0}
                    grow={false}
                    align="center"
                  />
                )}
              </Bubble>
            </box>
          </box>
        ) : null}

        {stopMarker(props.state) ? (
          <text fg={palette().warning} wrapMode="none">
            {`◼ ${stopMarker(props.state)}`}
          </text>
        ) : null}

        {props.state.error ? (
          <box flexDirection="column" marginBottom={1}>
            <text fg={palette().error} wrapMode="none">
              {`× ${props.state.error.failed}`}
            </text>
            <text fg={palette().muted} wrapMode="word">
              {`  ${props.state.error.kept} ${props.state.error.next}`}
            </text>
          </box>
        ) : null}

      </scrollbox>
      )}

      {newMessagesMarker(props.state) ? (
        <text fg={palette().accent} wrapMode="none" paddingX={1}>
          {newMessagesMarker(props.state)!}
        </text>
      ) : null}

      {props.state.attachments.length > 0 ? (
        <text fg={palette().secondary} wrapMode="none">
          {props.state.attachments.map(chipLabel).join(" ")}
        </text>
      ) : null}

      {/* The stop hint sits directly above the composer: Esc acts on the input,
          not on the message that happens to be above it. There is one line, not
          a second "send is stop" notice beside it. */}
      {props.state.status === "streaming" ? (
        <box height={1} paddingX={2} flexShrink={0}>
          <text fg={palette().warning} wrapMode="none">
            {STOP_LINE}
          </text>
        </box>
      ) : blockedSend() ? (
        <box height={1} paddingX={1} flexShrink={0}>
          <text fg={palette().warning} wrapMode="none">
            {`send disabled: ${(send() as { reason: string; fix: string }).reason} — ${(send() as { reason: string; fix: string }).fix}`}
          </text>
        </box>
      ) : null}

      {/* The composer is a frame, not a bare line: it is the one place that
          takes text, and the previous LockedIn made that obvious. */}
      <box
        flexShrink={0}
        marginX={1}
        marginBottom={0}
        border={["left", "right", "top", "bottom"]}
        borderStyle="rounded"
        borderColor={props.mode === "insert" ? palette().primary : palette().line}
        height={Math.max(3, composerRows(props.state, composerWidth()) + pasteRows(props.state) + 2)}
        paddingX={1}
        flexDirection="column"
      >
        <text
          fg={props.state.composer.length > 0 ? palette().foreground : palette().muted}
          wrapMode="word"
        >
          {props.state.composer.length > 0
            ? `${composerText(props.state, composerWidth())}${props.mode === "insert" ? COMPOSER_CURSOR : ""}`
            : props.mode === "normal"
              ? "Ask anything…  (i to type)"
              : `${COMPOSER_CURSOR}${PLACEHOLDER}`}
        </text>
        {props.state.pastes.length > 0 ? (
          <text fg={palette().secondary} wrapMode="none">
            {props.state.pastes.map(pasteLabel).join("  ")}
          </text>
        ) : null}
      </box>

      <box paddingX={1} flexShrink={0}>
        <text fg={palette().muted} wrapMode="none">
          {strip()}
        </text>
      </box>

    </box>
  )
}
