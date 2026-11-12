/**
 * One live key validation, and the only place a provider key is stored.
 *
 * Policy this module encodes (`docs/product.md` §10.1, `docs/architecture.md`
 * §3.3/§9):
 *
 *   1. local shape check — no network, value never echoed;
 *   2. one authenticated request, 10 s timeout, no retry, no fallback model;
 *   3. exactly one mapping from outcome to a typed error;
 *   4. store the key through WP-103's `SecretStore` **only** after success;
 *   5. linking never selects a model; the user chooses explicitly;
 *   6. the provider's response body never reaches the UI, and the key never
 *      reaches a message, a log line or an error object.
 */
import { createRedactor } from "../security/redaction"
import type { SecretError, SecretStore } from "../security/secret-store"
import { authHeaders, providerIdOfModel, type ProviderSpec } from "./provider-spec"
import { checkKeyFormat, resolveDiscoveryBaseUrl } from "./catalogue"

/** The subset of `AppError` this packet owns (`docs/architecture.md` §3.3). */
export type LlmError =
  | { kind: "config"; message: string }
  | { kind: "auth"; provider: string; message: string }
  | { kind: "rate-limit"; provider: string; retryAfter?: number }
  | { kind: "network"; message: string }
  | { kind: "provider"; provider: string; status: number; message: string }
  /** Carries WP-103's typed failure so its `hint` stays the single copy. */
  | { kind: "keychain"; provider: string; message: string; hint: string }

export type LlmResult<T> = { ok: true; value: T } | { ok: false; error: LlmError }

const ok = <T>(value: T): LlmResult<T> => ({ ok: true, value })
const fail = <T>(error: LlmError): LlmResult<T> => ({ ok: false, error })

const AUTH_COPY = "The provider rejected the key. It was not saved."

export type ValidationInput = {
  spec: ProviderSpec
  /** `null` for a keyless local endpoint. */
  key: string | null
  /** Only used for the custom provider. */
  baseUrl?: string
  /** Optional model the user typed; checked against the returned list. */
  model?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type ValidationSuccess = {
  /** Model ids exactly as the provider returned them, in its order. */
  models: string[]
  verifiedModel: string | null
  /** Always 1: the contract is one authenticated request per attempt. */
  requests: 1
}

/**
 * The single live request. Never retried, never fanned out to another model or
 * provider: a failure is reported once and the caller stops.
 */
export async function validateKeyOnce(input: ValidationInput): Promise<LlmResult<ValidationSuccess>> {
  const { spec } = input
  const key = input.key?.trim() ? input.key.trim() : null
  const redactor = createRedactor()
  redactor.add(key)

  const baseUrl = resolveDiscoveryBaseUrl(spec, input.baseUrl)
  if (!baseUrl) {
    return fail({ kind: "config", message: `Set a base URL for ${spec.label} first.` })
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    ...authHeaders(spec, key),
  }
  const discovery = spec.discovery
  const discoverModels = discovery.kind === "models-endpoint"
  const url = discovery.kind === "models-endpoint" ? `${baseUrl}${discovery.path}` : `${baseUrl}/chat/completions`
  const body = discovery.kind === "models-endpoint"
    ? null
    : JSON.stringify({ model: input.model ?? "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "hi" }] })

  const fetchImpl = input.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: discoverModels ? "GET" : "POST",
      headers: body ? { ...headers, "content-type": "application/json" } : headers,
      body,
      // One shot: the signal also gives the 10 s budget.
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    })
  } catch (err) {
    // No status at all: DNS, refused connection, TLS, timeout.
    return fail({
      kind: "network",
      message: `Could not reach ${spec.label}. Check your network or the base URL, then try again.`,
    })
  }

  if (!response.ok) return fail(await mapFailure(spec, response, redactor))

  let models: string[]
  try {
    models = await readModels(spec, response)
  } catch {
    return fail({
      kind: "provider",
      provider: spec.id,
      status: response.status,
      message: `${spec.label} returned a response this app does not understand.`,
    })
  }

  if (models.length === 0) {
    return fail({
      kind: "provider",
      provider: spec.id,
      status: response.status,
      message: `${spec.label} returned no models for this key.`,
    })
  }

  const wanted = input.model?.trim() || null
  if (wanted && !models.includes(wanted)) {
    return fail({
      kind: "provider",
      provider: spec.id,
      status: response.status,
      message: `${spec.label} does not offer "${wanted}". Choose a different model.`,
    })
  }

  return ok({ models, verifiedModel: wanted, requests: 1 })
}

/**
 * Status/body → typed error. The body is never passed through: only a one-line
 * message, redacted and capped, and only for the generic `provider` case.
 */
async function mapFailure(
  spec: ProviderSpec,
  response: Response,
  redactor: ReturnType<typeof createRedactor>,
): Promise<LlmError> {
  const status = response.status

  if (status === 401 || status === 403) {
    return { kind: "auth", provider: spec.id, message: AUTH_COPY }
  }
  if (status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "")
    return {
      kind: "rate-limit",
      provider: spec.id,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
    }
  }

  let detail = ""
  try {
    const text = await response.text()
    detail = redactor.redact(extractMessage(text))
  } catch {
    detail = ""
  }

  const message = detail
    ? `${spec.label} returned ${status}: ${detail}`
    : `${spec.label} returned an unexpected response (${status}).`

  // A body that says "invalid key" is an auth failure even without a 401.
  if (/invalid[_ -]?api[_ -]?key|incorrect api key|api key not valid/i.test(detail)) {
    return { kind: "auth", provider: spec.id, message: AUTH_COPY }
  }

  return { kind: "provider", provider: spec.id, status, message: message.slice(0, 200) }
}

/** First line of `error.message`, else the first line of the body. */
function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    const nested = typeof parsed.error === "string" ? parsed.error : parsed.error?.message
    const text = nested ?? parsed.message ?? ""
    if (text) return text.split("\n")[0]!.slice(0, 200)
  } catch {
    // not JSON: fall through to the raw first line
  }
  return body.split("\n")[0]!.slice(0, 200)
}

/** Accepts the OpenAI/Anthropic `{data:[{id}]}` and Google `{models:[{name}]}` shapes. */
async function readModels(spec: ProviderSpec, response: Response): Promise<string[]> {
  if (spec.discovery.kind === "probe-completion") {
    // A 1-token completion proves the key but lists no models.
    return [`${spec.id}/default`]
  }
  const payload = (await response.json()) as {
    data?: { id?: string; name?: string }[]
    models?: { name?: string; id?: string }[]
  }
  const list = (payload.data ?? payload.models ?? []) as Array<{
    id?: string
    name?: string
    /** OpenCode (and similar catalogues) name each model's supported API. */
    api?: Record<string, unknown>
  }>
  return list
    // A model that declares only `responses` or `messages` cannot be called
    // through the chat-completions client this build uses.
    .filter((entry) => entry.api === undefined || Object.hasOwn(entry.api, "chat-completions"))
    .map((entry) => entry.id ?? entry.name ?? "")
    .filter((id) => id.length > 0)
    .map((id) => id.replace(/^models\//, ""))
}

export type LinkInput = {
  providerId: string
  spec: ProviderSpec
  key?: string
  baseUrl?: string
  model?: string
  store: SecretStore
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type LinkOutcome = {
  providerId: string
  models: string[]
  /** Always null: linking a key must not auto-select a model. */
  modelSelected: null
  /** Always 1: one authenticated request per attempt, never a retry. */
  requests: 1
  /** The keychain entry name, for diagnostics — never the value. */
  secretRef: string
}

/**
 * The whole link flow. The key is written only after validation succeeds, and
 * never anywhere except the keychain.
 */
export async function linkProviderKey(input: LinkInput): Promise<LlmResult<LinkOutcome>> {
  const { spec, store } = input
  const key = input.key?.trim() ? input.key.trim() : null

  const format = checkKeyFormat(spec, key ?? "")
  if (!format.ok) return fail({ kind: "config", message: format.message })

  // A keyless local endpoint still needs a reachable provider, but nothing to
  // store; keep the same order so a missing keychain cannot break local use.
  if (key !== null) {
    // Cheap local probe first: a missing/locked keychain aborts before any
    // network call, and stores nothing.
    if (!(await store.available())) {
      return fail(keychainError(spec, unavailableSecret(spec)))
    }
  }

  const validated = await validateKeyOnce({
    spec,
    key,
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  })
  if (!validated.ok) return validated

  if (key !== null) {
    const stored = await store.set(spec.id, key)
    if (!stored.ok) return fail(keychainError(spec, stored.error))
  }

  return ok({
    providerId: spec.id,
    models: validated.value.models,
    modelSelected: null,
    requests: 1,
    secretRef: `lockedin/${spec.id}`,
  })
}

function unavailableSecret(spec: ProviderSpec): SecretError {
  return {
    kind: "unavailable",
    backend: "secret-store",
    message: "no keychain backend is available",
    hint: `No OS keychain is reachable. Start your desktop keyring and retry; the ${spec.label} key was not saved.`,
  }
}

function keychainError(spec: ProviderSpec, error: SecretError): LlmError {
  return { kind: "keychain", provider: spec.id, message: error.message, hint: error.hint }
}

export type UnlinkInput = {
  providerId: string
  spec: ProviderSpec
  store: SecretStore
  /** The user must have answered the confirmation. */
  confirmed: boolean
  /** Currently selected model id, e.g. `openai/gpt-4.1-mini`. */
  selectedModel?: string | null
}

export type UnlinkOutcome = { removed: boolean; selectionCleared: boolean }

/** Copy for the confirmation modal. It names the provider (design §11). */
export function unlinkConfirmation(spec: ProviderSpec): string {
  return `Unlink ${spec.label}? Its key will be deleted from the OS keychain.`
}

export async function unlinkProviderKey(input: UnlinkInput): Promise<LlmResult<UnlinkOutcome>> {
  if (!input.confirmed) {
    return fail({ kind: "config", message: unlinkConfirmation(input.spec) })
  }

  const removed = await input.store.delete(input.providerId)
  if (!removed.ok) return fail(keychainError(input.spec, removed.error))

  const selected = input.selectedModel ?? null
  const selectionCleared = selected !== null && providerIdOfModel(selected) === input.providerId

  return ok({ removed: removed.value, selectionCleared })
}

/**
 * The single copy mapping (`docs/design.md` §8, §11). Every screen shows these
 * strings; no screen writes its own.
 */
export function keyErrorCopy(error: LlmError): { title: string; next: string } {
  switch (error.kind) {
    case "config":
      return { title: error.message, next: "Check the value and try again. Nothing was saved." }
    case "auth":
      return {
        title: "The provider rejected the key.",
        next: "Open Settings → Providers, check the key, and paste a new one.",
      }
    case "rate-limit":
      return {
        title: "The provider is rate limiting this key.",
        next:
          error.retryAfter !== undefined
            ? `Wait ${error.retryAfter}s, then try again. Nothing was saved.`
            : "Wait a moment, then try again. Nothing was saved.",
      }
    case "network":
      return { title: "Could not reach the provider.", next: "Check your network and the base URL, then try again." }
    case "provider":
      return { title: error.message, next: "The key was not saved. Check the model name and try again." }
    case "keychain":
      return { title: error.message, next: error.hint }
  }
}
