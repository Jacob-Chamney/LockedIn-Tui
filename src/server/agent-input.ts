import {
  AGENT_ID_PATTERN,
  MAX_AGENT_INSTRUCTIONS_CHARS,
  MAX_AGENT_NAME_CHARS,
  MAX_MODEL_CHARS,
  MAX_ROLE_CHARS,
  MAX_TEMPLATE_ID_CHARS,
  MAX_TOOL_CALLS,
  MIN_TOOL_CALLS,
  type AgentPatch,
} from "../services/work/agents";
import type { ProjectMeta } from "../services/work/register";
import { isRecord } from "./rpc";

/**
 * Every id already in the raw `agents` array, including entries that fail
 * validation: a generated id must not collide with a record a later edit would
 * restore, so the taken set is read from disk rather than from the valid list.
 */
export function takenAgentIds(meta: ProjectMeta): string[] {
  return meta.agents
    .map((entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id : ""))
    .filter((entry) => entry !== "");
}

export type AgentSaveParse = { error: string } | { agentId?: string; fields: AgentPatch };

/**
 * Validate one `work.agent.save` payload.
 *
 * The bounds are the service's own exported constants, so the wire check and the
 * disk check cannot drift into two different limits. An unknown tool name is
 * deliberately **not** checked here: `KNOWN_TOOL_NAMES` is the service's rule and
 * its message names the accepted set, so the refusal stays typed `agent`.
 */
export function parseAgentSave(raw: unknown, requireName: boolean): AgentSaveParse {
  if (!isRecord(raw)) {
    return { error: "work.agent.save requires an agent object" };
  }

  const rawId = raw.id;
  let agentIdValue: string | undefined;
  if (rawId !== undefined) {
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return { error: "work.agent.save: agent.id must be a non-empty string" };
    }
    agentIdValue = rawId.trim();
    if (
      agentIdValue.length > MAX_TEMPLATE_ID_CHARS ||
      !AGENT_ID_PATTERN.test(agentIdValue)
    ) {
      return {
        error: `work.agent.save: agent.id "${agentIdValue}" is not a valid agent id; use lowercase letters, digits and dashes`,
      };
    }
  }

  const rawName = raw.name;
  if (rawName === undefined) {
    if (requireName) {
      return { error: "work.agent.save requires agent.name when creating an agent" };
    }
  } else {
    if (typeof rawName !== "string" || rawName.trim() === "") {
      return { error: "work.agent.save: agent.name must be a non-empty string" };
    }
    if (rawName.trim().length > MAX_AGENT_NAME_CHARS) {
      return {
        error: `work.agent.save: an agent name is at most ${MAX_AGENT_NAME_CHARS} characters`,
      };
    }
  }

  const fields: AgentPatch = {};
  if (typeof rawName === "string") fields.name = rawName.trim();

  const texts = [
    ["role", MAX_ROLE_CHARS],
    ["instructions", MAX_AGENT_INSTRUCTIONS_CHARS],
    ["model", MAX_MODEL_CHARS],
    ["template", MAX_TEMPLATE_ID_CHARS],
  ] as const;
  for (const [field, max] of texts) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      return { error: `work.agent.save: agent.${field} must be a string` };
    }
    if (value.trim().length > max) {
      return { error: `work.agent.save: agent.${field} is at most ${max} characters` };
    }
    fields[field] = value.trim();
  }

  const rawMax = raw.maxToolCalls;
  if (rawMax !== undefined) {
    if (
      typeof rawMax !== "number" ||
      !Number.isInteger(rawMax) ||
      rawMax < MIN_TOOL_CALLS ||
      rawMax > MAX_TOOL_CALLS
    ) {
      return {
        error: `work.agent.save: agent.maxToolCalls must be a whole number from ${MIN_TOOL_CALLS} to ${MAX_TOOL_CALLS}`,
      };
    }
    fields.maxToolCalls = rawMax;
  }

  const rawTools = raw.allowedTools;
  if (rawTools !== undefined) {
    if (!Array.isArray(rawTools)) {
      return {
        error: "work.agent.save: agent.allowedTools must be an array of tool names",
      };
    }
    const tools: string[] = [];
    for (const entry of rawTools) {
      if (typeof entry !== "string" || entry.trim() === "") {
        return {
          error: "work.agent.save: every entry in agent.allowedTools must be a non-empty string",
        };
      }
      tools.push(entry.trim());
    }
    fields.allowedTools = tools;
  }

  for (const field of ["allowWrite", "allowCommand"] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      return { error: `work.agent.save: agent.${field} must be true or false` };
    }
    fields[field] = value;
  }

  return agentIdValue === undefined ? { fields } : { agentId: agentIdValue, fields };
}

