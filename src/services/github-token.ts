/**
 * Validate a GitHub personal access token before it is stored.
 *
 * The token goes to the OS keychain, never to config, a log or a fixture. One
 * authenticated request is enough to tell a bad token from a good one; the
 * repository's privacy is a separate check performed before a push.
 */
const USER_API = "https://api.github.com/user";
const TIMEOUT_MS = 5_000;

export type GithubTokenCheck =
  | { ok: true; login: string }
  | { ok: false; message: string };

/** A coarse local check: non-empty, no whitespace, long enough to be a token. */
export function looksLikeGithubToken(token: string): boolean {
  const value = token.trim();
  return value.length >= 20 && !/\s/.test(value);
}

/**
 * One request to `/user`, never retried.
 *
 * A 401 is a rejected token, a 403 is usually a rate limit or an expired
 * credential, and any other status is reported with its number. The token is
 * never included in a message.
 */
export async function validateGithubToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubTokenCheck> {
  const value = token.trim();
  if (!looksLikeGithubToken(value)) {
    return { ok: false, message: "that does not look like a GitHub token" };
  }
  try {
    const response = await fetchImpl(USER_API, {
      headers: {
        Authorization: `Bearer ${value}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "lockedin",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) {
      return { ok: false, message: "GitHub rejected the token" };
    }
    if (response.status === 403) {
      return {
        ok: false,
        message:
          "GitHub refused the token (rate limited or missing permission); try again later or use a token with repository access",
      };
    }
    if (!response.ok) {
      return { ok: false, message: `GitHub returned ${response.status} while checking the token` };
    }
    const body = (await response.json()) as { login?: unknown };
    const login = typeof body.login === "string" ? body.login : "";
    return { ok: true, login };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "the GitHub check timed out"
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, message: `could not reach GitHub: ${message}` };
  }
}
