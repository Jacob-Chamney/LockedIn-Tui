/**
 * Repository privacy check (WP-601).
 *
 * `docs/product.md` §9: "The GitHub repo must be verified private before every
 * push; otherwise refuse." There is deliberately no override: a public, missing
 * or unreadable answer refuses the push and names the repository.
 *
 * This module is pure — the caller supplies the already-sent response, so the
 * verdict is testable without a network.
 */

export const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export type RepoProbe = {
  status: number
  json?: unknown
}

export type PrivacyVerdict =
  | { ok: true; repo: string; private: true }
  | {
      ok: false
      repo: string
      state: "public" | "not-found" | "unverifiable"
      message: string
      next: string
    }

export function parseRepoSlug(input: string): { repo: string } | null {
  const trimmed = typeof input === "string" ? input.trim() : ""
  if (!REPO_SLUG.test(trimmed)) return null
  if (trimmed.startsWith("/") || trimmed.endsWith("/") || trimmed.includes("//")) return null
  return { repo: trimmed }
}

/** Repository metadata endpoint for one repo. */
export function repoPath(repo: string): string {
  return `/repos/${repo}`
}

export function interpretRepoProbe(repo: string, probe: RepoProbe): PrivacyVerdict {
  if (probe.status === 404) {
    return {
      ok: false,
      repo,
      state: "not-found",
      message: `GitHub could not find “${repo}”, so it cannot be verified as private.`,
      next: "Check the repository name in Settings → Storage and archive; nothing was uploaded.",
    }
  }

  if (probe.status === 401 || probe.status === 403) {
    return {
      ok: false,
      repo,
      state: "unverifiable",
      message: `GitHub refused to describe “${repo}”, so it cannot be verified as private.`,
      next: "Relink a token with repository access in Settings → Providers; nothing was uploaded.",
    }
  }

  if (probe.status < 200 || probe.status >= 300) {
    return {
      ok: false,
      repo,
      state: "unverifiable",
      message: `GitHub returned ${probe.status} for “${repo}”, so it cannot be verified as private.`,
      next: "Try again when GitHub is reachable; nothing was uploaded.",
    }
  }

  const metadata = probe.json
  const isPrivate =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { private?: unknown }).private
      : undefined

  if (typeof isPrivate !== "boolean") {
    return {
      ok: false,
      repo,
      state: "unverifiable",
      message: `GitHub did not report whether “${repo}” is private.`,
      next: "Check the repository name and token access; nothing was uploaded.",
    }
  }

  if (!isPrivate) {
    return {
      ok: false,
      repo,
      state: "public",
      message: `“${repo}” is public, so nothing was uploaded.`,
      next: "Make the repository private on GitHub, or choose a private one in Settings → Storage and archive.",
    }
  }

  return { ok: true, repo, private: true }
}
