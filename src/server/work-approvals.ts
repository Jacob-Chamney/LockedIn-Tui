import { randomUUID } from "node:crypto";

import type { ActivityRecord } from "../services/work/activity";
import type { ProjectMeta } from "../services/work/register";
import { listAgents, type AgentProfile } from "../services/work/agents";
import { applyWrite, type WriteApproval } from "../services/work/writes";
import { proposeWrite, type ProposedWrite } from "../services/work/diff";
import {
  proposeCommand,
  resolveCommandCwd,
  runCommand,
  validateArgv,
  type CommandApproval,
  type ProposedCommand,
} from "../services/work/commands";
import type { SessionHandlerContext, SessionServices } from "./session-context";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** The global opt-in a write or command approval reads. */
export type WorkPermissions = {
  allowWrite: boolean;
  allowCommand: boolean;
};

/** The one refusal when the global write opt-in is off. */
export const WORK_WRITE_OPT_IN_OFF =
  "Writes are switched off in Settings → Work; turn them on to approve a write.";

/** The one refusal when the global command opt-in is off. */
export const WORK_COMMAND_OPT_IN_OFF =
  "Commands are switched off in Settings → Work; turn them on to approve a command.";

/** What an approval handler needs from the core beyond the session doors. */
export type WorkApprovalContext<C extends SessionServices> = SessionHandlerContext<C> & {
  notify: (notification: {
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }) => void;
  resolveProject: (
    id: RpcId,
    current: C,
    raw: unknown,
    field?: string,
  ) => Promise<{ error: JsonRpcFailure } | { projectId: string; meta: ProjectMeta }>;
  activitySink: (current: C) => ((record: ActivityRecord) => Promise<void>) | undefined;
  permissions: (current: C) => WorkPermissions;
};
  /* ------------------------------------------------------------------------ */
  /* Write and command approvals                                             */
  /* ------------------------------------------------------------------------ */

/**
 * Write and command approvals: propose, decide, and the pending list
 * (`docs/product.md` §8.2, `swarm/contracts.md` §4.3–4.4).
 *
 * A proposal is a **value, never a side effect**: `propose` builds the diff or
 * the argv and stores it in memory, and only `decide` can write a file or start
 * a process. An approval needs both the global Settings opt-in and the resolved
 * profile's own flag; a rejection needs neither.
 */
export function createWorkApprovalHandlers<C extends SessionServices>(
  ctx: WorkApprovalContext<C>,
): {
  handlers: {
    workWritePropose: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workWriteDecide: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workCommandPropose: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workCommandDecide: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workApprovalsList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
  addWriteProposal: (projectId: string, proposal: ProposedWrite) => string;
  addCommandProposal: (projectId: string, command: ProposedCommand) => string;
  /** The profile that approves a write or command, for the project chat tools. */
  approvalAgent: (
    workspace: C["workspace"],
    projectId: string,
    meta: ProjectMeta,
  ) => Promise<{ error: string } | { agent: AgentProfile }>;
} {
  const { services, resolveProject, notify, activitySink, permissions } = ctx;

  /**
   * Pending proposals live in **this process only**.
   *
   * A proposal is a value the user has not decided on yet, so it is never
   * written to disk: a restart forgets every one of them and the shell proposes
   * again. The maps hold the whole proposal (including `newContent` and the
   * exact argv), because the approval must apply the bytes and arguments the
   * diff and the approval screen showed — never a re-read that could have
   * changed underneath.
   */
  type StoredWriteProposal = {
    id: string;
    projectId: string;
    proposal: ProposedWrite;
  };

  type StoredCommandProposal = {
    id: string;
    projectId: string;
    command: ProposedCommand;
  };

  const writeProposals = new Map<string, StoredWriteProposal>();
  const commandProposals = new Map<string, StoredCommandProposal>();

  /** The write failure shape: one project, one path, one message. */
  const writeFailure = (
    id: RpcId,
    projectId: string,
    path: string,
    message: string,
  ): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "write", projectId, path, message }, false);

  /** The command failure shape: one project, one message. */
  const commandFailure = (id: RpcId, projectId: string, message: string): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "command", projectId, message }, false);

  /** A proposal id the process does not know (a restart, or a mistyped id). */
  const missingWriteProposal = (id: RpcId, proposalId: string): JsonRpcFailure => {
    const message = `there is no pending write proposal "${proposalId}"; propose it again`;
    return failure(id, BOOT_FAILED, message, { kind: "write", id: proposalId, message }, false);
  };

  const missingCommandProposal = (id: RpcId, proposalId: string): JsonRpcFailure => {
    const message = `there is no pending command proposal "${proposalId}"; propose it again`;
    return failure(id, BOOT_FAILED, message, { kind: "command", id: proposalId, message }, false);
  };

  /**
   * The profile that approves a write or command: the project default, or the
   * first valid profile when no default is set.
   *
   * No profile is a refusal, never an implicit permission. A default id that no
   * longer names a valid profile is not resurrected: the first valid profile is
   * used, which is the same rule `work.open` applies to the sidebar.
   */
  const approvalAgent = async (
    workspace: C["workspace"],
    projectId: string,
    meta: ProjectMeta,
  ): Promise<{ error: string } | { agent: AgentProfile }> => {
    const listed = await listAgents(workspace, projectId);
    if (!listed.ok) return { error: oneLine(listed.error.message) };
    const agents = listed.value.agents;
    if (agents.length === 0) {
      return {
        error:
          "this project has no agent profile; add one in Work → Agents before approving a write or command",
      };
    }
    const preferred =
      meta.default_agent === ""
        ? undefined
        : agents.find((agent) => agent.id === meta.default_agent);
    return { agent: preferred ?? agents[0]! };
  };

  /**
   * Register one proposal built by the project-chat tool path.
   *
   * The chat tool and `work.write.propose` share these maps, so a proposal the
   * model builds is approved by exactly the same decide path.
   */
  const addWriteProposal = (projectId: string, proposal: ProposedWrite): string => {
    const proposalId = randomUUID();
    writeProposals.set(proposalId, { id: proposalId, projectId, proposal });
    return proposalId;
  };

  const addCommandProposal = (projectId: string, command: ProposedCommand): string => {
    const proposalId = randomUUID();
    commandProposals.set(proposalId, { id: proposalId, projectId, command });
    return proposalId;
  };

  /**
   * Propose one write. **Nothing on disk is touched.**
   *
   * The proposal is built by `proposeWrite`, which confines the path inside the
   * registered root (absolute names, `..` and symlink escapes are typed
   * refusals), hashes the base bytes and renders the per-hunk diff. The whole
   * value is kept in memory under a fresh id; `work.write.decide` is the only
   * method that can apply it.
   */
  const workWritePropose = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProject = params.projectId;
    if (typeof rawProject !== "string" || rawProject.trim() === "") {
      return invalid(id, "work.write.propose requires a project id");
    }
    const rawPath = params.path;
    if (typeof rawPath !== "string" || rawPath.trim() === "") {
      return invalid(id, "work.write.propose requires a path relative to the project root");
    }
    const newContent = params.newContent;
    if (newContent !== null && typeof newContent !== "string") {
      return invalid(
        id,
        "work.write.propose requires newContent to be a string, or null to delete the file",
      );
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, rawProject);
    if ("error" in resolved) return resolved.error;
    const { projectId, meta } = resolved;

    const path = rawPath.trim();
    const proposed = await proposeWrite({ root: meta.root, path, newContent });
    if (!proposed.ok) {
      return writeFailure(id, projectId, path, oneLine(proposed.error.message));
    }

    const proposalId = randomUUID();
    writeProposals.set(proposalId, { id: proposalId, projectId, proposal: proposed.value });
    return success(id, {
      id: proposalId,
      path: proposed.value.path,
      kind: proposed.value.kind,
      diff: proposed.value.diff,
      hunks: proposed.value.hunks,
      stats: proposed.value.stats,
      baseHash: proposed.value.baseHash,
    });
  };

  /**
   * Approve or reject one pending write.
   *
   * An **approve** needs two independent permissions (`docs/product.md` §8.2):
   * the global Settings opt-in (`[work].allow_write`) and the resolved agent
   * profile's `allowWrite`. The global gate runs first, so a project with no
   * profile is still told to turn writes on in Settings; a profile that refuses
   * is told which profile to change. A **reject** applies nothing and needs no
   * permission. Both decisions consume the proposal; a permission refusal does
   * not, so the user can enable the gate and decide the same proposal again.
   */
  const workWriteDecide = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProposal = params.id;
    if (typeof rawProposal !== "string" || rawProposal.trim() === "") {
      return invalid(id, "work.write.decide requires a proposal id");
    }
    const decision = params.decision;
    if (decision !== "approve" && decision !== "reject") {
      return invalid(id, 'work.write.decide requires decision "approve" or "reject"');
    }
    const rawHunks = params.hunks;
    let hunks: number[] | undefined;
    if (rawHunks !== undefined) {
      if (decision !== "approve") {
        return invalid(id, "work.write.decide: hunks are only accepted with an approve decision");
      }
      if (!Array.isArray(rawHunks)) {
        return invalid(id, "work.write.decide: hunks must be an array of hunk indices");
      }
      hunks = [];
      for (const entry of rawHunks) {
        if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
          return invalid(
            id,
            "work.write.decide: every hunk index must be a non-negative whole number",
          );
        }
        hunks.push(entry);
      }
    }

    const proposalId = rawProposal.trim();
    const stored = writeProposals.get(proposalId);
    if (stored === undefined) return missingWriteProposal(id, proposalId);

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, stored.projectId);
    if ("error" in resolved) return resolved.error;
    const { projectId, meta } = resolved;

    // Gate 1: the global Settings opt-in. It is configuration, so no profile,
    // tool call or plugin can switch it on behind the user's back.
    if (decision === "approve" && permissions(current.value).allowWrite !== true) {
      return writeFailure(id, projectId, stored.proposal.path, WORK_WRITE_OPT_IN_OFF);
    }

    // Gate 2 needs a profile, so it is resolved only for an approval. A
    // rejection applies nothing, and `desktop/docs/protocol.md` says it "needs
    // no permission at all": resolving a profile first meant Reject failed with
    // "this project has no agent profile" in a project with none, the proposal
    // was never consumed, and the shell kept showing a row it could not
    // dismiss.
    let agent: AgentProfile | null = null;
    if (decision === "approve") {
      const selected = await approvalAgent(current.value.workspace, projectId, meta);
      if ("error" in selected) {
        return writeFailure(id, projectId, stored.proposal.path, selected.error);
      }
      agent = selected.agent;
      if (agent.allowWrite !== true) {
        return writeFailure(
          id,
          projectId,
          stored.proposal.path,
          `the agent “${agent.name}” is not allowed to write; give it permission in its profile first`,
        );
      }
    }

    const approval: WriteApproval =
      decision === "reject"
        ? { decision: "reject" }
        : { decision: "approve", ...(hunks === undefined ? {} : { hunks }) };

    // `applyWrite` only ever runs on an approval, and the block above either
    // set `agent` or returned.
    if (decision === "approve" && agent === null) {
      return writeFailure(id, projectId, stored.proposal.path, "no agent profile to approve this write");
    }
    const sink = activitySink(current.value);
    const outcome = await applyWrite({
      workspace: current.value.workspace,
      projectId,
      proposal: stored.proposal,
      // A rejection applies nothing and the service returns before it reads the
      // profile, so the name it reports is the only field it can touch.
      agent: agent ?? ({ name: "" } as AgentProfile),
      // Both gates above passed, so the service is told writes are allowed for
      // this one application. The service re-checks nothing global: the
      // transport already read the stored opt-in.
      settings: { allowWrite: true },
      approval,
      ...(sink === undefined ? {} : { onActivity: sink }),
    });
    writeProposals.delete(proposalId);
    // Best-effort: the shell drops the pending row it may be showing. The
    // decision itself is already final whether or not anyone is listening.
    notify({
      jsonrpc: "2.0",
      method: "work.approval.resolved",
      params: { id: proposalId, kind: "write" },
    });
    if (!outcome.ok) {
      return writeFailure(id, projectId, stored.proposal.path, oneLine(outcome.error.message));
    }
    return success(id, {
      decision: outcome.value.decision,
      applied: outcome.value.applied,
      path: outcome.value.path,
      hunks: outcome.value.hunks,
      bytes: outcome.value.bytes,
    });
  };

  /**
   * Propose one command. **No process is started.**
   *
   * `argv` is an array, never a shell line: `validateArgv` refuses a string, an
   * empty program, control characters and shell metacharacters, and
   * `resolveCommandCwd` confines the working directory to the project root. The
   * value is stored under a fresh id; `work.command.decide` is the only method
   * that can run it.
   */
  const workCommandPropose = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProject = params.projectId;
    if (typeof rawProject !== "string" || rawProject.trim() === "") {
      return invalid(id, "work.command.propose requires a project id");
    }
    const projectIdInput = rawProject.trim();

    const validated = validateArgv(params.argv);
    if (!validated.ok) {
      return commandFailure(id, projectIdInput, oneLine(validated.error.message));
    }

    const rawCwd = params.cwd;
    if (rawCwd !== undefined && typeof rawCwd !== "string") {
      return invalid(id, "work.command.propose: cwd must be a string");
    }
    const rawReason = params.reason;
    if (rawReason !== undefined && typeof rawReason !== "string") {
      return invalid(id, "work.command.propose: reason must be a string");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, projectIdInput);
    if ("error" in resolved) return resolved.error;
    const { projectId, meta } = resolved;

    const cwd = rawCwd === undefined || rawCwd.trim() === "" ? "." : rawCwd.trim();
    const confined = await resolveCommandCwd(meta.root, cwd);
    if (!confined.ok) {
      return commandFailure(id, projectId, oneLine(confined.error.message));
    }

    const command = proposeCommand({
      argv: validated.value,
      cwd,
      ...(rawReason === undefined ? {} : { reason: rawReason.trim() }),
    });
    const proposalId = randomUUID();
    commandProposals.set(proposalId, { id: proposalId, projectId, command });
    return success(id, {
      id: proposalId,
      argv: command.argv,
      cwd: command.cwd,
      reason: command.reason,
      risk: command.risk,
    });
  };

  /**
   * Approve or deny one pending command.
   *
   * An **approve** needs the global Settings opt-in (`[work].allow_command`)
   * **and** the resolved profile's `allowCommand`; the global gate runs first so
   * the refusal names the side that is off. A **denial** starts nothing and needs
   * no permission. Both decisions consume the proposal; a permission refusal
   * does not.
   */
  const workCommandDecide = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProposal = params.id;
    if (typeof rawProposal !== "string" || rawProposal.trim() === "") {
      return invalid(id, "work.command.decide requires a proposal id");
    }
    const decision = params.decision;
    if (decision !== "approve" && decision !== "deny") {
      return invalid(id, 'work.command.decide requires decision "approve" or "deny"');
    }
    const rawReason = params.reason;
    if (rawReason !== undefined && typeof rawReason !== "string") {
      return invalid(id, "work.command.decide: reason must be a string");
    }

    const proposalId = rawProposal.trim();
    const stored = commandProposals.get(proposalId);
    if (stored === undefined) return missingCommandProposal(id, proposalId);

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveProject(id, current.value, stored.projectId);
    if ("error" in resolved) return resolved.error;
    const { projectId, meta } = resolved;

    // Gate 1: the global Settings opt-in, before any profile is resolved.
    if (decision === "approve" && permissions(current.value).allowCommand !== true) {
      return commandFailure(id, projectId, WORK_COMMAND_OPT_IN_OFF);
    }

    // A denial starts nothing, so it needs no permission — and therefore no
    // profile. Resolving one first meant Deny failed with "this project has no
    // agent profile" in a project with none, and the row could not be dismissed.
    let agent: AgentProfile | null = null;
    if (decision === "approve") {
      const selected = await approvalAgent(current.value.workspace, projectId, meta);
      if ("error" in selected) return commandFailure(id, projectId, selected.error);
      agent = selected.agent;
      if (agent.allowCommand !== true) {
        return commandFailure(
          id,
          projectId,
          `the agent “${agent.name}” is not allowed to run commands; give it permission in its profile first`,
        );
      }
    }

    const reason = rawReason === undefined ? "" : rawReason.trim();
    const approval: CommandApproval =
      decision === "deny"
        ? { decision: "deny", ...(reason === "" ? {} : { reason }) }
        : { decision: "approve" };

    if (decision === "approve" && agent === null) {
      return commandFailure(id, projectId, "no agent profile to approve this command");
    }
    const sink = activitySink(current.value);
    const outcome = await runCommand({
      workspace: current.value.workspace,
      projectId,
      command: stored.command,
      agent: agent ?? ({ name: "" } as AgentProfile),
      // Both gates above passed, so the service is told commands are allowed for
      // this one run.
      settings: { allowCommand: true },
      approval,
      ...(sink === undefined ? {} : { onActivity: sink }),
    });
    commandProposals.delete(proposalId);
    notify({
      jsonrpc: "2.0",
      method: "work.approval.resolved",
      params: { id: proposalId, kind: "command" },
    });
    if (!outcome.ok) {
      return commandFailure(id, projectId, oneLine(outcome.error.message));
    }
    return success(id, {
      decision: outcome.value.decision,
      argv: outcome.value.argv,
      cwd: outcome.value.cwd,
      exitCode: outcome.value.exitCode,
      stdout: outcome.value.stdout,
      stderr: outcome.value.stderr,
      timedOut: outcome.value.timedOut,
    });
  };

  /**
   * List the proposals still waiting for a decision, read-only.
   *
   * The maps are process memory, so this is the shell's way to re-render a
   * pending approval after a view switch or a reconnect to the same core. It
   * never applies, runs, writes or consumes anything: the whole list is a
   * projection of the stored values, with `newContent` withheld because the
   * approval screen reviews the diff, not the raw replacement.
   *
   * `projectId` is optional; when supplied it filters both lists to that
   * project. An unknown project is not an error — it simply has no pending rows
   * — because a stale id must not hide another project's queue.
   */
  const workApprovalsList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawProject = params.projectId;
    if (rawProject !== undefined && (typeof rawProject !== "string" || rawProject.trim() === "")) {
      return invalid(id, "work.approvals.list: projectId must be a non-empty string when supplied");
    }
    const projectFilter = typeof rawProject === "string" ? rawProject.trim() : undefined;

    const writes = [...writeProposals.values()]
      .filter((entry) => projectFilter === undefined || entry.projectId === projectFilter)
      .map((entry) => ({
        id: entry.id,
        projectId: entry.projectId,
        path: entry.proposal.path,
        kind: entry.proposal.kind,
        diff: entry.proposal.diff,
        hunks: entry.proposal.hunks,
        stats: entry.proposal.stats,
        baseHash: entry.proposal.baseHash,
      }));
    const commands = [...commandProposals.values()]
      .filter((entry) => projectFilter === undefined || entry.projectId === projectFilter)
      .map((entry) => ({
        id: entry.id,
        projectId: entry.projectId,
        argv: entry.command.argv,
        cwd: entry.command.cwd,
        reason: entry.command.reason,
        risk: entry.command.risk,
      }));
    return success(id, { writes, commands });
  };


  return {
    handlers: {
      workWritePropose,
      workWriteDecide,
      workCommandPropose,
      workCommandDecide,
      workApprovalsList,
    },
    addWriteProposal,
    addCommandProposal,
    approvalAgent,
  };
}
