/** WP-702 — models and providers settings. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { testRender } = await import("@opentui/solid")
const models = await import("../../src/ui/settings/models")
const { listFirstClassProviders } = await import("../../src/llm/catalogue")
const { crimson } = await import("../../src/ui/theme")

type State = import("../../src/ui/settings/models").ModelsState
type Row = import("../../src/ui/settings/models").ProviderRow

const rows = (): Row[] =>
  listFirstClassProviders().map((spec) => ({ spec, linked: false, validation: { kind: "never" } }))
const state = (overrides: Partial<State> = {}): State => ({ ...models.initialModels(rows()), ...overrides })

async function mount(width: number, height: number, value = state(), cursor = 0) {
  const setup = await testRender(
    () => <models.ModelsPanel theme={crimson} width={width} height={height} focused state={value} cursor={cursor} />,
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("provider list", () => {
  test("every provider starts not linked and not validated", async () => {
    const setup = await mount(120, 30)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("not linked")
      expect(frame).toContain("not validated")
      expect(frame).not.toContain("ok ·")
      expect(frame).toContain("no provider linked yet")
    } finally {
      await setup.dispose()
    }
  })

  test("a failed validation shows the mapped copy and stays not linked", () => {
    const failed = models.afterFailure(
      state(),
      listFirstClassProviders()[0]!.id,
      { kind: "auth", provider: listFirstClassProviders()[0]!.id, message: "bad" },
      "2026-11-01T14:00:00Z",
    )
    const row = failed.rows[0]!
    expect(row.linked).toBe(false)
    expect(models.validationLine(row)).toContain("rejected this key")
  })

  test("each validation error maps to one sentence", () => {
    expect(models.errorCopy({ kind: "rate-limit", provider: "p" })).toContain("rate limited")
    expect(models.errorCopy({ kind: "network", message: "" })).toContain("network is unreachable")
    expect(models.errorCopy({ kind: "provider", provider: "p", status: 500, message: "" })).toContain("500")
    expect(models.errorCopy({ kind: "keychain", provider: "p", message: "", hint: "no keyring" })).toBe("no keyring")
  })
})

describe("key entry", () => {
  test("the field is masked and a malformed key is refused locally", async () => {
    const editing = { ...state(), editing: listFirstClassProviders()[0]!.id, keyDraft: "sk-live-123" }
    const setup = await mount(120, 30, editing)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("•")
      expect(frame).not.toContain("sk-live-123")
    } finally {
      await setup.dispose()
    }
    expect(models.masked("abc")).toBe("•••")

    const bad = models.submitKey({ ...state(), keyDraft: "has space" }, rows()[0]!)
    expect(bad.kind).toBe("refused")
  })

  test("a good key is submitted for validation and never carried in config", () => {
    const spec = listFirstClassProviders().find((s) => s.id === "openai")!
    // Use the provider's own documented example shape so the local check passes.
    const sample = spec.keyFormat!.example
    const submit = models.submitKey({ ...state(), keyDraft: sample }, { spec, linked: false, validation: { kind: "never" } })
    expect(submit.kind).toBe("validate")
    if (submit.kind !== "validate") throw new Error("expected validate")
    expect(submit.provider).toBe(spec.id)
  })

  test("checking state has a cancel path", () => {
    const row: Row = { spec: rows()[0]!.spec, linked: false, validation: { kind: "checking", startedAt: "x" } }
    expect(models.validationLine(row)).toBe("checking… · Esc cancel")
  })
})

describe("linking", () => {
  test("success links the provider and selects no model", () => {
    const provider = rows()[0]!.spec.id
    const next = models.afterLink(state(), provider, ["m-1", "m-2"], "2026-11-01T14:00:00Z")
    expect(next.rows[0]!.linked).toBe(true)
    expect(models.validationLine(next.rows[0]!)).toContain("2 models")
    expect(models.modelLabel(next, "chat")).toBe("choose a model")
    expect(models.modelLabel(next, "generation")).toBe("choose a model")
  })

  test("a model outside the validated list is refused by name", () => {
    const provider = rows()[0]!.spec.id
    const linked = models.afterLink(state(), provider, ["good-model"], "t")
    const refused = models.chooseModel(linked, "chat", `${provider}/other-model`)
    expect(refused).not.toHaveProperty("chatModel")
    if (!("kind" in refused)) throw new Error("expected a refusal")
    expect(refused.reason).toContain("other-model")

    const chosen = models.chooseModel(linked, "chat", `${provider}/good-model`)
    if ("kind" in chosen) throw new Error("expected a state")
    expect(models.modelLabel(chosen, "chat")).toBe(`${provider}/good-model`)
    expect(models.modelLabel(chosen, "generation")).toBe("choose a model")
  })
})

describe("unlink", () => {
  test("asks first, naming the provider, and declining changes nothing", () => {
    const armed = models.armUnlink(state(), rows()[0]!.spec.id)
    expect(armed.pendingUnlink?.label).toBe(rows()[0]!.spec.label)
    expect(models.unlinkCopy(armed.pendingUnlink!.label)).toContain("press u again")
    expect(models.confirmUnlink(state()).kind).toBe("refused")
  })

  test("unlink clears a selection that pointed at that provider", () => {
    const provider = rows()[0]!.spec.id
    const linked = models.afterLink(state(), provider, ["m"], "t")
    const withModel = models.chooseModel(linked, "chat", `${provider}/m`)
    if ("kind" in withModel) throw new Error("expected a state")
    const outcome = models.confirmUnlink(models.armUnlink(withModel, provider))
    expect(outcome).toEqual({ kind: "call", provider, clears: ["chat"] })

    const after = models.afterUnlink(models.armUnlink(withModel, provider), provider)
    expect(models.modelLabel(after, "chat")).toBe("choose a model")
    expect(after.rows[0]!.linked).toBe(false)
  })
})

describe("custom endpoint", () => {
  test("a loopback base url renders local, free", async () => {
    expect(models.isLocalFree("http://localhost:11434/v1")).toBe(true)
    expect(models.baseUrlLine("http://127.0.0.1:1234/v1")).toContain("local, free")
    const setup = await mount(120, 30, { ...state(), baseUrl: "http://localhost:11434/v1" })
    try {
      expect(lines(setup).join("\n")).toContain("local, free")
    } finally {
      await setup.dispose()
    }
  })

  test("an invalid base url is refused", () => {
    expect(models.validBaseUrl("not a url").ok).toBe(false)
    expect(models.validBaseUrl("ftp://x").ok).toBe(false)
    expect(models.validBaseUrl("https://api.example.com/v1").ok).toBe(true)
    expect(models.validBaseUrl("http://localhost:11434/v1").ok).toBe(true)
    expect(models.validBaseUrl("http://api.example.com/v1").ok).toBe(false)
  })
})

describe("layout and keys", () => {
  test("80x24 stacks without clipping", async () => {
    const setup = await mount(80, 24)
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      expect(out.join("\n")).toContain("chat model")
      expect(out.join("\n")).toContain("generation model")
    } finally {
      await setup.dispose()
    }
  })

  test("keys come from one table and the source never reads a key value", () => {
    expect(models.intentFor("return")).toBe("edit")
    expect(models.intentFor("return", { ctrl: true })).toBe("commit")
    expect(models.intentFor("u")).toBe("unlink")
    expect(models.footerHints()).toContain("u unlink")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/settings/models.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(/)
    expect(source).not.toContain("src/security")
  })
})

describe("the model picker screen", () => {
  test("the active provider and model are identified", () => {
    const screen = models.initialModelsScreen({
      chatModel: "opencode-go/kimi-k3",
      view: "models",
    })
    const linked = models.afterProviderLink(
      { ...screen, data: { ...screen.data, editing: "opencode-go" } },
      ["glm-5.3", "kimi-k3"],
      "t",
    )
    expect(models.activeProviderOf(linked)).toBe("opencode-go")
    expect(models.focusSelectedModel(linked).modelCursor).toBe(1)
    expect(models.activeProviderOf(models.initialModelsScreen())).toBeNull()
  })

  test("a linked key's returned models become the picker, then a full id is chosen", () => {
    const screen = models.initialModelsScreen()
    const open = models.beginProviderLink(screen)
    expect(open.data.editing).toBe("openai")

    const spec = listFirstClassProviders().find((entry) => entry.id === "openai")!
    const filled = { ...open, data: { ...open.data, keyDraft: spec.keyFormat!.example } }
    const request = models.linkRequest(filled)
    expect(request.kind).toBe("validate")
    if (request.kind !== "validate") throw new Error("expected validate")
    expect(request.providerId).toBe("openai")

    const linked = models.afterProviderLink(filled, ["gpt-4.1-mini", "gpt-4.1"], "2026-11-01T14:00:00Z")
    expect(linked.view).toBe("models")
    expect(linked.provider).toBe("openai")
    expect(models.screenModelIds(linked)).toEqual(["openai/gpt-4.1-mini", "openai/gpt-4.1"])

    const choice = models.chooseScreenModel(linked, 0)
    expect(choice.kind).toBe("chosen")
    if (choice.kind !== "chosen") throw new Error("expected a choice")
    expect(choice.model).toBe("openai/gpt-4.1-mini")
    expect(choice.screen.data.chatModel).toBe("openai/gpt-4.1-mini")

    const generation = models.chooseScreenModel({ ...linked, target: "generation" }, 1)
    expect(generation.kind).toBe("chosen")
    if (generation.kind !== "chosen") throw new Error("expected a choice")
    expect(generation.screen.data.generationModel).toBe("openai/gpt-4.1")
    expect(generation.screen.data.chatModel).toBe("")
  })

  test("the model view renders the provider's list and never the key", async () => {
    const screen = models.initialModelsScreen()
    const open = models.beginProviderLink(screen)
    const linked = models.afterProviderLink(
      { ...open, data: { ...open.data, keyDraft: "sk-live-secret-value" } },
      ["gpt-4.1-mini", "gpt-4.1"],
      "t",
    )
    const setup = await testRender(
      () => <models.ModelsScreenPanel theme={crimson} width={90} height={24} focused screen={linked} />,
      { width: 90, height: 24 },
    )
    try {
      await setup.flush()
      await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      const frame = lines(setup).join("\n")
      expect(frame).toContain("openai/gpt-4.1-mini")
      expect(frame).toContain("openai/gpt-4.1")
      expect(frame).not.toContain("sk-live-secret-value")
    } finally {
      await setup.dispose()
    }
  })

  test("a custom endpoint needs a base url before the key is sent", () => {
    const custom = models.initialModelsScreen()
    const at = custom.data.rows.findIndex((row) => row.spec.id === "custom")
    const selected = { ...custom, cursor: at }
    const open = models.beginProviderLink(selected)
    const request = models.linkRequest({ ...open, data: { ...open.data, keyDraft: "local-placeholder" } })
    expect(request.kind).toBe("refused")
    if (request.kind !== "refused") throw new Error("expected a refusal")
    expect(request.reason).toContain("base URL")
  })
})
