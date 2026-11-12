/**
 * Debug channel for the dev effects harness.
 *
 * Writes to a file, never to stderr: the app owns the terminal, so a stray
 * line on stderr paints over the UI. Off unless `LOCKEDIN_EFFECTS_DEBUG=1`.
 */
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function effectDebug(message: string): void {
  if (process.env.LOCKEDIN_EFFECTS_DEBUG !== "1") return
  const path = process.env.LOCKEDIN_EFFECTS_LOG ?? join(tmpdir(), "lockedin-effects.log")
  try {
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Debug output must never break the app.
  }
}
