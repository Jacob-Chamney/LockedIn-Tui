/**
 * One list row, in every list.
 *
 * Selection is three signals — the bar, the panel fill and the foreground
 * colour — plus a primary check mark when the row is the active value. Feature
 * screens pass label/value/detail; they never re-implement the chrome.
 */
import type { ThemePalette } from "../theme"

export type ListRowTone = "normal" | "muted" | "error"

export function ListRow(props: {
  theme: ThemePalette
  selected: boolean
  /** The chosen/current value, independent of the cursor. */
  active?: boolean
  label: string
  /** Rendered after a fixed-width label; omitted for full-width rows. */
  value?: string
  /** A second, muted line under the label. */
  detail?: string
  /** When set, the label is padded/truncated to this width. */
  labelWidth?: number
  tone?: ListRowTone
}) {
  const palette = () => props.theme
  const label = () => {
    if (props.labelWidth === undefined) return props.label
    if (props.label.length > props.labelWidth - 1) {
      return `${props.label.slice(0, Math.max(0, props.labelWidth - 2))}…`
    }
    return props.label.padEnd(props.labelWidth)
  }
  const valueFg = () => {
    if (props.active) return palette().primary
    if (props.selected) return palette().foreground
    if (props.tone === "error") return palette().error
    if (props.tone === "muted") return palette().muted
    return palette().secondary
  }
  const marker = () => (props.active ? "  ✓" : "")

  return (
    <box flexDirection="column" backgroundColor={props.selected ? palette().panel : undefined}>
      <box flexDirection="row" flexShrink={0}>
        <text fg={palette().primary} wrapMode="none" width={2}>
          {props.selected ? "▌ " : "  "}
        </text>
        <text
          fg={
            props.active
              ? palette().primary
              : props.selected
                ? palette().foreground
                : props.tone === "error"
                  ? palette().error
                  : props.tone === "muted"
                    ? palette().muted
                    : palette().foreground
          }
          wrapMode="none"
          {...(props.labelWidth === undefined ? {} : { width: props.labelWidth })}
        >
          {label()}
        </text>
        {props.value === undefined ? (
          <text fg={valueFg()} wrapMode="none">
            {marker()}
          </text>
        ) : (
          <text fg={valueFg()} wrapMode="none">
            {`${props.value}${marker()}`}
          </text>
        )}
      </box>
      {props.detail ? (
        <text fg={palette().muted} wrapMode="none" flexShrink={0}>
          {`  ${props.detail}`}
        </text>
      ) : null}
    </box>
  )
}

/** A group heading in a list; primary is the section you are in. */
export function SectionLabel(props: { theme: ThemePalette; title: string; muted?: boolean }) {
  return (
    <text fg={props.theme.muted} wrapMode="none">
      {props.title.toUpperCase()}
    </text>
  )
}
