/**
 * Command-line surface for the compiled binary.
 *
 * `README.md` documents `lockedin --version` and `lockedin --workspace <path>`;
 * this is the one place those flags are read.
 */
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"

export const USAGE = [
  "LockedIn-Tui — a keyboard-first terminal workspace for learning and focused work",
  "",
  "usage:",
  "  lockedin [--workspace <path>]",
  "  lockedin --version",
  "  lockedin --help",
  "",
  "flags:",
  "  -w, --workspace <path>  workspace folder (overrides LOCKEDIN_WORKSPACE)",
  "  -v, --version           print the version and exit",
  "  -h, --help              print this help and exit",
].join("\n")

export type CliCommand =
  | { kind: "run"; workspace?: string }
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "error"; message: string }

function workspacePath(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2))
  return isAbsolute(value) ? value : resolve(value)
}

export function parseCli(argv: readonly string[]): CliCommand {
  let workspace: string | undefined
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (argument === "--version" || argument === "-v") return { kind: "version" }
    if (argument === "--help" || argument === "-h") return { kind: "help" }
    if (argument === "--workspace" || argument === "-w") {
      const value = argv[index + 1]
      if (value === undefined || value.trim() === "") {
        return { kind: "error", message: `${argument} needs a path` }
      }
      workspace = workspacePath(value)
      index += 1
      continue
    }
    if (argument.startsWith("--workspace=")) {
      const value = argument.slice("--workspace=".length)
      if (value.trim() === "") return { kind: "error", message: "--workspace needs a path" }
      workspace = workspacePath(value)
      continue
    }
    return { kind: "error", message: `unknown argument: ${argument}` }
  }
  return workspace === undefined ? { kind: "run" } : { kind: "run", workspace }
}
