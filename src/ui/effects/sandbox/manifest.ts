/**
 * Capability manifest for a sandboxed effect.
 *
 * The manifest is data, not code. The host validates it, then clamps the effect
 * to exactly these numbers and layers, whatever the effect asks for.
 */
import type { ParticleSpawnTrigger, ParticleSystem } from "../api"
import type { TextLayer } from "../paint"
import { PARTICLE_LIMITS } from "../api"
import { parseBinding } from "../../keymap/registry"
import { SCENE_ANCHORS, SCENE_STATE_FIELDS, type SceneAnchor, type SceneStateField } from "../scene/model"

export type ParticlePermission = {
  /** Hard cap on live particles. */
  maxParticles: number
  /** Text layers the effect may use. */
  layers: TextLayer[]
  /** Events that may trigger a spawn burst. */
  triggers: ParticleSpawnTrigger[]
  /** Hard cap on ambient emission, per second. */
  spawnRate: number
  /** Hard cap on one event burst. */
  spawnBurst: number
}

export type ScenePermission = {
  /** Anchors the plugin may place nodes at. */
  anchors: SceneAnchor[]
  /** Exact cell placement. A separate grant from anchors. */
  absolute?: boolean
  /** Highest compose rate the plugin may request, 1-60. Default 4. */
  fps?: number
  /** Hard cap on nodes per compose call. */
  maxNodes: number
  /** Hard cap on total text characters per compose call. */
  maxText: number
}

export type PointerPermission = {
  /** Command to run on a left click inside a window. */
  click?: string
  /** Command to run when the hovered window/row/cell changes. */
  hover?: string
  /** Command to run on a mouse-wheel event. */
  wheel?: string
  /** Drag lifecycle: button down, movement while held, button up. */
  press?: string
  move?: string
  release?: string
}

export type CommandPermission = {
  /** Command palette name and the id the plugin exports. */
  id: string
  title: string
  /** Optional chord, in the keymap registry notation. */
  keys?: string
}

export type EffectManifest = {
  manifestVersion: 1
  /** Stable id; must match the exported system id. */
  id: string
  name: string
  version: string
  apiVersion: "1.0"
  /** Entry file relative to the plugin directory. */
  entry: string
  permissions: {
    particles?: ParticlePermission
    scene?: ScenePermission
    /** Read-only app state fields the plugin may receive. */
    state?: SceneStateField[]
    /** Commands the plugin may expose; `keys` also lists them in help. */
    commands?: CommandPermission[]
    /** Allow commands to copy text to the system clipboard. */
    clipboard?: boolean
    /** Route click/hover targets to granted commands. */
    pointer?: PointerPermission
  }
}

export type ManifestCheck =
  | { ok: true; manifest: EffectManifest }
  | { ok: false; errors: string[] }

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ACTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const VERSION = /^\d+\.\d+\.\d+$/
const LAYERS: readonly TextLayer[] = ["around", "under", "over"]
const TRIGGERS: readonly ParticleSpawnTrigger[] = ["cursor-move", "keypress", "send"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function integerIn(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

export function parseManifest(input: unknown): ManifestCheck {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ["manifest must be an object"] }

  if (input.manifestVersion !== 1) errors.push("manifestVersion must be 1")
  if (typeof input.id !== "string" || !ID.test(input.id)) {
    errors.push("id must be 1-64 characters: lowercase letters, digits, dot, dash or underscore")
  }
  if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 80) {
    errors.push("name must be a non-empty string of at most 80 characters")
  }
  if (typeof input.version !== "string" || !VERSION.test(input.version)) {
    errors.push("version must look like 1.0.0")
  }
  if (input.apiVersion !== "1.0") errors.push('apiVersion must be "1.0"')

  const entry = input.entry
  if (
    typeof entry !== "string" ||
    entry.length === 0 ||
    entry.length > 200 ||
    entry.startsWith("/") ||
    entry.includes("..") ||
    entry.includes("\\") ||
    !/\.(ts|js|mjs)$/.test(entry)
  ) {
    errors.push("entry must be a relative .ts/.js path inside the plugin directory")
  }

  const permissions = input.permissions
  if (!isRecord(permissions)) {
    errors.push("permissions is required")
  } else {
    if (
      permissions.particles === undefined &&
      permissions.scene === undefined &&
      permissions.commands === undefined
    ) {
      errors.push("grant at least one of permissions.particles, permissions.scene or permissions.commands")
    }
    if (permissions.particles !== undefined) {
      if (!isRecord(permissions.particles)) {
        errors.push("permissions.particles must be an object")
      } else {
        const particles = permissions.particles
        if (!integerIn(particles.maxParticles, 1, PARTICLE_LIMITS.maxParticles)) {
          errors.push(`permissions.particles.maxParticles must be an integer from 1 to ${PARTICLE_LIMITS.maxParticles}`)
        }
        if (!Array.isArray(particles.layers) || particles.layers.length === 0) {
          errors.push("permissions.particles.layers must list at least one layer")
        } else {
          for (const layer of particles.layers) {
            if (!LAYERS.includes(layer as TextLayer)) errors.push(`unknown layer: ${String(layer)}`)
          }
        }
        if (!Array.isArray(particles.triggers)) {
          errors.push("permissions.particles.triggers must be an array")
        } else {
          for (const trigger of particles.triggers) {
            if (!TRIGGERS.includes(trigger as ParticleSpawnTrigger)) errors.push(`unknown trigger: ${String(trigger)}`)
          }
        }
        if (typeof particles.spawnRate !== "number" || !Number.isFinite(particles.spawnRate) || particles.spawnRate < 0 || particles.spawnRate > PARTICLE_LIMITS.spawnRate) {
          errors.push(`permissions.particles.spawnRate must be from 0 to ${PARTICLE_LIMITS.spawnRate}`)
        }
        if (!integerIn(particles.spawnBurst, 0, PARTICLE_LIMITS.spawnBurst)) {
          errors.push(`permissions.particles.spawnBurst must be an integer from 0 to ${PARTICLE_LIMITS.spawnBurst}`)
        }
      }
    }
    if (permissions.scene !== undefined) {
      if (!isRecord(permissions.scene)) {
        errors.push("permissions.scene must be an object")
      } else {
        const scene = permissions.scene
        if (!Array.isArray(scene.anchors) || scene.anchors.length === 0) {
          errors.push("permissions.scene.anchors must list at least one anchor")
        } else {
          for (const anchor of scene.anchors) {
            if (!SCENE_ANCHORS.includes(anchor as SceneAnchor)) errors.push(`unknown anchor: ${String(anchor)}`)
          }
        }
        if (!integerIn(scene.maxNodes, 1, 64)) {
          errors.push("permissions.scene.maxNodes must be an integer from 1 to 64")
        }
        if (!integerIn(scene.maxText, 1, 4096)) {
          errors.push("permissions.scene.maxText must be an integer from 1 to 4096")
        }
        if (scene.absolute !== undefined && typeof scene.absolute !== "boolean") {
          errors.push("permissions.scene.absolute must be a boolean")
        }
        if (scene.fps !== undefined && !integerIn(scene.fps, 1, 60)) {
          errors.push("permissions.scene.fps must be an integer from 1 to 60")
        }
      }
    }
    if (permissions.clipboard !== undefined && typeof permissions.clipboard !== "boolean") {
      errors.push("permissions.clipboard must be a boolean")
    }
    const grantedCommands = new Set<string>()
    if (permissions.commands !== undefined) {
      if (!Array.isArray(permissions.commands)) {
        errors.push("permissions.commands must be an array")
      } else {
        if (permissions.commands.length > 16) errors.push("permissions.commands may list at most 16 commands")
        const seen = new Set<string>()
        for (const command of permissions.commands) {
          if (!isRecord(command)) {
            errors.push("each command must be an object")
            continue
          }
          if (typeof command.id !== "string" || !ACTION_ID.test(command.id)) {
            errors.push(`command id ${String(command.id)} must be lowercase kebab-case`)
          } else if (seen.has(command.id)) {
            errors.push(`duplicate command id: ${command.id}`)
          } else {
            seen.add(command.id)
            grantedCommands.add(command.id)
          }
          if (typeof command.title !== "string" || command.title.trim() === "" || command.title.length > 80) {
            errors.push(`command ${String(command.id)} needs a title of at most 80 characters`)
          }
          if (command.keys !== undefined) {
            if (typeof command.keys !== "string") {
              errors.push(`command ${String(command.id)} keys must be a string`)
            } else {
              const binding = parseBinding(command.keys)
              if ("reason" in binding) errors.push(`command ${String(command.id)}: ${binding.message}`)
            }
          }
        }
      }
    }
    if (permissions.pointer !== undefined) {
      if (!isRecord(permissions.pointer)) {
        errors.push("permissions.pointer must be an object")
      } else {
        if (
          permissions.pointer.click === undefined &&
          permissions.pointer.hover === undefined &&
          permissions.pointer.wheel === undefined &&
          permissions.pointer.press === undefined &&
          permissions.pointer.move === undefined &&
          permissions.pointer.release === undefined
        ) {
          errors.push("permissions.pointer needs at least one event")
        }
        for (const event of ["click", "hover", "wheel", "press", "move", "release"] as const) {
          const command = permissions.pointer[event]
          if (command === undefined) continue
          if (typeof command !== "string" || !ACTION_ID.test(command)) {
            errors.push(`permissions.pointer.${event} must be a command id`)
          } else if (!grantedCommands.has(command)) {
            errors.push(`permissions.pointer.${event} must reference a granted command`)
          }
        }
      }
    }
    if (permissions.state !== undefined) {
      if (!Array.isArray(permissions.state)) {
        errors.push("permissions.state must be an array")
      } else {
        for (const field of permissions.state) {
          if (!SCENE_STATE_FIELDS.includes(field as SceneStateField)) {
            errors.push(`unknown state field: ${String(field)}`)
          }
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, manifest: input as unknown as EffectManifest }
}

/** What the effect declared about itself inside the sandbox. */
export type SystemDescription = Pick<
  ParticleSystem,
  "id" | "maxParticles" | "textLayer" | "spawnRate" | "spawnOn" | "spawnBurst"
> & {
  name?: string
  hasParticles?: boolean
  hasCompose?: boolean
  fps?: number
  commandIds?: string[]
}

/**
 * Capability escalation is rejected; resource values are clamped by the host.
 *
 * A granted layer or trigger is a permission, so asking for one the manifest
 * does not grant fails the load. Counts and rates are only sizes: the tool
 * keeps them as small as the manifest allows.
 */
export function checkSystemAgainstManifest(
  manifest: EffectManifest,
  system: SystemDescription,
): string[] {
  const errors: string[] = []
  if (system.name !== undefined && (typeof system.name !== "string" || system.name.length > 80)) {
    errors.push("name must be a string of at most 80 characters")
  }
  if (system.id !== manifest.id) {
    errors.push(`effect id "${String(system.id)}" does not match manifest id "${manifest.id}"`)
  }
  if (system.hasCompose && !manifest.permissions.scene) {
    errors.push("compose() requires permissions.scene")
  }
  if (system.hasParticles && !manifest.permissions.particles) {
    errors.push("particle hooks require permissions.particles")
  }
  const granted = new Set((manifest.permissions.commands ?? []).map((command) => command.id))
  for (const id of system.commandIds ?? []) {
    if (!granted.has(id)) errors.push(`command "${id}" is not granted by the manifest`)
  }
  const limit = manifest.permissions.particles
  if (limit) {
    if (system.textLayer !== undefined && !limit.layers.includes(system.textLayer)) {
      errors.push(`textLayer "${system.textLayer}" is not granted by the manifest`)
    }
    for (const trigger of system.spawnOn ?? []) {
      if (!limit.triggers.includes(trigger)) {
        errors.push(`trigger "${trigger}" is not granted by the manifest`)
      }
    }
  }
  return errors
}
