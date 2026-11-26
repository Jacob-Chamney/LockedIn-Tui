import { createJsonlHistoryPort } from "../storage/chat-history";
import { loadProjectMeta } from "../services/work/agents";
import { CHAT_ID, chatPath, listChats } from "../services/work/chat";
import { nextProjectChatId } from "./views";
import { resolveLoadedProject } from "./work-projects";
import { projectTools, type ChatToolSource } from "../app/actions/projects";
import { commandToolSpecs } from "../services/work/commands";
import { proposeWrite } from "../services/work/diff";
import { proposeCommand, resolveCommandCwd, validateArgv } from "../services/work/commands";
import type { LoadedProject } from "../app/actions/projects";
import type { ChatController } from "../app/chat-controller";
import type { ToolSpec } from "../llm/tools";
import { chatSnapshot, type ChatState } from "./chat-wire";
import type { SessionHandlerContext, SessionServices } from "./session-context";
import type { ProposedWrite } from "../services/work/diff";
import type { ProposedCommand } from "../services/work/commands";
import type { AgentProfile } from "../services/work/agents";
import type { ProjectMeta } from "../services/work/register";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  messageOf,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** What a Work chat handler needs beyond the shared session doors. */
export type WorkChatContext<C extends SessionServices> = SessionHandlerContext<C> & {
  notify: (notification: {
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }) => void;
  historyLimit: (current: C) => number;
  approvalAgent: (
    workspace: C["workspace"],
    projectId: string,
    meta: ProjectMeta,
  ) => Promise<{ error: string } | { agent: AgentProfile }>;
  addWriteProposal: (projectId: string, proposal: ProposedWrite) => string;
  addCommandProposal: (projectId: string, command: ProposedCommand) => string;
};

/**
 * Project chat: `work.chat.*` and the proposal-only tool path
 * (`docs/product.md` §8.2).
 *
 * A project chat is read-only by default. The base toolbox is the project's own
 * files, confined to the registered root; a profile with the write or command
 * flag also gets a **proposal** tool, which builds a pending value and never
 * writes or runs anything. `work.write.decide`/`work.command.decide` remain the
 * only apply path.
 */
export function createWorkChatHandlers<C extends SessionServices>(
  ctx: WorkChatContext<C>,
): {
  handlers: {
    workChatList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workChatOpen: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workChatSend: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workChatCancel: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
  /** Drop every project controller after a settings change. */
  resetProjectChats: () => void;
} {
  const {
    services,
      notify,
    historyLimit,
    approvalAgent,
    addWriteProposal,
    addCommandProposal,
  } = ctx;

  /* ------------------------------------------------------------------------ */
  /* Project chat tools: read-only plus capability-gated proposals            */
  /* ------------------------------------------------------------------------ */

  /** The two write tools a write-capable profile may be offered. */
  const WRITE_TOOL_NAME = "write_file";
  const DELETE_TOOL_NAME = "delete_file";

  /**
   * The proposal write tools. They are value-builders: calling one only creates
   * a pending proposal, never a file.
   */
  const WRITE_PROPOSAL_SPECS: readonly ToolSpec[] = [
    {
      name: WRITE_TOOL_NAME,
      description:
        "Propose writing one text file inside the project. Nothing is written: the user must approve the diff first.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the project root, as listed by list_files.",
          },
          content: {
            type: "string",
            description: "The full new file content; the diff is computed for you.",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      side: "work",
      write: true,
      command: false,
    },
    {
      name: DELETE_TOOL_NAME,
      description:
        "Propose deleting one file inside the project. Nothing is deleted: the user must approve it first.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the project root." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      side: "work",
      write: true,
      command: false,
    },
  ];

  /**
   * The extra tool specs one profile earns. A read-only profile gets none, so
   * the chat sees exactly the three read-only tools it saw before this packet.
   *
   * `commandToolSpecs` normally also checks the global Settings opt-in; that
   * opt-in is a later packet, and this packet gates on the profile alone, so the
   * transport passes the documented "allowed" value here. The real decision
   * still happens in `work.command.decide`.
   */
  function proposalToolSpecs(agent: AgentProfile): ToolSpec[] {
    const specs: ToolSpec[] = [];
    if (agent.allowWrite === true) specs.push(...WRITE_PROPOSAL_SPECS);
    if (agent.allowCommand === true) {
      specs.push(...commandToolSpecs({ settings: { allowCommand: true }, agent }));
    }
    return specs;
  }

  /**
   * Bind the project toolbox for one chat, adding proposal tools when the
   * project's approving profile is allowed to change something.
   *
   * The read-only tools are `projectTools` unchanged. A proposal tool resolves
   * the same service the explicit `work.write.propose` / `work.command.propose`
   * methods use, stores the value in the same in-memory maps `decide` consumes,
   * and emits a notification so the shell can show the pending row. **No file is
   * written and no process is started here**: `decide` is still the only apply
   * or run path.
   *
   * A project with no profile, or a profile whose flags are both off, gets the
   * three read-only tools and the original context — the old behaviour exactly.
   */
  const buildProjectChatTools = async (
    current: C,
    project: LoadedProject,
    chatId: string,
  ): Promise<ChatToolSource | null> => {
    const base = projectTools({
      workspace: current.workspace,
      id: project.id,
      name: project.name,
      folder: project.folder,
    });
    if (base === null) return null;

    const meta = await loadProjectMeta(current.workspace, project.id);
    if (!meta.ok) return base;
    const selected = await approvalAgent(current.workspace, project.id, meta.value);
    if ("error" in selected) return base;
    const agent = selected.agent;

    const extra = proposalToolSpecs(agent);
    if (extra.length === 0) return base;

    /** Build a proposal and return the tool result; `null` means "not ours". */
    const propose = async (
      name: string,
      input: Record<string, unknown>,
    ): Promise<string | null> => {
      if (name === WRITE_TOOL_NAME || name === DELETE_TOOL_NAME) {
        const path = typeof input.path === "string" ? input.path.trim() : "";
        if (path === "") {
          return JSON.stringify({
            ok: false,
            error: "path must be a non-empty string relative to the project root",
          });
        }
        const content = input.content;
        if (name === WRITE_TOOL_NAME && typeof content !== "string") {
          return JSON.stringify({ ok: false, error: "content must be a string" });
        }

        const proposed = await proposeWrite({
          root: meta.value.root,
          path,
          newContent: name === DELETE_TOOL_NAME ? null : (content as string),
        });
        if (!proposed.ok) {
          return JSON.stringify({ ok: false, error: oneLine(proposed.error.message) });
        }
        const proposalId = addWriteProposal(project.id, proposed.value);
        notify({
          jsonrpc: "2.0",
          method: "work.write.proposal",
          params: {
            projectId: project.id,
            chatId,
            id: proposalId,
            path: proposed.value.path,
            kind: proposed.value.kind,
            diff: proposed.value.diff,
            hunks: proposed.value.hunks,
            stats: proposed.value.stats,
            baseHash: proposed.value.baseHash,
          },
        });
        return JSON.stringify({
          ok: true,
          status: "pending-approval",
          id: proposalId,
          path: proposed.value.path,
          message: "the user must approve this before it is applied",
        });
      }

      if (name === "run_command") {
        const validated = validateArgv(input.argv);
        if (!validated.ok) {
          return JSON.stringify({ ok: false, error: oneLine(validated.error.message) });
        }
        const rawCwd = input.cwd;
        if (rawCwd !== undefined && typeof rawCwd !== "string") {
          return JSON.stringify({ ok: false, error: "cwd must be a string" });
        }
        const rawReason = input.reason;
        if (rawReason !== undefined && typeof rawReason !== "string") {
          return JSON.stringify({ ok: false, error: "reason must be a string" });
        }

        const cwd = typeof rawCwd === "string" && rawCwd.trim() !== "" ? rawCwd.trim() : ".";
        const confined = await resolveCommandCwd(meta.value.root, cwd);
        if (!confined.ok) {
          return JSON.stringify({ ok: false, error: oneLine(confined.error.message) });
        }
        const reason = typeof rawReason === "string" ? rawReason.trim() : "";
        const command = proposeCommand({
          argv: validated.value,
          cwd,
          ...(reason === "" ? {} : { reason }),
        });
        const proposalId = addCommandProposal(project.id, command);
        notify({
          jsonrpc: "2.0",
          method: "work.command.proposal",
          params: {
            projectId: project.id,
            chatId,
            id: proposalId,
            argv: command.argv,
            cwd: command.cwd,
            reason: command.reason,
            risk: command.risk,
          },
        });
        return JSON.stringify({
          ok: true,
          status: "pending-approval",
          id: proposalId,
          argv: command.argv,
          message: "the user must approve this before it is applied",
        });
      }

      return null;
    };

    const capabilities = [
      "Change tools only propose; the user must approve each proposal before anything is applied or run.",
      "Never claim a change was made or a command ran; a proposal stays pending until the user decides.",
    ];
    if (agent.allowWrite === true) {
      capabilities.push(
        "write_file and delete_file only build a diff and write nothing.",
      );
    }
    if (agent.allowCommand === true) {
      capabilities.push("run_command only builds an argv array and starts no process.");
    }
    const proposalNote = capabilities.join("\n");

    return {
      specs: [...base.specs, ...extra],
      ...(base.dynamicSpecs === undefined ? {} : { dynamicSpecs: base.dynamicSpecs }),
      resolveTool: async (name, input, context) => {
        const proposed = await propose(name, input);
        if (proposed !== null) return proposed;
        return base.resolveTool(name, input, context);
      },
      context: async (context) => {
        const text = await base.context(context);
        // The read-only context ends with "Writes and commands are off"; when a
        // proposal tool is offered that sentence would contradict the tool list.
        const off = "Writes and commands are off, so do not claim a change was made.";
        if (text.includes(off)) return text.replace(off, proposalNote);
        return text.trim() === "" ? proposalNote : `${text}\n\n${proposalNote}`;
      },
    };
  };

  /* ------------------------------------------------------------------------ */
  /* Project chat (T-019)                                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * One project chat controller, keyed by `projectId:chatId`.
   *
   * A project has several chats (`chats/chat-<n>.jsonl`), so unlike a lock-in
   * session there is no single controller per project: the map key carries both
   * ids and every event echoes them back.
   */
  type ProjectChat = {
    projectId: string;
    chatId: string;
    controller: ChatController;
    state: ChatState;
    timer: ReturnType<typeof setTimeout> | null;
    unsubscribe: () => void;
    /** This stream's frame counter (see `chatSnapshot`). */
    seq: number;
  };

  /**
   * One entry per open chat, holding the in-flight build (not just the finished
   * controller) so two concurrent requests cannot create two history writers for
   * the same chat. A failed build is removed, so the next request starts from
   * scratch — a fresh request, never a retry of a turn.
   */
  const projectChats = new Map<string, Promise<ProjectChat | null>>();
  /**
   * Ids the shell has opened. `work.chat.send` refuses a chat that neither
   * exists on disk nor was opened, so a mistyped id cannot start a second
   * transcript; this set keeps a brand-new chat addressable even after a
   * settings change dropped its controller.
   */
  const openedProjectChats = new Set<string>();

  const projectChatKey = (projectId: string, chatId: string): string => `${projectId}:${chatId}`;

  /** The work-chat failure shape: one project, one chat, one message. */
  const chatFailure = (
    id: RpcId,
    projectId: string,
    chatId: string,
    message: string,
  ): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "chat", projectId, chatId, message }, false);

  const emitProjectState = (runtime: ProjectChat): void => {
    runtime.seq += 1;
    notify({
      jsonrpc: "2.0",
      method: "work.chat.state",
      params: {
        projectId: runtime.projectId,
        chatId: runtime.chatId,
        ...chatSnapshot(runtime.state, runtime.controller.usage(), runtime.seq),
      },
    });
  };

  /**
   * Build one project chat controller on first use.
   *
   * The history is the project's own `chats/<chat>.jsonl`, scoped by the same
   * `ui.chill_history_limit` a session chat uses. The toolbox is
   * `buildProjectChatTools`: the read-only project files, path-confined to the
   * registered root, plus proposal-only write/command tools when the project's
   * approving profile allows them (`docs/product.md` §8.2). The proposal tools
   * never write or run anything; `work.write.decide`/`work.command.decide` stay
   * the only apply path.
   */
  const ensureProjectChat = (
    current: C,
    project: LoadedProject,
    chatId: string,
  ): Promise<ProjectChat | null> => {
    const key = projectChatKey(project.id, chatId);
    openedProjectChats.add(key);
    const cached = projectChats.get(key);
    if (cached) return cached;

    let building!: Promise<ProjectChat | null>;
    building = (async (): Promise<ProjectChat | null> => {
      if (!current.createChat) return null;
      const history = createJsonlHistoryPort(
        chatPath(current.workspace, project.id, chatId),
        historyLimit(current),
      );
      const tools = await buildProjectChatTools(current, project, chatId);
      const controller = current.createChat(
        history,
        "work",
        "work",
        tools ? tools.context : undefined,
        tools ?? undefined,
      );
      await controller.load();
      // A settings patch may have dropped the cache while the history loaded; a
      // controller nobody can reach must not keep a subscription alive.
      if (projectChats.get(key) !== building) {
        controller.dispose();
        return null;
      }
      const runtime: ProjectChat = {
        projectId: project.id,
        chatId,
        controller,
        state: controller.state(),
        timer: null,
        unsubscribe: () => {},
        seq: 0,
      };
      runtime.unsubscribe = controller.subscribe((state) => {
        runtime.state = state;
        if (runtime.timer !== null) return;
        runtime.timer = setTimeout(() => {
          runtime.timer = null;
          emitProjectState(runtime);
        }, 33);
      });
      return runtime;
    })();

    projectChats.set(key, building);
    void building.catch(() => {
      if (projectChats.get(key) === building) projectChats.delete(key);
    });
    return building;
  };

  /**
   * Drop every project controller after a settings change, exactly like the
   * session controllers: the next snapshot or send rebuilds it with the saved
   * model. An unrelated settings patch leaves an in-flight reply alone.
   */
  const resetProjectChats = (): void => {
    const previous = [...projectChats.values()];
    projectChats.clear();
    for (const entry of previous) {
      void entry
        .then((runtime) => {
          if (!runtime) return;
          if (runtime.timer !== null) clearTimeout(runtime.timer);
          runtime.timer = null;
          runtime.unsubscribe();
          runtime.controller.dispose();
        })
        .catch(() => {});
    }
  };

  const projectChatIds = async (
    id: RpcId,
    workspace: C["workspace"],
    projectId: string,
  ): Promise<{ error: JsonRpcFailure } | { chats: string[] }> => {
    const listed = await listChats(workspace, projectId);
    if (!listed.ok) {
      const message = oneLine(listed.error.message);
      return {
        error: failure(id, BOOT_FAILED, message, { kind: "chat", projectId, message }, false),
      };
    }
    return { chats: listed.value };
  };

  const workChatList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, params.projectId);
    if ("error" in resolved) return resolved.error;
    const listed = await projectChatIds(id, current.value.workspace, resolved.project.id);
    if ("error" in listed) return listed.error;
    return success(id, { chats: listed.chats });
  };

  /**
   * Open one project chat: the shell's entry point for the Work surface.
   *
   * An omitted `chatId` resumes the newest chat, or starts `chat-<n+1>` when the
   * project has none. An explicit id must already exist — a typo is refused
   * rather than silently opening a different transcript. The snapshot is the one
   * `ChatSnapshot` shape every chat method returns, loaded once here so the
   * shell does not re-read the file.
   */
  const workChatOpen = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawChat = params.chatId;
    if (rawChat !== undefined && rawChat !== null) {
      if (typeof rawChat !== "string" || rawChat.trim() === "") {
        return invalid(id, "work.chat.open: chatId must be a non-empty string when supplied");
      }
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, params.projectId);
    if ("error" in resolved) return resolved.error;
    const project = resolved.project;

    const listed = await projectChatIds(id, current.value.workspace, project.id);
    if ("error" in listed) return listed.error;

    let chatId: string;
    if (typeof rawChat === "string") {
      chatId = rawChat.trim();
      const known = CHAT_ID.test(chatId) && listed.chats.includes(chatId);
      if (!known) {
        return chatFailure(
          id,
          project.id,
          chatId,
          `there is no chat "${chatId}" in this project`,
        );
      }
    } else {
      chatId = listed.chats.at(-1) ?? nextProjectChatId(listed.chats);
    }

    const runtime = await ensureProjectChat(current.value, project, chatId);
    if (!runtime) {
      return failure(id, -32601, "Project chat is not available in this build", undefined, false);
    }
    return success(id, {
      chatId,
      snapshot: chatSnapshot(
        runtime.controller.state(),
        runtime.controller.usage(),
        runtime.seq,
      ),
    });
  };

  /**
   * Send one turn into one project chat.
   *
   * The reply is a notification pair keyed by `projectId` and `chatId`, so a
   * shell with two projects (or two chats) open can route each update. The
   * request itself returns as soon as the turn is claimed; the state events are
   * authoritative and the shell never appends a local message.
   */
  const workChatSend = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const text = params.text;
    if (typeof text !== "string" || text.trim() === "") {
      return invalid(id, "work.chat.send requires a non-empty text string");
    }
    const rawChat = params.chatId;
    if (typeof rawChat !== "string" || rawChat.trim() === "") {
      return invalid(id, "work.chat.send requires a chat id");
    }
    const chatId = rawChat.trim();
    if (!CHAT_ID.test(chatId)) {
      return invalid(id, `work.chat.send: "${chatId}" is not a chat id`);
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, params.projectId);
    if ("error" in resolved) return resolved.error;
    const project = resolved.project;
    const key = projectChatKey(project.id, chatId);

    // Known means opened in this run or present on disk. A stray id would
    // otherwise start a transcript the shell never listed.
    if (!projectChats.has(key) && !openedProjectChats.has(key)) {
      const listed = await projectChatIds(id, current.value.workspace, project.id);
      if ("error" in listed) return listed.error;
      if (!listed.chats.includes(chatId)) {
        return chatFailure(
          id,
          project.id,
          chatId,
          `there is no chat "${chatId}" in this project`,
        );
      }
    }

    const runtime = await ensureProjectChat(current.value, project, chatId);
    if (!runtime) {
      return failure(id, -32601, "Project chat is not available in this build", undefined, false);
    }
    const projectId = runtime.projectId;
    void runtime.controller
      .send(text)
      .then((outcome) => {
        notify({
          jsonrpc: "2.0",
          method: "work.chat.done",
          params: { projectId, chatId, ...outcome },
        });
      })
      .catch((error: unknown) => {
        notify({
          jsonrpc: "2.0",
          method: "work.chat.error",
          params: { projectId, chatId, message: oneLine(messageOf(error)) },
        });
      });
    return success(id, { turnId: key });
  };

  /** Stop a project turn. A chat with nothing in flight is a no-op, not an error. */
  const workChatCancel = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawChat = params.chatId;
    if (typeof rawChat !== "string" || rawChat.trim() === "") {
      return invalid(id, "work.chat.cancel requires a chat id");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, params.projectId);
    if ("error" in resolved) return resolved.error;

    const cached = projectChats.get(projectChatKey(resolved.project.id, rawChat.trim()));
    if (cached) {
      const runtime = await cached.catch(() => null);
      runtime?.controller.cancel();
    }
    return success(id, { ok: true });
  };


  return {
    handlers: { workChatList, workChatOpen, workChatSend, workChatCancel },
    resetProjectChats,
  };
}
