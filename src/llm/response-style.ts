/**
 * Response length and tutoring policy.
 *
 * These are prompt-level preferences, not token limits. The hard output
 * ceiling lives in the provider call; a style asks the model how to use that
 * room.
 */

import type { ChatMode } from "./chat"

export type ResponseStyle = "brief" | "normal" | "detailed"
export type TutorPolicy = "direct" | "guided" | "socratic"

export const DEFAULT_RESPONSE_STYLE: ResponseStyle = "normal"
export const DEFAULT_TUTOR_POLICY: TutorPolicy = "direct"

export const RESPONSE_STYLES: readonly ResponseStyle[] = ["brief", "normal", "detailed"]
export const TUTOR_POLICIES: readonly TutorPolicy[] = ["direct", "guided", "socratic"]

export function isResponseStyle(value: string): value is ResponseStyle {
  return (RESPONSE_STYLES as readonly string[]).includes(value)
}

export function isTutorPolicy(value: string): value is TutorPolicy {
  return (TUTOR_POLICIES as readonly string[]).includes(value)
}

export function styleInstruction(style: ResponseStyle): string {
  if (style === "brief") {
    return "Response style: brief. Answer in 1-3 short paragraphs or at most 5 bullets. Do not restate the question, add a preamble, or pad with a summary."
  }
  if (style === "detailed") {
    return "Response style: detailed. Give a thorough answer with structure, examples and caveats where they help. Do not repeat yourself."
  }
  return "Response style: normal. Answer directly and stop when the question is answered; usually 2-5 paragraphs unless the task needs more."
}

export function tutorInstruction(policy: TutorPolicy): string {
  if (policy === "guided") {
    return "Tutoring policy: guided. Explain one useful chunk, then ask the learner a short check-in question before continuing. Do not dump the whole solution at once."
  }
  if (policy === "socratic") {
    return "Tutoring policy: socratic. Ask one question at a time and let the learner reason. Give a direct answer only when they are stuck or explicitly ask for it."
  }
  return "Tutoring policy: direct. Answer the learner's question directly, while still distinguishing what the sources support from what is inference."
}

/** Which response controls a surface actually offers. */
export type ChatCapabilities = { responseStyle: boolean; tutorPolicy: boolean }

/**
 * Where each control applies.
 *
 * Chill is a plain conversation, so neither belongs there. A lock-in chat is
 * working through one assignment: answer length applies, tutoring does not — the
 * task is fixed. A skill session is taught, so it gets both. A Work project chat
 * is still a conversation, so it gets the style and not the tutor.
 */
export function chatCapabilities(mode: ChatMode | undefined): ChatCapabilities {
  switch (mode) {
    case "skill":
      return { responseStyle: true, tutorPolicy: true }
    case "lockin":
    case "work":
      return { responseStyle: true, tutorPolicy: false }
    default:
      return { responseStyle: false, tutorPolicy: false }
  }
}

/** The instruction block for the current turn, restricted to what applies. */
export function learningInstructions(
  style: ResponseStyle,
  tutor: TutorPolicy,
  capabilities: ChatCapabilities,
): string {
  const parts: string[] = []
  if (capabilities.responseStyle) parts.push(styleInstruction(style))
  if (capabilities.tutorPolicy) parts.push(tutorInstruction(tutor))
  return parts.join("\n")
}
