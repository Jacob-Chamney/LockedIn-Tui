/**
 * The settings snapshot the core returns and the shell renders.
 *
 * It lives here, not in a frontend, because both the TUI (removed) and the
 * desktop shell consume the same projection from `src/server`.
 */
export type SettingsView = {
  username: string
  theme: string
  chatModel: string
  baseUrl: string
  maxToolCalls: number
  maxTokensPerRequest: number
  budgetUsd: number
  period: "day" | "month"
  warnAt: number
  pauseAtLimit: boolean
  dataDir: string
  archiveBackend: string
  archiveFolder: string
  /** `archive.github.repo`: owner/name, empty until configured. */
  archiveGithubRepo: string
  /** `archive.github.branch`: the branch pushes target. */
  archiveGithubBranch: string
  /** `archive.github.consent`: one-time permission to leave the machine. */
  archiveGithubConsent: boolean
  historyLimit: number
  responseStyle: string
  tutorPolicy: string
  /** MCP server names from config, for the Plugins surface. */
  pluginServers: string[]
  /** `ui.hide_hints`: the chat's own hint rows are hidden. */
  hideHints: boolean
  /** `ui.plugins.dirs`: folders that contain plugin directories. */
  pluginDirs: string[]
  /** `ui.plugins.disabled`: discovered plugin ids that are not mounted. */
  disabledPlugins: string[]
}
