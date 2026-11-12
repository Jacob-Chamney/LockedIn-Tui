/**
 * Provider/model selection controller.
 *
 * Owns the Models screen state and the one-shot keychain/model requests. The
 * shell passes settings, pane changes and notifications in; this module never
 * renders and never imports a UI component. Swapping the Providers or Models
 * surface leaves this controller and its tests intact.
 */
import { createSignal } from "solid-js";
import type { Prompt } from "../ui/overlays/prompt";
import type { SettingsView } from "../ui/settings";
import type { LinkOutcome, LlmResult } from "../llm/validate";
import type { ShellPress } from "./keys/press";
import { typedCharacter } from "./keys/press";
import { afterProviderLink, afterProviderLinkFailure, backspaceModelsDraft, beginBaseUrlEdit, cancelModelsDraft, chooseScreenModel, commitBaseUrl, focusSelectedModel, initialModelsScreen, screenProvider, typeModelsDraft, type ModelsScreen } from "../ui/settings/models";
export type ModelsControllerDeps = {
  settings: () => SettingsView | undefined
  openPane: (pane: "providers" | "models") => void
  backToSettings: () => void
  setPrompt: (prompt: Prompt | null) => void
  notify: (text: string, level?: "info" | "warn" | "error") => void
  /** Save and apply one config patch; rejects when the write is refused. */
  saveConfig: (patch: Record<string, unknown>) => Promise<void>
  linkProvider?: (input: { providerId: string; key: string; baseUrl?: string }) => Promise<LlmResult<LinkOutcome>>
  modelsForProvider?: (providerId: string) => Promise<LlmResult<LinkOutcome>>
  linkedProviders?: () => Promise<string[]>
}

export type ModelsController = {
  screen: () => ModelsScreen
  openProviders: (providerId?: string) => void
  openPicker: () => void
  input: (
    pane: "providers" | "models",
    press: ShellPress,
    event: { preventDefault: () => void },
  ) => boolean
  /** Enter in the masked provider-key window. */
  submitPrompt: (providerId: string, key: string) => Promise<void>
}

export function createModelsController(deps: ModelsControllerDeps): ModelsController {
  const [screen, setScreen] = createSignal<ModelsScreen>(
    initialModelsScreen({ baseUrl: deps.settings()?.baseUrl, chatModel: deps.settings()?.chatModel }),
  )

  /** The small command-style window that collects a provider key. */
  function openPrompt(providerId: string, notice?: string): void {
    const current = screen()
    const row = current.data.rows.find((entry) => entry.spec.id === providerId)
    if (!row) return
    if (providerId === "custom" && current.data.baseUrl.trim() === "") {
      setScreen({ ...current, loading: false, notice: "set the base URL first (b)" })
      return
    }
    setScreen({ ...current, loading: false, notice: notice ?? null })
    deps.setPrompt({
      title: `Link ${row.spec.label}`,
      hint: `${notice ? `${notice} · ` : ""}${
        providerId === "custom"
          ? "Paste the key and press Enter. Esc cancels; the base URL is the one set in Models."
          : "Paste the key and press Enter. Esc cancels; the endpoint is built in."
      }`,
      value: "",
      kind: "provider-key",
      mask: true,
      provider: providerId,
    })
  }

  /** Validate and store the key from the window, then show its models. */
  async function submitKey(providerId: string, key: string): Promise<void> {
    const current = screen()
    const row = current.data.rows.find((entry) => entry.spec.id === providerId)
    if (!row) return
    if (!deps.linkProvider) {
      deps.notify("linking a provider is not available in this build", "warn")
      return
    }
    const menu = current.view
    const attempt = {
      ...current,
      view: menu,
      data: { ...current.data, editing: providerId, keyDraft: key },
      loading: true,
      notice: null,
    }
    setScreen(attempt)
    try {
      const result = await deps.linkProvider({
        providerId,
        key,
        ...(providerId === "custom" ? { baseUrl: current.data.baseUrl } : {}),
      })
      const at = new Date().toISOString()
      if (result.ok) {
        const linked = focusSelectedModel(afterProviderLink(attempt, result.value.models, at))
        setScreen({
          ...linked,
          view: menu,
          notice:
            menu === "providers"
              ? `linked · ${result.value.models.length} models · open Chat model to pick one`
              : linked.notice,
        })
        deps.notify(`${row.spec.label} linked · ${result.value.models.length} models returned`)
      } else {
        setScreen(afterProviderLinkFailure(attempt, result.error, at))
        if (result.error.kind === "auth") openPrompt(providerId, "the provider rejected that key")
        deps.notify(
          result.error.kind === "config" || result.error.kind === "provider"
            ? result.error.message
            : `the provider rejected this key${result.error.kind === "auth" ? " (401/403)" : ""}`,
          "error",
        )
      }
    } catch (error) {
      setScreen({
        ...screen(),
        loading: false,
        notice: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Fetch one provider's models, or ask for its key when none is stored. */
  async function loadProvider(providerId: string, base: ModelsScreen): Promise<void> {
    const menu = base.view
    if (!deps.modelsForProvider) {
      setScreen({ ...base, view: menu, notice: null })
      openPrompt(providerId)
      return
    }
    const attempt = {
      ...base,
      view: menu,
      data: { ...base.data, editing: providerId },
      loading: true,
      notice: null,
    }
    setScreen(attempt)
    try {
      const result = await deps.modelsForProvider(providerId)
      const at = new Date().toISOString()
      if (result.ok) {
        const linked = focusSelectedModel(afterProviderLink(attempt, result.value.models, at))
        setScreen({
          ...linked,
          view: menu,
          notice:
            menu === "providers"
              ? `linked · ${result.value.models.length} models · open Chat model to pick one`
              : linked.notice,
        })
      } else if (result.error.kind === "config") {
        setScreen({ ...attempt, loading: false })
        openPrompt(providerId)
      } else if (result.error.kind === "keychain") {
        setScreen({ ...attempt, loading: false, notice: result.error.hint })
      } else if (result.error.kind === "auth") {
        setScreen({ ...attempt, loading: false })
        openPrompt(providerId, "the stored key was rejected")
      } else {
        setScreen({ ...afterProviderLinkFailure(attempt, result.error, at), view: menu })
      }
    } catch (error) {
      setScreen({
        ...screen(),
        loading: false,
        notice: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function openProviders(providerId?: string): void {
    const settings = deps.settings()
    const chatModel = settings?.chatModel ?? ""
    const at = chatModel.indexOf("/")
    const active = providerId ?? (at > 0 ? chatModel.slice(0, at) : undefined)
    setScreen(
      initialModelsScreen({
        baseUrl: settings?.baseUrl,
        chatModel,
        view: "providers",
        ...(active === undefined ? {} : { providerId: active }),
      }),
    )
    deps.openPane("providers")
    void deps
      .linkedProviders?.()
      .then((ids) => {
        if (ids.length === 0) return
        setScreen((current) => ({
          ...current,
          data: {
            ...current.data,
            rows: current.data.rows.map((row) =>
              ids.includes(row.spec.id) && !row.linked ? { ...row, linked: true } : row,
            ),
          },
        }))
      })
      .catch(() => {
        // A locked keychain leaves the rows as "not linked"; linking still works.
      })
  }

  function openPicker(): void {
    const settings = deps.settings()
    const chatModel = settings?.chatModel ?? ""
    const existing = screen()
    const at = chatModel.indexOf("/")
    const configured = at > 0 ? chatModel.slice(0, at) : null
    if (existing.models.length > 0) {
      setScreen(focusSelectedModel({ ...existing, view: "models" }))
      deps.openPane("models")
      return
    }
    const next = initialModelsScreen({
      baseUrl: settings?.baseUrl,
      chatModel,
      view: "models",
    })
    setScreen(next)
    deps.openPane("models")
    if (configured !== null) void loadProvider(configured, next)
  }

  async function choose(index: number): Promise<void> {
    const current = screen()
    const choice = chooseScreenModel(current, index)
    if (choice.kind === "refused") {
      setScreen({ ...current, notice: choice.reason })
      deps.notify(choice.reason, "warn")
      return
    }
    try {
      const target = current.target
      await deps.saveConfig({ [target === "chat" ? "models.chat" : "models.generation"]: choice.model })
      setScreen(choice.screen)
      deps.backToSettings()
      deps.notify(`${target === "chat" ? "chat" : "generation"} model: ${choice.model}`)
    } catch (error) {
      setScreen({
        ...current,
        notice: error instanceof Error ? error.message : String(error),
      })
      deps.notify("the model could not be saved", "error")
    }
  }

  function input(
    pane: "providers" | "models",
    press: ShellPress,
    event: { preventDefault: () => void },
  ): boolean {
    const current = screen()
    if (current.loading) {
      event.preventDefault()
      return true
    }
    if (current.baseUrlEditing) {
      if (press.name === "escape") setScreen(cancelModelsDraft(current))
      else if (press.name === "return") setScreen(commitBaseUrl(current))
      else if (press.name === "backspace" || press.name === "delete") setScreen(backspaceModelsDraft(current))
      else {
        const character = typedCharacter(press)
        if (character !== null) setScreen(typeModelsDraft(current, character))
      }
      event.preventDefault()
      return true
    }
    if (current.data.editing) {
      if (press.name === "escape") setScreen(cancelModelsDraft(current))
      else if (press.name === "return") void submitKey(current.data.editing, current.data.keyDraft)
      else if (press.name === "backspace" || press.name === "delete") setScreen(backspaceModelsDraft(current))
      else {
        const character = typedCharacter(press)
        if (character !== null) setScreen(typeModelsDraft(current, character))
      }
      event.preventDefault()
      return true
    }
    if (pane === "models") {
      if (press.name === "escape") deps.backToSettings()
      else if (press.name === "j" || press.name === "k") {
        const delta = press.name === "j" ? 1 : -1
        setScreen({
          ...current,
          modelCursor: Math.max(0, Math.min(current.models.length - 1, current.modelCursor + delta)),
        })
      } else if (press.name === "g") {
        setScreen({ ...current, target: current.target === "chat" ? "generation" : "chat", notice: null })
      } else if (press.name === "return") {
        void choose(current.modelCursor)
      }
      event.preventDefault()
      return true
    }
    if (press.name === "escape") {
      deps.backToSettings()
    } else if (press.name === "j" || press.name === "k") {
      const delta = press.name === "j" ? 1 : -1
      setScreen({
        ...current,
        cursor: Math.max(0, Math.min(current.data.rows.length - 1, current.cursor + delta)),
        notice: null,
      })
    } else if (press.name === "return") {
      const row = screenProvider(current)
      if (row) void loadProvider(row.spec.id, current)
    } else if (press.name === "b") {
      setScreen(beginBaseUrlEdit(current))
    } else if (press.name === "r") {
      const row = screenProvider(current)
      if (row) openPrompt(row.spec.id)
    }
    event.preventDefault()
    return true
  }

  return {
    screen,
    openProviders,
    openPicker,
    input,
    submitPrompt: submitKey,
  }
}
