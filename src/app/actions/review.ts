/** The review queue as the shell consumes it: items, nudge and diagnostics. */
import { reviewQueue } from "../../services/review/queue"
import type { NudgeIntensity, ReviewItem, NudgeState } from "../../domain/review"
import type { ReviewDiagnostic } from "../../services/review/queue"
import type { Workspace } from "../../storage/workspace"

export type LoadedReview = {
  items: ReviewItem[]
  nudge: NudgeState
  intensity: NudgeIntensity
  diagnostics: ReviewDiagnostic[]
}

export async function loadReview(workspace: Workspace): Promise<LoadedReview> {
  const result = await reviewQueue(workspace)
  return {
    items: result.items,
    nudge: result.nudge,
    intensity: result.intensity,
    diagnostics: result.diagnostics,
  }
}
