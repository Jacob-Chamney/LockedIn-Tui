/**
 * The `SecretStore` port (`docs/architecture.md` §4.6) and its rules.
 *
 * Product invariants this file protects:
 *   - 11: secrets live in the OS keychain only. There is no file backend here,
 *     and no function in this module can write to disk;
 *   - 10: a failure is reported once and never retried.
 *
 * Everything is a `Result`, not a throw: a missing or locked keyring is an
 * expected state the UI must render, not an exception. `Result` is the repo's
 * convention (`src/domain/markdown.ts`), and `unwrapSecret` exists for callers
 * that treat a missing keychain as fatal.
 */

export type SecretErrorKind =
  /** No backend reachable (no Secret Service, no Keychain, no Credential Manager). */
  | "unavailable"
  /** Backend present but locked, or the unlock prompt was dismissed. */
  | "locked"
  /** Backend refused access. */
  | "denied"
  /** Name failed the local format check; nothing was read or written. */
  | "invalid-name"
  /** This adapter cannot run on this platform. */
  | "unsupported"
  /** Anything else; `message` is sanitised and never contains the value. */
  | "failed"

export type SecretError = {
  readonly kind: SecretErrorKind
  readonly backend: string
  /** One line, <=200 chars, sanitised. Never contains a secret value. */
  readonly message: string
  /** One actionable sentence for the UI (`docs/design.md` §11). */
  readonly hint: string
}

export type SecretResult<T> = { ok: true; value: T } | { ok: false; error: SecretError }

export interface SecretStore {
  /** Stable adapter id, for diagnostics and the Settings → Providers row. */
  readonly id: string
  /** Cheap local check: can this adapter run here at all? Never proves auth. */
  available(): Promise<boolean>
  get(name: string): Promise<SecretResult<string | null>>
  set(name: string, value: string): Promise<SecretResult<void>>
  delete(name: string): Promise<SecretResult<boolean>>
}

/**
 * Every keychain entry is namespaced so LockedIn cannot collide with another
 * app's generic-password entry, and so a diagnostic dump is recognisable.
 */
export const NAMESPACE = "lockedin"

/** Maximum length of the *public* name; the namespaced form adds 9 chars. */
export const MAX_NAME_LENGTH = 182

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/

/** Local format check. Runs before any I/O, so a bad name costs nothing. */
export function validateSecretName(name: string): SecretError | null {
  const invalid = (message: string): SecretError => ({
    kind: "invalid-name",
    backend: "format-check",
    message,
    hint: "Use a lowercase secret name such as providers/openai or github/token.",
  })

  if (name.length === 0) return invalid("Secret name is empty.")
  if (name.length > MAX_NAME_LENGTH) {
    return invalid(`Secret name is longer than ${MAX_NAME_LENGTH} characters.`)
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return invalid("Secret name contains a control character.")
  if (name.startsWith("/") || name.endsWith("/")) {
    return invalid("Secret name has a leading or trailing '/'.")
  }
  if (name.startsWith(`${NAMESPACE}/`)) {
    return invalid(`Secret name must not repeat the '${NAMESPACE}/' namespace.`)
  }
  for (const segment of name.split("/")) {
    if (segment === "." || segment === "..") {
      return invalid("Secret name contains a relative path segment.")
    }
    if (!SEGMENT.test(segment)) {
      return invalid(
        `Secret name segment "${segment}" must be lowercase letters, digits, '.', '_' or '-'.`,
      )
    }
  }
  return null
}

/** `providers/openai` → `lockedin/providers/openai`. */
export function namespacedName(name: string): string {
  return `${NAMESPACE}/${name}`
}

/** The only thing a config file may hold about a secret: a pointer to it. */
export function secretRefFor(name: string): string {
  return namespacedName(name)
}

export function secretOk<T>(value: T): SecretResult<T> {
  return { ok: true, value }
}

export function secretError(
  kind: SecretErrorKind,
  backend: string,
  message: string,
): SecretError {
  return { kind, backend, message: sanitize(message), hint: hintFor(kind) }
}

/** First line only, collapsed whitespace, hard cap. Never echoes a value. */
export function sanitize(message: string): string {
  return message.split("\n")[0]!.replace(/\s+/g, " ").trim().slice(0, 200)
}

export function hintFor(kind: SecretErrorKind): string {
  switch (kind) {
    case "unavailable":
      return "No OS keychain is reachable. Start your desktop keyring and retry; keys are never written to a file."
    case "locked":
      return "The OS keychain is locked. Unlock it and retry; the key was not saved."
    case "denied":
      return "The OS keychain refused access. Allow LockedIn in your keyring settings and retry."
    case "invalid-name":
      return "Fix the secret name; nothing was read or written."
    case "unsupported":
      return "This keychain adapter cannot run on this platform. Pick another one in Settings."
    case "failed":
      return "The OS keychain rejected the request. No key was saved and no file was written."
  }
}

/** Throwing form, for callers where a missing keychain is genuinely fatal. */
export function unwrapSecret<T>(result: SecretResult<T>): T {
  if (result.ok) return result.value
  throw new SecretStoreError(result.error)
}

export class SecretStoreError extends Error {
  readonly kind: SecretErrorKind
  readonly hint: string
  readonly backend: string

  constructor(error: SecretError) {
    // The message never carries the value; there is no value in scope here.
    super(`${error.kind}: ${error.message}`)
    this.name = "SecretStoreError"
    this.kind = error.kind
    this.hint = error.hint
    this.backend = error.backend
  }
}
