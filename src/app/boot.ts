/**
 * Composition root.
 *
 * `src/index.tsx` used to render `<App />` with no workspace, no config and no
 * services, so nothing behind the UI existed outside tests. This module turns a
 * directory into a working app: it opens or creates the workspace, loads config,
 * seeds the spend counters from `usage.json`, builds the budget gate, the chill
 * history port and the chat controller.
 *
 * Two rules shape it:
 * - **boot never fails because the user has not linked a provider.** A missing
 *   model boots and the controller reports its documented blocked state.
 * - **boot reads no secret.** The provider glue lives in `src/llm/**` and is not
 *   this packet's to write, so `createService` is an injected seam; it receives a
 *   `readKey` capability and decides whether to use it. Without it, chat reports
 *   one actionable line instead of pretending to be configured.
 */

import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { createProviderService } from "../llm/provider";
import type { ArchiveBackend, ArchiveError } from "../archive/types";
import { basename, dirname, join } from "node:path";
import { err, ok, type Result } from "../domain/markdown";
import { createBudgetGate, periodKey, type BudgetConfig, type BudgetGate, type BudgetPeriod } from "../llm/budget";
import type { ChatService } from "../llm/chat";
import { getProvider, listProviders } from "../llm/catalogue";
import { linkProviderKey, validateKeyOnce, type LinkOutcome, type LlmResult } from "../llm/validate";
import { runRecord, spentFromUsage, type RunScope, type UsageStore, createUsageStore } from "../llm/usage";
import { estimateCostMicroUsd, priceFor } from "../llm/pricing";
import { ZERO_USAGE, type Usage } from "../llm/events";
import { createChatController, type ChatController, type HistoryPort, type HistoryRecord, type ToolContext } from "./chat-controller";
import { createPluginRuntime, type PluginRuntime } from "./actions/plugins";
import { coreServersFor } from "../plugins/policy";
import { loadConfig } from "../storage/config";
import { defaultWorkspaceRoot, workspacePaths } from "../storage/paths";
import { createWorkspace, openWorkspace, type Workspace, type WorkspaceError } from "../storage/workspace";
import type { Config } from "../storage/config-schema";
import type { SettingsView } from "../ui/settings";
/** File the chill history lives in, inside the data directory. */
export const CHILL_HISTORY_FILE = "chill.json"

export type BootFailure = {
  kind: "boot"
  /** The workspace path the user must look at. */
  path: string
  message: string
  /** One actionable sentence; never "see logs". */
  next: string
}

export type BootServiceContext = {
  providerId: string
  model: string
  baseUrl: string
  /** Reads the provider key from the keychain. Only the factory may call it. */
  readKey: (ref: string) => Promise<string | null>
}

export type BootOptions = {
  /** Overrides `LOCKEDIN_WORKSPACE`; defaults to the platform location. */
  workspaceRoot?: string
  /** Overrides the workspace's data directory (tests use a temp dir). */
  dataDir?: string
  env?: Record<string, string | undefined>
  /** Injectable clock: everything time-dependent in boot goes through it. */
  now?: () => Date
  /**
   * Builds the chat service from config. Defaults to the real provider glue
   * (`createProviderService`); tests inject a fake here.
   */
  createService?: (context: BootServiceContext) => ChatService | null | Promise<ChatService | null>
  /** Keychain reader handed to `createService`; never called by boot itself. */
  readKey?: (ref: string) => Promise<string | null>
  onUsageError?: (message: string) => void
  scope?: RunScope
}

export type Booted = {
  workspace: Workspace
  config: Config
  controller: ChatController
  usageStore: UsageStore
  history: HistoryPort
  budget: BudgetGate
  /** Micro-USD already spent this period, seeded from `usage.json`. */
  spentMicroUsd: number
  /** Non-fatal notes for the task centre; boot succeeded regardless. */
  diagnostics: string[]
  /** Scope every run from this app is attributed to. */
  scope: RunScope
  /** The loaded configuration, as the settings pane reads it. */
  settings: SettingsView
  /** Apply a saved config to the live gate, limits and service. */
  updateConfig: (next: Config) => Promise<void>
  /**
   * Validate and store a provider key, returning the models that key can see.
   * The key reaches only the keychain; it is never written to config.
   */
  linkProvider: (input: {
    providerId: string
    key: string
    baseUrl?: string
  }) => Promise<LlmResult<LinkOutcome>>
  /**
   * Fetch models for a provider that already has a key in the keychain, without
   * asking the user to paste it again.
   */
  modelsForProvider: (providerId: string) => Promise<LlmResult<LinkOutcome>>
  /** Providers whose key is already in the OS keychain (or a keyless custom endpoint). */
  linkedProviders: () => Promise<string[]>
  /**
   * A controller for one buffer's own history. The service, budget and config
   * are shared; the transcript is not.
   */
  createChat: (
    history: HistoryPort,
    scope?: RunScope,
    mode?: import("../llm/chat").ChatMode,
    context?: (context: ToolContext) => Promise<string>,
    tools?: import("./actions/projects").ChatToolSource,
  ) => ChatController
  /** The GitHub archive backend, built on demand; config and consent gate it. */
  createGithubArchive?: () => Promise<import("../domain/markdown").Result<ArchiveBackend, ArchiveError>>
  /** Configured MCP servers, started lazily in the background. */
  pluginRuntime: PluginRuntime
  /**
   * One non-streaming completion, for the skill-plan generator. Absent when no
   * model is configured: a caller must fall back rather than hammer a service
   * that cannot answer.
   */
  generate?: (prompt: string) => Promise<string>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One spend total for every buffer, reset when the budget period rolls over. */
function createSpendCounter(seed: number, now: () => Date, period: () => BudgetPeriod) {
  let key = periodKey(now(), period())
  let total = seed
  const roll = () => {
    const next = periodKey(now(), period())
    if (next === key) return
    key = next
    total = 0
  }
  return {
    total: () => {
      roll()
      return total
    },
    add: (microUsd: number) => {
      roll()
      total += microUsd
    },
  }
}

/** Turn a workspace refusal into one boot failure without losing its copy. */
export function bootFailureFrom(error: WorkspaceError, fallback: string): BootFailure {
  return {
    kind: "boot",
    path: "path" in error && typeof error.path === "string" ? error.path : fallback,
    message: error.message,
    next: "next" in error && typeof error.next === "string" ? error.next : "Choose a different folder.",
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * The chill history, on disk as text records only.
 *
 * No reasoning, no tool output, no attachments: the file is a transcript the
 * user can read, and `ui.chill_history_limit` bounds it (zero keeps nothing).
 */
export function createHistoryPort(options: {
  dataDir: string
  limit: number
}): HistoryPort {
  const path = join(options.dataDir, CHILL_HISTORY_FILE)

  return {
    async load() {
      let raw: string
      try {
        raw = await readFile(path, "utf8")
      } catch {
        return []
      }
      try {
        const parsed = JSON.parse(raw) as { messages?: HistoryRecord[] }
        return Array.isArray(parsed.messages) ? parsed.messages.slice(-options.limit) : []
      } catch {
        // A corrupt history is not a boot failure: the transcript starts empty.
        return []
      }
    },

    async save(records) {
      const kept = options.limit <= 0 ? [] : records.slice(-options.limit)
      const body = JSON.stringify(
        { schema: 1, messages: kept.map(({ role, content, at }) => ({ role, content, at })) },
        null,
        2,
      )
      const temporary = `${path}.tmp-${crypto.randomUUID()}`
      try {
        await mkdir(options.dataDir, { recursive: true })
        await Bun.write(temporary, `${body}\n`)
        const handle = await open(temporary, "r+")
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, path)
      } catch {
        // Writing history is best-effort: a read-only data dir must not break chat.
      }
    },
  }
}

function budgetConfigFrom(config: Config): BudgetConfig {
  return {
    budget: config.usage.budget,
    period: config.usage.period,
    warn_at: config.usage.warn_at,
    pause_at_limit: config.usage.pause_at_limit,
  }
}

/** A service that reports one actionable line instead of pretending. */
function unavailableService(message: string, fix: string): ChatService {
  const requests: string[] = []
  return {
    active: () => [...requests],
    cancel() {
      requests.length = 0
    },
    async *send(request: { requestId: string }) {
      requests.push(request.requestId)
      yield {
        type: "error",
        error: { kind: "config", message: `${message}. ${fix}` },
      }
      requests.length = 0
    },
  } as ChatService
}

/**
 * Boot the app from a directory.
 *
 * Order matters and is asserted by the tests: resolve the root, open or create
 * the workspace, load config, then build services from that config. A legacy
 * folder is refused with the workspace module's own typed error, never a crash.
 */
export async function boot(options: BootOptions = {}): Promise<Result<Booted, BootFailure>> {
  const env = options.env ?? process.env
  const root = options.workspaceRoot ?? defaultWorkspaceRoot(env)
  const now = options.now ?? (() => new Date())
  const diagnostics: string[] = []

  // 1. The workspace: create it when absent, otherwise open what is there.
  const openOrCreate = async (path: string) =>
    (await exists(path))
      ? openWorkspace(path, options.dataDir ? { dataDir: options.dataDir } : {})
      : createWorkspace(path, options.dataDir ? { dataDir: options.dataDir } : {})

  let opened = await openOrCreate(root)
  let workspace: Workspace

  /**
   * A machine with the old LockedIn installed has `~/LockedIn` and no v1
   * workspace. Refusing to start there is correct but useless as a first run, so
   * boot moves to the sibling folder this version documents (`~/LockedIn-Tui`)
   * and says so. It never reads or writes the old folder, and an explicit
   * LOCKEDIN_WORKSPACE (or `workspaceRoot`) is always honoured verbatim.
   */
  if (!opened.ok && opened.error.kind === "legacy" && options.workspaceRoot === undefined) {
    const override = (env.LOCKEDIN_WORKSPACE ?? "").trim()
    const fallback = join(dirname(root), "LockedIn-Tui")
    if (override === "") {
      const moved = await openOrCreate(fallback)
      if (moved.ok) {
        diagnostics.push(
          `“${basename(root)}” belongs to the old LockedIn; using ${fallback} instead`,
        )
        console.error(
          `LockedIn: “${basename(root)}” belongs to the old LockedIn (v0.7); ` +
            `using ${fallback}. Set LOCKEDIN_WORKSPACE to choose another folder.`,
        )
        opened = moved
      }
    }
  }

  if (!opened.ok) return err(bootFailureFrom(opened.error, root))
  workspace = opened.value

  // 2. Config, which writes the documented defaults on first run.
  const loaded = await loadConfig(workspace.paths)
  if (!loaded.ok) {
    return err({
      kind: "boot",
      path: loaded.error.path,
      message: loaded.error.message,
      next: loaded.error.next,
    })
  }
  let config = loaded.value.config
  if (loaded.value.created) diagnostics.push("config.toml was written with the documented defaults")

  // 3. Spend first, so the budget gate starts from the persisted total.
  const dataDir = options.dataDir ?? workspace.paths.dataDir
  const usageStore = createUsageStore({ dir: dataDir })
  const seed = await spentFromUsage(dataDir, config.usage.period, now())
  const spend = createSpendCounter(seed.spentMicroUsd, now, () => config.usage.period)
  if (seed.unpriced > 0) {
    diagnostics.push(`${seed.unpriced} recorded run(s) have no price; spend may be underestimated`)
  }

  const pluginRuntime = createPluginRuntime(
    Object.entries(config.plugins.servers).map(([id, server]) => ({
      id,
      command: server.command,
      args: server.args,
      enabled: server.enabled,
      // The web-search core server is always available on skill/work sides.
      core: coreServersFor("skill").includes(id),
    })),
  )
  // Never block the first frame on a child process.
  void pluginRuntime.start().catch(() => {})
  const budget = createBudgetGate({ config: () => budgetConfigFrom(config), now })
  const history = createHistoryPort({ dataDir, limit: config.ui.chill_history_limit })
  // Chill is a scratch conversation: every app launch starts with an empty
  // transcript. Sessions and project buffers keep their own histories.
  await history.save([])

  // 4. The chat service, from config plus an injected factory. No secret is read
  //    here: a key is only ever touched inside the factory, and only when a model
  //    is configured at all.
  let model = config.models.chat.trim()
  let providerId = model.includes("/") ? model.slice(0, model.indexOf("/")) : ""
  const readKey = async (ref: string): Promise<string | null> => {
    if (model === "") return null
    if (options.readKey) return options.readKey(ref)
    // Production has no injected reader: use the OS keychain. The ref is the
    // public `lockedin/<provider>` form; the store namespaces it itself.
    try {
      const { createSystemSecretStore } = await import("../security/keyring")
      const store = await createSystemSecretStore()
      if (!(await store.available())) return null
      const name = ref.startsWith("lockedin/") ? ref.slice("lockedin/".length) : ref
      const value = await store.get(name)
      return value.ok ? value.value : null
    } catch {
      // A locked or unavailable keychain is the documented blocked state.
      return null
    }
  }

  // The real glue is the default; the seam stays injectable for tests.
  const refusals: string[] = []
  const buildService =
    options.createService ??
    (async (context: BootServiceContext): Promise<ChatService | null> => {
      const result = await createProviderService(context)
      if (result.ok) return result.service
      refusals.push(result.message)
      return null
    })

  let service: ChatService | null = null
  if (model !== "") {
    service = await buildService({
      providerId,
      model,
      baseUrl: config.models.base_url,
      readKey,
    })
  }
  if (service === null) {
    service = unavailableService(
      model === ""
        ? "no model configured"
        : (refusals[0] ?? `chat is unavailable for "${model}"`),
      model === "" ? "link a key in Settings → Providers" : "fix the provider in Settings → Models",
    )
    if (model !== "") {
      diagnostics.push(`chat is unavailable for "${model}": ${refusals[0] ?? "no service could be built"}`)
    }
  }
  let serviceReady = model !== "" && service !== null && refusals.length === 0

  /**
   * The generation model is separate from chat. An empty value means "use the
   * chat model"; a configured value is built like any other provider and never
   * silently falls back.
   */
  let generationModel = config.models.generation.trim()
  let generationService: ChatService | null = null
  let generationError: string | null = null
  const resolveGeneration = async (): Promise<void> => {
    const wanted = config.models.generation.trim()
    if (wanted === "" || wanted === model) {
      generationModel = model
      generationService = service
      generationError = null
      return
    }
    generationModel = wanted
    const generationProvider = wanted.includes("/") ? wanted.slice(0, wanted.indexOf("/")) : ""
    const before = refusals.length
    generationService = await buildService({
      providerId: generationProvider,
      model: wanted,
      baseUrl: config.models.base_url,
      readKey,
    })
    if (generationService === null) {
      generationError =
        refusals.length > before
          ? refusals.at(-1)!
          : `the generation model "${wanted}" is unavailable`
      diagnostics.push(`generation is unavailable for "${wanted}": ${generationError}`)
    } else {
      generationError = null
    }
  }
  await resolveGeneration()

  const buildController = (
    chatHistory: HistoryPort,
    chatScope: RunScope = options.scope ?? "school",
    chatMode: import("../llm/chat").ChatMode = "chill",
    context?: (context: ToolContext) => Promise<string>,
    tools?: import("./actions/projects").ChatToolSource,
  ): ChatController =>
    createChatController({
      service: service ?? unavailableService("chat is unavailable", "check Settings → Models"),
      budget,
      history: chatHistory,
      scope: chatScope,
      usage: usageStore,
      ...(options.onUsageError ? { onUsageError: options.onUsageError } : {}),
      config: () => ({
        // A model without a working service must report the blocked state, not
        // half-work.
        model: serviceReady ? model : null,
        maxToolCalls: config.models.max_tool_calls,
        maxTokens: config.models.max_tokens_per_request,
        chillHistoryLimit: config.ui.chill_history_limit,
        responseStyle: config.ui.response_style as import("../llm/response-style").ResponseStyle,
        tutorPolicy: config.ui.tutor_policy as import("../llm/response-style").TutorPolicy,
        mode: chatMode,
        ...(context ? { context } : {}),
        // Both halves are evaluated at send time: a plugin server may finish
        // connecting after this controller was built.
        tools: (context) => {
          const base = tools ? (tools.dynamicSpecs?.() ?? tools.specs) : []
          const plugin = pluginRuntime.sourceFor(chatMode, {
            explicitCall: context.webExplicit,
          })
          const extra = plugin
            ? plugin.specs.filter((spec) => !base.some((entry) => entry.name === spec.name))
            : []
          return [...base, ...extra]
        },
        resolveTool: async (name: string, input: Record<string, unknown>, context) => {
          const base = tools ? (tools.dynamicSpecs?.() ?? tools.specs) : []
          if (tools && base.some((spec) => spec.name === name)) {
            return tools.resolveTool(name, input, context)
          }
          const plugin = pluginRuntime.sourceFor(chatMode, {
            explicitCall: context?.webExplicit === true,
          })
          if (plugin) return plugin.resolveTool(name, input)
          return JSON.stringify({ ok: false, error: { kind: "unavailable", message: `unknown tool "${name}"` } })
        },
      }),
      now,
      spend,
      ...(config.models.base_url.trim() ? { baseUrl: config.models.base_url.trim() } : {}),
      username: config.ui.username,
    })

  const controller = buildController(history)

  /**
   * Settings writes go through here after `config.toml` is saved. Budget,
   * limits, username and the model all take effect without a restart; a model
   * or endpoint change rebuilds the service so the controller is not left
   * pointing at the old provider.
   */
  const linkProvider = async (input: {
    providerId: string
    key: string
    baseUrl?: string
  }): Promise<LlmResult<LinkOutcome>> => {
    const spec = getProvider(input.providerId)
    if (!spec) {
      return { ok: false, error: { kind: "config", message: `unknown provider "${input.providerId}"` } }
    }
    const { createSystemSecretStore } = await import("../security/keyring")
    const store = await createSystemSecretStore()
    return linkProviderKey({
      providerId: spec.id,
      spec,
      key: input.key,
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
      store,
    })
  }

  const modelsForProvider = async (providerId: string): Promise<LlmResult<LinkOutcome>> => {
    const spec = getProvider(providerId)
    if (!spec) {
      return { ok: false, error: { kind: "config", message: `unknown provider "${providerId}"` } }
    }
    const { createSystemSecretStore } = await import("../security/keyring")
    const store = await createSystemSecretStore()
    if (!(await store.available())) {
      return {
        ok: false,
        error: {
          kind: "keychain",
          provider: spec.id,
          message: "no keychain backend is available",
          hint: "Start your desktop keyring, then link the provider again.",
        },
      }
    }
    const stored = await store.get(spec.id)
    if (!stored.ok) {
      return {
        ok: false,
        error: { kind: "keychain", provider: spec.id, message: stored.error.message, hint: stored.error.hint },
      }
    }
    const key = stored.value
    if ((key === null || key === "") && spec.keyRequired) {
      return { ok: false, error: { kind: "config", message: `no ${spec.label} key is linked yet` } }
    }
    const baseUrl = spec.id === "custom" ? config.models.base_url : undefined
    const validated = await validateKeyOnce({
      spec,
      key,
      ...(baseUrl === undefined || baseUrl === "" ? {} : { baseUrl }),
    })
    if (!validated.ok) return validated
    return {
      ok: true,
      value: {
        providerId: spec.id,
        models: validated.value.models,
        modelSelected: null,
        requests: 1,
        secretRef: `lockedin/${spec.id}`,
      },
    }
  }

  const linkedProviders = async (): Promise<string[]> => {
    const { createSystemSecretStore } = await import("../security/keyring")
    const store = await createSystemSecretStore()
    if (!(await store.available())) return []
    const linked: string[] = []
    for (const spec of listProviders()) {
      const stored = await store.get(spec.id)
      const hasKey = stored.ok && stored.value !== null && stored.value.trim() !== ""
      if (spec.id === "custom") {
        if (hasKey || config.models.base_url.trim() !== "") linked.push(spec.id)
      } else if (hasKey) {
        linked.push(spec.id)
      }
    }
    return linked
  }

  const applyConfig = async (next: Config): Promise<void> => {
    const previousModel = model
    const previousBase = config.models.base_url
    config = next
    const nextModel = next.models.chat.trim()
    if (nextModel === previousModel && next.models.base_url === previousBase) return
    model = nextModel
    providerId = model.includes("/") ? model.slice(0, model.indexOf("/")) : ""
    refusals.length = 0
    service = model === "" ? null : await buildService({ providerId, model, baseUrl: config.models.base_url, readKey })
    if (service === null) {
      service = unavailableService(
        model === "" ? "no model configured" : (refusals[0] ?? `chat is unavailable for "${model}"`),
        model === "" ? "link a key in Settings → Providers" : "fix the provider in Settings → Models",
      )
      if (model !== "") diagnostics.push(`chat is unavailable for "${model}": ${refusals[0] ?? "no service could be built"}`)
    }
    serviceReady = model !== "" && service !== null && refusals.length === 0
  }

  /**
   * A single completion for plan generation (a course's chapters).
   *
   * It is a paid run like any other: the budget gate runs first, and the usage
   * it reports is written to `usage.json` and added to the shared spend total.
   * A blocked budget throws, so the caller's documented template fallback is
   * used instead of silently spending past the limit.
   */
  const generate = async (prompt: string): Promise<string> => {
    const genService = generationService
    const genModel = generationModel || model
    if (!genService) {
      throw new Error(generationError ?? "the generation model is unavailable; fix Settings → Models")
    }
    const gate = budget.check(spend.total())
    if (gate.block) {
      throw new Error(`the ${gate.block.period} budget is reached; raise it in Settings → Usage`)
    }
    let text = ""
    let usage: Usage | undefined
    let failure: string | null = null
    for await (const event of genService.send({
      requestId: `generate-${Date.now()}`,
      mode: "chill",
      messages: [{ role: "user", content: prompt }],
      model: genModel,
      tools: [],
      images: [],
      caps: { maxToolCalls: 1, maxTokens: config.models.max_tokens_per_request, maxOutputTokens: 8192 },
    })) {
      if (event.type === "text") text += event.delta
      if (event.type === "usage") usage = event.tokens
      if (event.type === "done") {
        usage = event.usage ?? usage
        text = event.text || text
        if (event.truncated) failure = "generation stopped at the output ceiling"
        break
      }
      if (event.type === "error") {
        failure = "message" in event.error && event.error.message ? event.error.message : event.error.kind
        break
      }
    }
    const tokens = usage ?? ZERO_USAGE
    const price = priceFor(genModel, config.models.base_url.trim() ? { baseUrl: config.models.base_url.trim() } : {})
    const costMicroUsd = price.price
      ? estimateCostMicroUsd(price.price, { input: tokens.input, output: tokens.output })
      : null
    spend.add(costMicroUsd ?? 0)
    try {
      await usageStore.append(
        runRecord({
          model: genModel,
          usage: tokens,
          costMicroUsd,
          scope: "skills",
          failed: failure !== null,
          at: now(),
        }),
      )
    } catch (error) {
      options.onUsageError?.(
        `Could not save usage counters: ${messageOf(error).slice(0, 120)}. The plan is unaffected.`,
      )
    }
    if (failure !== null) throw new Error(`generation failed: ${failure}`)
    return text
  }

  const createGithubArchive = async (): Promise<import("../domain/markdown").Result<ArchiveBackend, ArchiveError>> => {
    const repo = config.archive.github.repo.trim()
    if (repo === "") {
      return err({
        kind: "config",
        field: "archive.github.repo",
        message: "No GitHub archive repository is configured.",
        next: "Set archive.github.repo to owner/name in Settings → Storage and archive.",
      })
    }
    const [{ createGithubFetchTransport, GITHUB_TOKEN_SECRET, openGithubArchive }, { createSystemSecretStore }] =
      await Promise.all([import("../archive/github"), import("../security/keyring")])
    const secrets = await createSystemSecretStore()
    const token = await secrets.get(GITHUB_TOKEN_SECRET)
    if (!token.ok || !token.value) {
      return err({
        kind: "auth",
        repo,
        message: "GitHub archive needs a token in the OS keychain.",
        next: "Link a GitHub token in Settings → Providers, then retry.",
      })
    }
    const transport = createGithubFetchTransport(token.value)
    return openGithubArchive({
      workspace,
      repo,
      branch: config.archive.github.branch,
      secrets,
      transport,
    })
  }

  return ok({
    workspace,
    config,
    controller,
    usageStore,
    history,
    budget,
    spentMicroUsd: spend.total(),
    diagnostics,
    scope: options.scope ?? "school",
    settings: settingsViewFrom(config, dataDir),
    updateConfig: applyConfig,
    linkProvider,
    modelsForProvider,
    linkedProviders,
    createChat: buildController,
    createGithubArchive,
    pluginRuntime,
    ...(model !== "" ? { generate } : {}),
  })
}

/**
 * Collapse a multi-line message into one line.
 *
 * A TOML parse error carries its own line breaks (`at line 3, column 5` on a
 * new line), and so does anything that echoes a file back. The boot line is one
 * sentence in a terminal that is about to exit, so newlines become a separator
 * and runs of whitespace become one space. No content is dropped.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * One actionable line for a failed boot; the shell renders this and exits.
 *
 * The whole string is one line by construction: a message that carried
 * newlines used to render as six rows of half-parsed TOML instead of the single
 * instruction the user needs.
 */
/**
 * The settings pane's view of the loaded config.
 *
 * Built here, where the config and the data directory are known, so the pane
 * takes props and never reads a file (WP-815).
 */
export function settingsViewFrom(config: Config, dataDir: string): SettingsView {
  return {
    username: config.ui.username,
    theme: config.ui.theme,
    chatModel: config.models.chat,
    baseUrl: config.models.base_url,
    maxToolCalls: config.models.max_tool_calls,
    maxTokensPerRequest: config.models.max_tokens_per_request,
    responseStyle: config.ui.response_style,
    tutorPolicy: config.ui.tutor_policy,
    budgetUsd: config.usage.budget,
    period: config.usage.period === "month" ? "month" : "day",
    warnAt: config.usage.warn_at,
    pauseAtLimit: config.usage.pause_at_limit,
    dataDir,
    archiveBackend: config.archive.backend,
    archiveFolder: config.archive.folder,
    historyLimit: config.ui.chill_history_limit,
    pluginServers: Object.keys(config.plugins.servers),
    hideHints: config.ui.hide_hints,
  }
}

export function bootFailureLine(failure: BootFailure): string {
  return `LockedIn could not start: ${oneLine(failure.message)} (${failure.path}) — ${oneLine(failure.next)}`
}

export { workspacePaths, messageOf }
