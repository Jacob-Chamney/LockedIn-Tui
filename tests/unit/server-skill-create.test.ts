/**
 * `skill.create`: the Skills wizard's Review step, at the protocol boundary.
 *
 * Every case here is shape-only. An invalid payload is refused **before** the
 * app boots, so no workspace, keychain or provider is touched; a valid payload
 * is proven to pass validation by reaching the boot seam, which this test wires
 * to a refusal. The real transaction (goal folder, template plan, duplicate ids)
 * is covered by `tests/integration/server-data.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  parseSkillPlan,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle(
    request(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "skill.create",
        ...(params === undefined ? {} : { params }),
      }),
    ),
  );
  if (response === null) throw new Error("expected a response for a request with an id");
  return response;
}

const REFUSAL: BootFailure = {
  kind: "boot",
  path: "/tmp/lockedin-unit-skill-create",
  message: "this test never opens a workspace",
  next: "nothing to do",
};

/**
 * A core whose boot counts calls and then refuses.
 *
 * Validation happens before `services()`, so a shape failure leaves the counter
 * at zero while a well-formed payload reaches it. That is the whole assertion
 * this file needs: it never writes a goal folder.
 */
function refusingCore() {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: false, error: REFUSAL } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, counter };
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, params);
  if (!("error" in response)) throw new Error("skill.create should have failed");
  return response.error;
}

describe("skill.create", () => {
  test("is published in the handshake capabilities", () => {
    expect(CAPABILITIES).toContain("skill.create");
  });

  test("a missing goal is invalid params and never boots", async () => {
    const { server, counter } = refusingCore();
    const error = await errorOf(server);
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("goal");
    expect(counter.calls).toBe(0);
  });

  test("a blank goal is invalid params, not a boot", async () => {
    const { server, counter } = refusingCore();
    for (const goal of ["", "   ", "\n\t "]) {
      const error = await errorOf(server, { goal });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("goal");
    }
    expect(counter.calls).toBe(0);
  });

  test("a non-string goal is invalid params", async () => {
    const { server, counter } = refusingCore();
    for (const goal of [42, null, true, ["read"]] as const) {
      const error = await errorOf(server, { goal });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("goal");
    }
    expect(counter.calls).toBe(0);
  });

  test("a goal over 200 characters is invalid params", async () => {
    const { server, counter } = refusingCore();
    const error = await errorOf(server, { goal: "x".repeat(201) });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("200");
    expect(counter.calls).toBe(0);
  });

  test("a non-string prior is invalid params", async () => {
    const { server, counter } = refusingCore();
    const error = await errorOf(server, { goal: "Read disassembly output", prior: 5 });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("prior");
    expect(counter.calls).toBe(0);
  });

  test("prior over 2000 characters is invalid params", async () => {
    const { server, counter } = refusingCore();
    const error = await errorOf(server, {
      goal: "Read disassembly output",
      prior: "y".repeat(2001),
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("2000");
    expect(counter.calls).toBe(0);
  });

  test("a well-formed payload passes validation and reaches the boot seam", async () => {
    const { server, counter } = refusingCore();

    // The goal alone (prior omitted) and the goal with prior both pass the wire
    // check; the boot refusal is the proof, because it is asked after it.
    for (const params of [
      { goal: "Read disassembly output confidently" },
      { goal: "Read disassembly output confidently", prior: "I know a little C" },
      { goal: "x".repeat(200), prior: "y".repeat(2000) },
    ]) {
      const error = await errorOf(server, params);
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "boot" });
    }
    expect(counter.calls).toBe(1);
  });

  test("a caller-chosen id is ignored and the payload still passes validation", async () => {
    // The core derives the id from the goal (`courseSlug`); a client-sent id is
    // never read, so it cannot overwrite an existing goal.
    const { server, counter } = refusingCore();
    const error = await errorOf(server, {
      goal: "Read disassembly output confidently",
      id: "an-easier-name",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(counter.calls).toBe(1);
  });
});

describe("parseSkillPlan", () => {
  const chapters = [
    { title: "Registers", guide: "# Lesson\n", practical: "# Practical\n" },
    { title: "Control flow", guide: "# Lesson\n", practical: "# Practical\n" },
  ];

  test("reads a bare JSON array", () => {
    expect(parseSkillPlan(JSON.stringify(chapters))).toEqual(chapters);
  });

  test("reads the first array inside prose or a fenced block", () => {
    const raw = ["Here you go:", "```json", JSON.stringify(chapters), "```", "Done."].join("\n");
    expect(parseSkillPlan(raw)).toEqual(chapters);
  });

  test("keeps surrounding text containing brackets from truncating the array", () => {
    const raw = `[draft]\n${JSON.stringify(chapters)}\n[note]`;
    expect(parseSkillPlan(raw)).toEqual(chapters);
  });

  test("returns an empty list for malformed JSON", () => {
    expect(parseSkillPlan("not JSON at all")).toEqual([]);
    expect(parseSkillPlan("[{")).toEqual([]);
  });

  test("one unusable entry makes the whole reply unusable", () => {
    const raw = JSON.stringify([
      chapters[0],
      { title: "No practical", guide: "# Lesson\n" },
      { title: "Blank guide", guide: "   ", practical: "# Practical\n" },
      "a string",
      null,
    ]);
    expect(parseSkillPlan(raw)).toEqual([]);
    expect(parseSkillPlan(JSON.stringify([chapters[0], { title: "Only a title" }]))).toEqual([]);
  });

  test("an object reply is not an array and yields no plan", () => {
    expect(parseSkillPlan('{"chapters":[]}')).toEqual([]);
  });
});
