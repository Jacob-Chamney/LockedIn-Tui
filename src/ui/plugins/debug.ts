/**
 * Debug channel for the dev effects harness.
 *
 * Writes to a file, never to stderr: the app owns the terminal, so a stray
 * line on stderr paints over the UI. Off unless `LOCKEDIN_PLUGINS_DEBUG=1`.
 */
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pluginEnvValue } from "./env"

export function effectDebug(message: string): void {
  if (pluginEnvValue(process.env, "debug") !== "1") return
  const path = pluginEnvValue(process.env, "log") ?? join(tmpdir(), "lockedin-plugins.log")
  try {
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Debug output must never break the app.
  }
}
