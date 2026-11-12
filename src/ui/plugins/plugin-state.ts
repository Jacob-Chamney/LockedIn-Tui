/**
 * Host-owned state for sandboxed plugins.
 *
 * A plugin never sees a path or a file handle. It reads and writes a flat map
 * of primitives through `ctx.store`; this class loads it on mount and writes it
 * back atomically, one small JSON file per plugin. `ctx.session` is not here:
 * that lives inside the sandbox and resets when the worker reloads.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { effectDebug } from "./debug"

export type PluginStoreValue = string | number | boolean | null
export type PluginStoreData = Record<string, PluginStoreValue>

/** Enough for preferences and counters, small enough to stay out of the way. */
export const PLUGIN_STORE_MAX_BYTES = 16 * 1024

const KEY = /^[A-Za-z0-9._-]{1,64}$/
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function sanitizeStore(input: unknown): PluginStoreData {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {}
  const out: PluginStoreData = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!KEY.test(key)) continue
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      out[key] = value
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value
    }
  }
  return out
}

export function storeBytes(data: PluginStoreData): number {
  return Buffer.byteLength(JSON.stringify(data), "utf8")
}

export class PluginStateStore {
  private readonly root: string
  private readonly pending = new Map<string, { data: PluginStoreData; timer: ReturnType<typeof setTimeout> }>()

  constructor(root: string) {
    this.root = root
  }

  private file(id: string): string | null {
    return ID.test(id) ? join(this.root, `${id}.json`) : null
  }

  /** Missing or corrupt files are an empty store, never a failed plugin. */
  async load(id: string): Promise<PluginStoreData> {
    const file = this.file(id)
    if (!file) return {}
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown
      return sanitizeStore(parsed)
    } catch {
      return {}
    }
  }

  /** Write now. Returns the reason when the store is refused. */
  async save(id: string, data: PluginStoreData): Promise<{ ok: true } | { ok: false; message: string }> {
    const file = this.file(id)
    if (!file) return { ok: false, message: `invalid plugin id: ${id}` }
    const clean = sanitizeStore(data)
    if (storeBytes(clean) > PLUGIN_STORE_MAX_BYTES) {
      return { ok: false, message: `state exceeds ${PLUGIN_STORE_MAX_BYTES} bytes` }
    }
    try {
      await mkdir(this.root, { recursive: true })
      const temporary = `${file}.tmp-${process.pid}`
      await writeFile(temporary, `${JSON.stringify(clean, null, 2)}\n`, "utf8")
      await rename(temporary, file)
      return { ok: true }
    } catch (error) {
      effectDebug(`plugin state write failed: ${id}: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, message: "the plugin state could not be written" }
    }
  }

  /** Coalesce rapid writes (a command that sets several keys) into one save. */
  schedule(id: string, data: PluginStoreData, delay = 250): void {
    const previous = this.pending.get(id)
    if (previous) clearTimeout(previous.timer)
    const timer = setTimeout(() => {
      this.pending.delete(id)
      void this.save(id, data)
    }, delay)
    timer.unref?.()
    this.pending.set(id, { data, timer })
  }

  /** Flush every scheduled write; call before unloading hosts or quitting. */
  async flush(): Promise<void> {
    const entries = [...this.pending.entries()]
    this.pending.clear()
    for (const [id, entry] of entries) {
      clearTimeout(entry.timer)
      await this.save(id, entry.data)
    }
  }

  /** Remove a plugin's state; used when a plugin is uninstalled. */
  async remove(id: string): Promise<void> {
    const file = this.file(id)
    if (!file) return
    await rm(file, { force: true }).catch(() => {})
  }
}
