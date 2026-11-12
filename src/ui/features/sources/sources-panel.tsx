/**
 * File finder pane.
 *
 * The left half is the list (directory browse, ranked finder results, or the
 * review list). Under it sits a capped preview of the highlighted file. The
 * right half is the source manifest, or a full-width manifest on a narrow
 * terminal. The window frame is the shared `FloatingWindow`, so this surface
 * has the same fill, header and footer as every other window.
 *
 * The same component serves lock-in sources, a skill's gathered sources and a
 * single assignment-instructions file: the title, manifest label and limit
 * come from the caller.
 */
import type { PickerState } from "../../../services/lockin/picker";
import type { ThemePalette } from "../../theme";
import { ListRow } from "../../panels/list-row";
import { FloatingWindow, WindowBody, WindowFooter, WindowHeader } from "../../panels/floating-window";
import { windowStart } from "../../panels/select-list";
import {
  activeEntries,
  blockedReason,
  countLine,
  displayPath,
  emptyState,
  formatBytes,
  inputLine,
  reviewEntries,
  rowFor,
  scopeLabel,
  shortPath,
} from "./sources-model";
import type { PickerView } from "./sources-model";
import { footerHints } from "./sources-keys";

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function previewMeta(view: PickerView): string {
  if (!view.preview) return ""
  const parts = [view.preview.kind, formatBytes(view.preview.bytes)]
  if (view.preview.note) parts.push(view.preview.note)
  const day = new Date(view.preview.modifiedMs).toISOString().slice(0, 10)
  parts.push(day)
  return parts.join(" · ")
}

export function SourcesPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  /** Pane dimming follows the shell focus, never colour alone. */
  focused: boolean
  state: PickerState
  view: PickerView
  /** Parent directory name, for the empty state's "go back" sentence. */
  parent?: string
  /** Files already attached to the target. */
  existing?: readonly string[]
  /** Window title; the instructions picker reuses this surface. */
  title?: string
  /** Right-hand manifest heading. */
  manifestLabel?: string
  /** Creation also offers file instructions, so an empty review can continue. */
  allowInstructions?: boolean
}) {
  const palette = () => props.theme
  const narrow = () => props.width < 76
  const showingSources = () => props.view.focus === "sources" && narrow()
  const listFocused = () => props.view.focus === "list"
  const blocked = () => blockedReason(props.state, props.view, { allowInstructions: props.allowInstructions })
  const entries = () => (props.view.step === "review" ? reviewEntries(props.state) : activeEntries(props.state, props.view))
  const showPreview = () => props.height >= 24 && !showingSources()
  const previewRows = () => Math.max(3, Math.min(8, Math.floor(props.height * 0.22)))
  const listSize = () =>
    Math.max(3, props.height - 10 - (showPreview() ? previewRows() : 0))
  const start = () => windowStart(props.view.cursor, entries().length, listSize())
  const visible = () => entries().slice(start(), start() + listSize())
  const leftWidth = () => (narrow() ? Math.max(20, props.width - 4) : Math.max(34, Math.floor((props.width - 4) * 0.58)))
  const rightWidth = () => Math.max(20, props.width - leftWidth() - 3)
  const existing = () => props.existing ?? []
  const total = () => existing().length + props.state.marks.length
  const current = () => activeEntries(props.state, props.view)[props.view.cursor]
  /** The file the preview follows: the list row, or the selected source. */
  const previewTarget = () => {
    if (props.view.focus === "sources") {
      const path = props.state.marks[props.view.sourcesCursor]
      if (!path) return undefined
      return {
        path,
        name: displayPath(props.state, path),
        kind: "file" as const,
        bytes: props.view.preview?.bytes ?? 0,
        selectable: true,
        reason: null,
        marked: true,
      }
    }
    return current()
  }
  const hints = () => {
    if (props.view.editing) return ["↑↓ choose", "Enter apply", "Ctrl+F scope", "Esc"]
    if (props.view.step === "review") return ["j/k", "d remove", "Enter", "Esc"]
    if (props.view.focus === "sources") return ["j/k", "d remove", "Enter", "Esc"]
    if (props.width >= 82) return footerHints(props.view)
    if (props.width >= 60) {
      return ["j/k move", "Space mark", "Enter open", "A folder", "r review", "/ search"]
    }
    return ["j/k", "Space mark", "Enter", "A folder", "Tab", "/"]
  }

  const status = () => {
    if (props.view.error) return { text: `× ${props.view.error}`, tone: palette().error }
    if (props.view.searching) return { text: "searching…", tone: palette().muted }
    if (props.view.capped) return { text: "! results capped · narrow the query", tone: palette().warning }
    if (props.view.query.trim() !== "" && props.view.visited > 0) {
      return {
        text: `${entries().length} match${entries().length === 1 ? "" : "es"} · searched ${props.view.visited} entries`,
        tone: palette().muted,
      }
    }
    return { text: countLine(props.state), tone: palette().muted }
  }

  const manifest = (width: number) => (
    <box width={width} minHeight={0} flexDirection="column" paddingX={1}>
      <text fg={props.view.focus === "sources" ? palette().primary : palette().muted} wrapMode="none">
        {`${props.view.focus === "sources" ? "▸" : " "} ${props.manifestLabel ?? "SOURCES"} · ${total()}`}
      </text>
      {total() === 0 ? (
        <text fg={palette().muted} wrapMode="word">no sources yet · press Space to add one</text>
      ) : (
        <>
          {existing().length > 0 ? <text fg={palette().muted} wrapMode="none">ALREADY ADDED</text> : null}
          {existing().map((name) => (
            <text fg={palette().success} wrapMode="none">
              {fit(`◉ ${name}`, width - 2)}
            </text>
          ))}
          {props.state.marks.length > 0 ? (
            <text fg={palette().muted} wrapMode="none">MARKED NOW</text>
          ) : null}
          {props.state.marks.map((path, index) => {
            const label = shortPath(displayPath(props.state, path), Math.max(8, width - 6))
            if (props.view.focus === "sources") {
              return (
                <ListRow
                  theme={palette()}
                  selected={index === props.view.sourcesCursor}
                  label={`◉ ${label}`}
                  labelWidth={Math.max(8, width - 8)}
                />
              )
            }
            return (
              <text fg={palette().accent} wrapMode="none">
                {`◉ ${label}`}
              </text>
            )
          })}
        </>
      )}
    </box>
  )

  const preview = () => {
    const entry = previewTarget()
    if (!entry) {
      return <text fg={palette().muted} wrapMode="none">no file selected</text>
    }
    if (entry.kind === "directory") {
      return <text fg={palette().muted} wrapMode="none">directory · Enter opens it</text>
    }
    if (props.view.previewing) {
      return <text fg={palette().muted} wrapMode="none">Loading preview…</text>
    }
    if (props.view.previewError) {
      return <text fg={palette().error} wrapMode="word">{`× ${props.view.previewError}`}</text>
    }
    const preview = props.view.preview
    if (!preview) {
      return <text fg={palette().muted} wrapMode="none">no preview</text>
    }
    return (
      <box flexDirection="column" minHeight={0}>
        <text fg={palette().muted} wrapMode="none">
          {fit(previewMeta(props.view), leftWidth() - 2)}
        </text>
        {preview.error ? (
          <text fg={palette().warning} wrapMode="word">{`! ${preview.error}`}</text>
        ) : null}
        {preview.lines.slice(0, Math.max(1, previewRows() - 2)).map((line) => (
          <text fg={palette().secondary} wrapMode="none">
            {fit(line === "" ? " " : line, leftWidth() - 2)}
          </text>
        ))}
        {preview.truncated ? <text fg={palette().muted} wrapMode="none">…</text> : null}
      </box>
    )
  }

  return (
    <FloatingWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      header={
        <WindowHeader
          theme={palette()}
          title={props.title ?? "Add sources"}
          meta={`${total()} of ${props.state.limit}`}
          detailLines={[shortPath(props.state.cwd, props.width - 4)]}
        />
      }
      footer={<WindowFooter theme={palette()} hints={hints()} width={props.width} />}
    >
      <WindowBody>
        <text fg={props.view.editing ? palette().accent : palette().muted} wrapMode="none">
          {fit(
            `${inputLine(props.view)}    scope: ${scopeLabel(props.state, props.view)}`,
            Math.max(8, props.width - 4),
          )}
        </text>

        {showingSources() ? (
          <box flexGrow={1} minHeight={0} flexDirection="column" paddingTop={1}>
            {manifest(props.width - 4)}
          </box>
        ) : (
          <box flexGrow={1} minHeight={0} flexDirection="row" gap={1} paddingTop={1}>
            <box width={leftWidth()} minHeight={0} flexDirection="column" paddingX={1}>
              <text fg={listFocused() ? palette().primary : palette().muted} wrapMode="none">
                {`${listFocused() ? "▸" : " "} ${
                  props.view.step === "review"
                    ? `REVIEW · ${props.state.marks.length} source${props.state.marks.length === 1 ? "" : "s"}`
                    : props.view.query.trim() !== ""
                      ? `MATCHES · ${entries().length}`
                      : "FILES"
                }`}
              </text>

              {props.view.step === "review" && props.state.marks.length === 0 ? (
                <text fg={palette().warning} wrapMode="word">
                  {`! ${blocked() ?? "no sources selected"}`}
                </text>
              ) : entries().length === 0 ? (
                <text fg={palette().warning} wrapMode="word">
                  {props.view.searching
                    ? "searching…"
                    : props.view.query.trim() !== ""
                      ? "no matches · keep typing or press Esc"
                      : `! ${emptyState(props.state, props.parent)}`}
                </text>
              ) : (
                visible().map((entry, offset) => {
                  const index = start() + offset
                  const row = rowFor(entry, index === props.view.cursor)
                  const label = `${row.glyph} ${shortPath(entry.name, Math.max(8, leftWidth() - 20))}`
                  return (
                    <ListRow
                      theme={palette()}
                      selected={index === props.view.cursor}
                      label={label}
                      labelWidth={Math.max(10, leftWidth() - 14)}
                      value={row.detail}
                      tone={listFocused() && !row.dim ? "normal" : "muted"}
                    />
                  )
                })
              )}

              {showPreview() ? (
                <box flexDirection="column" minHeight={0} marginTop={1}>
                  <text fg={palette().muted} wrapMode="none">
                    {previewTarget()
                      ? fit(`PREVIEW · ${previewTarget()!.name}`, leftWidth() - 2)
                      : "PREVIEW"}
                  </text>
                  {preview()}
                </box>
              ) : null}
            </box>

            {narrow() ? null : (
              <>
                <box width={1} flexShrink={0} backgroundColor={palette().line} />
                {manifest(rightWidth())}
              </>
            )}
          </box>
        )}

        <text fg={blocked() ? palette().warning : status().tone} wrapMode="none">
          {blocked() ? `! ${blocked()}` : status().text}
        </text>
      </WindowBody>
    </FloatingWindow>
  )
}

