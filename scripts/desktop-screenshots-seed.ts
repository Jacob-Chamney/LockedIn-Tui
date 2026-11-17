/**
 * Synthetic-data seeder for the desktop screenshot set.
 *
 * Everything it writes lives under the run directory given on the command line;
 * nothing touches a real workspace, a provider key or the user's data dir. The
 * names are invented on purpose so a screenshot can never show personal content.
 *
 *   bun scripts/desktop-screenshots-seed.ts /tmp/lockedin-shots/run
 *   scripts/desktop-screenshots.sh \
 *     --workspace /tmp/lockedin-shots/run/workspace \
 *     --data      /tmp/lockedin-shots/run/data
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createWorkspace } from "../src/storage/workspace.ts";
import { createLockInSession } from "../src/services/lockin/create.ts";
import { renderSteps } from "../src/services/lockin/steps.ts";
import { toggle } from "../src/domain/progress.ts";
import { createCourse } from "../src/services/skills/course.ts";
import { gatherSources } from "../src/services/skills/gather.ts";
import { register } from "../src/services/work/register.ts";

const run = process.argv[2];
if (!run) throw new Error("usage: seed.ts <run-dir>");
const workspaceRoot = join(run, "workspace");
const dataDir = join(run, "data");
const inputDir = join(run, "input");
const projectsDir = join(run, "projects");

await mkdir(inputDir, { recursive: true });
await mkdir(projectsDir, { recursive: true });

const created = await createWorkspace(workspaceRoot, { dataDir });
if (!created.ok) throw new Error(`workspace: ${JSON.stringify(created.error)}`);
const workspace = created.value;
console.log("workspace:", workspace.root);

const write = async (path: string, body: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body, "utf8");
};

const source = async (name: string, body: string): Promise<string> => {
  const path = join(inputDir, name);
  await writeFile(path, body, "utf8");
  return path;
};

type SessionSpec = {
  name: string;
  at: string;
  prompt: string;
  files: string[];
  steps: { phase: string; items: string[] }[];
  checked?: number[];
  chat?: { role: "user" | "assistant"; content: string }[];
};

const specs: SessionSpec[] = [
  {
    name: "Physics — Unit 4",
    at: "2026-11-15T10:30:00Z",
    prompt:
      "Work through the Unit 4 problem set on energy balance. Explain each step before solving it.",
    files: [
      await source(
        "unit-4-lecture-notes.md",
        [
          "# Unit 4 — Energy balance",
          "",
          "## Boundary conditions",
          "",
          "The integral limits come from the physical boundary of the system. A",
          "closed system exchanges no mass, so the energy balance reduces to heat",
          "and work terms.",
          "",
          "## Worked example",
          "",
          "A gas expands from 2 L to 5 L at 1 atm. The work done is pΔV.",
          "",
        ].join("\n"),
      ),
      await source(
        "unit-4-problem-set.md",
        [
          "# Problem set 4",
          "",
          "1. Derive the energy balance for a closed system.",
          "2. Compute the work done by an expanding gas.",
          "3. State when the boundary conditions change the integral limits.",
          "",
        ].join("\n"),
      ),
    ],
    steps: [
      {
        phase: "Understand",
        items: [
          "Summarise the boundary conditions that set the integral limits in section 4.2",
          "Distinguish a closed system from an open one in the lecture notes",
        ],
      },
      {
        phase: "Solve",
        items: ["Derive the energy balance for problem 1 with the stated limits"],
      },
    ],
    checked: [1],
    chat: [
      {
        role: "user",
        content: "Where do the integral limits come from in problem 1?",
      },
      {
        role: "assistant",
        content:
          "They come from the boundary of the system, not from the maths. Section 4.2 of the lecture notes fixes the limits at the physical boundary; for a closed system no mass crosses it, so only heat and work terms survive and the limits are the two states in the problem statement.",
      },
    ],
  },
  {
    name: "Biology — Cells",
    at: "2026-11-12T14:00:00Z",
    prompt: "Revise cell structure and prepare for the short-answer test.",
    files: [
      await source(
        "cell-structure.md",
        [
          "# Cell structure",
          "",
          "Mitochondria produce ATP by oxidative phosphorylation. Ribosomes assemble",
          "proteins. The nucleus holds the genome and controls transcription.",
          "",
        ].join("\n"),
      ),
      await source(
        "cell-transport.md",
        [
          "# Transport across membranes",
          "",
          "Diffusion moves solutes down a gradient. Active transport needs ATP and",
          "moves solutes against it.",
          "",
        ].join("\n"),
      ),
    ],
    steps: [
      {
        phase: "Recall",
        items: [
          "Name the organelle that produces ATP and state the process it uses",
          "List the three functions of the nucleus from the notes",
        ],
      },
      {
        phase: "Apply",
        items: [
          "Compare diffusion and active transport in a two-column table",
          "Explain why active transport needs ATP but diffusion does not",
        ],
      },
    ],
  },
  {
    name: "Chemistry — Bonding",
    at: "2026-11-08T09:00:00Z",
    prompt: "Explain ionic and covalent bonding with examples from the notes.",
    files: [
      await source(
        "bonding-notes.md",
        [
          "# Bonding",
          "",
          "Ionic bonds transfer electrons between a metal and a non-metal. Covalent",
          "bonds share electrons between non-metals.",
          "",
        ].join("\n"),
      ),
      await source(
        "bonding-questions.md",
        [
          "# Questions",
          "",
          "1. Why does sodium chloride conduct when molten?",
          "2. Draw the covalent bond in water.",
          "",
        ].join("\n"),
      ),
    ],
    steps: [
      {
        phase: "Understand",
        items: [
          "Define ionic bonding using the electron-transfer description in the notes",
          "Define covalent bonding using the shared-pair description in the notes",
        ],
      },
      {
        phase: "Practise",
        items: [
          "Explain why molten sodium chloride conducts electricity",
          "Draw the electron sharing in a water molecule",
        ],
      },
    ],
    checked: [0],
  },
];

const sessionFolders: Record<string, string> = {};
for (const spec of specs) {
  const result = await createLockInSession({
    workspace,
    created: spec.at,
    name: spec.name,
    prompt: spec.prompt,
    files: spec.files,
    steps: true,
  });
  if (!result.ok) throw new Error(`${spec.name}: ${JSON.stringify(result.error)}`);
  const folder = result.value.folder;
  sessionFolders[result.value.session.id] = folder;

  let steps = renderSteps({ phases: spec.steps });
  for (const index of spec.checked ?? []) {
    const toggled = toggle(steps, index);
    if (!toggled.ok) throw new Error(`${spec.name} toggle ${index}: ${JSON.stringify(toggled.error)}`);
    steps = toggled.value.text;
  }
  await writeFile(join(folder, "assignment-steps.md"), steps, "utf8");

  if (spec.chat) {
    const lines = spec.chat.map((message, index) =>
      JSON.stringify({
        role: message.role,
        content: message.content,
        at: new Date(Date.parse(spec.at) + (index + 1) * 45_000).toISOString(),
      }),
    );
    await writeFile(join(folder, "chat.jsonl"), `${lines.join("\n")}\n`, "utf8");
  }
  console.log("session:", result.value.session.id, "->", folder);
}

// Chill history: local text only, exactly the file the core loads on chat.snapshot.
await mkdir(dataDir, { recursive: true });
const chill = {
  schema: 1,
  messages: [
    {
      role: "user",
      content: "What is the difference between work and heat in a closed system?",
      at: "2026-11-16T09:02:00.000Z",
    },
    {
      role: "assistant",
      content:
        "Work crosses the boundary through a force acting over a distance; heat crosses it through a temperature difference. In a closed system no mass crosses the boundary, so the internal energy changes only through those two terms.",
      at: "2026-11-16T09:02:06.000Z",
    },
    {
      role: "user",
      content: "Does that change if the process is adiabatic?",
      at: "2026-11-16T09:03:00.000Z",
    },
    {
      role: "assistant",
      content:
        "Yes: adiabatic means no heat crosses the boundary, so the heat term is zero and any change in internal energy comes entirely from work.",
      at: "2026-11-16T09:03:05.000Z",
    },
  ],
};
await writeFile(join(dataDir, "chill.json"), `${JSON.stringify(chill, null, 2)}\n`, "utf8");

// Usage and learning counters so Stats has real-shaped data (all synthetic).
const now = new Date("2026-11-16T09:00:00.000Z");
const runAt = (daysAgo: number, hour: number) => {
  const at = new Date(now);
  at.setUTCDate(at.getUTCDate() - daysAgo);
  at.setUTCHours(hour, 0, 0, 0);
  return at.toISOString();
};
const usage = {
  schema: 1,
  runs: [
    { model: "openai/gpt-4.1-mini", input: 3120, output: 880, costMicroUsd: 4360, at: runAt(6, 9), failed: false, scope: "school" },
    { model: "openai/gpt-4.1-mini", input: 2210, output: 640, costMicroUsd: 3180, at: runAt(5, 11), failed: false, scope: "school" },
    { model: "anthropic/claude-sonnet-4", input: 1840, output: 1200, costMicroUsd: 24_600, at: runAt(5, 15), failed: false, scope: "skills" },
    { model: "openai/gpt-4.1-mini", input: 900, output: 410, costMicroUsd: 1290, at: runAt(4, 10), failed: true, scope: "school" },
    { model: "openai/gpt-4.1-mini", input: 4620, output: 1510, costMicroUsd: 6340, at: runAt(3, 8), failed: false, scope: "work" },
    { model: "anthropic/claude-sonnet-4", input: 2860, output: 1780, costMicroUsd: 35_400, at: runAt(2, 14), failed: false, scope: "skills" },
    { model: "openai/gpt-4.1-mini", input: 1980, output: 720, costMicroUsd: 2840, at: runAt(1, 16), failed: false, scope: "school" },
    { model: "openai/gpt-4.1-mini", input: 1240, output: 560, costMicroUsd: 1780, at: runAt(0, 9), failed: false, scope: "school" },
  ],
};
await writeFile(join(dataDir, "usage.json"), `${JSON.stringify(usage, null, 2)}\n`, "utf8");

const learning = {
  schema: 1,
  events: [
    { kind: "step-toggled", at: runAt(5, 12), scope: "school" },
    { kind: "step-toggled", at: runAt(4, 12), scope: "school" },
    { kind: "step-toggled", at: runAt(2, 18), scope: "school" },
    { kind: "card-known", at: runAt(3, 20), scope: "school" },
    { kind: "card-known", at: runAt(3, 21), scope: "school" },
    { kind: "card-missed", at: runAt(2, 20), scope: "school" },
    { kind: "lesson-completed", at: runAt(2, 15), scope: "skills" },
    { kind: "tool-call", at: runAt(1, 10), scope: "work", name: "read_file" },
    { kind: "tool-call", at: runAt(1, 11), scope: "work", name: "search_files" },
  ],
};
await writeFile(join(dataDir, "stats.json"), `${JSON.stringify(learning, null, 2)}\n`, "utf8");

// One Work project: a real git repo outside the workspace, so Changes has data.
const projectRoot = join(projectsDir, "garden-notes");
await mkdir(join(projectRoot, "src"), { recursive: true });
await writeFile(join(projectRoot, "README.md"), "# Garden notes\n\nA small planting planner.\n", "utf8");
await writeFile(join(projectRoot, "src", "planting.ts"), "export const beds = 4;\n", "utf8");
const git = (args: string[]) =>
  Bun.spawnSync(["git", ...args], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
git(["init", "-q", "-b", "main"]);
git(["config", "user.email", "screenshot@example.invalid"]);
git(["config", "user.name", "Screenshot Seed"]);
git(["add", "-A"]);
git(["commit", "-q", "-m", "seed: initial planting planner"]);
await writeFile(
  join(projectRoot, "src", "planting.ts"),
  "export const beds = 6;\nexport const rowsPerBed = 3;\n",
  "utf8",
);
await writeFile(join(projectRoot, "src", "seasons.ts"), "export const seasons = ['spring', 'summer'];\n", "utf8");

const registered = await register({
  workspace,
  root: projectRoot,
  name: "Garden notes",
  instructions: "Prefer small diffs. Answer with file paths.",
  mode: "chat",
});
if (!registered.ok) throw new Error(`project: ${JSON.stringify(registered.error)}`);
console.log("project:", registered.value.meta.id, "->", registered.value.folder);

// One skill course with two gathered sources that carry excerpts.
const course = await createCourse({
  workspace,
  goal: "Read disassembly output confidently",
  prior: "I know a little C and can read a stack trace.",
  created: "2026-11-10T09:00:00Z",
});
if (!course.ok) throw new Error(`course: ${JSON.stringify(course.error)}`);
const gathered = await gatherSources(
  {
    workspace,
    goalId: course.value.id,
    retrievedAt: "2026-11-10T09:05:00Z",
  },
  [
    {
      kind: "text",
      name: "intel-sdm-excerpt.md",
      text: "Registers hold working state across calls. The instruction pointer names the next instruction to execute, and the stack pointer tracks the current frame.",
    },
    {
      kind: "text",
      name: "objdump-notes.md",
      text: "objdump -d prints one instruction per line with its address and encoding, so a branch target can be read straight off the left column.",
    },
  ],
);
if (!gathered.ok) throw new Error(`gather: ${JSON.stringify(gathered.error)}`);
console.log("skill:", course.value.id, "sources:", gathered.value.added);

// Vault notes give the Knowledge surface something to draw: a topic forest on
// the school side and one on the skills side, each with a short body.
const vaultNote = async (side: "school" | "skills", slug: string, topics: string, title: string, body: string) => {
  const folder = side === "school" ? "school/vault/concepts" : "skills/vault/knowledge";
  await write(
    join(workspace.root, folder, `${slug}.md`),
    [
      "---",
      `title: "${title}"`,
      "type: concept",
      `topics: [${topics}]`,
      `updated: 2026-11-14T09:00:00Z`,
      "---",
      "",
      `# ${title}`,
      "",
      body,
      "",
    ].join("\n"),
  );
};

await vaultNote(
  "school",
  "energy-balance-boundary",
  '"Physics", "Thermodynamics", "Boundary conditions"',
  "Boundary conditions set the integral limits",
  "A closed system exchanges no mass, so only heat and work cross the boundary.\nThat is why the limits of the energy integral are the two states in the problem.",
);
await vaultNote(
  "school",
  "cell-structure",
  '"Biology", "Cells"',
  "Cell structure in one page",
  "The mitochondrion produces ATP; the nucleus holds DNA; the membrane is selective.\nShort-answer questions reward naming the function, not just the organelle.",
);
await vaultNote(
  "skills",
  "stack-frames",
  '"Assembly", "Stack frames"',
  "What a stack frame actually holds",
  "A frame holds the return address, saved registers and the callee's locals.\nThe stack pointer tracks the current frame; the base pointer anchors it.",
);

const config = await readFile(join(workspace.root, "config.toml"), "utf8").catch(() => "");
console.log("config present:", config.length > 0);
console.log("seeded:", run);
