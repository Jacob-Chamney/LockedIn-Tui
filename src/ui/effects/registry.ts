/**
 * The set of particle systems the app runs.
 *
 * Systems are validated before they enter the registry, so a bad user file
 * reports its problems instead of half-loading. The registry is the seam the
 * sandboxed loader will target: same add/remove/list calls, different runtime.
 */
import { validateParticleSystem, type ParticleSystem, type SystemCheck } from "./api"

export type EffectEntry = {
  id: string
  system: ParticleSystem
  enabled: boolean
}

export class EffectRegistry {
  private entries = new Map<string, EffectEntry>()

  get size(): number {
    return this.entries.size
  }

  add(input: unknown): SystemCheck {
    const check = validateParticleSystem(input)
    if (!check.ok) return check
    const id = check.system.id
    if (this.entries.has(id)) {
      return { ok: false, errors: [`a system with id "${id}" is already registered`] }
    }
    this.entries.set(id, { id, system: check.system, enabled: true })
    return check
  }

  remove(id: string): boolean {
    return this.entries.delete(id)
  }

  get(id: string): EffectEntry | undefined {
    return this.entries.get(id)
  }

  list(): EffectEntry[] {
    return [...this.entries.values()]
  }

  enabled(): EffectEntry[] {
    return this.list().filter((entry) => entry.enabled)
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    entry.enabled = enabled
    return true
  }

  clear(): void {
    this.entries.clear()
  }
}
