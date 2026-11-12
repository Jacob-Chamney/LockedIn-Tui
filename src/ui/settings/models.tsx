/**
 * Models and providers settings.
 *
 * The screen never touches a key's value beyond masking it while typed: the
 * validation call and the keychain write belong to `src/llm/validate.ts`. This
 * module renders provider state, collects a masked key, and produces config
 * patches that contain no secret.
 */
import { parseBinding, type Binding } from "../keymap/registry";
import type { ProviderSpec } from "../../llm/provider-spec";
import { checkKeyFormat, listProviders } from "../../llm/catalogue";
import type { LlmError } from "../../llm/validate";
import { isLoopbackUrl } from "../../llm/pricing";
import type { ThemePalette } from "../theme";
import { ListRow } from "../panels/list-row";
import { TwoColumnSurface } from "../panels/two-column";
export type ValidationState =
  | { kind: "never" }
  | { kind: "checking"; startedAt: string }
  | { kind: "ok"; models: string[]; at: string }
  | { kind: "failed"; error: LlmError; at: string }

export type ProviderRow = {
  spec: ProviderSpec
  linked: boolean
  validation: ValidationState
}

export type ModelsState = {
  rows: ProviderRow[]
  /** The provider whose key field is open, if any. */
  editing: string | null
  /** Never rendered: the field shows one mask character per keystroke. */
  keyDraft: string
  chatModel: string
  generationModel: string
  baseUrl: string
  pendingUnlink?: { provider: string; label: string }
  notice?: string | null
}

export function initialModels(rows: ProviderRow[]): ModelsState {
  return {
    rows,
    editing: null,
    keyDraft: "",
    chatModel: "",
    generationModel: "",
    baseUrl: "",
    pendingUnlink: undefined,
    notice: null,
  }
}

/** The field renders masks only; the value is never echoed. */
export function masked(value: string): string {
  return value.length === 0 ? "" : "•".repeat(value.length)
}

export function linkingCopy(): string {
  return "no provider linked yet · press Enter on a provider to link a key"
}

export function validationLine(row: ProviderRow): string {
  switch (row.validation.kind) {
    case "never":
      // Never validated is never "ok".
      return "not validated"
    case "checking":
      return "checking… · Esc cancel"
    case "ok":
      return `ok · ${row.validation.models.length} models · ${row.validation.at}`
    case "failed":
      return `× ${errorCopy(row.validation.error)} · ${row.validation.at}`
  }
}

export function providerLine(row: ProviderRow): string {
  const state = row.linked ? "linked" : "not linked"
  return `${row.spec.label}  ${state}  ${validationLine(row)}`
}

/** One mapping from the validation error to the documented copy. */
export function errorCopy(error: LlmError): string {
  switch (error.kind) {
    case "auth":
      return "the provider rejected this key; check it and try again"
    case "provider":
      return error.message || `the provider returned ${error.status}; nothing was saved`
    case "rate-limit":
      return "rate limited; wait a moment and validate again"
    case "network":
      return "the network is unreachable; nothing was saved"
    case "config":
      return error.message
    case "keychain":
      return `${error.hint}`
  }
}

export type KeySubmit =
  | { kind: "validate"; provider: string; key: string }
  | { kind: "refused"; reason: string }

/** Local format check first; no request is made for a malformed key. */
export function submitKey(state: ModelsState, row: ProviderRow): KeySubmit {
  const format = checkKeyFormat(row.spec, state.keyDraft)
  if (!format.ok) return { kind: "refused", reason: format.message }
  return { kind: "validate", provider: row.spec.id, key: state.keyDraft }
}

/** Linking a key never selects a model (product §10.1). */
export function afterLink(state: ModelsState, provider: string, models: string[], at: string): ModelsState {
  return {
    ...state,
    editing: null,
    keyDraft: "",
    notice: `${provider} linked · ${models.length} models returned · choose a model below`,
    rows: state.rows.map((row) =>
      row.spec.id === provider
        ? { ...row, linked: true, validation: { kind: "ok", models, at } }
        : row,
    ),
  }
}

export function afterFailure(state: ModelsState, provider: string, error: LlmError, at: string): ModelsState {
  return {
    ...state,
    editing: null,
    keyDraft: "",
    notice: null,
    rows: state.rows.map((row) =>
      row.spec.id === provider ? { ...row, validation: { kind: "failed", error, at } } : row,
    ),
  }
}

/** A model absent from the validated list is refused by name. */
export function chooseModel(
  state: ModelsState,
  target: "chat" | "generation",
  model: string,
): ModelsState | { kind: "refused"; reason: string } {
  const provider = model.split("/")[0]
  const row = state.rows.find((candidate) => candidate.spec.id === provider)
  if (!row) return { kind: "refused", reason: `${provider} is not a linked provider` }
  if (row.validation.kind !== "ok") {
    return { kind: "refused", reason: `${row.spec.label} is not validated yet` }
  }
  const short = model.slice(provider.length + 1)
  if (!row.validation.models.includes(model) && !row.validation.models.includes(short)) {
    return { kind: "refused", reason: `${model} is not in the validated list for ${row.spec.label}` }
  }
  return target === "chat" ? { ...state, chatModel: model } : { ...state, generationModel: model }
}

export function modelLabel(state: ModelsState, target: "chat" | "generation"): string {
  const value = target === "chat" ? state.chatModel : state.generationModel
  return value === "" ? "choose a model" : value
}

/**
 * A loopback endpoint is local and free; no key is required.
 *
 * One definition with the pricing table (`isLoopbackUrl`), so the “local, free”
 * label and `$0.0000` can never disagree about `127.0.0.2` or `0.0.0.0`.
 */
export function isLocalFree(baseUrl: string): boolean {
  return isLoopbackUrl(baseUrl)
}

export function baseUrlLine(baseUrl: string): string {
  if (baseUrl === "") return "base url  (not set)"
  return isLocalFree(baseUrl) ? `base url  ${baseUrl}  local, free` : `base url  ${baseUrl}`
}

export function validBaseUrl(value: string): { ok: true } | { ok: false; reason: string } {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: "a base url must be http or https" }
    }
    if (url.protocol === "http:" && !isLoopbackUrl(value)) {
      return { ok: false, reason: "remote base urls must use https; http is only for a loopback endpoint" }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: `“${value}” is not a url` }
  }
}

// ---------------------------------------------------------------- unlink

export function armUnlink(state: ModelsState, provider: string): ModelsState {
  const row = state.rows.find((candidate) => candidate.spec.id === provider)
  if (!row) return { ...state, notice: "no such provider" }
  return { ...state, pendingUnlink: { provider, label: row.spec.label }, notice: null }
}

export function unlinkCopy(label: string): string {
  return `unlink ${label}? the key is deleted and any model chosen from it is cleared · press u again`
}

export type UnlinkOutcome =
  | { kind: "call"; provider: string; clears: ("chat" | "generation")[] }
  | { kind: "refused"; reason: string }

export function confirmUnlink(state: ModelsState): UnlinkOutcome {
  if (!state.pendingUnlink) return { kind: "refused", reason: "press u on a linked provider to unlink it" }
  const provider = state.pendingUnlink.provider
  const clears: ("chat" | "generation")[] = []
  if (state.chatModel.startsWith(`${provider}/`)) clears.push("chat")
  if (state.generationModel.startsWith(`${provider}/`)) clears.push("generation")
  return { kind: "call", provider, clears }
}

/** Applied after the keychain delete succeeds: no selection survives it. */
export function afterUnlink(state: ModelsState, provider: string): ModelsState {
  const clears = (value: string) => (value.startsWith(`${provider}/`) ? "" : value)
  return {
    ...state,
    pendingUnlink: undefined,
    chatModel: clears(state.chatModel),
    generationModel: clears(state.generationModel),
    rows: state.rows.map((row) =>
      row.spec.id === provider ? { ...row, linked: false, validation: { kind: "never" } } : row,
    ),
  }
}

// ---------------------------------------------------------------- keys

export type ModelsIntent = "down" | "up" | "edit" | "commit" | "unlink" | "cancel"

const SPECS: Array<{ intent: ModelsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "edit", key: "return", footer: "Enter link" },
  { intent: "commit", key: "ctrl+return", footer: "Ctrl+Enter validate" },
  { intent: "unlink", key: "u", footer: "u unlink" },
  { intent: "cancel", key: "escape", footer: "Esc cancel" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`models key "${key}": ${binding.message}`)
  return binding
}

export const MODELS_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { ctrl?: boolean } = {}): ModelsIntent | undefined {
  const key = options.ctrl ? `ctrl+${name.toLowerCase()}` : name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return MODELS_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return MODELS_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

// ---------------------------------------------------------------- render

export function ModelsPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: ModelsState
  cursor: number
}) {
  const palette = () => props.theme
  const linked = () => props.state.rows.filter((row) => row.linked).length
  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} MODELS · ${linked()} of ${props.state.rows.length} linked`}
      </text>

      {linked() === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {linkingCopy()}
        </text>
      ) : null}

      {props.state.rows.map((row, index) => (
        <text
          fg={
            row.validation.kind === "failed"
              ? palette().error
              : index === props.cursor
                ? palette().primary
                : palette().foreground
          }
          wrapMode="none"
        >
          {`${index === props.cursor ? "▸" : " "} ${providerLine(row)}`}
        </text>
      ))}

      {props.state.editing ? (
        <text fg={palette().secondary} wrapMode="none">
          {`key ${masked(props.state.keyDraft)}`}
        </text>
      ) : null}

      <text fg={palette().foreground} wrapMode="none">
        {`chat model        ${modelLabel(props.state, "chat")}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {`generation model  ${modelLabel(props.state, "generation")}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {baseUrlLine(props.state.baseUrl)}
      </text>

      {props.state.pendingUnlink ? (
        <text fg={palette().error} wrapMode="none">
          {`! ${unlinkCopy(props.state.pendingUnlink.label)}`}
        </text>
      ) : null}
      {props.state.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.state.notice}`}
        </text>
      ) : null}
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}

// ---------------------------------------------------------------- screen state

/**
 * The Models screen the shell opens from Settings. A key is validated first,
 * then the provider's own model list becomes the picker: linking a key must not
 * make the user type a model name from memory.
 */
export type ModelsScreen = {
  data: ModelsState
  cursor: number
  view: "providers" | "models"
  /** Which configured model the next choice writes. */
  target: "chat" | "generation"
  /** The provider whose models are shown in `view: "models"`. */
  provider: string | null
  models: string[]
  modelCursor: number
  baseUrlDraft: string
  baseUrlEditing: boolean
  loading: boolean
  notice: string | null
}

export function initialModelsScreen(options: {
  baseUrl?: string
  chatModel?: string
  /** Open on this provider instead of the first row. */
  providerId?: string
  /** Which section to show first. */
  view?: "providers" | "models"
  /** Which model the picker writes; defaults to chat. */
  target?: "chat" | "generation"
} = {}): ModelsScreen {
  const rows = listProviders().map((spec) => ({
    spec,
    linked: false,
    validation: { kind: "never" } as ValidationState,
  }))
  const wanted = options.providerId === undefined ? -1 : rows.findIndex((row) => row.spec.id === options.providerId)
  return {
    data: {
      ...initialModels(rows),
      chatModel: options.chatModel ?? "",
      baseUrl: options.baseUrl ?? "",
    },
    cursor: wanted < 0 ? 0 : wanted,
    view: options.view ?? "providers",
    target: options.target ?? "chat",
    provider: null,
    models: [],
    modelCursor: 0,
    baseUrlDraft: options.baseUrl ?? "",
    baseUrlEditing: false,
    loading: false,
    notice: null,
  }
}

export function screenProvider(screen: ModelsScreen): ProviderRow | undefined {
  return screen.data.rows[screen.cursor]
}

export function beginProviderLink(screen: ModelsScreen): ModelsScreen {
  const row = screenProvider(screen)
  if (!row) return screen
  if (screen.loading) return screen
  return {
    ...screen,
    view: "providers",
    modelCursor: 0,
    data: { ...screen.data, editing: row.spec.id, keyDraft: "" },
    baseUrlEditing: false,
    loading: false,
    notice: null,
  }
}

export function beginBaseUrlEdit(screen: ModelsScreen): ModelsScreen {
  const row = screenProvider(screen)
  if (!row) return screen
  if (row.spec.id !== "custom") {
    return { ...screen, notice: "this provider has a fixed base URL" }
  }
  return {
    ...screen,
    baseUrlDraft: screen.data.baseUrl || screen.baseUrlDraft,
    baseUrlEditing: true,
    data: { ...screen.data, editing: null },
    notice: null,
  }
}

/** Type one character into whichever draft is open. */
export function typeModelsDraft(screen: ModelsScreen, character: string): ModelsScreen {
  if (screen.baseUrlEditing) return { ...screen, baseUrlDraft: screen.baseUrlDraft + character }
  if (!screen.data.editing) return screen
  return { ...screen, data: { ...screen.data, keyDraft: screen.data.keyDraft + character } }
}

export function backspaceModelsDraft(screen: ModelsScreen): ModelsScreen {
  if (screen.baseUrlEditing) {
    return { ...screen, baseUrlDraft: Array.from(screen.baseUrlDraft).slice(0, -1).join("") }
  }
  if (!screen.data.editing) return screen
  return {
    ...screen,
    data: { ...screen.data, keyDraft: Array.from(screen.data.keyDraft).slice(0, -1).join("") },
  }
}

export function cancelModelsDraft(screen: ModelsScreen): ModelsScreen {
  return { ...screen, baseUrlEditing: false, data: { ...screen.data, editing: null, keyDraft: "" }, notice: null }
}

export function commitBaseUrl(screen: ModelsScreen): ModelsScreen {
  const value = screen.baseUrlDraft.trim()
  const check = validBaseUrl(value)
  if (!check.ok) return { ...screen, notice: check.reason }
  return {
    ...screen,
    baseUrlDraft: value,
    baseUrlEditing: false,
    data: { ...screen.data, baseUrl: value },
    notice: null,
  }
}

export type LinkRequest =
  | { kind: "validate"; providerId: string; key: string; baseUrl?: string }
  | { kind: "refused"; reason: string }

/** The one request the screen may send; the format check happens locally. */
export function linkRequest(screen: ModelsScreen): LinkRequest {
  const row = screen.data.rows.find((candidate) => candidate.spec.id === screen.data.editing)
  if (!row) return { kind: "refused", reason: "press Enter on a provider to link its key" }
  if (screen.loading) return { kind: "refused", reason: "a validation is already running" }
  const submitted = submitKey(screen.data, row)
  if (submitted.kind === "refused") return submitted
  const baseUrl = (screen.data.baseUrl || screen.baseUrlDraft).trim()
  if (row.spec.id === "custom" && baseUrl === "") {
    return { kind: "refused", reason: "set the base URL first (b)" }
  }
  return {
    kind: "validate",
    providerId: row.spec.id,
    key: submitted.key,
    ...(row.spec.id === "custom" ? { baseUrl } : {}),
  }
}

export function afterProviderLink(screen: ModelsScreen, models: string[], at: string): ModelsScreen {
  const provider = screen.data.editing ?? screen.provider
  if (provider === null) return screen
  return {
    ...screen,
    data: afterLink(screen.data, provider, models, at),
    view: "models",
    provider,
    models,
    modelCursor: 0,
    loading: false,
    notice: null,
  }
}

export function afterProviderLinkFailure(screen: ModelsScreen, error: LlmError, at: string): ModelsScreen {
  const provider = screen.data.editing ?? screen.provider
  if (provider === null) return { ...screen, loading: false }
  return {
    ...screen,
    data: afterFailure(screen.data, provider, error, at),
    view: "providers",
    models: [],
    loading: false,
    notice: errorCopy(error),
  }
}

/** The provider of the configured chat model, or null. */
export function activeProviderOf(screen: ModelsScreen): string | null {
  const model = screen.data.chatModel
  const at = model.indexOf("/")
  return at > 0 ? model.slice(0, at) : null
}

/** Put the cursor on the configured model after a list is fetched. */
export function focusSelectedModel(screen: ModelsScreen): ModelsScreen {
  const at = screenModelIds(screen).indexOf(screen.data.chatModel)
  return at < 0 ? screen : { ...screen, modelCursor: at }
}

/** Full `provider/model` ids in the order the provider returned them. */
export function screenModelIds(screen: ModelsScreen): string[] {
  if (screen.provider === null) return []
  return screen.models.map((model) => `${screen.provider}/${model}`)
}

export type ScreenChoice =
  | { kind: "chosen"; model: string; screen: ModelsScreen }
  | { kind: "refused"; reason: string }

export function chooseScreenModel(screen: ModelsScreen, index: number): ScreenChoice {
  const model = screenModelIds(screen)[index]
  if (!model) return { kind: "refused", reason: "no model selected" }
  const next = chooseModel(screen.data, screen.target, model)
  if ("kind" in next) return next
  return { kind: "chosen", model, screen: { ...screen, data: next } }
}

// ---------------------------------------------------------------- screen render

/**
 * The Models screen uses the Settings page's shape: a two-column window with a
 * bar on the selected row, group headers in the primary colour, values in the
 * secondary colour and the selected row on the panel fill. Providers and models
 * are two sections of the same list, switched with Tab.
 */
export function ModelsScreenPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  screen: ModelsScreen
}) {
  const palette = () => props.theme
  const screen = () => props.screen
  const models = () => screenModelIds(screen())
  const modelView = () => screen().view === "models"
  const provider = () => screenProvider(screen())
  const linked = () => screen().data.rows.filter((row) => row.linked).length
  const modelCapacity = () => Math.max(4, props.height - 6)
  const modelStart = () => {
    const count = models().length
    const size = modelCapacity()
    if (count <= size) return 0
    return Math.max(0, Math.min(count - size, screen().modelCursor - Math.floor(size / 2)))
  }
  const selectedModel = () => models()[screen().modelCursor]
  const selectedForTarget = () =>
    screen().target === "chat" ? screen().data.chatModel : screen().data.generationModel

  const providerValue = (row: ProviderRow): string => {
    if (!row.linked) return row.validation.kind === "failed" ? "key rejected" : "not linked"
    if (row.validation.kind === "ok") {
      const count = row.validation.models.length
      return `${count} model${count === 1 ? "" : "s"}`
    }
    return row.validation.kind === "checking" ? "checking…" : "linked"
  }

  const hints = () =>
    modelView()
      ? "j/k move · g chat/generation · Enter choose · Esc back"
      : screenProvider(screen())?.spec.id === "custom"
        ? "Enter link · r re-link · b url · Esc"
        : "Enter link · r re-link · Esc back"

  const surfaceDetail = () =>
    modelView()
      ? {
          title: selectedModel() ?? "Model",
          meta: `${screen().target} completions`,
          body: `Enter chooses this model for ${screen().target === "chat" ? "chat" : "background generation"}. Only models this build can call through chat completions are listed.`,
          footer: `Provider: ${screen().provider ?? ""} · ${models().length} models returned`,
          extra: screen().data.chatModel === "" ? [] : [`current: ${screen().data.chatModel}`],
        }
      : provider() === undefined
        ? undefined
        : {
            title: provider()!.spec.label,
            meta: provider()!.spec.keyRequired ? "key required" : "key optional",
            body:
              provider()!.spec.note ??
              "Link or replace this provider's key; the endpoint and model list are built in.",
            footer: `Key: ${provider()!.linked ? "linked" : "not linked"} · ${validationLine(provider()!)}`,
            extra: [
              provider()!.spec.id === "custom"
                ? baseUrlLine(screen().data.baseUrl)
                : provider()!.spec.baseUrl,
              ...(activeProviderOf(screen()) === provider()!.spec.id ? ["active provider"] : []),
            ],
          }

  return (
    <TwoColumnSurface
      theme={palette()}
      width={props.width}
      height={props.height}
      focused={props.focused}
      title={modelView() ? "Models" : "Providers"}
      meta={
        modelView()
          ? screen().provider === null
            ? "no provider selected"
            : `${screen().provider} · ${models().length} models · ${
                models().length === 0 ? "0/0" : `${screen().modelCursor + 1}/${models().length}`
              }`
          : `${linked()} of ${screen().data.rows.length} linked${
              activeProviderOf(screen()) === null
                ? ""
                : ` · active ${screen().data.rows.find((row) => row.spec.id === activeProviderOf(screen()))?.spec.label ?? ""}`
            }`
      }
      notice={screen().notice}
      hints={[hints()]}
      detail={surfaceDetail()}
    >
      {modelView() ? (
        <>
          {models().length === 0 ? (
            <text fg={palette().muted} wrapMode="none">
              {"  no models loaded · link a provider in Providers"}
            </text>
          ) : null}
          {models()
            .slice(modelStart(), modelStart() + modelCapacity())
            .map((id, offset) => {
              const index = modelStart() + offset
              return (
                <ListRow
                  theme={palette()}
                  selected={index === screen().modelCursor}
                  active={id === selectedForTarget()}
                  label={id}
                />
              )
            })}
        </>
      ) : (
        <>
          {screen().data.rows.map((row, index) => (
            <ListRow
              theme={palette()}
              selected={index === screen().cursor}
              active={activeProviderOf(screen()) === row.spec.id}
              label={row.spec.label}
              value={providerValue(row)}
              labelWidth={22}
              tone={row.validation.kind === "failed" ? "error" : "normal"}
            />
          ))}
          {screen().loading ? (
            <text fg={palette().secondary} wrapMode="none">
              {"  validating the key and fetching models…"}
            </text>
          ) : null}
        </>
      )}
    </TwoColumnSurface>
  )
}
