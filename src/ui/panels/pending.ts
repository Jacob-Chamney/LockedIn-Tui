/**
 * The two-step destructive action every manager uses.
 *
 * The first press names the object and changes nothing; a second press on the
 * same object is the only thing that returns a call. Moving the cursor away
 * disarms it. Feature models supply the warning sentence; the mechanics live
 * here once.
 */
export type PendingKind = "archive" | "delete" | "export"
export type PendingAction = { kind: PendingKind; id: string; name: string }
export type PendingHost = { pending?: PendingAction; notice?: string | null }
export type PendingSubject = { id: string; name: string }

export type PendingOutcome =
  | { kind: "call"; action: PendingKind; id: string }
  | { kind: "refused"; reason: string }
  | { kind: "none" }

export function armPending<T extends PendingHost>(
  state: T,
  subject: PendingSubject | undefined,
  kind: PendingKind,
  missing: string,
): T {
  if (!subject) return { ...state, notice: missing }
  return { ...state, pending: { kind, id: subject.id, name: subject.name }, notice: null }
}

export function cancelPending<T extends PendingHost>(state: T): T {
  return { ...state, pending: undefined, notice: null }
}

export function confirmPending<T extends PendingHost>(
  state: T,
  subject: PendingSubject | undefined,
  kind: PendingKind,
): PendingOutcome {
  if (!state.pending) {
    const key = kind === "archive" ? "a" : kind === "delete" ? "d" : "x"
    return { kind: "refused", reason: `press ${key} again to ${kind} “${subject?.name ?? "this item"}”` }
  }
  if (state.pending.kind !== kind) {
    return {
      kind: "refused",
      reason: `“${state.pending.name}” is waiting for ${state.pending.kind}; Esc cancels it`,
    }
  }
  if (!subject || subject.id !== state.pending.id) {
    return {
      kind: "refused",
      reason: `“${state.pending.name}” moved; Esc cancels the pending ${state.pending.kind}`,
    }
  }
  return { kind: "call", action: kind, id: subject.id }
}
