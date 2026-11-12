/**
 * Provider catalogue — pure data (`docs/product.md` §10.1).
 *
 * "Providers are configuration": nothing here performs IO, imports a provider
 * library or touches a secret. Importing this module must stay free of side
 * effects, and `tests/unit/providers.test.ts` asserts exactly that.
 *
 * Facts encoded per entry:
 *   - stable id + label;
 *   - wire family (all v1 providers speak an OpenAI-shaped HTTP API except the
 *     native-auth ones, which differ only in how the key is presented);
 *   - default base URL;
 *   - whether a key is required (local endpoints are keyless);
 *   - the local format rule (a cheap shape test, never a validity claim);
 *   - how the model list is discovered.
 */

/** How the credential is presented on the wire. */
export type AuthKind =
  /** `Authorization: Bearer <key>` — OpenAI, OpenRouter, OpenAI-compatible. */
  | "bearer"
  /** `x-api-key` + a version header — Anthropic. */
  | "x-api-key"
  /** `x-goog-api-key` — Google Generative Language. */
  | "google-api-key"

/** How a provider's model list is discovered. Both cost exactly one request. */
export type Discovery =
  /**
   * `GET {baseUrl}{path}` returning the model list. Preferred.
   *
   * `baseUrl` overrides the chat endpoint for discovery only; OpenCode serves
   * `/models` one level above its `/openai/v1` chat path.
   */
  | { kind: "models-endpoint"; path: string; baseUrl?: string }
  /** One 1-token completion, when the provider has no model list. */
  | { kind: "probe-completion" }

/**
 * A shape test on the key, not a validity check. `example` is a fake value
 * shown in Settings so the user knows what to paste; it is never a real key.
 */
export type KeyFormat = {
  pattern: RegExp
  /** Human description of the shape, used in the error copy. */
  shape: string
  example: string
}

export type ProviderSpec = {
  id: string
  label: string
  wire: "openai-compatible" | "native"
  auth: AuthKind
  /** Empty string means "the user must supply one" (custom endpoints). */
  baseUrl: string
  keyRequired: boolean
  /** `null` when the provider genuinely needs no key. */
  keyFormat: KeyFormat | null
  discovery: Discovery
  /** Shown in Settings → Providers. */
  note?: string
}

export const CUSTOM_PROVIDER_ID = "custom"

/**
 * The user-supplied OpenAI-compatible endpoint. It is not "first-class": it has
 * no default URL, and its key is optional (Ollama, LM Studio and llama.cpp run
 * keyless on localhost).
 */
export const CUSTOM_PROVIDER: ProviderSpec = {
  id: CUSTOM_PROVIDER_ID,
  label: "Custom OpenAI-compatible",
  wire: "openai-compatible",
  auth: "bearer",
  baseUrl: "",
  keyRequired: false,
  keyFormat: {
    // Any non-empty, whitespace-free string: local servers often use a
    // placeholder like "ollama" or no key at all.
    pattern: /^\S{8,}$/,
    shape: "8+ characters, no spaces",
    example: "local-placeholder",
  },
  discovery: { kind: "models-endpoint", path: "/models" },
  note: "Ollama, LM Studio, llama.cpp and OpenRouter-style endpoints. Local models are free.",
}

/**
 * First-class providers, in the order Settings lists them.
 *
 * Key shapes are the publicly documented prefixes; they are deliberately
 * permissive enough to survive a provider changing its suffix format, and
 * strict enough to catch a pasted URL, an email or an empty box.
 */
export const FIRST_CLASS_PROVIDERS: readonly ProviderSpec[] = [
  {
    id: "openai",
    label: "OpenAI",
    wire: "openai-compatible",
    auth: "bearer",
    baseUrl: "https://api.openai.com/v1",
    keyRequired: true,
    keyFormat: {
      pattern: /^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/,
      shape: "sk-… (20+ letters, digits, - or _)",
      example: "sk-spike-placeholder-not-a-key",
    },
    discovery: { kind: "models-endpoint", path: "/models" },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    wire: "native",
    auth: "x-api-key",
    baseUrl: "https://api.anthropic.com/v1",
    keyRequired: true,
    keyFormat: {
      pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
      shape: "sk-ant-… (20+ letters, digits, - or _)",
      example: "sk-ant-spike-placeholder",
    },
    discovery: { kind: "models-endpoint", path: "/models" },
    note: "Requires the anthropic-version header.",
  },
  {
    id: "google",
    label: "Google",
    wire: "native",
    auth: "google-api-key",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyRequired: true,
    keyFormat: {
      pattern: /^AIza[0-9A-Za-z_-]{35}$/,
      shape: "AIza… (39 characters in total)",
      example: "AIza... (39 characters)",
    },
    discovery: { kind: "models-endpoint", path: "/models" },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    wire: "openai-compatible",
    auth: "bearer",
    baseUrl: "https://openrouter.ai/api/v1",
    keyRequired: true,
    keyFormat: {
      pattern: /^sk-or-v1-[a-f0-9]{32,}$/,
      shape: "sk-or-v1-… (32+ hex characters)",
      example: "sk-or-v1-00000000000000000000000000000000",
    },
    discovery: { kind: "models-endpoint", path: "/models" },
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    wire: "openai-compatible",
    auth: "bearer",
    // Chat completions; `/models` lives one level above this path.
    baseUrl: "https://opencode.ai/inference/openai/v1",
    keyRequired: true,
    keyFormat: {
      // Provisional: the live validation is authoritative.
      pattern: /^[A-Za-z0-9_-]{24,}$/,
      shape: "24+ letters, digits, - or _",
      example: "opencode-zen-placeholder-000000",
    },
    discovery: {
      kind: "models-endpoint",
      path: "/models",
      baseUrl: "https://opencode.ai/inference/v1",
    },
    note: "Console pay-as-you-go key. For a Go subscription choose OpenCode Go.",
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    wire: "openai-compatible",
    auth: "bearer",
    // Go chat completions; `/models` lives one level above this path.
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    keyRequired: true,
    keyFormat: {
      // Provisional: no public shape is documented yet. Kept deliberately wide
      // so a format change does not lock users out; the live check decides.
      pattern: /^[A-Za-z0-9_-]{24,}$/,
      shape: "24+ letters, digits, - or _",
      example: "opencode-spike-placeholder-000000",
    },
    discovery: {
      kind: "models-endpoint",
      path: "/models",
      baseUrl: "https://opencode.ai/inference/go/v1",
    },
    note: "Key shape is provisional; the live validation is authoritative.",
  },
] as const

export const ALL_PROVIDERS: readonly ProviderSpec[] = [...FIRST_CLASS_PROVIDERS, CUSTOM_PROVIDER]

/** Default timeout for the single live validation request. */
export const VALIDATION_TIMEOUT_MS = 10_000

const OPENCODE_PROVIDERS = new Set(["opencode-zen", "opencode-go"])

/**
 * Provider-specific routing headers. OpenCode asks for a stable session id on
 * inference requests and rejects a request without one; other providers need
 * nothing here.
 */
export function transportHeaders(spec: ProviderSpec, sessionId: string): Record<string, string> {
  if (!OPENCODE_PROVIDERS.has(spec.id)) return {}
  return {
    "x-opencode-session": sessionId,
    "user-agent": "lockedin/0.1",
  }
}

/** Header name/value for the provider's auth style. `key` is never logged. */
export function authHeaders(spec: ProviderSpec, key: string | null): Record<string, string> {
  if (spec.auth === "x-api-key") {
    return { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" }
  }
  if (spec.auth === "google-api-key") {
    return key ? { "x-goog-api-key": key } : {}
  }
  return key ? { authorization: `Bearer ${key}` } : {}
}

/** The provider a model id belongs to, e.g. `openai/gpt-4.1-mini` → `openai`. */
export function providerIdOfModel(modelId: string): string | null {
  const index = modelId.indexOf("/")
  return index > 0 ? modelId.slice(0, index) : null
}
