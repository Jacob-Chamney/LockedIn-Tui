/**
 * Worker entry for one sandboxed effect.
 *
 * The Worker is the availability boundary: a plugin that spins or exhausts its
 * QuickJS heap only blocks this thread, and the host can terminate it. QuickJS
 * remains the security boundary — the worker has no host objects either way.
 */
import { SandboxedPlugin } from "./plugin"
import type { FrameInput, WireParticle, WorkerIn, WorkerOut } from "./protocol"

let effect: SandboxedPlugin | null = null

/** Bun's worker scope; the DOM typings do not describe a dedicated worker. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerIn>) => void) | null
  postMessage: (value: WorkerOut) => void
  close?: () => void
}

function post(message: WorkerOut): void {
  scope.postMessage(message)
}

function serialise(): WireParticle[] {
  if (!effect) return []
  return effect.particles().map((particle) => ({
    x: particle.x,
    y: particle.y,
    vx: particle.vx,
    vy: particle.vy,
    age: particle.age,
    life: particle.life,
    seed: particle.seed,
    glyph: particle.glyph,
    color: particle.color,
    alpha: particle.alpha,
    layer: particle.layer,
  }))
}

scope.onmessage = async (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  if (message.type === "dispose") {
    if (effect) {
      effect.deactivate()
      post({ type: "bye", store: effect.takeStoreChanges() ?? undefined })
      effect.dispose()
      effect = null
    } else {
      post({ type: "bye" })
    }
    scope.close?.()
    return
  }
  if (message.type === "load") {
    try {
      effect?.dispose()
      effect = await SandboxedPlugin.create(
        message.bundle,
        message.manifest,
        message.limits,
        message.store ?? {},
      )
      post({
        type: "ready",
        layer: effect.layer,
        description: effect.description,
        hasParticles: effect.hasParticles,
        hasCompose: effect.hasCompose,
        fps: effect.fps,
        commandIds: effect.commandIds,
      })
    } catch (error) {
      post({
        type: "error",
        phase: "load",
        message: String(error instanceof Error ? error.message : error).slice(0, 300),
      })
    }
    return
  }
  if (message.type === "command") {
    if (!effect) return
    const result = effect.runCommand(message.id, message.input)
    post({
      type: "command",
      id: message.id,
      ok: result.ok,
      message: result.message,
      level: result.level,
      copy: result.copy,
      failed: effect.failed,
      error: effect.lastError,
      store: effect.takeStoreChanges() ?? undefined,
    })
    return
  }
  if (message.type === "compose") {
    if (!effect) return
    const result = effect.compose(message.input) as { nodes?: unknown }
    post({
      type: "scene",
      nodes: Array.isArray(result?.nodes) ? result.nodes : [],
      failed: effect.failed,
      error: effect.lastError,
      store: effect.takeStoreChanges() ?? undefined,
    })
    return
  }
  if (message.type === "frame") {
    if (!effect) return
    const input: FrameInput = message.input
    effect.resize(input.width, input.height)
    effect.setCursor(input.cursor.x, input.cursor.y)
    for (const event of input.events) effect.event(event)
    effect.update(input.dt)
    post({
      type: "frame",
      particles: serialise(),
      count: effect.particleCount,
      failed: effect.failed,
      error: effect.lastError,
      store: effect.takeStoreChanges() ?? undefined,
    })
  }
}
