/**
 * Catalogue queries and the local key-format check.
 *
 * Pure functions over `provider-spec.ts`. No network, no secrets, no config
 * writes: the UI can call any of this on first paint (`docs/design.md` §10,
 * "no network call blocks the first frame").
 */
import {
  ALL_PROVIDERS,
  CUSTOM_PROVIDER,
  CUSTOM_PROVIDER_ID,
  FIRST_CLASS_PROVIDERS,
  type ProviderSpec,
} from "./provider-spec"

/** The five first-class providers plus the custom entry, in display order. */
export function listProviders(): readonly ProviderSpec[] {
  return ALL_PROVIDERS
}

/** Only the providers with a fixed endpoint (Settings → Providers). */
export function listFirstClassProviders(): readonly ProviderSpec[] {
  return FIRST_CLASS_PROVIDERS
}

export function getProvider(id: string): ProviderSpec | null {
  return ALL_PROVIDERS.find((spec) => spec.id === id) ?? null
}

export function isCustomProvider(id: string): boolean {
  return id === CUSTOM_PROVIDER_ID
}

/** Providers the user must paste a key for. Custom endpoints are optional. */
export function providersRequiringKey(): readonly ProviderSpec[] {
  return ALL_PROVIDERS.filter((spec) => spec.keyRequired)
}

/** The endpoint used for a validation. `baseUrl` overrides only for custom. */
export function resolveBaseUrl(spec: ProviderSpec, override?: string): string {
  const url = (override ?? spec.baseUrl).trim().replace(/\/+$/, "")
  return url
}

/** The URL model discovery talks to; usually the chat URL, sometimes above it. */
export function resolveDiscoveryBaseUrl(spec: ProviderSpec, override?: string): string {
  const discovery = spec.discovery
  if (discovery.kind === "models-endpoint" && discovery.baseUrl) {
    return discovery.baseUrl.trim().replace(/\/+$/, "")
  }
  return resolveBaseUrl(spec, override)
}

export function customSpec(baseUrl: string): ProviderSpec {
  return { ...CUSTOM_PROVIDER, baseUrl }
}

export type FormatCheck =
  | { ok: true }
  | { ok: false; message: string }

/**
 * Cheap local shape test. Runs before any request, and never echoes the value
 * (a mistyped key is still a secret).
 */
export function checkKeyFormat(spec: ProviderSpec, value: string): FormatCheck {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return spec.keyRequired
      ? { ok: false, message: `enter a key for ${spec.label} (expected ${shapeOf(spec)})` }
      : { ok: true } // keyless local endpoint
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, message: `that does not look like a ${spec.label} key (expected ${shapeOf(spec)})` }
  }
  const format = spec.keyFormat
  if (format && !format.pattern.test(trimmed)) {
    return { ok: false, message: `that does not look like a ${spec.label} key (expected ${format.shape})` }
  }
  return { ok: true }
}

function shapeOf(spec: ProviderSpec): string {
  return spec.keyFormat?.shape ?? "a key"
}

/** Copy for Settings, so the user knows the expected shape before pasting. */
export function keyShapeHint(spec: ProviderSpec): string {
  if (!spec.keyRequired) return "Optional for local endpoints."
  return `Expected ${spec.keyFormat?.shape ?? "a key"}`
}
