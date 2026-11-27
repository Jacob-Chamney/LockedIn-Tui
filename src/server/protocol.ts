/**
 * The Flutter shell <-> Bun core protocol.
 *
 * One JSON-RPC 2.0 object per line. The core is authoritative; the shell sends
 * intents and renders events. This module owns framing, validation and the
 * method table; the application services arrive through an injected `boot` seam,
 * so the protocol can be tested without a workspace, a provider or a process.
 *
 * Product rules this file implements:
 * - **One report, no retries.** Boot is attempted once per process; a failure is
 *   remembered and returned as a typed error on every later call.
 * - **The handshake always answers.** `initialize` and `ping` never need the
 *   workspace, so a shell can start, show the boot error and still talk.
 * - **stdout is protocol-only.** This module writes nothing; `main.ts` writes
 *   the returned lines and logs go to stderr.
 */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
export { parseSkillPlan } from "./skills";

import type { Booted, BootFailure } from "../app/boot";
import type { PluginWriteApprover, PluginWriteRequest } from "../app/actions/plugins";
import { computeCoverage } from "../domain/coverage";
import { loadSessionHome, loadSessionRows } from "../app/actions/sessions";
import type { Result } from "../domain/markdown";

type ChatController = NonNullable<CoreServices["controller"]>;

/** How long one plugin write waits for the shell's answer. */
export const PLUGIN_PERMISSION_TIMEOUT_MS = 120_000;
import type { ThemeTokens } from "./theme-tokens";
export { THEME_TOKEN_NAMES, validateThemeTokens } from "./theme-tokens";
export type { ThemeTokenName, ThemeTokens } from "./theme-tokens";
import type { DecisionSettings } from "./decision-types";
export type { DecisionSettings, DecisionView } from "./decision-types";
export { DECISION_LOCAL_MODEL_REASON, DECISION_RULES_ONLY_REFUSAL } from "./decision-types";
import type { KeybindMaps, KeybindWrite } from "./keybinds";
export type { KeybindMaps, KeybindWrite } from "./keybinds";
import {
} from "./session-documents";
import { createSessionInstructionHandlers } from "./session-instructions";
import { createSessionChatHandlers } from "./session-chat-handlers";
import {
  createWorkApprovalHandlers,
  type WorkPermissions,
} from "./work-approvals";
import { createWorkActivityHandlers } from "./work-activity";
import { createWorkProjectHandlers, resolveLoadedProject, resolveProject } from "./work-projects";
import { createWorkChatHandlers } from "./work-chat-handlers";
import { createWorkSwarmHandlers } from "./work-swarm-handlers";
import { createTeachHandlers } from "./teach-handlers";
import { createSkillHandlers } from "./skill-handlers";
import { createSessionLifecycleHandlers } from "./session-lifecycle-handlers";
import { createSessionExtrasHandlers } from "./session-extras-handlers";
import { createWorkspaceReadHandlers } from "./workspace-read-handlers";
import { createSettingsHandlers } from "./settings-handlers";
import { createArchiveHandlers } from "./archive-handlers";
import { createMcpHandlers } from "./mcp-handlers";
export {
  WORK_COMMAND_OPT_IN_OFF,
  WORK_WRITE_OPT_IN_OFF,
  type WorkPermissions,
} from "./work-approvals";
import { createSessionOutputHandlers } from "./session-output-handlers";
import {
  markCard,
  markMistakeTarget,
  markStage,
  markStep,
  type MarkOutcome,
} from "./review-mark";
import {
  type SessionCoverageRow,
} from "./views";
export * from "./views";
import {
  chatSnapshot,
  imageMediaType,
  type ChatState,
} from "./chat-wire";
export * from "./chat-wire";
export * from "./chat-memory";
import {
  keybindTable,
} from "./keybinds";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  isRecord,
  messageOf,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";
export * from "./rpc";
import {
  REVIEW_MARK_RESULTS,
  REVIEW_SIDES,
  isReviewMarkResult,
  isReviewSide,
  parseReviewItemId,
  projectReviewSide,
  type ReviewMarkResult,
  type ReviewMarkTarget,
} from "./review";
import {
  KNOWLEDGE_HIT_LIMIT,
  KNOWLEDGE_SCOPES,
  KNOWLEDGE_TREE_SIDES,
  indexedNoteCandidates,
  isKnowledgeScope,
  isKnowledgeTreeSide,
  knowledgeExcerpt,
  capKnowledgeBody,
  archiveKnowledge,
  goalKnowledge,
  projectKnowledge,
  sessionKnowledge,
  parseKnowledgeReadTarget,
  readKnowledgeTarget,
  knowledgeScore,
  knowledgeSort,
  KNOWLEDGE_BODY_LIMIT,
  KNOWLEDGE_NO_TOPIC,
  readVaultNotes,
  type KnowledgeCandidate,
  type KnowledgeHit,
  type KnowledgeTreeNode,
  type KnowledgeTopicGroup,
  type KnowledgeScope,
  type KnowledgeTreeSide,
  type VaultNote,
} from "./knowledge";
export * from "./knowledge";
import { MAX_IMAGES } from "../llm/chat";
import type {
  SwarmTaskEntry,
} from "../domain/review";
import { listProjects } from "../services/work/register";
import {
  listReportRuns,
  readReport,
  verifyReportTaskFile,
} from "../services/work/report";
import type { WorkerRunner } from "../services/work/swarm";
import { loadLearningGraph } from "../services/knowledge/learning-graph";
import {
  openSession,
  type OpenResult,
} from "../services/lockin/manager";
import { reviewQueue, type ReviewQueueResult } from "../services/review/queue";
import type {
  PluginCommand,
  PluginPolicy,
  PluginPolicyCell,
} from "../storage/config-schema";
import type { SettingsView } from "../types/settings";

export const SERVER_PROTOCOL_VERSION = 1;

/** Methods this core answers. Additive: the shell must ignore unknown names. */
export const CAPABILITIES = [
  "workspace.info",
  "session.list",
  "session.open",
  "session.coverage",
  "session.create",
  "session.toggleStep",
  "session.generateSteps",
  "session.document",
  "session.instructions.get",
  "session.instructions.save",
  "session.instructions.import",
  "session.instructions.reextract",
  "session.archive",
  "session.remove",
  "session.export",
  "session.output.build",
  "session.output.read",
  "session.output.mark",
  "session.deck.state",
  "session.deck.grade",
  "session.deck.reset",
  "session.figure.list",
  "session.figure.extract",
  "session.figure.read",
  "session.figure.annotate",
  "session.figure.remove",
  "session.mistake.list",
  "session.mistake.record",
  "session.mistake.promote",
  "session.mistake.correct",
  "archive.list",
  "archive.restore",
  "archive.remove",
  "source.list",
  "source.add",
  "stats.summary",
  "stats.export",
  "achievements.list",
  "settings.get",
  "decision.get",
  "decision.set",
  "keybinds.get",
  "keybinds.set",
  "chat.snapshot",
  "chat.send",
  "chat.cancel",
  "session.chat.snapshot",
  "session.chat.send",
  "session.chat.cancel",
  "session.chat.context",
  "session.chat.compact",
  "session.chat.uncompact",
  "provider.list",
  "provider.link",
  "settings.patch",
  "theme.custom.get",
  "theme.custom.set",
  "work.list",
  "work.open",
  "work.create",
  "work.templates.list",
  "work.agent.save",
  "work.agent.delete",
  "work.defaultAgent",
  "work.instructions.save",
  "work.changes",
  "work.write.propose",
  "work.write.decide",
  "work.command.propose",
  "work.command.decide",
  "work.permissions.get",
  "work.permissions.set",
  "work.approvals.list",
  "work.chat.list",
  "work.chat.open",
  "work.chat.send",
  "work.chat.cancel",
  "work.swarm.run",
  "work.swarm.board",
  "work.swarm.runs",
  "work.swarm.cancel",
  "work.swarm.remove",
  "work.swarm.retry",
  "work.swarm.verify",
  "activity.list",
  "mcp.list",
  "mcp.refresh",
  "mcp.policy.get",
  "mcp.policy.set",
  "mcp.confirm",
  "skill.list",
  "skill.open",
  "skill.chapter",
  "skill.create",
  "skill.stages.save",
  "skill.archive",
  "skill.remove",
  "skill.export",
  "skill.lesson.build",
  "skill.lesson.read",
  "teach.state",
  "teach.measure",
  "teach.step",
  "teach.check",
  "teach.practice",
  "teach.practice.result",
  "teach.side.snapshot",
  "teach.side.send",
  "teach.side.clear",
  "research.start",
  "research.list",
  "research.read",
  "research.cancel",
  "prompts.list",
  "prompts.set",
  "update.info",
  "update.check",
  "skill.sources.list",
  "skill.sources.add",
  "skill.chat.list",
  "skill.chat.open",
  "skill.chat.create",
  "skill.chat.send",
  "skill.chat.cancel",
  "review.queue",
  "review.mark",
  "knowledge.search",
  "knowledge.tree",
  "knowledge.read",
  "knowledge.graph",
] as const;

/** JSON-RPC error code for a boot refusal (server-defined range). */

/** The slice of a booted app the protocol needs. `boot()` satisfies it. */
export type CoreServices = Pick<Booted, "workspace" | "settings"> & {
  /**
   * Check the public release feed for a newer build.
   *
   * Supplied by `main.ts` from `src/services/update.ts`, so protocol tests can
   * inject a result without a network call. Absent means this build cannot
   * check, which is an honest refusal rather than a hang.
   */
  updateCheck?: () => Promise<import("../services/update").UpdateCheck>;
  /** The stored note for one prompt, or "". Supplied by `main.ts`. */
  promptNote?: (id: import("../domain/prompts").PromptId) => string;
  /** Persist one note (empty clears it). */
  savePrompt?: (
    id: import("../domain/prompts").PromptId,
    note: string,
  ) => Promise<Result<void, { message: string }>>;
  /**
   * The fetch used for a learner-named research source.
   *
   * Supplied by tests with a fake; production uses the global fetch through the
   * service's own SSRF and content-type guards.
   */
  researchFetch?: typeof fetch;
  /** Render one PDF page/crop; tests inject a fake, production spawns pdftoppm. */
  renderFigure?: typeof import("../services/lockin/figures").renderFigure;
  /** Present on a real boot; protocol tests may omit it. */
  controller?: Booted["controller"];
  /** A fresh controller using the current config, after a settings patch. */
  createChat?: Booted["createChat"];
  history?: Booted["history"];
  linkProvider?: Booted["linkProvider"];
  modelsForProvider?: Booted["modelsForProvider"];
  linkedProviders?: Booted["linkedProviders"];
  /**
   * One non-streaming completion, used to build a session's assignment steps.
   *
   * Absent when no model is configured: the caller reports the actionable
   * Settings hint rather than hammering a service that cannot answer.
   */
  generate?: Booted["generate"];
  /**
   * Configured MCP servers, read-only.
   *
   * Present on a real boot. The protocol reads rows and policy; it never spawns
   * a server unless the shell explicitly asks for `mcp.refresh`.
   */
  pluginRuntime?: Booted["pluginRuntime"];
  /** The loaded config, for the read-only policy matrix. */
  config?: Booted["config"];
  /**
   * The GitHub archive backend, built on demand.
   *
   * Present on a real boot; the protocol only calls it when Settings selects the
   * GitHub backend, and the boot seam itself refuses an unconfigured repo or a
   * missing token with an actionable message.
   */
  createGithubArchive?: Booted["createGithubArchive"];
  /**
   * Persist one settings patch and return the new view.
   *
   * Supplied by `main.ts`, which owns the config file and the live boot state;
   * the protocol stays a transport and never serializes TOML itself.
   */
  saveConfig?: (
    patch: Record<string, unknown>,
  ) => Promise<Result<SettingsView, { message: string }>>;
  /**
   * Persist the optional decision layer and return what the config now stores.
   *
   * Supplied by `main.ts`, which owns `config.toml`: one `patchConfig` writing
   * `[decision_layer]`, then `updateConfig`. It is the only writer of these two
   * values — `settings.patch` refuses a `decision_layer` key — so the rejection
   * rules above the write live in one place and cannot be bypassed by another
   * method.
   */
  saveDecision?: (
    input: DecisionSettings,
  ) => Promise<Result<DecisionSettings, { message: string }>>;
  /**
   * Persist the global Work write/command opt-in and return what config stores.
   *
   * Supplied by `main.ts`, which owns `config.toml`: one `patchConfig` writing
   * `[work]`, then `updateConfig`. It is the only writer of these two values —
   * `settings.patch` refuses a `work` key — so the gate below reads one truth
   * and no other method can flip it behind the gate's back.
   */
  saveWorkPermissions?: (
    input: WorkPermissions,
  ) => Promise<Result<WorkPermissions, { message: string }>>;
  /**
   * Persist one MCP policy cell and return the whole new matrix.
   *
   * Supplied by `main.ts`, which owns `config.toml` and the live boot state; the
   * protocol stays a transport and never serializes TOML. The reply is the
   * stored matrix, so `mcp.policy.get` reflects the write without a second read.
   */
  savePolicy?: (input: {
    command: PluginCommand;
    server: string;
    value: PluginPolicyCell;
  }) => Promise<Result<PluginPolicy, { message: string }>>;
  /**
   * Persist the keybind overrides and return what the config now stores.
   *
   * Supplied by `main.ts`, which owns `config.toml`; the protocol stays a
   * transport and never serializes TOML. The whole table is handed over, and
   * `cleared` names the actions whose override was removed, so the config write
   * can record them as unset. Nothing here knows the default binding table: the
   * registry's defaults live in the UI.
   */
  saveKeybinds?: (input: KeybindWrite) => Promise<Result<KeybindMaps, { message: string }>>;
  /**
   * Persist the custom palette's stored tokens and return what config now holds.
   *
   * Supplied by `main.ts`, which owns `config.toml`: one `patchConfig` writing
   * `[ui.custom_theme]`, then `updateConfig`. The map is a **replacement**: a
   * token absent from [tokens] is cleared, so resetting one token in the editor
   * persists. The protocol validates names and colours; this wrapper only
   * stores what it was given. The palette catalogue and every default stay in
   * the shell, so the core never invents a colour.
   */
  saveThemeTokens?: (tokens: ThemeTokens) => Promise<Result<ThemeTokens, { message: string }>>;
  /**
   * The model loop one swarm worker runs. Tests inject a deterministic fake
   * here so no provider is touched; production leaves it absent and the core
   * builds the real read-only worker.
   *
   * It is a seam, not a capability: whatever it returns is still a value the
   * service clamps, and a worker's tool list still comes from `forSwarm`.
   */
  swarmRunner?: WorkerRunner;
};

/** Lazy, memoised by the server: called at most once per process. */
export type CoreBoot = () => Promise<Result<CoreServices, BootFailure>>;

/** One notification written outside a request/response pair. */
export type CoreNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type CoreOptions = {
  boot: CoreBoot;
  /** Writes an event to the shell; `main.ts` points this at stdout. */
  notify?: (notification: CoreNotification) => void;
};

export type CoreServer = {
  /** Resolve one request. Notifications return null and never get a response. */
  handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null>;
};

/**
 * One core, one boot.
 *
 * The first data method boots the app and every later call reuses the result.
 * A refusal is memoised too: the shell reports it once and restarts the process
 * after the user acts — the core never retries on its own.
 */
export function createCoreServer(options: CoreOptions): CoreServer {
  /**
   * Plugin writes waiting for `mcp.confirm`, by request id.
   *
   * This map is process memory and nothing else: a pending prompt is not a
   * decision, so it is never written to config, a session or a log. A core
   * restart forgets every pending prompt and the chat's tool call fails closed.
   */
  const pendingPluginPermissions = new Map<
    string,
    { finish: (granted: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();

  /**
   * The per-call gate installed on the plugin runtime after boot.
   *
   * Every chat controller boot builds calls the runtime at send time, so this
   * one installation covers Chill, session, work and skill chats without a
   * second tool path. A write tool is offered only while this gate exists;
   * `mcp.confirm` answers exactly one request and the map entry is consumed
   * either way, so no approval is cached and no session grant exists.
   */
  const requestPluginWrite: PluginWriteApprover = ({ server, tool, input }: PluginWriteRequest) =>
    new Promise<boolean>((resolve) => {
      const requestId = randomUUID();
      let settled = false;
      const finish = (granted: boolean): void => {
        if (settled) return;
        settled = true;
        const pending = pendingPluginPermissions.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingPluginPermissions.delete(requestId);
        }
        resolve(granted);
      };
      const timer = setTimeout(() => finish(false), PLUGIN_PERMISSION_TIMEOUT_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
      pendingPluginPermissions.set(requestId, { finish, timer });
      // The input is the model's tool call, shown verbatim so the user approves
      // what will actually run. It is untrusted data, never an instruction.
      options.notify?.({
        jsonrpc: "2.0",
        method: "mcp.permission",
        params: { requestId, server, tool, input, write: true },
      });
    });

  let booted: Promise<Result<CoreServices, BootFailure>> | null = null;
  const services = (): Promise<Result<CoreServices, BootFailure>> =>
    (booted ??= (async () => {
      const result = await options.boot();
      // A runtime that cannot take the gate keeps offering no write tools,
      // which is the safe default rather than an implicit approval.
      if (result.ok) result.value.pluginRuntime?.setWriteApproval?.(requestPluginWrite);
      return result;
    })());

  let chatLoaded = false;
  let chatUnsubscribe: (() => void) | null = null;
  let chatState: ChatState | null = null;
  let chatTimer: ReturnType<typeof setTimeout> | null = null;
  /** The post-patch settings view; `get` must not return the boot snapshot. */
  let settingsOverride: SettingsView | null = null;
  /**
   * The post-write policy matrix.
   *
   * `booted.config` is the boot snapshot, so a successful `mcp.policy.set` must
   * carry its result here or `mcp.policy.get` would keep reporting the old cell
   * for the rest of the process.
   */
  let policyOverride: PluginPolicy | null = null;
  /**
   * The post-write keybind tables.
   *
   * `booted.config` is the boot snapshot, so a successful `keybinds.set` must
   * carry its result here or `keybinds.get` would keep reporting the old keys
   * for the rest of the process.
   */
  let keybindsOverride: KeybindMaps | null = null;
  /**
   * The post-write custom palette tokens.
   *
   * `booted.config` is the boot snapshot, so a successful `theme.custom.set`
   * must carry its result here or `theme.custom.get` would keep reporting the
   * tokens the process booted with.
   */
  let themeTokensOverride: ThemeTokens | null = null;
  /**
   * The post-write decision-layer settings.
   *
   * `booted.config` is the boot snapshot, so a successful `decision.set` must
   * carry its result here or `decision.get` would keep reporting the old values
   * for the rest of the process.
   */
  let decisionOverride: DecisionSettings | null = null;
  /**
   * The post-write global Work write/command opt-in.
   *
   * `booted.config` is the boot snapshot, so a successful
   * `work.permissions.set` must carry its result here or the gate would keep
   * reading the values the process booted with.
   */
  let workPermissionsOverride: WorkPermissions | null = null;

    /** The Chill stream's frame counter (see `chatSnapshot`). */
  let chatSeq = 0;

  const emitChat = (): void => {
    if (chatState === null || chatUnsubscribe === null) return;
    const controller = (chatController as ChatController | null);
    if (controller === null) return;
    chatSeq += 1;
    options.notify?.({
      jsonrpc: "2.0",
      method: "chat.state",
      params: chatSnapshot(chatState, controller.usage(), chatSeq),
    });
  };

  let chatController: ChatController | null = null;

  const scheduleChat = (state: ChatState): void => {
    chatState = state;
    if (chatTimer !== null) return;
    chatTimer = setTimeout(() => {
      chatTimer = null;
      emitChat();
    }, 33);
  };

  const ensureChat = async (current: CoreServices): Promise<ChatController | null> => {
    const controller = current.controller;
    if (!controller) return null;
    if (!chatLoaded) {
      await controller.load();
      chatLoaded = true;
    }
    if (chatUnsubscribe === null) {
      chatController = controller;
      chatUnsubscribe = controller.subscribe(scheduleChat);
    }
    return controller;
  };

  /**
   * Resolve one session id from a request; a failure is a typed session error.
   *
   * `field` names the parameter the shell sent (`id` for `session.*`,
   * `sessionId` for `source.*`) so the error data mirrors the request instead of
   * inventing a key the client cannot find.
   */
  const resolveSession = async (
    id: RpcId,
    current: CoreServices,
    raw: unknown,
    field: "id" | "sessionId" = "id",
  ): Promise<{ error: JsonRpcFailure } | { opened: OpenResult }> => {
    if (typeof raw !== "string" || raw.trim() === "") {
      return { error: invalid(id, "a session id is required") };
    }
    const sessionId = raw.trim();
    const opened = await openSession({ workspace: current.workspace, id: sessionId });
    if (!opened.ok) {
      const message = oneLine(opened.error.message);
      return {
        error: failure(
          id,
          BOOT_FAILED,
          message,
          { kind: "session", [field]: sessionId, message },
          false,
        ),
      };
    }
    return { opened: opened.value };
  };

  const sessionInstructionHandlers = createSessionInstructionHandlers({
    services,
    resolveSession,
  });
  const {
    sessionInstructionsGet,
    sessionInstructionsSave,
    sessionInstructionsImport,
    sessionInstructionsReextract,
  } = sessionInstructionHandlers;

  const sessionChat = createSessionChatHandlers({
    services,
    resolveSession,
    notify: (notification) => options.notify?.(notification),
    historyLimit: (current) => (settingsOverride ?? current.settings).historyLimit,
  });
  const {
    sessionChatSnapshot,
    sessionChatContext,
    sessionChatCompact,
    sessionChatUncompact,
    sessionChatSend,
    sessionChatCancel,
  } = sessionChat.handlers;
  const { resetSessionChats, dropSessionChat } = sessionChat;

  const {
    sessionDocument,
    sessionOutputBuild,
    sessionOutputRead,
    sessionOutputMark,
    sessionDeckState,
    sessionDeckGrade,
    sessionDeckReset,
  } = createSessionOutputHandlers({ services, resolveSession });

    const chatSnapshotResponse = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const controller = await ensureChat(current.value);
    if (!controller) return failure(id, -32601, "Chat is not available in this build", undefined, false);
    return success(id, chatSnapshot(controller.state(), controller.usage(), chatSeq));
  };

  /* ------------------------------------------------------------------------ */
  /* Custom palette — the shell owns the catalogue, the core stores the map    */
  /* ------------------------------------------------------------------------ */

  /**
   * The stored `ui.custom_theme` tokens.
   *
   * The core invents no default: a fresh workspace reads `{}` and the shell
   * derives every missing token from crimson (`docs/design.md` §3.1). An empty
   * value is a cleared override — the same sentinel `ui.keybinds` uses — and is
   * filtered out, so clearing the palette reads back as `{}`.
   */
  const workPermissionsStored = (current: CoreServices): WorkPermissions =>
    workPermissionsOverride ?? {
      allowWrite: current.config?.work?.allow_write ?? false,
      allowCommand: current.config?.work?.allow_command ?? false,
    };

  const workActivity = createWorkActivityHandlers({
    services,
    dataDir: (current) => (settingsOverride ?? current.settings).dataDir,
  });
  const { activitySink, activityList } = workActivity;

  const workApproval = createWorkApprovalHandlers({
    services,
    resolveSession,
    resolveProject,
    notify: (notification) => options.notify?.(notification),
    activitySink,
    permissions: workPermissionsStored,
  });
  const {
    workWritePropose,
    workWriteDecide,
    workCommandPropose,
    workCommandDecide,
    workApprovalsList,
  } = workApproval.handlers;
  const { addWriteProposal, addCommandProposal, approvalAgent } = workApproval;

  const workChat = createWorkChatHandlers({
    services,
    resolveSession,
    notify: (notification) => options.notify?.(notification),
    historyLimit: (current) => (settingsOverride ?? current.settings).historyLimit,
    approvalAgent,
    addWriteProposal,
    addCommandProposal,
  });
  const { workChatList, workChatOpen, workChatSend, workChatCancel } = workChat.handlers;
  const { resetProjectChats } = workChat;

  const workSwarm = createWorkSwarmHandlers({
    services,
    notify: (notification) => options.notify?.(notification),
    activitySink,
    resolveLoadedProject,
  });
  const {
    workSwarmRun,
    workSwarmBoard,
    workSwarmRuns,
    workSwarmCancel,
    workSwarmRemove,
    workSwarmVerify,
    workSwarmRetry,
  } = workSwarm.handlers;
  const swarmServiceFor = workSwarm.swarmServiceFor;

  const skill = createSkillHandlers({
    services,
    notify: (notification) => options.notify?.(notification),
    historyLimit: (current) => (settingsOverride ?? current.settings).historyLimit,
    settingsView: (current) => settingsOverride ?? current.settings,
  });
  const {
    skillList,
    skillOpen,
    skillChapter,
    skillCreate,
    skillLessonBuild,
    skillLessonRead,
    skillChatList,
    skillChatOpen,
    skillChatCreate,
    skillChatSend,
    skillChatCancel,
    skillSourcesList,
    skillSourcesAdd,
    skillStagesSave,
    skillArchive,
    skillRemove,
    skillExport,
  } = skill.handlers as {
    skillList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillOpen: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillChapter: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillCreate: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillLessonBuild: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillLessonRead: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillChatList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillChatOpen: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillChatCreate: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillChatSend: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillChatCancel: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillSourcesList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillSourcesAdd: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillStagesSave: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillArchive: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillRemove: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    skillExport: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
  const { resetSkillChats } = skill;

  const sessionLifecycle = createSessionLifecycleHandlers({ services, resolveSession });
  const {
    sessionOpen,
    sessionCoverage,
    sessionCreate,
    sessionToggleStep,
    sessionGenerateSteps,
  } = sessionLifecycle.handlers;

  const sessionExtras = createSessionExtrasHandlers({ services, resolveSession });
  const {
    sessionFigureList,
    sessionFigureExtract,
    sessionFigureRead,
    sessionFigureAnnotate,
    sessionFigureRemove,
    sessionMistakeList,
    sessionMistakeRecord,
    sessionMistakePromote,
    sessionMistakeCorrect,
  } = sessionExtras.handlers;

  const workspaceRead = createWorkspaceReadHandlers({
    services,
    resolveSession,
    settingsView: (current) => settingsOverride ?? current.settings,
  });
  const {
    workspaceInfo,
    sessionList,
    statsSummary,
    statsExport,
    achievementsList,
    sourceList,
    sourceAdd,
  } = workspaceRead.handlers;

  const settingsSurface = createSettingsHandlers({
    services,
    settingsView: (current) => settingsOverride ?? current.settings,
    setSettings: (view) => {
      settingsOverride = view;
    },
    keybinds: (current) =>
      keybindsOverride ?? {
        keybinds: keybindTable(current.config?.ui.keybinds),
        fixedKeybinds: keybindTable(current.config?.ui.fixed_keybinds),
      },
    setKeybinds: (maps) => {
      keybindsOverride = maps;
    },
    theme: (current) => themeTokensOverride ?? current.config?.ui.custom_theme ?? {},
    setTheme: (tokens) => {
      themeTokensOverride = tokens;
    },
    decision: (current) =>
      decisionOverride ?? {
        enabled: current.config?.decision_layer?.enabled ?? false,
        model: current.config?.decision_layer?.model ?? "",
      },
    setDecision: (settings) => {
      decisionOverride = settings;
    },
  });
  const {
    settingsGet,
    providerList,
    providerLink,
    promptsList,
    promptsSet,
    updateInfo,
    updateCheck,
    themeCustomGet,
    themeCustomSet,
    keybindsGet,
    keybindsSet,
    decisionGet,
    decisionSet,
  } = settingsSurface.handlers as {
    settingsGet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    providerList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    providerLink: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    promptsList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    promptsSet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    updateInfo: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    updateCheck: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    themeCustomGet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    themeCustomSet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    keybindsGet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    keybindsSet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    decisionGet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    decisionSet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
  const archiveSurface = createArchiveHandlers({
    services,
    settingsView: (current) => settingsOverride ?? current.settings,
    dropSessionChat,
    resolveSession,
  });
  const {
    sessionArchive,
    sessionRemove,
    sessionExport,
    archiveList,
    archiveRestore,
    archiveRemove,
  } = archiveSurface.handlers;

  const mcpSurface = createMcpHandlers({
    services,
    policy: (current) => policyOverride ?? current.config?.plugins.policy ?? {},
    setPolicy: (next) => {
      policyOverride = next;
    },
    resolvePermission: (requestId, allow) => {
      pendingPluginPermissions.get(requestId)?.finish(allow);
    },
  });
  const { mcpList, mcpRefresh, mcpPolicyGet, mcpPolicySet, mcpConfirm } = mcpSurface.handlers;


  const teach = createTeachHandlers({
    services,
    notify: (notification) => options.notify?.(notification),
  });
  const {
    teachState,
    teachMeasure,
    teachStep,
    teachCheck,
    teachPractice,
    teachPracticeResult,
    teachSideSnapshot,
    teachSideSend,
    teachSideClear,
    researchStart,
    researchList,
    researchRead,
    researchCancel,
  } = teach.handlers;

  const workProject = createWorkProjectHandlers({ services });
  const {
    workList,
    workOpen,
    workCreate,
    workInstructionsSave,
    workTemplatesList,
    workAgentSave,
    workAgentDelete,
    workDefaultAgent,
    workChanges,
  } = workProject;



  /** The global opt-in, read from configuration. */
  const workPermissionsGet = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    return success(id, { ...workPermissionsStored(current.value) });
  };

  /**
   * Write the global Work opt-in (`docs/product.md` §8.2).
   *
   * This is the *outer* approval gate: `work.write.decide` and
   * `work.command.decide` require the matching flag here **and** the resolved
   * profile's own flag. An omitted field keeps its stored value; a request with
   * neither is a no-op success. A malformed shape is `-32602`, a build without
   * the config writer is `-32601`, and a failed write is one `-32000` that leaves
   * the previous values in place. Nothing is retried.
   */
  const workPermissionsSet = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawWrite = params.allowWrite;
    if (rawWrite !== undefined && typeof rawWrite !== "boolean") {
      return invalid(id, "work.permissions.set: allowWrite must be true or false");
    }
    const rawCommand = params.allowCommand;
    if (rawCommand !== undefined && typeof rawCommand !== "boolean") {
      return invalid(id, "work.permissions.set: allowCommand must be true or false");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    const stored = workPermissionsStored(current.value);
    if (rawWrite === undefined && rawCommand === undefined) {
      return success(id, { ...stored });
    }

    const next: WorkPermissions = {
      allowWrite: rawWrite ?? stored.allowWrite,
      allowCommand: rawCommand ?? stored.allowCommand,
    };

    if (!current.value.saveWorkPermissions) {
      return failure(
        id,
        -32601,
        "Work permission editing is not available in this build",
        undefined,
        false,
      );
    }

    const saved = await current.value.saveWorkPermissions(next);
    if (!saved.ok) {
      const message = oneLine(saved.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "config", message }, false);
    }
    // The config write is the truth: the gate and the reply read what it stored.
    workPermissionsOverride = saved.value;
    return success(id, { ...saved.value });
  };

  /* ------------------------------------------------------------------------ */
  /* Review queue — read-only (review surface)                                */
  /* ------------------------------------------------------------------------ */

  /**
   * Per-session coverage for the review snapshot.
   *
   * The queue service reads the session records for its items; coverage needs
   * each session's document text as well, so it is read here through the same
   * `loadSessionHome` the session home uses. A session that no longer opens is
   * skipped: the queue already reports it as a diagnostic, and one unreadable
   * folder must not fail the whole snapshot. An empty report is a real answer
   * (a session with no sources), not a missing one.
   */
  const schoolCoverage = async (
    workspace: CoreServices["workspace"],
  ): Promise<SessionCoverageRow[]> => {
    const rows: SessionCoverageRow[] = [];
    for (const row of await loadSessionRows(workspace)) {
      if (row.broken) continue;
      const home = await loadSessionHome(workspace, row.id);
      if (home === null) continue;
      rows.push({
        sessionId: row.id,
        name: home.name,
        report: computeCoverage(home.sources, home.documents),
      });
    }
    return rows;
  };

  /**
   * The read-only review queue (`docs/product.md` §6.1).
   *
   * Built from what the workspace already records — unchecked steps, missed
   * flashcards, unfinished skill stages and session memory — by the service;
   * this handler owns the `side` filter, the per-session coverage reports and
   * the failure shape. Nothing is written and nothing is marked: marking
   * known/missed is a later packet, so a shell must treat this as a snapshot.
   *
   * A broken session or goal folder is a **diagnostic inside the queue**, not a
   * request failure: one unreadable folder never hides the rest of the work. A
   * failure of the service itself (an unexpected read error) is one `-32000`
   * with `data.kind: "review"` and `retryable: false`.
   */
  /**
   * The unverified completed swarm tasks this process knows.
   *
   * A board is process state (`desktop/docs/protocol.md`): a restart forgets
   * every run, so this read returns nothing until a run happens again. The
   * report on disk keeps its last bytes; this queue deliberately does not invent
   * a run from a report it cannot verify in memory.
   */
  const reviewTasks = async (current: CoreServices): Promise<SwarmTaskEntry[]> => {
    let rows;
    try {
      rows = await listProjects(current.workspace);
    } catch {
      return [];
    }
    if (rows.length === 0) return [];
    const service = swarmServiceFor(current);
    const out: SwarmTaskEntry[] = [];
    for (const row of rows) {
      if (row.broken) continue;
      const boards = new Map(service.runs(row.id).map((board) => [board.runId, board]));
      for (const board of boards.values()) {
        for (const task of board.tasks) {
          out.push({
            projectId: row.id,
            projectName: row.name,
            runId: board.runId,
            taskId: task.id,
            title: task.title,
            status: task.status,
            verified: task.verified,
          });
        }
      }
      // Reports are the durable half: a restart forgets every board, but the
      // report keeps the task ids and statuses. A run still in memory is read
      // from the board only, so a task is never listed twice.
      for (const runId of await listReportRuns(current.workspace, row.id)) {
        if (boards.has(runId)) continue;
        const stored = await readReport(current.workspace, row.id, runId);
        if (stored === null) continue;
        for (const task of stored.report.tasks) {
          if (task.state !== "done") continue;
          out.push({
            projectId: row.id,
            projectName: row.name,
            runId,
            taskId: task.id,
            title: task.title === "" ? task.id : task.title,
            status: "done",
            verified: false,
          });
        }
      }
    }
    return out;
  };

  /**
   * Mark a Work task verified through the swarm service.
   *
   * `known` is verification: the run's report is rewritten and the activity log
   * records the decision. `missed` is refused — a completed task has no miss
   * signal, and inventing one would make the nudge state lie.
   */
  const markTaskItem = async (
    current: CoreServices,
    target: Extract<ReviewMarkTarget, { kind: "task" }>,
    result: ReviewMarkResult,
  ): Promise<MarkOutcome> => {
    if (result !== "known") {
      return {
        ok: false,
        message: "a completed task has no miss signal; verify it or leave it",
      };
    }
    const service = swarmServiceFor(current);
    // A run this process still knows: verify through the board, which also
    // rewrites the report and records the activity entry.
    if (service.board(target.projectId, target.runId) !== null) {
      const verified = await service.verify({
        projectId: target.projectId,
        runId: target.runId,
        taskId: target.taskId,
      });
      if (!verified.ok) return { ok: false, message: oneLine(verified.error.message) };
      return { ok: true };
    }

    // Report-only verification: the run outlived the process. Rewrite the one
    // line, then record the decision in the activity log exactly as the board
    // path does. A log failure is best-effort and never fails the verification.
    const written = await verifyReportTaskFile({
      workspace: current.workspace,
      projectId: target.projectId,
      runId: target.runId,
      taskId: target.taskId,
    });
    if (!written.ok) return { ok: false, message: oneLine(written.error.message) };
    if (!written.value.already) {
      const sink = activitySink(current);
      await sink?.({
        kind: "swarm",
        project: target.projectId,
        run: target.runId,
        event: "verified",
        task: target.taskId,
        status: "verified",
        at: new Date().toISOString(),
      });
    }
    return { ok: true };
  };

  const reviewQueueResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawSide = params.side;
    if (rawSide !== undefined && !isReviewSide(rawSide)) {
      return invalid(
        id,
        `review.queue: unknown side ${JSON.stringify(rawSide)}; expected one of ${REVIEW_SIDES.join(", ")}`,
      );
    }
    const side = rawSide ?? "all";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    // Work tasks are only read for the projections that can show them: a
    // school- or skills-only view must not touch the Work registry.
    const tasks =
      side === "all" || side === "work" ? await reviewTasks(current.value) : [];
    let queue: ReviewQueueResult;
    try {
      queue = await reviewQueue(current.value.workspace, { tasks });
    } catch (error) {
      const message = oneLine(messageOf(error));
      return failure(id, BOOT_FAILED, message, { kind: "review", message }, false);
    }

    const projected =
      side === "all" ? queue : projectReviewSide(queue, current.value.workspace, side);
    // Coverage is school-side material (`docs/product.md` §6.1); a skills-only
    // projection has none, and `all`/`school` get one report per session.
    const coverage =
      side === "skills" || side === "work"
        ? []
        : await schoolCoverage(current.value.workspace);
    return success(id, { queue: { ...projected, coverage } });
  };

  /* ------------------------------------------------------------------------ */
  /* Review marking — the write half of the Review surface                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Mark one review item known or missed (`docs/product.md` §6.1–6.2).
   *
   * Three kinds write; session memory is read-only and refused with a message.
   * The service already owns every rule behind each kind (the step toggle, the
   * deck codec, the curriculum transition), so this handler only parses the id,
   * dispatches and then returns a fresh queue: the shell replaces its snapshot
   * from one reply instead of guessing what the mark did to the list.
   *
   * A malformed id, an unknown `result` or a missing parameter is `-32602`; an
   * id that is well formed but names nothing, and memory, is one `-32000` with
   * `data.kind: "review"` and `retryable: false`. Nothing is retried.
   */
  const reviewMarkResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawItem = params.itemId;
    if (typeof rawItem !== "string" || rawItem.trim() === "") {
      return invalid(id, "review.mark requires a non-empty itemId string");
    }
    const itemId = rawItem.trim();

    const rawResult = params.result;
    if (!isReviewMarkResult(rawResult)) {
      return invalid(
        id,
        `review.mark: unknown result ${JSON.stringify(rawResult)}; expected one of ${REVIEW_MARK_RESULTS.join(", ")}`,
      );
    }
    const result = rawResult;

    const parsed = parseReviewItemId(itemId);
    if (!parsed.ok) return invalid(id, `review.mark: ${parsed.message}`);

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const workspace = current.value.workspace;

    const target = parsed.target;
    if (target.kind === "memory") {
      return failure(
        id,
        BOOT_FAILED,
        "Session memory is read-only history; it cannot be marked known or missed.",
        {
          kind: "review",
          itemId,
          message: "session memory is read-only; it is history, not a review item",
        },
        false,
      );
    }

    const outcome =
      target.kind === "step"
        ? await markStep(workspace, target, result)
        : target.kind === "card"
          ? await markCard(workspace, target, result)
          : target.kind === "mistake"
            ? await markMistakeTarget(workspace, target, result)
            : target.kind === "task"
              ? await markTaskItem(current.value, target, result)
              : await markStage(workspace, target, result);
    if (!outcome.ok) {
      return failure(
        id,
        BOOT_FAILED,
        outcome.message,
        { kind: "review", itemId, message: outcome.message },
        false,
      );
    }

    // One call, one snapshot: the shell replaces its queue, never patches it.
    let queue: ReviewQueueResult;
    try {
      queue = await reviewQueue(workspace, { tasks: await reviewTasks(current.value) });
    } catch (error) {
      const message = oneLine(messageOf(error));
      return failure(id, BOOT_FAILED, message, { kind: "review", itemId, message }, false);
    }
    // The reply must be the same snapshot shape `review.queue` sends, coverage
    // included, or a mark would silently drop it from the shell's copy.
    return success(id, { queue: { ...queue, coverage: await schoolCoverage(workspace) } });
  };

  /* ------------------------------------------------------------------------ */
  /* Knowledge base — read-only search and topic tree                        */
  /* ------------------------------------------------------------------------ */

  /**
   * Unified knowledge search over both vaults and the workspace's own records
   * (`docs/product.md` §6.3).
   *
   * There is **one read** of every source and `scope` is a projection over that
   * result, never a second pass: a `school` request cannot see a skills row
   * because the row was labelled when it was built, not filtered afterwards into
   * existence. The vault notes come from the side's FTS index (refreshed as a
   * cache, never Markdown); no model is called and no network is contacted.
   *
   * Ranking is deterministic and lexical: a title/name prefix beats a whole-word
   * match, which beats a body substring; ties go to the most recently updated,
   * then the path. At most {@link KNOWLEDGE_HIT_LIMIT} hits are returned.
   */
  /**
   * The source-grounded learning graph (`desktop/docs/redesign.md` §6).
   *
   * Read-only and derived: goals, teaching steps with their citations, copied
   * sources, lock-in sessions and tasks, cards, research and figures. A broken
   * folder is a diagnostic in the reply; it is never a request failure.
   */
  const knowledgeGraphResponse = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    try {
      return success(id, { graph: await loadLearningGraph(current.value.workspace) });
    } catch (error) {
      return failure(
        id,
        BOOT_FAILED,
        oneLine(messageOf(error)),
        { kind: "knowledge-graph", message: oneLine(messageOf(error)) },
        false,
      );
    }
  };

  const knowledgeSearchResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawQuery = params.query;
    if (typeof rawQuery !== "string" || rawQuery.trim() === "") {
      return invalid(id, "knowledge.search requires a non-empty query string");
    }
    const query = rawQuery.trim();

    const rawScope = params.scope;
    if (rawScope !== undefined && !isKnowledgeScope(rawScope)) {
      return invalid(
        id,
        `knowledge.search: unknown scope ${JSON.stringify(rawScope)}; expected one of ${KNOWLEDGE_SCOPES.join(", ")}`,
      );
    }
    const scope: KnowledgeScope = rawScope ?? "all";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const workspace = current.value.workspace;

    const candidates: KnowledgeCandidate[] = [];
    candidates.push(...(await indexedNoteCandidates(workspace, "school", query)));
    candidates.push(...(await indexedNoteCandidates(workspace, "skills", query)));
    candidates.push(...(await sessionKnowledge(workspace)));
    candidates.push(...(await goalKnowledge(workspace)));
    candidates.push(...(await projectKnowledge(workspace)));
    candidates.push(...(await archiveKnowledge(workspace.paths.archiveIndex)));

    const lowered = query.toLowerCase();
    const hits: KnowledgeHit[] = [];
    for (const candidate of candidates) {
      const score = knowledgeScore(candidate, query);
      if (score === 0) continue;
      // Keep the excerpt on the field that actually matched, so a title-only hit
      // is not shown with the first line of an unrelated body.
      const excerptSource =
        candidate.text.toLowerCase().includes(lowered) || candidate.text === ""
          ? candidate.text
          : candidate.title;
      hits.push({
        id: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        excerpt: knowledgeExcerpt(excerptSource, query),
        side: candidate.side,
        path: candidate.path,
        updated: candidate.updated,
        score,
      });
    }

    hits.sort(knowledgeSort);
    const projected = scope === "all" ? hits : hits.filter((hit) => hit.side === scope);
    return success(id, { hits: projected.slice(0, KNOWLEDGE_HIT_LIMIT) });
  };

  /**
   * The topic forest built from vault note `topics` frontmatter.
   *
   * One group per first-level topic, with that group's notes sorted by topic
   * path then title. A note without topics lands in `(no topic)`. This reads the
   * Markdown directly: the index is a cache and is never opened or rebuilt here.
   */
  const knowledgeTreeResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawSide = params.side;
    if (rawSide !== undefined && !isKnowledgeTreeSide(rawSide)) {
      return invalid(
        id,
        `knowledge.tree: unknown side ${JSON.stringify(rawSide)}; expected one of ${KNOWLEDGE_TREE_SIDES.join(", ")}`,
      );
    }
    const side: KnowledgeTreeSide = rawSide ?? "all";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const workspace = current.value.workspace;

    const notes: VaultNote[] = [];
    if (side === "all" || side === "school") {
      notes.push(...(await readVaultNotes(workspace.root, workspace.paths.schoolVault)));
    }
    if (side === "all" || side === "skills") {
      notes.push(...(await readVaultNotes(workspace.root, workspace.paths.skillVault)));
    }

    type Grouped = KnowledgeTreeNode & { topic: string };
    const grouped = new Map<string, Grouped[]>();
    for (const note of notes) {
      const topic = note.topics.find((entry) => entry.trim() !== "")?.trim() ?? KNOWLEDGE_NO_TOPIC;
      const firstLevel = topic.split("/")[0]?.trim() || KNOWLEDGE_NO_TOPIC;
      const list = grouped.get(firstLevel) ?? [];
      list.push({ path: note.path, title: note.title, updated: note.updated, topic });
      grouped.set(firstLevel, list);
    }

    const groups: KnowledgeTopicGroup[] = [...grouped.entries()]
      .map(([topic, entries]) => ({
        topic,
        notes: entries
          .sort((a, b) => {
            if (a.topic !== b.topic) return a.topic < b.topic ? -1 : 1;
            if (a.title !== b.title) return a.title < b.title ? -1 : 1;
            return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
          })
          .map(({ path, title, updated }) => ({ path, title, updated })),
      }))
      .sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));

    return success(id, { groups });
  };

  /**
   * Open one knowledge hit in a reader (`docs/product.md` §6.3).
   *
   * The `id` is exactly what `knowledge.search` returned, or a bare note path
   * from `knowledge.tree`; both resolve through the same scheme and the same
   * vault confinement the row builders use. The body is content, never a
   * citation: `hit.side` still says which side of the wall the item belongs to.
   * Read-only — no index rebuild, no model, no network, no write — and a body is
   * capped at {@link KNOWLEDGE_BODY_LIMIT} bytes with `truncated` set.
   */
  const knowledgeReadResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "knowledge.read requires a non-empty item id");
    }
    const itemId = rawId.trim();
    const target = parseKnowledgeReadTarget(itemId);
    if (target === null) {
      const message = `there is no knowledge item "${itemId}"`;
      return failure(id, BOOT_FAILED, message, { kind: "knowledge", id: itemId, message }, false);
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const read = await readKnowledgeTarget(current.value.workspace, target, itemId);
    if (!read.ok) {
      return failure(
        id,
        BOOT_FAILED,
        read.message,
        { kind: "knowledge", id: itemId, message: read.message },
        false,
      );
    }
    const capped = capKnowledgeBody(read.body);
    return success(id, { hit: read.hit, body: capped.body, truncated: capped.truncated });
  };

  const settingsPatch = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const patch = params.patch;
    if (!isRecord(patch)) {
      return invalid(id, "settings.patch requires a patch object");
    }
    // The decision layer has its own rejection rules (`decision.set`), so the
    // generic config patch must not be a second writer that bypasses them.
    if ("decision_layer" in patch) {
      return invalid(
        id,
        "settings.patch cannot change the decision layer; use decision.set",
      );
    }
    // The Work opt-in is the approval gate's own read. A generic patch would
    // change the file without changing the gate's view of it, which is exactly
    // the bypass this gate exists to prevent.
    if ("work" in patch) {
      return invalid(
        id,
        "settings.patch cannot change Work permissions; use work.permissions.set",
      );
    }
    // A prompt note is appended to a specific generator (`prompts.set`), so the
    // generic patch must not be a second writer with no id or length check.
    if ("prompts" in patch) {
      return invalid(id, "settings.patch cannot change prompt notes; use prompts.set");
    }
    // The custom palette has its own validation (`theme.custom.set`): a generic
    // patch would store a token name or colour the editor could never produce.
    if (isRecord(patch.ui) && "custom_theme" in patch.ui) {
      return invalid(
        id,
        "settings.patch cannot change the custom palette; use theme.custom.set",
      );
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    if (!current.value.saveConfig) {
      return failure(id, -32601, "Settings editing is not available in this build", undefined, false);
    }
    const saved = await current.value.saveConfig(patch);
    if (!saved.ok) {
      return failure(id, BOOT_FAILED, saved.error.message, { kind: "config" }, false);
    }
    settingsOverride = saved.value;
    // A new model only takes effect in a controller built after `updateConfig`.
    if (current.value.createChat && current.value.history) {
      const next = current.value.createChat(current.value.history);
      (current.value as { controller: ChatController }).controller = next;
      chatUnsubscribe?.();
      chatUnsubscribe = null;
      chatController = next;
      chatLoaded = false;
      await ensureChat(current.value);
    }
    // A model change captured the old service in every session and project
    // controller; drop them so the next use is built with the saved model. Other
    // settings (theme, hints) leave an in-flight reply alone.
    if (isRecord(patch.models)) {
      resetSessionChats();
      resetProjectChats();
      resetSkillChats();
    }
    return success(id, saved.value as unknown as Record<string, unknown>);
  };

  const dispatch = async (
    id: RpcId,
    request: JsonRpcRequest,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    switch (request.method) {
      case "initialize":
        return success(id, {
          protocol: SERVER_PROTOCOL_VERSION,
          server: "lockedin-core",
          capabilities: [...CAPABILITIES],
        });
      case "ping":
        return success(id, { pong: true });
      case "shutdown":
        return success(id, { ok: true });
      case "chat.snapshot":
        return chatSnapshotResponse(id);
      case "chat.send": {
        const text = params.text;
        if (text !== undefined && typeof text !== "string") {
          return invalid(id, "chat.send text must be a string");
        }
        const requested = params.images;
        if (requested !== undefined && !Array.isArray(requested)) {
          return invalid(id, "chat.send images must be an array of image file paths");
        }
        const imagePaths: string[] = [];
        for (const entry of requested ?? []) {
          if (typeof entry !== "string" || entry.trim() === "") {
            return invalid(id, "chat.send images must be non-empty file paths");
          }
          imagePaths.push(entry);
        }
        if (imagePaths.length > MAX_IMAGES) {
          return invalid(id, `chat.send accepts at most ${MAX_IMAGES} images`);
        }
        // An image is content, so a text-less turn is a real request; text only
        // still has to say something.
        if ((text ?? "").trim() === "" && imagePaths.length === 0) {
          return invalid(id, "chat.send requires a non-empty text string");
        }
        const current = await services();
        if (!current.ok) return bootFailureResponse(id, current.error);
        const controller = await ensureChat(current.value);
        if (!controller) return failure(id, -32601, "Chat is not available in this build", undefined, false);
        for (const path of imagePaths) {
          const attached = controller.attachImage({
            path,
            name: basename(path),
            mediaType: imageMediaType(path),
            sha256: "",
          });
          if (!attached.ok) {
            const message = oneLine(attached.reason);
            return failure(id, BOOT_FAILED, message, { kind: "image", message }, false);
          }
        }
        void controller
          .send(text)
          .then((outcome) => {
            options.notify?.({ jsonrpc: "2.0", method: "chat.done", params: { ...outcome } });
          })
          .catch((error: unknown) => {
            options.notify?.({
              jsonrpc: "2.0",
              method: "chat.error",
              params: { message: oneLine(messageOf(error)) },
            });
          });
        return success(id, { turnId: "chill" });
      }
      case "chat.cancel": {
        const current = await services();
        if (!current.ok) return bootFailureResponse(id, current.error);
        const controller = await ensureChat(current.value);
        controller?.cancel();
        return success(id, { ok: true });
      }
      case "session.open":
        return sessionOpen(id, params);
      case "session.coverage":
        return sessionCoverage(id, params);
      case "session.create":
        return sessionCreate(id, params);
      case "session.toggleStep":
        return sessionToggleStep(id, params);
      case "session.generateSteps":
        return sessionGenerateSteps(id, params);
      case "session.document":
        return sessionDocument(id, params);
      case "session.instructions.get":
        return sessionInstructionsGet(id, params);
      case "session.instructions.save":
        return sessionInstructionsSave(id, params);
      case "session.instructions.import":
        return sessionInstructionsImport(id, params);
      case "session.instructions.reextract":
        return sessionInstructionsReextract(id, params);
      case "session.archive":
        return sessionArchive(id, params);
      case "session.remove":
        return sessionRemove(id, params);
      case "session.export":
        return sessionExport(id, params);
      case "session.output.build":
        return sessionOutputBuild(id, params);
      case "session.deck.state":
        return sessionDeckState(id, params);
      case "session.deck.grade":
        return sessionDeckGrade(id, params);
      case "session.deck.reset":
        return sessionDeckReset(id, params);
      case "session.output.read":
        return sessionOutputRead(id, params);
        case "session.output.mark":
          return sessionOutputMark(id, params);
      case "archive.list":
        return archiveList(id, params);
      case "archive.restore":
        return archiveRestore(id, params);
      case "archive.remove":
        return archiveRemove(id, params);
      case "source.list":
        return sourceList(id, params);
      case "source.add":
        return sourceAdd(id, params);
      case "session.chat.snapshot":
        return sessionChatSnapshot(id, params);
      case "session.chat.send":
        return sessionChatSend(id, params);
      case "session.chat.context":
        return sessionChatContext(id, params);
      case "session.chat.compact":
        return sessionChatCompact(id, params);
      case "session.chat.uncompact":
        return sessionChatUncompact(id, params);
      case "session.chat.cancel":
        return sessionChatCancel(id, params);
      case "workspace.info":
        return workspaceInfo(id);
      case "session.list":
        return sessionList(id, params);
      case "stats.summary":
        return statsSummary(id, params);
      case "stats.export":
        return statsExport(id, params);
      case "achievements.list":
        return achievementsList(id);
      case "settings.get":
        return settingsGet(id, params);
      case "settings.patch":
        return settingsPatch(id, params);
      case "theme.custom.get":
        return themeCustomGet(id, params);
      case "theme.custom.set":
        return themeCustomSet(id, params);
      case "decision.get":
        return decisionGet(id, params);
      case "decision.set":
        return decisionSet(id, params);
      case "keybinds.get":
        return keybindsGet(id, params);
      case "keybinds.set":
        return keybindsSet(id, params);
      case "provider.list":
        return providerList(id, params);
      case "provider.link":
        return providerLink(id, params);
      case "work.list":
        return workList(id);
      case "work.open":
        return workOpen(id, params);
      case "work.create":
        return workCreate(id, params);
      case "work.instructions.save":
        return workInstructionsSave(id, params);
      case "work.templates.list":
        return workTemplatesList(id, params);
      case "work.agent.save":
        return workAgentSave(id, params);
      case "work.agent.delete":
        return workAgentDelete(id, params);
      case "work.defaultAgent":
        return workDefaultAgent(id, params);
      case "work.changes":
        return workChanges(id, params);
      case "work.write.propose":
        return workWritePropose(id, params);
      case "work.write.decide":
        return workWriteDecide(id, params);
      case "work.command.propose":
        return workCommandPropose(id, params);
      case "work.command.decide":
        return workCommandDecide(id, params);
      case "work.permissions.get":
        return workPermissionsGet(id);
      case "work.permissions.set":
        return workPermissionsSet(id, params);
      case "work.approvals.list":
        return workApprovalsList(id, params);
      case "work.chat.list":
        return workChatList(id, params);
      case "work.chat.open":
        return workChatOpen(id, params);
      case "work.chat.send":
        return workChatSend(id, params);
      case "work.chat.cancel":
        return workChatCancel(id, params);
      case "work.swarm.run":
        return workSwarmRun(id, params);
      case "work.swarm.board":
        return workSwarmBoard(id, params);
      case "work.swarm.runs":
        return workSwarmRuns(id, params);
      case "work.swarm.cancel":
        return workSwarmCancel(id, params);
      case "work.swarm.remove":
        return workSwarmRemove(id, params);
      case "work.swarm.verify":
        return workSwarmVerify(id, params);
      case "work.swarm.retry":
        return workSwarmRetry(id, params);
      case "activity.list":
        return activityList(id, params);
      case "mcp.list":
        return mcpList(id, params);
      case "mcp.refresh":
        return mcpRefresh(id, params);
      case "mcp.policy.get":
        return mcpPolicyGet(id, params);
      case "mcp.policy.set":
        return mcpPolicySet(id, params);
      case "mcp.confirm":
        // Answers a pending in-memory prompt; it never boots the app.
        return mcpConfirm(id, params);
      case "review.queue":
        return reviewQueueResponse(id, params);
      case "review.mark":
        return reviewMarkResponse(id, params);
      case "knowledge.search":
        return knowledgeSearchResponse(id, params);
      case "knowledge.tree":
        return knowledgeTreeResponse(id, params);
      case "knowledge.graph":
        return knowledgeGraphResponse(id);
      case "knowledge.read":
        return knowledgeReadResponse(id, params);
      case "skill.list":
        return skillList(id, params);
      case "skill.open":
        return skillOpen(id, params);
      case "skill.chapter":
        return skillChapter(id, params);
      case "skill.create":
        return skillCreate(id, params);
      case "skill.stages.save":
        return skillStagesSave(id, params);
      case "skill.archive":
        return skillArchive(id, params);
      case "skill.remove":
        return skillRemove(id, params);
      case "skill.export":
        return skillExport(id, params);
      case "skill.lesson.build":
        return skillLessonBuild(id, params);
      case "skill.lesson.read":
        return skillLessonRead(id, params);
      case "skill.sources.list":
        return skillSourcesList(id, params);
      case "skill.sources.add":
        return skillSourcesAdd(id, params);
      case "teach.state":
        return teachState(id, params);
      case "teach.measure":
        return teachMeasure(id, params);
      case "teach.step":
        return teachStep(id, params);
      case "teach.check":
        return teachCheck(id, params);
      case "teach.practice":
        return teachPractice(id, params);
      case "session.figure.list":
        return sessionFigureList(id, params);
      case "session.figure.extract":
        return sessionFigureExtract(id, params);
      case "session.figure.read":
        return sessionFigureRead(id, params);
      case "session.figure.annotate":
        return sessionFigureAnnotate(id, params);
      case "session.figure.remove":
        return sessionFigureRemove(id, params);
      case "session.mistake.list":
        return sessionMistakeList(id, params);
      case "session.mistake.record":
        return sessionMistakeRecord(id, params);
      case "session.mistake.promote":
        return sessionMistakePromote(id, params);
      case "session.mistake.correct":
        return sessionMistakeCorrect(id, params);
      case "research.start":
        return researchStart(id, params);
      case "research.list":
        return researchList(id, params);
      case "research.read":
        return researchRead(id, params);
      case "research.cancel":
        return researchCancel(id, params);
      case "prompts.list":
        return promptsList(id, params);
      case "prompts.set":
        return promptsSet(id, params);
      case "update.info":
        return updateInfo(id, params);
      case "update.check":
        return updateCheck(id, params);
      case "teach.side.snapshot":
        return teachSideSnapshot(id, params);
      case "teach.side.send":
        return teachSideSend(id, params);
      case "teach.side.clear":
        return teachSideClear(id, params);
      case "teach.practice.result":
        return teachPracticeResult(id, params);
      case "skill.chat.list":
        return skillChatList(id, params);
      case "skill.chat.open":
        return skillChatOpen(id, params);
      case "skill.chat.create":
        return skillChatCreate(id, params);
      case "skill.chat.send":
        return skillChatSend(id, params);
      case "skill.chat.cancel":
        return skillChatCancel(id, params);
      default:
        return failure(id, -32601, `Method not found: ${request.method}`);
    }
  };

  return {
    async handle(request) {
      if (request.id === undefined) return null;
      try {
        return await dispatch(request.id, request, request.params ?? {});
      } catch (error) {
        // A handler failure is one reported error, never a crash or a retry.
        return failure(request.id, -32603, "Internal error", { message: oneLine(messageOf(error)) });
      }
    },
  };
}

export function isShutdown(request: JsonRpcRequest): boolean {
  return request.method === "shutdown";
}
