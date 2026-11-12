/**
 * Provider glue: turns a configured `provider/model` into a real `ChatService`.
 *
 * This is the seam WP-809 left open. `boot()` used to have no factory, so a
 * configured model reported "no provider glue is wired in this build".
 *
 * Rules, each with its own refusal so the UI can say exactly what is wrong:
 *
 *   - the model id must be `provider/model` (a bare `gpt-4o` is ambiguous);
 *   - the provider must be in the catalogue;
 *   - a provider that needs a key must have one **in the keychain** — read
 *     through the injected `readKey`, once, and never logged;
 *   - a loopback base URL is a local, free endpoint and needs no key;
 *   - a provider whose wire family is not OpenAI-compatible is refused rather
 *     than spoken to with the wrong protocol. No fallback, ever.
 */
import { randomUUID } from "node:crypto"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createChatService, type ChatService } from "./chat"
import { getProvider, resolveBaseUrl } from "./catalogue"
import { transportHeaders } from "./provider-spec"
import { isLoopbackUrl } from "./pricing"

export type ProviderRefusalReason =
  | "no-model-prefix"
  | "unknown-provider"
  | "unsupported-wire"
  | "missing-base-url"
  | "invalid-base-url"
  | "insecure-base-url"
  | "missing-key"

export type ProviderService =
  | { ok: true; service: ChatService; providerId: string; modelName: string }
  | { ok: false; reason: ProviderRefusalReason; message: string }

export type CreateProviderInput = {
  /** Prefix of the model id, or "" when the id has none. */
  providerId: string
  /** Full id as configured, e.g. `openai/gpt-4.1-mini`. */
  model: string
  /** Custom endpoint from config; ignored for first-class providers. */
  baseUrl: string
  /**
   * Keychain reader. Called at most once, and only when a key is required.
   * The ref is the keychain entry name, `lockedin/<provider-id>`.
   */
  readKey: (ref: string) => Promise<string | null>
}

function refuse(reason: ProviderRefusalReason, message: string): ProviderService {
  return { ok: false, reason, message }
}

/** `openai/gpt-4.1-mini` → `gpt-4.1-mini`; a bare id is returned unchanged. */
export function modelNameOf(model: string): string {
  const index = model.indexOf("/")
  return index === -1 ? model : model.slice(index + 1)
}

/** Stable for this process; one id is enough for routing and prompt caching. */
const SESSION_ID = randomUUID()

export async function createProviderService(input: CreateProviderInput): Promise<ProviderService> {
  const model = input.model.trim()
  const prefix = input.providerId || (model.includes("/") ? model.slice(0, model.indexOf("/")) : "")

  if (model === "") return refuse("no-model-prefix", "No model is configured.")
  if (prefix === "") {
    return refuse(
      "no-model-prefix",
      `"${model}" has no provider. Choose a provider-qualified model such as openai/gpt-4.1-mini.`,
    )
  }

  const spec = getProvider(prefix)
  if (!spec) return refuse("unknown-provider", `Unknown provider "${prefix}". Add it in Settings → Providers.`)

  if (spec.wire !== "openai-compatible") {
    return refuse(
      "unsupported-wire",
      `${spec.label} speaks its own protocol; this build has no adapter for it. Pick an OpenAI-compatible provider.`,
    )
  }

  // An empty `models.base_url` means "use the provider's default", not "no URL".
  const override = input.baseUrl.trim()
  const baseUrl = resolveBaseUrl(spec, override === "" ? undefined : override)
  if (baseUrl === "") {
    return refuse("missing-base-url", `Set a base URL for ${spec.label} in Settings → Models.`)
  }

  // A local endpoint is free and keyless; nothing is read from the keychain.
  const local = isLoopbackUrl(baseUrl)
  if (!local) {
    let protocol: string
    try {
      protocol = new URL(baseUrl).protocol
    } catch {
      return refuse("invalid-base-url", `"${baseUrl}" is not a valid base URL.`)
    }
    if (protocol !== "https:") {
      return refuse(
        "insecure-base-url",
        `${spec.label} must use https unless it is a loopback endpoint; refusing to send a key in clear text.`,
      )
    }
  }
  let apiKey = "local"
  if (!local) {
    // An optional key (the custom endpoint) is still used when one is linked:
    // skipping it made every remote OpenAI-compatible endpoint send `Bearer local`.
    const key = await input.readKey(`lockedin/${spec.id}`)
    if (key && key.trim() !== "") {
      apiKey = key
    } else if (spec.keyRequired) {
      return refuse("missing-key", `No ${spec.label} key is linked. Link one in Settings → Providers.`)
    }
  }

  const provider = createOpenAICompatible({
    name: spec.id,
    baseURL: baseUrl,
    apiKey,
    headers: transportHeaders(spec, SESSION_ID),
  })

  const service = createChatService({
    // The SDK gets the model name without the provider prefix; the failure
    // message still carries the provider id.
    resolveModel: (id: string) => provider(modelNameOf(id)),
    providerId: spec.id,
  })

  return { ok: true, service, providerId: spec.id, modelName: modelNameOf(model) }
}
