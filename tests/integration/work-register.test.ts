/**
 * WP-501 — project registration and home.
 *
 * Every root is created inside a temp directory; no test touches a real user
 * project. Assertions are about bytes: a tree hash before and after registration
 * or removal must be identical, because "the app never moves, copies, renames or
 * deletes the root" is the whole promise (`docs/product.md` §8.1).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { removeTemp } from "../helpers/cleanup"
import { existsSync } from "node:fs"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"

import { type Result } from "../../src/domain/markdown"
import { createWorkspace, type Workspace } from "../../src/storage/workspace"
import { createProject } from "../../src/app/actions/projects"
import {
  META_FILE,
  assertProjectId,
  home,
  listProjects,
  markOpened,
  projectId,
  projectMetaPath,
  register,
  remove,
  setMode,
  type RemovePlan,
  type WorkError,
} from "../../src/services/work/register"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURE_META = join(import.meta.dir, "..", "fixtures", "work-projects", "meta.json")
/** Root ignores permission bits, so permission-denial cases cannot run there. */
const isRoot = typeof process.getuid === "function" && process.getuid() === 0
const isWindows = process.platform === "win32"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, WorkError>): WorkError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let projects: string

/** Relative paths of every entry under `root`, sorted. */
async function tree(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      out.push(relative(root, path))
      if (entry.isDirectory()) await walk(path)
    }
  }
  if (existsSync(root)) await walk(root)
  return out.sort()
}

/**
 * A content hash of a whole tree: relative path, kind and bytes. Symlinks hash
 * their target, so "nothing was rewritten" includes "no link was retargeted".
 */
async function treeHash(root: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256")
  for (const path of await tree(root)) {
    const full = join(root, path)
    const info = await lstat(full)
    if (info.isSymbolicLink()) {
      hasher.update(`${path}\u0000link\u0000${await readlink(full)}`)
      continue
    }
    if (info.isDirectory()) {
      hasher.update(`${path}\u0000dir\u0000`)
      continue
    }
    const bytes = new Bun.CryptoHasher("sha256").update(await readFile(full)).digest("hex")
    hasher.update(`${path}\u0000file\u0000${bytes}\u0000${info.mode}\u0000`)
  }
  return hasher.digest("hex")
}

async function makeProject(name: string, options: { git?: boolean } = {}): Promise<string> {
  const root = join(projects, name)
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "README.md"), `# ${name}\n\nA sample project.\n`)
  await writeFile(join(root, "src", "index.ts"), "export const answer = 42\n")
  if (options.git) {
    await mkdir(join(root, ".git"), { recursive: true })
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
  }
  return realpath(root)
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "work-register-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  projects = join(base, "projects")
  await mkdir(projects, { recursive: true })
})

afterEach(async () => {
  // Restore any permissions a test removed before deleting the temp tree.
  await chmod(base, 0o755).catch(() => {})
  await removeTemp(base)
})

describe("register", () => {
  test("writes meta.json with an absolute resolved root and nothing inside the root", async () => {
    const root = await makeProject("non-git")
    const before = await treeHash(root)
    const workspaceBefore = await tree(workspace.paths.root)

    const registered = unwrap(await register({ workspace, root, name: "My app" }))

    expect(registered.meta.root).toBe(await realpath(root))
    expect(isAbsolute(registered.meta.root)).toBe(true)
    expect(registered.meta.schema).toBe(1)
    expect(registered.meta.name).toBe("My app")
    expect(registered.meta.agents).toEqual([])
    expect(registered.meta.tasks).toEqual([])
    expect(registered.meta.default_agent).toBe("")
    expect(registered.metaPath).toBe(projectMetaPath(workspace, registered.meta.id))

    // The root is byte-identical, and every new workspace path is this project.
    expect(await treeHash(root)).toBe(before)
    const added = (await tree(workspace.paths.root)).filter((path) => !workspaceBefore.includes(path))
    expect(added.sort()).toEqual(
      [relative(workspace.paths.root, registered.folder), relative(workspace.paths.root, registered.metaPath)].sort(),
    )

    const onDisk = JSON.parse(await readFile(registered.metaPath, "utf8"))
    expect(onDisk).toMatchObject({
      schema: 1,
      id: registered.meta.id,
      name: "My app",
      root: registered.meta.root,
      instructions: "",
      default_agent: "",
      agents: [],
      tasks: [],
    })
  })

  test.skipIf(isWindows)("stores the resolved target of a symlinked root and recognises it twice", async () => {
    const root = await makeProject("linked-app")
    const link = join(projects, "linked-app-shortcut")
    await symlink(root, link, "dir")

    const first = unwrap(await register({ workspace, root: link, name: "Linked app" }))
    expect(first.meta.root).toBe(await realpath(root))

    // Through the symlink and through the real folder: the same project.
    for (const again of [link, root]) {
      const duplicate = errorOf(await register({ workspace, root: again, name: "Linked app again" }))
      expect(duplicate.kind).toBe("duplicate")
      if (duplicate.kind !== "duplicate") throw new Error("unreachable")
      expect(duplicate.existingId).toBe(first.meta.id)
      expect(duplicate.existingName).toBe("Linked app")
      expect(duplicate.message).toContain("Linked app")
      expect(duplicate.message).toContain(first.meta.root)
    }

    expect(await listProjects(workspace)).toHaveLength(1)
  })

  test("refuses a root that is already registered and names the first project", async () => {
    const root = await makeProject("dup")
    const first = unwrap(await register({ workspace, root, name: "First project" }))

    const duplicate = errorOf(await register({ workspace, root, name: "Second project" }))
    expect(duplicate.kind).toBe("duplicate")
    if (duplicate.kind !== "duplicate") throw new Error("unreachable")
    expect(duplicate.existingId).toBe(first.meta.id)
    expect(duplicate.existingName).toBe("First project")
    expect(duplicate.path).toBe(first.meta.root)

    const rows = await listProjects(workspace)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe("First project")
  })

  test("two projects with the same name get distinct ids", async () => {
    const left = await makeProject("same-name-a")
    const right = await makeProject("same-name-b")

    const a = unwrap(await register({ workspace, root: left, name: "Same name" }))
    const b = unwrap(await register({ workspace, root: right, name: "Same name" }))

    expect(a.meta.id).not.toBe(b.meta.id)
    expect(a.meta.id.startsWith("same-name-")).toBe(true)
    expect(b.meta.id.startsWith("same-name-")).toBe(true)
    expect(a.meta.id.slice(-6)).toMatch(/^[0-9a-f]{6}$/)
    expect((await listProjects(workspace)).map((row) => row.id).sort()).toEqual(
      [a.meta.id, b.meta.id].sort(),
    )
  })

  test("projectId is deterministic for a free name and salted on collision", () => {
    const first = projectId("My app")
    expect(first).toBe(projectId("My app"))
    const second = projectId("My app", [first])
    expect(second).not.toBe(first)
    expect(second.startsWith("my-app-")).toBe(true)
  })

  test("a missing path, a file path and an unreadable path are typed errors naming the path", async () => {
    const missing = join(projects, "does-not-exist")
    const missingError = errorOf(await register({ workspace, root: missing, name: "Missing" }))
    expect(missingError.kind).toBe("path")
    if (missingError.kind !== "path") throw new Error("unreachable")
    expect(missingError.path).toBe(missing)

    const file = join(projects, "notes.txt")
    await writeFile(file, "not a folder\n")
    const fileError = errorOf(await register({ workspace, root: file, name: "A file" }))
    expect(fileError.kind).toBe("path")
    if (fileError.kind !== "path") throw new Error("unreachable")
    expect(fileError.path).toBe(file)
    expect(fileError.message).toContain("file, not a folder")

    // Root ignores the permission bits, and Windows has no POSIX bits.
    if (!isRoot && !isWindows) {
      const unreadable = await makeProject("unreadable")
      await chmod(unreadable, 0o000)
      try {
        const denied = errorOf(await register({ workspace, root: unreadable, name: "Unreadable" }))
        expect(denied.kind).toBe("storage")
        if (denied.kind !== "storage") throw new Error("unreachable")
        expect(denied.path).toBe(unreadable)
      } finally {
        await chmod(unreadable, 0o755)
      }
    }

    // None of the three refusals wrote a project.
    expect(await listProjects(workspace)).toEqual([])
  })

  test("refuses a root inside the workspace tree", async () => {
    const inside = join(workspace.paths.root, "input", "adopted")
    await mkdir(inside, { recursive: true })
    await writeFile(join(inside, "note.md"), "# Not a project\n")
    const before = await treeHash(workspace.paths.root)

    const error = errorOf(await register({ workspace, root: inside, name: "Adopted" }))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") throw new Error("unreachable")
    expect(error.reason).toBe("escape")
    expect(error.path).toBe(await realpath(inside))
    expect(await treeHash(workspace.paths.root)).toBe(before)
  })

  test("a failed wizard registration removes the folders it just created", async () => {
    const folder = join(base, "new", "parent", "child")
    const failed = await createProject({
      workspace,
      id: "failed-abc123",
      name: "   ",
      folder,
      mode: "chat",
    })
    expect(failed.ok).toBe(false)
    expect(existsSync(folder)).toBe(false)
    expect(existsSync(join(base, "new", "parent"))).toBe(false)
    expect(existsSync(join(base, "new"))).toBe(false)
  })

  test("setMode changes only the mode and survives a reload", async () => {
    const root = await makeProject("mode")
    const registered = unwrap(await register({ workspace, root, name: "Mode" }))
    const before = JSON.parse(await readFile(projectMetaPath(workspace, registered.meta.id), "utf8")) as Record<string, unknown>

    const updated = unwrap(
      await setMode({ workspace, id: registered.meta.id, mode: "swarm", swarmName: "Team" }),
    )
    expect(updated.mode).toBe("swarm")
    expect(updated.swarmName).toBe("Team")
    const after = JSON.parse(await readFile(projectMetaPath(workspace, registered.meta.id), "utf8")) as Record<string, unknown>
    expect(after.mode).toBe("swarm")
    expect(after.swarm_name).toBe("Team")
    expect(after).toEqual({ ...before, mode: "swarm", swarm_name: "Team" })
    const listed = (await listProjects(workspace)).find((row) => row.id === registered.meta.id)
    expect(listed?.swarmName).toBe("Team")
  })

  test("refuses an empty name and a non-project id", async () => {
    const root = await makeProject("named")
    expect(errorOf(await register({ workspace, root, name: "   " })).kind).toBe("invalid-input")

    for (const id of ["", ".hidden", "../escape", "a/b", "a\\b", "con", "nul.txt", "a:b", "name.", "name "]) {
      const rejected = errorOf(assertProjectId(id))
      expect(rejected.kind).toBe("path")
    }
    expect(unwrap(assertProjectId("my-app-4f2a1c"))).toBe("my-app-4f2a1c")
  })
})

describe("home", () => {
  test("reports counts from meta.json and hasGit for a git and a non-git root", async () => {
    const plain = await makeProject("plain")
    const git = await makeProject("repo", { git: true })

    const plainProject = unwrap(await register({ workspace, root: plain, name: "Plain" }))
    const gitProject = unwrap(await register({ workspace, root: git, name: "Repo" }))

    const plainHome = unwrap(await home({ workspace, id: plainProject.meta.id }))
    expect(plainHome).toMatchObject({
      id: plainProject.meta.id,
      name: "Plain",
      root: plainProject.meta.root,
      hasGit: false,
      agentCount: 0,
      taskCount: 0,
      defaultAgentName: "",
      instructions: "",
      rootMissing: false,
    })
    expect(plainHome.lastOpenedAt).not.toBe("")

    const gitHome = unwrap(await home({ workspace, id: gitProject.meta.id }))
    expect(gitHome.hasGit).toBe(true)
  })

  test("reads agents, tasks and the default agent name from the documented sample", async () => {
    const root = await makeProject("fixture-app", { git: true })
    const id = "my-app-4f2a1c"
    const folder = join(workspace.paths.workProjects, id)
    await mkdir(folder, { recursive: true })
    const sample = JSON.parse(await readFile(FIXTURE_META, "utf8"))
    await writeFile(join(folder, META_FILE), `${JSON.stringify({ ...sample, root }, null, 2)}\n`)

    const view = unwrap(await home({ workspace, id }))
    expect(view).toMatchObject({
      id,
      name: "My app",
      root,
      hasGit: true,
      agentCount: 2,
      taskCount: 1,
      defaultAgentName: "Reviewer",
      lastOpenedAt: "2026-11-01T10:30:00Z",
      instructions: "Prefer small diffs.",
      rootMissing: false,
    })
  })

  test("a project whose root disappeared reports rootMissing and still lists", async () => {
    const root = await makeProject("vanishing")
    const project = unwrap(await register({ workspace, root, name: "Vanishing" }))
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })

    const view = unwrap(await home({ workspace, id: project.meta.id }))
    expect(view.rootMissing).toBe(true)
    expect(view.hasGit).toBe(false)

    const rows = await listProjects(workspace)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: project.meta.id,
      name: "Vanishing",
      root,
      rootMissing: true,
      broken: false,
    })

    // Metadata can still be removed when the folder is gone.
    const outcome = unwrap(await remove({ workspace, id: project.meta.id, approve: () => true }))
    expect(outcome.removed).toBe(true)
    expect(existsSync(project.folder)).toBe(false)
  })

  test("markOpened advances lastOpenedAt and preserves keys it does not own", async () => {
    const root = await makeProject("opened")
    const project = unwrap(await register({ workspace, root, name: "Opened" }))

    // Simulate a later packet adding a key this module does not know.
    const before = JSON.parse(await readFile(project.metaPath, "utf8"))
    await writeFile(project.metaPath, `${JSON.stringify({ ...before, future_key: "kept" }, null, 2)}\n`)

    const view = unwrap(await markOpened({ workspace, id: project.meta.id }))
    expect(view.lastOpenedAt >= project.meta.last_opened_at).toBe(true)
    const after = JSON.parse(await readFile(project.metaPath, "utf8"))
    expect(after.future_key).toBe("kept")
    expect(after.created).toBe(project.meta.created)
  })
})

describe("remove", () => {
  test("deletes only the metadata folder and leaves the root byte-identical", async () => {
    const root = await makeProject("removable", { git: true })
    const project = unwrap(await register({ workspace, root, name: "Removable" }))
    const before = await treeHash(root)

    let shown: RemovePlan | undefined
    const outcome = unwrap(
      await remove({
        workspace,
        id: project.meta.id,
        approve: (plan) => {
          shown = plan
          return true
        },
      }),
    )

    expect(outcome.removed).toBe(true)
    if (!shown) throw new Error("the confirmation was never shown the plan")
    const plan: RemovePlan = shown
    expect(plan.message).toContain("Removable")
    expect(plan.message).toContain(root)
    expect(plan.message.toLowerCase()).toContain("files stay")
    expect(outcome.plan.message).toBe(plan.message)

    expect(existsSync(project.folder)).toBe(false)
    expect(await treeHash(root)).toBe(before)
    expect(await listProjects(workspace)).toEqual([])
  })

  test("cancelling the confirmation changes nothing", async () => {
    const root = await makeProject("kept")
    const project = unwrap(await register({ workspace, root, name: "Kept" }))
    const rootBefore = await treeHash(root)
    const metaBefore = await readFile(project.metaPath, "utf8")
    const workspaceBefore = await treeHash(workspace.paths.root)

    const refused = unwrap(
      await remove({ workspace, id: project.meta.id, approve: () => false }),
    )
    expect(refused.removed).toBe(false)
    expect(refused.plan.name).toBe("Kept")

    // No callback is also a refusal, never an implicit delete.
    const implicit = unwrap(await remove({ workspace, id: project.meta.id }))
    expect(implicit.removed).toBe(false)

    expect(await readFile(project.metaPath, "utf8")).toBe(metaBefore)
    expect(await treeHash(root)).toBe(rootBefore)
    expect(await treeHash(workspace.paths.root)).toBe(workspaceBefore)
    expect(await stat(project.folder)).toBeTruthy()
  })

  test("an unknown or escaping id is a typed error and deletes nothing", async () => {
    const root = await makeProject("safe")
    const project = unwrap(await register({ workspace, root, name: "Safe" }))
    const before = await treeHash(workspace.paths.root)

    const unknown = errorOf(await remove({ workspace, id: "no-such-project", approve: () => true }))
    expect(unknown.kind).toBe("path")

    const escape = errorOf(await remove({ workspace, id: "../work", approve: () => true }))
    expect(escape.kind).toBe("path")
    if (escape.kind !== "path") throw new Error("unreachable")
    expect(escape.reason).toBe("escape")

    expect(await treeHash(workspace.paths.root)).toBe(before)
    expect(existsSync(project.folder)).toBe(true)
  })
})
