/**
 * Remove a test directory. Windows may still hold a freshly closed SQLite file
 * for a moment; retry, then treat that specific failure as a leaked temp dir
 * rather than failing an otherwise correct test. POSIX failures still throw.
 */
import { rm } from "node:fs/promises"

const WINDOWS_TRANSIENT = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"])

export async function removeTemp(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })
  } catch (error) {
    const code = (error as { code?: string }).code ?? ""
    if (process.platform === "win32" && WINDOWS_TRANSIENT.has(code)) return
    throw error
  }
}
