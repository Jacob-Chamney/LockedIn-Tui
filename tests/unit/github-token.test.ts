/** GitHub token format check and its one validation request. */
import { describe, expect, test } from "bun:test";

import {
  looksLikeGithubToken,
  validateGithubToken,
} from "../../src/services/github-token";

const TOKEN = "ghp_" + "a".repeat(36);

function responder(status: number, body: unknown = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("github token", () => {
  test("rejects blank, short and whitespace-bearing values locally", () => {
    expect(looksLikeGithubToken("")).toBe(false);
    expect(looksLikeGithubToken("short")).toBe(false);
    expect(looksLikeGithubToken("ghp_" + "a".repeat(20) + " x")).toBe(false);
    expect(looksLikeGithubToken(TOKEN)).toBe(true);
  });

  test("a good token returns the login from one request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ login: "friend" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await validateGithubToken(TOKEN, fetchImpl);
    expect(result).toEqual({ ok: true, login: "friend" });
    expect(calls).toBe(1);
  });

  test("401 is a rejected token, 403 names the permission case", async () => {
    expect(await validateGithubToken(TOKEN, responder(401))).toEqual({
      ok: false,
      message: "GitHub rejected the token",
    });
    const forbidden = await validateGithubToken(TOKEN, responder(403));
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.message).toContain("repository access");
  });

  test("a bad format never reaches the network", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await validateGithubToken("short", fetchImpl);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
});
