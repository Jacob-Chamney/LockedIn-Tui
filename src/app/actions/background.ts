/** Secondary loads: the activity log, stats and knowledge, after the first frame. */
import type { ActivityRecord } from "../../services/work/activity"
import type { KnowledgeGraph } from "../../services/knowledge/graph"
import type { StatsSummary } from "../../stats/types"
import type { Workspace } from "../../storage/workspace"

export async function loadActivity(
  workspace: Workspace,
): Promise<{ records: ActivityRecord[]; skipped: number } | null> {
  if (!workspace.data?.activity) return null
  const { createActivityLog } = await import("../../services/work/activity")
  const opened = createActivityLog(workspace)
  if (!opened.ok) return null
  const result = await opened.value.list({ limit: 100 })
  return result.ok ? { records: result.value.records, skipped: result.value.skipped } : null
}

export async function loadStats(dataDir: string): Promise<StatsSummary | null> {
  const { createStatsService } = await import("../../stats/summary")
  return createStatsService({ dir: dataDir }).summary("all", "all")
}

/** Read both vaults and build the Knowledge graph. Read-only over the notes. */
export async function loadKnowledge(workspace: Workspace): Promise<KnowledgeGraph | null> {
  const { loadKnowledgeGraph } = await import("../../services/knowledge/graph")
  return loadKnowledgeGraph(workspace)
}
