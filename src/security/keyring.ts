/**
 * OS keychain adapters behind the `SecretStore` port.
 *
 * Chosen by the S2 spike (`docs/stack.md` §8, WP-003):
 *
 *   1. `@napi-rs/keyring` pinned to `{ linux: { store: "secret-service" } }`.
 *      The default builder silently falls back to the in-memory kernel keyutils
 *      store, which is not an OS keychain and dies on reboot — forbidden.
 *   2. the platform command shim (`secret-tool` on Linux, `security` on macOS)
 *      as a diagnostic fallback when the addon is not installed.
 *
 * Both use the same Secret Service attribute schema (`service` + `username`) so
 * a key written by one adapter is readable by the other.
 *
 * There is no file backend in this module and no import that can write to
 * disk. A missing backend returns a typed `unavailable` error.
 */
import {
  namespacedName,
  secretError,
  secretOk,
  validateSecretName,
  type SecretErrorKind,
  type SecretResult,
  type SecretStore,
} from "./secret-store"

const SERVICE = "lockedin-tui"

/** Map a backend failure message onto one actionable kind. */
export function classifyKeychainFailure(message: string): SecretErrorKind {
  const m = message.toLowerCase()
  if (/(locked|lock state|dismiss|cancell?ed|prompt)/.test(m)) return "locked"
  if (/(denied|not authorised|not authorized|access.*refus)/.test(m)) return "denied"
  if (
    /(no such file|not available|unavailable|failed to (connect|open|initiali[sz]e)|could not connect|dbus|secret service|platformfailure|no backend|not supported|storage)/.test(
      m,
    )
  ) {
    return "unavailable"
  }
  return "failed"
}

type NativeEntry = {
  getPassword(): Promise<string | null>
  setPassword(password: string): Promise<void>
  deleteCredential(): Promise<boolean>
}

type NativeModule = {
  AsyncEntry: new (
    service: string,
    username: string,
    options?: { linux?: { store?: "secret-service" | "keyutils" } },
  ) => NativeEntry
}

let nativePromise: Promise<NativeModule | null> | null = null

/**
 * Load the addon lazily and only once. It is an optional dependency of the
 * app at this stage (WP-111 packages it), so a missing module is an
 * `unavailable` backend — never a reason to fall back to a file.
 */
async function loadNative(): Promise<NativeModule | null> {
  if (nativePromise) return nativePromise
  const specifier = "@napi-rs/keyring"
  nativePromise = (async () => {
    try {
      return (await import(/* @vite-ignore */ specifier)) as unknown as NativeModule
    } catch {
      return null
    }
  })()
  return nativePromise
}

/** Test seam: reset the memoised module probe. */
export function resetNativeProbe(): void {
  nativePromise = null
}

export function createNativeKeychain(): SecretStore {
  const backend = "@napi-rs/keyring(secret-service)"

  const entry = async (name: string): Promise<NativeEntry | null> => {
    const mod = await loadNative()
    if (!mod) return null
    // Pinned: throws instead of falling back to the kernel keyring.
    return new mod.AsyncEntry(SERVICE, namespacedName(name), {
      linux: { store: "secret-service" },
    })
  }

  const fail = (err: unknown): SecretResult<never> => {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: secretError(classifyKeychainFailure(message), backend, message) }
  }

  return {
    id: "native",

    async available() {
      const mod = await loadNative()
      if (!mod) return false
      try {
        await new mod.AsyncEntry(SERVICE, namespacedName("probe/available"), {
          linux: { store: "secret-service" },
        }).getPassword()
        return true
      } catch {
        return false
      }
    },

    async get(name) {
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      try {
        const e = await entry(name)
        if (!e) {
          return {
            ok: false,
            error: secretError("unsupported", backend, "the keychain addon is not installed"),
          }
        }
        return secretOk(await e.getPassword())
      } catch (err) {
        return fail(err)
      }
    },

    async set(name, value) {
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      try {
        const e = await entry(name)
        if (!e) {
          return {
            ok: false,
            error: secretError("unsupported", backend, "the keychain addon is not installed"),
          }
        }
        await e.setPassword(value)
        return secretOk(undefined)
      } catch (err) {
        return fail(err)
      }
    },

    async delete(name) {
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      try {
        const e = await entry(name)
        if (!e) {
          return {
            ok: false,
            error: secretError("unsupported", backend, "the keychain addon is not installed"),
          }
        }
        return secretOk(await e.deleteCredential())
      } catch (err) {
        return fail(err)
      }
    },
  }
}

type RunResult = { code: number; stdout: string; stderr: string }

async function run(cmd: string[], stdin?: string): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

/**
 * Platform command shim. Linux writes the secret to the child's stdin so it
 * never appears in `ps`. macOS `security` has no stdin mode; its `-w` argument
 * is visible to same-user processes, which is why this is a fallback.
 */
export function createCommandKeychain(platform = process.platform): SecretStore {
  const tool = platform === "darwin" ? "security" : "secret-tool"
  const backend = tool

  const absent = (r: RunResult) =>
    (r.code === 1 || r.code === 44) && r.stderr.trim() === "" && r.stdout.trim() === ""

  const fail = (r: RunResult): SecretResult<never> => {
    const message = (r.stderr.trim() || `exit ${r.code}`).replace(/^secret-tool: /, "")
    return { ok: false, error: secretError(classifyKeychainFailure(message), backend, message) }
  }

  return {
    id: tool,

    async available() {
      return Bun.which(tool) !== null
    },

    async get(name) {
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      if (!Bun.which(tool)) return { ok: false, error: secretError("unsupported", backend, `${tool} is not installed`) }

      const full = namespacedName(name)
      const r =
        platform === "darwin"
          ? await run(["security", "find-generic-password", "-a", full, "-s", SERVICE, "-w"])
          : await run(["secret-tool", "lookup", "service", SERVICE, "username", full])

      if (r.code === 0) {
        const value = r.stdout.endsWith("\n") ? r.stdout.slice(0, -1) : r.stdout
        return secretOk(value)
      }
      if (absent(r)) return secretOk(null)
      return fail(r)
    },

    async set(name, value) {
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      if (!Bun.which(tool)) return { ok: false, error: secretError("unsupported", backend, `${tool} is not installed`) }

      const full = namespacedName(name)
      const r =
        platform === "darwin"
          ? await run(["security", "add-generic-password", "-U", "-a", full, "-s", SERVICE, "-w", value])
          : await run(
              ["secret-tool", "store", `--label=LockedIn · ${full}`, "service", SERVICE, "username", full],
              value,
            )
      return r.code === 0 ? secretOk(undefined) : fail(r)
    },

    async delete(name) {
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      if (!Bun.which(tool)) return { ok: false, error: secretError("unsupported", backend, `${tool} is not installed`) }

      const full = namespacedName(name)
      const r =
        platform === "darwin"
          ? await run(["security", "delete-generic-password", "-a", full, "-s", SERVICE])
          : await run(["secret-tool", "clear", "service", SERVICE, "username", full])

      if (r.code === 0) return secretOk(true)
      if (absent(r)) return secretOk(false)
      return fail(r)
    },
  }
}

/**
 * The adapter the app should use: native addon when it loads, otherwise the
 * platform command shim. Both are keychain-only; neither writes a file.
 */
export async function createSystemSecretStore(): Promise<SecretStore> {
  const native = createNativeKeychain()
  if (await native.available()) return native
  return createCommandKeychain()
}
