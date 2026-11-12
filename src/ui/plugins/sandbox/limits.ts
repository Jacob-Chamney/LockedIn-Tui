/**
 * Resource limits for a sandboxed effect.
 *
 * Values follow the plugin-sandbox spike (ADR 0016): a small heap and stack, a
 * bounded load and a bounded per-call deadline. The Worker that runs them is the
 * availability boundary; these limits are the capability and resource boundary.
 */
export type SandboxLimits = {
  /** QuickJS heap cap. */
  memoryBytes: number
  stackBytes: number
  loadTimeoutMs: number
  /** One frame: spawn + step + style for every particle. */
  callTimeoutMs: number
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 512 * 1024,
  loadTimeoutMs: 1_000,
  callTimeoutMs: 100,
}

/** A compiled bundle is data, but a huge one is still a load-time problem. */
export const MAX_BUNDLE_BYTES = 512 * 1024

/** A command may copy at most this many characters to the clipboard. */
export const MAX_CLIPBOARD_CHARS = 4096
