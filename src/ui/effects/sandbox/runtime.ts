/**
 * QuickJS/WASM wrapper for a single effect sandbox.
 *
 * One runtime + context per effect. Every handle is disposed in `finally`: a
 * leaked handle after an OOM makes `JS_FreeRuntime` assert and aborts the host.
 */
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten-core"
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core"
import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync"

import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits } from "./limits"

export type SandboxError = {
  name: string
  message: string
  stack?: string
}

let modulePromise: Promise<QuickJSWASMModule> | null = null

/** Load the release-sync WASM variant once per process (~1.4 MiB, not the 14 MiB meta package). */
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  if (!modulePromise) modulePromise = newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
  return modulePromise
}

export class SandboxFailure extends Error {
  readonly info: SandboxError
  constructor(info: SandboxError) {
    super(`${info.name}: ${info.message}`)
    this.name = "SandboxFailure"
    this.info = info
  }
}

export class Sandbox {
  readonly runtime: QuickJSRuntime
  readonly context: QuickJSContext
  readonly limits: SandboxLimits
  private deadlineAt = 0
  private closed = false
  /** Unrecoverable engine error (OOM, stack blowout). */
  fatal: SandboxError | null = null

  constructor(module: QuickJSWASMModule, limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS) {
    this.limits = limits
    this.runtime = module.newRuntime()
    this.runtime.setMemoryLimit(limits.memoryBytes)
    this.runtime.setMaxStackSize(limits.stackBytes)
    this.runtime.setInterruptHandler(() => this.deadlineAt > 0 && Date.now() >= this.deadlineAt)
    this.context = this.runtime.newContext()
  }

  get alive(): boolean {
    return !this.closed && !this.fatal
  }

  /** Run `fn` with a wall-clock deadline enforced by QuickJS interrupts. */
  withDeadline<T>(timeoutMs: number, fn: () => T): T {
    if (this.closed) throw new Error("sandbox disposed")
    const previous = this.deadlineAt
    this.deadlineAt = Date.now() + timeoutMs
    try {
      return fn()
    } finally {
      this.deadlineAt = previous
    }
  }

  eval(code: string, filename: string, timeoutMs = this.limits.loadTimeoutMs): QuickJSHandle {
    return this.withDeadline(timeoutMs, () => {
      const result = this.context.evalCode(code, filename)
      if (result.error) {
        const info = this.describe(result.error)
        result.error.dispose()
        if (Sandbox.isFatal(info)) this.fatal = info
        throw new SandboxFailure(info)
      }
      return result.value
    })
  }

  call(fn: QuickJSHandle, args: QuickJSHandle[] = [], timeoutMs = this.limits.callTimeoutMs): QuickJSHandle {
    return this.withDeadline(timeoutMs, () => {
      const result = this.context.callFunction(fn, this.context.undefined, args)
      if (result.error) {
        const info = this.describe(result.error)
        result.error.dispose()
        if (Sandbox.isFatal(info)) this.fatal = info
        throw new SandboxFailure(info)
      }
      return result.value
    })
  }

  describe(errorHandle: QuickJSHandle): SandboxError {
    try {
      const dumped = this.context.dump(errorHandle) as Record<string, unknown> | string
      if (dumped && typeof dumped === "object") {
        return {
          name: typeof dumped.name === "string" ? dumped.name : "Error",
          message: typeof dumped.message === "string" ? dumped.message : String(dumped),
          stack: typeof dumped.stack === "string" ? dumped.stack.slice(0, 2000) : undefined,
        }
      }
      return { name: "Error", message: String(dumped) }
    } catch {
      return { name: "Error", message: "unprintable sandbox exception" }
    }
  }

  static isFatal(error: SandboxError): boolean {
    return /out of memory|stack overflow|Maximum call stack/i.test(error.message)
  }

  static isTimeout(error: SandboxError): boolean {
    return /interrupted|timed out|deadline/i.test(error.message)
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.context.dispose()
    } catch {
      // ignore
    }
    try {
      this.runtime.dispose()
    } catch {
      // ignore
    }
  }
}
