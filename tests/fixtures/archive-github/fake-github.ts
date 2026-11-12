/**
 * A recording GitHub transport for WP-601.
 *
 * It answers the three endpoints the backend uses (repo metadata, contents
 * listing, contents write/delete), keeps an in-memory tree so a push can be
 * listed and restored, and records every request for the assertions.
 */

import type { GithubRequest, GithubResponse, GithubTransport } from "../../../src/archive/github"

export type RecordedRequest = GithubRequest

export type FakeGithubOptions = {
  repo: string
  /** `null` → 404; `"unknown"` → 200 without a `private` field. */
  private?: boolean | null | "unknown"
  /** Fail this upload path (1-based index) — used for the failed-push case. */
  failUploadAt?: number
  status?: number
}

export type FakeGithub = GithubTransport & {
  requests: RecordedRequest[]
  tree: Map<string, string>
  reset(): void
}

export function createFakeGithub(options: FakeGithubOptions): FakeGithub {
  const requests: RecordedRequest[] = []
  const tree = new Map<string, string>() // repo path -> base64 content
  let uploads = 0

  function children(prefix: string): Array<Record<string, unknown>> {
    const seen = new Set<string>()
    const out: Array<Record<string, unknown>> = []
    const base = prefix === "" ? "" : `${prefix}/`
    for (const path of tree.keys()) {
      if (!path.startsWith(base)) continue
      const rest = path.slice(base.length)
      const head = rest.split("/")[0] as string
      const full = `${base}${head}`
      if (seen.has(full)) continue
      seen.add(full)
      out.push(
        rest.includes("/")
          ? { path: full, type: "dir", sha: `sha-${head}` }
          : { path: full, type: "file", sha: `sha-${head}` },
      )
    }
    return out.sort((a, b) => (String(a.path) < String(b.path) ? -1 : 1))
  }

  return {
    requests,
    tree,
    reset() {
      requests.length = 0
    },
    async send(request: GithubRequest): Promise<GithubResponse> {
      requests.push(request)

      if (request.path === `/repos/${options.repo}`) {
        if (options.private === null) return { status: 404 }
        if (options.private === "unknown") return { status: 200, json: { full_name: options.repo } }
        return { status: 200, json: { full_name: options.repo, private: options.private ?? true } }
      }

      const contents = request.path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/)
      const target = contents?.[1] ?? ""

      if (request.method === "GET" && tree.has(target)) {
        // A file: return its content so `restore()` can download it.
        return {
          status: 200,
          json: { path: target, type: "file", encoding: "base64", content: tree.get(target) },
        }
      }

      if (request.method === "GET") {
        const listing = children(target)
        if (listing.length === 0) return { status: 404 }
        return { status: 200, json: listing }
      }

      if (request.method === "PUT") {
        uploads += 1
        if (options.failUploadAt === uploads) throw new Error("network down")
        if (options.status && options.status >= 400) return { status: options.status }
        const body = request.body as { content?: string } | undefined
        tree.set(target, body?.content ?? "")
        return { status: 201, json: { content: { path: target } } }
      }

      if (request.method === "DELETE") {
        tree.delete(target)
        return { status: 200, json: { path: target } }
      }

      return { status: 405 }
    },
  }
}
