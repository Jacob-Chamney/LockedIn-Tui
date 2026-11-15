/**
 * One list row, in every list.
 *
 * Selection is three signals — the bar, the panel fill and the foreground
 * colour — plus a primary check mark when the row is the active value. Feature
 * screens pass label/value/detail; they never re-implement the chrome.
 */
import type { ThemePalette } from "../theme"
import type { BadgeTone } from "../badges"
import { Badge } from "../shell/badges"
import { checklistBox } from "../checklist"
import { Toggle } from "../shell/toggle"
import { Slider } from "../shell/slider"
import { StatusDot } from "../shell/status-dot"
import { Segmented } from "../shell/segmented"
import { ProgressChip } from "../shell/progress-chip"
import { TagInput } from "../shell/tag-input"
import type { StatusState } from "../status-dot"

export type ListRowTone = "normal" | "muted" | "error"

export function ListRow(props: {
  theme: ThemePalette
  selected: boolean
  /** The chosen/current value, independent of the cursor. */
  active?: boolean
  label: string
  /** Rendered after a fixed-width label; omitted for full-width rows. */
  value?: string
  /** A tone-coded chip instead of a plain value; takes precedence over `value`. */
  badge?: { label: string; tone?: BadgeTone }
  /** A checkbox before the label, for checklist rows. */
  check?: { checked: boolean; disabled?: boolean }
  /** Background for the unselected row; selected rows always use the panel. */
  background?: string
  /** A switch in the value column, for boolean rows. */
  toggle?: { on: boolean; onLabel?: string; offLabel?: string }
  /** A slider in the value column, for ranged rows. */
  slider?: { value: number; min?: number; max?: number; label?: string; width?: number }
  /** A health dot before the label. */
  status?: { state: StatusState; label?: string }
  /** A segmented control in the value column, for small exclusive choices. */
  segments?: { options: readonly string[]; selected: number; width?: number }
  /** A compact done/total chip after the label. */
  progress?: { done: number; total: number; width?: number }
  /** Read-only tags in the value column. */
  tags?: { labels: readonly string[]; invalid?: readonly boolean[]; width?: number }
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
    <box
      flexDirection="column"
      backgroundColor={props.selected ? palette().panel : (props.background ?? undefined)}
    >
      <box flexDirection="row" flexShrink={0}>
        <text fg={palette().primary} wrapMode="none" width={2}>
          {props.selected ? "▌ " : "  "}
        </text>
        {props.status ? (
          <>
            <StatusDot theme={palette()} state={props.status.state} label={props.status.label} />
            <text fg={palette().muted} wrapMode="none">
              {" "}
            </text>
          </>
        ) : null}
        {props.check ? (
          <text
            fg={
              props.check.disabled
                ? palette().muted
                : props.check.checked
                  ? palette().success
                  : palette().muted
            }
            wrapMode="none"
            width={4}
          >
            {checklistBox(props.check.checked, props.check.disabled)}
          </text>
        ) : null}
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
        {props.tags ? (
          <>
            <text fg={palette().muted} wrapMode="none">
              {" "}
            </text>
            <TagInput
              theme={palette()}
              tags={props.tags.labels.map((label, index) => ({
                id: `${index}:${label}`,
                label,
                removable: false,
                invalid: props.tags!.invalid?.[index] === true,
              }))}
              width={props.tags.width ?? 24}
            />
          </>
        ) : null}
        {props.progress ? (
          <>
            <text fg={palette().muted} wrapMode="none">
              {" "}
            </text>
            <ProgressChip
              theme={palette()}
              done={props.progress.done}
              total={props.progress.total}
              width={props.progress.width}
            />
          </>
        ) : null}
        {props.tags ? null : props.segments ? (
          <Segmented
            theme={palette()}
            options={props.segments.options}
            selected={props.segments.selected}
            width={props.segments.width ?? 14}
          />
        ) : props.slider ? (
          <Slider
            theme={palette()}
            value={props.slider.value}
            width={props.slider.width ?? 18}
            min={props.slider.min}
            max={props.slider.max}
            label={props.slider.label}
          />
        ) : props.toggle ? (
          <Toggle
            theme={palette()}
            on={props.toggle.on}
            onLabel={props.toggle.onLabel}
            offLabel={props.toggle.offLabel}
          />
        ) : props.badge ? (
          <>
            <Badge
              theme={palette()}
              label={props.badge.label}
              tone={props.badge.tone}
              width={40}
            />
            {props.active ? (
              <text fg={palette().primary} wrapMode="none">
                {marker()}
              </text>
            ) : null}
          </>
        ) : props.value === undefined ? (
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
