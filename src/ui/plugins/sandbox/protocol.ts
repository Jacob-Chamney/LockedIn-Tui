/**
 * Wire types for the effect sandbox worker.
 *
 * Only plain data crosses the thread boundary: no host objects, no handles.
 */
import type { ParticleEvent, ParticleSystem } from "../api"
import type { TextLayer } from "../paint"
import type { SandboxLimits } from "./limits"
import type { PluginManifest } from "./manifest"
import type { SceneState } from "../scene/model"
import type { PluginStoreData } from "../plugin-state"

export type WireParticle = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  seed: number
  glyph: string
  /** A palette role or `#rrggbb`; the main thread resolves it. */
  color: string
  alpha: number
  layer?: TextLayer
}

export type LoadMessage = {
  type: "load"
  bundle: string
  manifest: PluginManifest
  limits: SandboxLimits
  /** Persistent plugin state loaded by the host. */
  store?: PluginStoreData
}

export type FrameInput = {
  dt: number
  cursor: { x: number; y: number }
  width: number
  height: number
  events: ParticleEvent[]
}

export type ComposeInput = {
  state: SceneState
  /** Host clock in seconds; the plugin never reads wall time. */
  time: number
  /** Seconds since the previous compose, for frame-rate-independent animation. */
  dt: number
  /** Palette roles as hex strings, for theme-matching colour. */
  palette?: Record<string, string>
}

export type WorkerIn =
  | LoadMessage
  | { type: "frame"; input: FrameInput }
  | { type: "compose"; input: ComposeInput }
  | { type: "command"; id: string; input: unknown }
  | { type: "dispose" }

export type WorkerOut =
  | {
      type: "ready"
      layer: TextLayer
      description: Partial<ParticleSystem>
      hasParticles: boolean
      hasCompose: boolean
      fps: number
      commandIds: string[]
    }
  | { type: "frame"; particles: WireParticle[]; count: number; failed: boolean; error: string | null; store?: PluginStoreData }
  | { type: "scene"; nodes: unknown[]; failed: boolean; error: string | null; store?: PluginStoreData }
  | {
      type: "command"
      id: string
      ok: boolean
      message?: string
      /** Text the host may place on the clipboard, if granted. */
      copy?: string
      failed: boolean
      error: string | null
      store?: PluginStoreData
    }
  | { type: "bye"; store?: PluginStoreData }
  | { type: "error"; phase: "load" | "frame"; message: string }
