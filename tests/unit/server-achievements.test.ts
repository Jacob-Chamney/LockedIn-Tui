/**
 * `achievements.list`: the catalogue projection, its award dates and its
 * warning.
 *
 * Every case uses an injected boot seam and a throwaway data directory, so no
 * test here creates a workspace or contacts a provider; the real boot path is
 * covered by `tests/integration/server-data.test.ts`. The one write this method
 * can make is `<dataDir>/achievements.json`, and the cases below prove it never
 * lands anywhere but there.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AWARDS_FILE } from "../../src/app/actions/achievements";
import type { BootFailure } from "../../src/app/boot";
import { ACHIEVEMENTS } from "../../src/domain/achievements";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

/** One row exactly as this method sends it. */
type Row = {
  id: string;
  name: string;
  task: string;
  category: string;
  metric: string;
  target: number;
  value: number;
  progress: number;
  unlocked: boolean;
  difficulty: string;
  awardedAt?: string;
};

type Reply = {
  achievements: Row[];
  earned: number;
  total: number;
  warning: string | null;
};

let base: string;
let dataDir: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-achievements-"));
  dataDir = join(base, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await removeTemp(base);
});

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

/**
 * The boot vocabulary this method reads.
 *
 * The workspace paths point at folders that do not exist: the snapshot treats an
 * unreadable session, goal or project folder as an empty list, so the counters
 * start at zero and the data directory is the only thing this test seeds.
 */
function fakeServices(dataDirOverride: unknown = dataDir): CoreServices {
  return {
    workspace: {
      root: join(base, "workspace"),
      paths: {
        schoolSessions: join(base, "workspace", "school", "sessions"),
        skillsGoals: join(base, "workspace", "skills", "goals"),
        workProjects: join(base, "workspace", "work", "projects"),
      },
    },
    settings: {
      username: "friend",
      theme: "lockedin",
      chatModel: "",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir: dataDirOverride,
      archiveBackend: "folder",
      archiveFolder: "",
      historyLimit: 20,
      responseStyle: "normal",
      tutorPolicy: "direct",
      pluginServers: [],
      hideHints: false,
      pluginDirs: [],
      disabledPlugins: [],
    },
  } as unknown as CoreServices;
}

/** A core whose boot resolves to `services`, counting how often it is called. */
function fakeCore(services: CoreServices = fakeServices()) {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: services } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, services, counter };
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    ...(params === undefined ? {} : { params }),
  });
  const response = await server.handle(request(line));
  if (response === null) throw new Error("expected a response for a request with an id");
  return response;
}

async function achievementsOf(
  server: ReturnType<typeof createCoreServer>,
): Promise<Reply> {
  const response = await ask(server, "achievements.list");
  if ("error" in response) throw new Error(`achievements.list failed: ${response.error.message}`);
  return response.result as unknown as Reply;
}

describe("achievements.list", () => {
  test("is a documented capability", () => {
    expect([...CAPABILITIES]).toContain("achievements.list");
  });

  test("one row per catalogue entry, in catalogue order", async () => {
    const { server } = fakeCore();
    const reply = await achievementsOf(server);

    expect(reply.achievements.map((row) => row.id)).toEqual(
      ACHIEVEMENTS.map((achievement) => achievement.id),
    );
    expect(reply.total).toBe(ACHIEVEMENTS.length);
    expect(reply.earned).toBe(reply.achievements.filter((row) => row.unlocked).length);
    expect(reply.earned).toBeLessThanOrEqual(reply.total);

    // The first entry carries every documented field, unchanged from the domain.
    expect(reply.achievements[0]).toMatchObject({
      id: "first-light",
      name: "First Light",
      task: "Send your first message.",
      category: "starter",
      metric: "messages",
      target: 1,
      difficulty: "easiest",
    });
    for (const row of reply.achievements) {
      expect(["starter", "learning", "work", "collection"]).toContain(row.category);
      expect(row.target).toBeGreaterThan(0);
      // `value` fills the bar and is clamped; `progress` is the raw counter.
      expect(Number.isInteger(row.value)).toBe(true);
      expect(row.value).toBeGreaterThanOrEqual(0);
      expect(row.value).toBeLessThanOrEqual(row.target);
      expect(row.progress).toBeGreaterThanOrEqual(row.value);
      expect(typeof row.difficulty).toBe("string");
      expect(row.difficulty.length).toBeGreaterThan(0);
      if (row.unlocked) {
        expect(row.awardedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      } else {
        // Omitted, not null: a locked row has never been awarded.
        expect("awardedAt" in row).toBe(false);
      }
    }
    expect(reply.warning).toBeNull();
  });

  test("the earned counts agree with the rows and the award file", async () => {
    const { server } = fakeCore();
    const reply = await achievementsOf(server);

    expect(reply.earned).toBeGreaterThanOrEqual(1);
    const awards = JSON.parse(
      await readFile(join(dataDir, AWARDS_FILE), "utf8"),
    ) as Record<string, string>;
    for (const row of reply.achievements) {
      if (row.unlocked) {
        expect(row.awardedAt).toBe(awards[row.id]!);
      } else {
        expect(awards[row.id]).toBeUndefined();
      }
    }
  });

  test("a stored award date is passed through and an unknown id is ignored", async () => {
    await writeFile(
      join(dataDir, AWARDS_FILE),
      `${JSON.stringify({ "first-light": "2026-11-01", "not-an-achievement": "2026-11-01" })}\n`,
    );
    const { server } = fakeCore();
    const reply = await achievementsOf(server);

    expect(reply.achievements).toHaveLength(ACHIEVEMENTS.length);
    const firstLight = reply.achievements.find((row) => row.id === "first-light");
    expect(firstLight?.awardedAt).toBe("2026-11-01");
    expect(reply.achievements.some((row) => row.id === "not-an-achievement")).toBe(false);
    expect(reply.warning).toBeNull();
  });

  test("a corrupt awards file is a warning beside the rows, not an error", async () => {
    await writeFile(join(dataDir, AWARDS_FILE), "{not json\n");
    const { server } = fakeCore();
    const reply = await achievementsOf(server);

    expect(reply.warning).toBe("award dates could not be read");
    expect(reply.achievements).toHaveLength(ACHIEVEMENTS.length);
    expect(reply.earned).toBe(reply.achievements.filter((row) => row.unlocked).length);
    // The read repairs the file for the rows it awards, so the next call is clean.
    if (reply.earned > 0) {
      const repaired = JSON.parse(
        await readFile(join(dataDir, AWARDS_FILE), "utf8"),
      ) as Record<string, string>;
      expect(Object.keys(repaired).length).toBeGreaterThan(0);
    }
  });

  test("a read failure is one typed error, retryable false, and boot stays once", async () => {
    // A non-string data directory is the transport-level guard: the snapshot
    // tolerates a missing or corrupt file, so this is the shape of a genuine
    // read failure rather than a malformed parameter (`achievements.list` has
    // none and never answers `-32602`).
    const { server, counter } = fakeCore(fakeServices(5));
    const first = await ask(server, "achievements.list");
    if (!("error" in first)) throw new Error("achievements.list should have failed");
    expect(first.error.code).toBe(BOOT_FAILED);
    expect(first.error.retryable).toBe(false);
    expect(first.error.data).toMatchObject({ kind: "achievements" });
    expect(typeof (first.error.data as { message: string }).message).toBe("string");

    // A second call is a new request with the same answer, never a retry.
    const second = await ask(server, "achievements.list");
    expect("error" in second && second.error.code).toBe(BOOT_FAILED);
    expect(counter.calls).toBe(1);
  });

  test("a boot refusal is the shared boot shape", async () => {
    const failure: BootFailure = {
      kind: "boot",
      path: "/home/me/LockedIn",
      message: "“LockedIn” belongs to the old LockedIn (v0.7).",
      next: "Start with LOCKEDIN_WORKSPACE=~/LockedIn-Tui bun start.",
    };
    const server = createCoreServer({
      boot: async () => ({ ok: false, error: failure }) as Result<CoreServices, BootFailure>,
    });
    const response = await ask(server, "achievements.list");
    if (!("error" in response)) throw new Error("achievements.list should have failed");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "boot", path: failure.path });
  });
});
