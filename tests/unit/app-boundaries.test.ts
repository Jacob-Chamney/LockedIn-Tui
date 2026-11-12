/** The slim app layer's pure helpers: buffer wiring and settings patches. */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { chatModeFor, chatPathFor, HOME_BUFFER, scopeForBuffer, type WorkBuffer } from "../../src/app/buffers"
import { applyViewPatch, nestedPatch } from "../../src/app/settings-patch"
import { emptySettingsView } from "../../src/ui/settings"

const workspace = {
  paths: {
    goals: join("/w", "skills", "goals"),
    schoolSessions: join("/w", "school", "sessions"),
    workProjects: join("/w", "work", "projects"),
  },
} as never

const buffer = (overrides: Partial<WorkBuffer>): WorkBuffer => ({ ...HOME_BUFFER, ...overrides })

describe("buffer wiring", () => {
  test("each buffer gets its own chat file", () => {
    expect(chatPathFor(HOME_BUFFER, workspace)).toBeNull()
    expect(chatPathFor(buffer({ id: "skill:cpp", kind: "skill", courseId: "cpp" }), workspace)).toBe(
      join("/w", "skills", "goals", "cpp", "chats", "chat-1.jsonl"),
    )
    expect(chatPathFor(buffer({ id: "session:s1", kind: "session" }), workspace)).toBe(
      join("/w", "school", "sessions", "s1", "chat.jsonl"),
    )
    expect(chatPathFor(buffer({ id: "project:p1", kind: "project", projectId: "p1" }), workspace)).toBe(
      join("/w", "work", "projects", "p1", "chat.jsonl"),
    )
    expect(
      chatPathFor(buffer({ id: "agent:a1", kind: "agent", projectId: "p1", agentId: "a1" }), workspace),
    ).toBe(join("/w", "work", "projects", "p1", "agents", "a1", "chat.jsonl"))
  })

  test("scope and mode follow the buffer side, not the app default", () => {
    expect(scopeForBuffer(buffer({ kind: "session" }), "work")).toBe("school")
    expect(scopeForBuffer(buffer({ kind: "skill" }), "work")).toBe("skills")
    expect(scopeForBuffer(buffer({ kind: "agent" }), "school")).toBe("work")
    expect(scopeForBuffer(HOME_BUFFER, "skills")).toBe("skills")
    expect(chatModeFor(buffer({ kind: "session" }))).toBe("lockin")
    expect(chatModeFor(buffer({ kind: "skill" }))).toBe("skill")
    expect(chatModeFor(buffer({ kind: "project" }))).toBe("work")
    expect(chatModeFor(HOME_BUFFER)).toBe("chill")
  })
})

describe("settings patches", () => {
  test("dotted keys nest for config.toml and apply to the view", () => {
    const patch = { "models.chat": "opencode-go/kimi-k3", "usage.budget": 12 }
    expect(nestedPatch(patch)).toEqual({ models: { chat: "opencode-go/kimi-k3" }, usage: { budget: 12 } })
    const view = applyViewPatch(emptySettingsView(), patch)
    expect(view.chatModel).toBe("opencode-go/kimi-k3")
    expect(view.budgetUsd).toBe(12)
    expect(view.username).toBe("")
  })
})
