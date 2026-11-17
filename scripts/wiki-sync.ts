#!/usr/bin/env bun
/**
 * Sync the user-facing wiki from this overlay to the public GitHub wiki.
 *
 * The public repository stays source-only; the wiki is its own git repository.
 * This script is dev tooling and is never shipped.
 *
 *   bun run scripts/wiki-sync.ts             # push the pages
 *   bun run scripts/wiki-sync.ts --check     # show changes without pushing
 *   bun run scripts/wiki-sync.ts --message "Update install notes"
 *
 * The wiki must have its first page created at
 * https://github.com/Jacob-Chamney/LockedIn-Tui/wiki before the git remote
 * exists. After that this script owns the page set.
 */
import { cp, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const SOURCE = join(ROOT, "wiki")
const REMOTE = process.env.WIKI_REMOTE ?? "git@github.com:Jacob-Chamney/LockedIn-Tui.wiki.git"

const argv = process.argv.slice(2)
const check = argv.includes("--check")
const messageIndex = argv.indexOf("--message")
const message = messageIndex >= 0 ? argv[messageIndex + 1] : undefined
if (messageIndex >= 0 && (!message || message.startsWith("--"))) {
  console.error("wiki: --message needs a value")
  process.exit(2)
}

function run(command: string[], cwd?: string, capture = false) {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdin: "inherit",
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  })
  return {
    exitCode: result.exitCode ?? 1,
    stdout: capture ? result.stdout.toString() : "",
    stderr: capture ? result.stderr.toString() : "",
  }
}

async function main(): Promise<void> {
  const entries = await readdir(SOURCE)
  if (entries.length === 0) {
    console.error("wiki: wiki/ is empty")
    process.exit(1)
  }

  const dir = await mkdtemp(join(tmpdir(), "lockedin-wiki-"))
  try {
    const clone = run(["git", "clone", "--quiet", REMOTE, dir], undefined, true)
    if (clone.exitCode !== 0) {
      console.error(`wiki: could not clone ${REMOTE}`)
      console.error(clone.stderr.trim() || "check the remote and your SSH access")
      console.error(
        "If the wiki has no pages yet, create the first page at " +
          "https://github.com/Jacob-Chamney/LockedIn-Tui/wiki and run this again.",
      )
      process.exit(1)
    }

    const keep = new Set(entries)
    for (const entry of await readdir(dir)) {
      if (entry === ".git") continue
      if (!keep.has(entry)) await rm(join(dir, entry), { recursive: true, force: true })
    }
    for (const entry of entries) {
      await cp(join(SOURCE, entry), join(dir, entry), { recursive: true, force: true })
    }

    const add = run(["git", "add", "-A"], dir)
    if (add.exitCode !== 0) process.exit(1)

    const status = run(["git", "status", "--porcelain"], dir, true)
    if (status.stdout.trim() === "") {
      console.log("wiki: up to date")
      return
    }

    console.log(status.stdout.trimEnd())
    if (check) {
      console.log("wiki: changes pending (dry run)")
      return
    }

    const commitMessage = message ?? "Sync user documentation"
    const commit = run(["git", "commit", "-q", "-m", commitMessage], dir)
    if (commit.exitCode !== 0) process.exit(1)

    const push = run(["git", "push", "--quiet", "origin", "HEAD"], dir)
    if (push.exitCode !== 0) process.exit(1)

    console.log(`wiki: pushed ${entries.length} entries to ${REMOTE}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

await main()
