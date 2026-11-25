> **2026-11-25 — this is the desktop shell.** The TUI frontend has been removed.
> "Advanced TUI" describes the visual language (hairlines, mono chrome, one
> accent), not a second frontend.

# Redesign — "advanced TUI" visual system + a real learning harness

Status: proposed (2026-11-23). Supersedes the look, not the behaviour rules in
`desktop/AGENTS.md` §4 and `docs/design.md` §1–§2.

The brief:

1. **Flawless, clean UI/UX.** Calm, dense, legible, keyboard-first, no dead space.
2. **An advanced TUI** — the feel of a modern terminal application (think
   Superfile / Yazi / lazygit / btop), but rendered with Flutter: real
   typography, gradients, translucent surfaces, hairline borders, motion.
3. **A real learning harness** whose model output is clean, clear and concise —
   guided by [learnharness](https://github.com/amosblomqvist/learnharness)'s
   *method*, not its code or screens.

---

## 1. What is wrong today

Evidence: `/tmp/opencode/before/shots/*.png` (20 surfaces, captured from the
release bundle).

- **It reads as generic Material, not a TUI.** Rounded 8 px cards, Material
  icons, Roboto label text, a standard `TextField`, a stock `FilledButton`.
  Nothing in the chrome says "terminal application".
- **The learning surface is a card wall.** `session-detail.png` is five stacked
  cards — INSTRUCTIONS, SOURCES, SESSION MEMORY, COVERAGE, STEPS — each with an
  uppercase label and a badge. The most important thing (what am I learning next,
  and did it land?) is at the bottom, below two diagnostic sections.
- **Density without hierarchy.** Everything is `surface` on `background` with the
  same 14 px padding and the same uppercase 10 px label, so nothing is louder
  than anything else. The eye has no entry point.
- **Empty states are dead space.** `chat.png` centres a title and two lines in a
  1,000 px box.
- **The harness is a chat with files.** A lock-in session is sources + a prompt +
  generated checkboxes. There is no measurement of what the learner already
  holds, no dependency map, no per-step check, no repair, and no held knowledge.
  The model is asked for a JSON plan and a chat reply; nothing shapes it toward
  "one reasoning step, then check".

---

## 2. The learning method we adopt (own wording, own data model)

From `learnharness/docs/teaching-methodology.md`, distilled to the parts that
change our product:

| Idea | What it means for us |
|---|---|
| **Two states** | A session brackets *what the learner holds* and *the goal*, and both are concrete. |
| **Self-evidence is the goal** | The session ends when the goal *feels obviously true*, not when a checklist is ticked. |
| **One reasoning step at a time** | Each teaching beat adds exactly one connection to something already held. |
| **A check after every step** | The step is verified immediately; a miss is repaired before anything is built on it. |
| **The minimal tree** | The plan is the smallest dependency set from held to goal — not a topic list, not coverage. |
| **Plan is a map, not the road** | The learner sees a coarse structural map; the lesson is not chopped into "Part 3". The map is a tree: the first step is open and a branch stays locked, with the blocking step named, until everything it builds on is held. |
| **Presentation is clarity** | No meta-narration, no labelled segments, no restating the structure. Prose carries the reasoning. |
| **Knowledge is a graph** | Held propositions and the reasoning links between them persist across sessions. |
| **Practice retrieves without naming** | Problems that require the knowledge to come to mind, not questions that name the concept. |

What we deliberately **do not** take: their views, their plugin API, their
Electron shell, their exact screens, their feature set.

### 2.1 Session shape

```
measure ──▶ plan ──▶ teach ──▶ practice ──▶ held
   │         │        │  ▲        │            │
   │         │        │  └─ repair │            └─▶ knowledge graph
   │         │        └─ step + check
   │         └─ dependency map (coarse, editable)
   └─ probe questions + a concrete goal
```

Each phase is a *surface state*, not a separate window: the session page is one
place whose centre changes. `Esc` never loses the session; the phase rail on the
left is always visible.

### 2.2 What the model is asked for, and how output stays concise

- Every generation returns **structured data we render**, never prose we dump:
  a probe set, a plan tree, one step, one check, one repair.
- The four phases are keyboard-reachable (`1`–`4`), and the teaching loop has
  its own keys (`m` measure, `n` next step, `i` answer, `s` side question,
  `Enter` check), so the harness never requires a pointer.
- Prompts state the shape, the length budget and the voice, and refuse
  meta-commentary ("In this step we will…"). A reply that fails the shape is
  retried once by us with the failure named, then reported — never rendered raw.
- Rendering does the formatting: numbers, keys, code, emphasis. The model does
  not write Markdown tables or headings for us to strip.

---

## 3. Visual system

### 3.1 Identity: a terminal with a graphics stack

Three pillars — **hairlines, type, one accent**:

- **1 px hairlines** everywhere instead of shadows and rounded boxes. Panels are
  separated by `line` at 1 px, not by elevation. Radius 0–2 px: a terminal has
  no rounded corners, and the crispness is the point.
- **A real type scale in a mono face** for chrome and data; prose gets a
  proportional face at a comfortable measure. Hierarchy comes from *weight,
  size and colour*, never from boxes.
- **One accent**, used only for the focused thing and for progress. Everything
  else is a neutral ramp.

Advanced rendering, used with restraint (it is a tool, not decoration):

- a **12 px backdrop blur** behind floating layers (palette, leader, dialogs) —
  opaque enough to read, blurred enough to say "above";
- a **2 px accent rail with a soft outer glow** to mark focus (the only glow in
  the app);
- **gradient progress** (accent → accent-70 %) in thin bars, never chunky;
- **animated caret and a 1 px caret trail** in the composer;
- **sub-pixel glyph detail** from a variable mono font (`JetBrains Mono` bundled,
  fallback `monospace`);
- **motion**: 120 ms fades for layer entry, 90 ms for value changes, and one
  "settle" animation per phase transition. Nothing loops. Reduced-motion is
  honoured (`MediaQuery.disableAnimations`).

### 3.2 Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LOCKEDIN / Physics — Unit 4 / Teach            ● streaming   2.4k tok  $0.01  │  1
├──────────┬──────────────────────────────────────────────┬────────────────────┤
│ PHASES   │  the step                                       │  CONTEXT           │
│ measure  │  ┌──────────────────────────────────────────┐   │  plan              │
│ plan     │  │ reasoning prose …                        │   │  sources           │
│ ▸ teach  │  └──────────────────────────────────────────┘   │  notes             │
│ practice │  ✓ check: which quantity is conserved? …        │  held              │
├──────────┴──────────────────────────────────────────────┴────────────────────┤
│ TEACH  NORMAL  step 4/9 · 2 checks · 1 repaired        ? keys  Space leader   │  1
└──────────────────────────────────────────────────────────────────────────────┘
```

- The rail is **labels + state glyphs**, 2 chars of padding, no icons-only mode
  below 900 px — it becomes a 3 px activity strip with a tooltip instead.
- The **right context pane** is where sources, plan and held knowledge live. It
  is the "IDE sidebar" of a learning session, and it collapses to a tab strip.
- Chat is **one surface among several**, not the chrome around all of them: the
  centre column is whatever the current phase needs.

### 3.3 Tokens

Reuse the twelve semantic tokens (they are wired to the core's custom palette)
and add a *typographic* and *spatial* layer as Dart constants, not config:

| Layer | Tokens |
|---|---|
| space | 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 (px) — no other values |
| radius | `0` chrome, `2` controls, `6` floating layers only |
| stroke | `hairline` 1 px, `focus` 2 px, `progress` 3 px |
| type | `micro` 10.5/1.3 w600, `label` 11.5/1.4 w600 caps-0, `body` 13/1.55, `prose` 15/1.7, `title` 18/1.3 w600, `display` 24/1.2 w650 |
| motion | `fast` 90 ms, `base` 120 ms, `settle` 220 ms, curves: `easeOutCubic`, `easeOutQuint` |

---

## 4. Phases of the overhaul

Each phase ends with a green `scripts/desktop-check.sh`, screenshots, and a
commit. Order is chosen so every phase is demoable.

| # | Phase | Deliverable | Evidence |
|---|---|---|---|
| **A** | **Foundations** | type/spacing/motion token layer, mono font bundle, hairline chrome primitives (`Panel`, `Rule`, `SectionLabel`, `KeyHint`, `ProgressBar`), new top bar / status bar / rail | screenshots of chat, sessions, settings at 800×600 and 1600×1000 |
| **B** | **Chat surface** | composer with caret trail + attachments strip, bubbles → message blocks with role gutters, streaming tick, empty state that teaches, error as a banner row | chat screenshot, streaming test |
| **C** | **Teaching surface** | phase rail, centre stage, plan map, check cards, repair flow, sources/held pane — the card wall is gone | session screenshots per phase |
| **C2** | **Lock-in, focused** | the same chrome carrying a step-first surface: one step at a time, the list as the product, no teaching prose, a "next step" that is always the loudest thing | lock-in screenshots |
| **D** | **Core: session phases** | protocol + services for `measure`/`plan`/`teach`/`practice`, prompt shaping, concise-output guard, held propositions | protocol doc, core tests |
| **E** | **Knowledge** | held propositions + reasoning links, session links, practice draws from them | knowledge screenshots, tests |
| **F** | **Polish** | every surface audited against `ui-review`/`ui-visual`/`ui-states`, motion + reduced-motion, 800×600 pass, docs | audit table, screenshots |

---

## 4a. The two learning modes, decided 2026-11-23

The user settled the product split, and it is sharper than "add a mode":

| | **Teaching** (the old Skills, renamed) | **Lock-in** (kept, re-focused) |
|---|---|---|
| Who it is for | Someone who does not yet hold the idea | Someone who can already do the work |
| Job | Build understanding: measure → plan → one reasoning step at a time → check → repair → practice | Keep them on task: a crisp, ordered step list so the work itself is the only thing to think about |
| The model produces | A probe set, a dependency map, one step, one check, one repair | Steps only — concrete, small, in order. No explanations unless asked |
| Success | The goal feels obviously true; knowledge is held | The user did the work without deciding what to do next |
| What we must never do | Lecture; multi-step walls of text; build on an unchecked step | Preach, explain, or hand over the solution (a coding assignment gets steps, not code) |
| Example | "Why does the energy balance hold?" | "1. Read §4.2 and list the boundary conditions. 2. Write the integral limits down." |

Lock-in's steps are a *focus device*, not a curriculum: the prompt asks for the
next physical action, phrased so the user can start it immediately, and the UI
puts exactly one step in front of them with the list beside it.

## 5. Non-negotiables carried over

- Keyboard-first; every action reachable without a mouse; leader chords never
  depend on a frame (PR #132).
- One accent colour, colour never the only signal.
- Every state legible: empty, loading, streaming, failed, blocked, cancelled.
- The wall, chill-is-tool-free, source-bound facts, atomic writes — unchanged.
- 80×24-ish (800×600) must stay usable; nothing clips.

## 6. Depth systems (P1/P2, built 2026-11-24)

Ten systems on top of the harness, each with its own contract and tests. They
are ours: the reference product was read for the *problems it solves*, not for
its data shapes or code.

| System | Where | What it does |
|---|---|---|
| Thinking + confidence | `teach.check` | The learner's reasoning and a 1–5 self-report travel with the answer; both are stored and shown to the marker, never treated as evidence. |
| Plan map | `teaching.json`, `src/domain/teaching.ts` | Each step names the earlier steps it requires. The next step is the first unpassed step whose prerequisites are held, so a branch is available without waiting for an unrelated one. |
| Side questions | `src/services/teaching/side.ts` | One tool-free thread per step, stored beside the goal, opened inside the step card. A failure writes nothing. |
| Math + Mermaid | `desktop/lib/features/chat/math.dart`, `diagram.dart` | A small LaTeX renderer (fractions, roots, scripts, greek, operators) and a layered flowchart renderer, both in-repo; an unreadable diagram keeps its source. |
| Theme overrides | `theme.custom.*`, `desktop/lib/theme/palette.dart` | Twelve token overrides layered over any base palette, with JSON import/export and validation by name. |
| Updater surface | `update.info`, `update.check` | Shows the running version and checks the public release feed on an explicit key; the reply is a release page, never an automatic self-replace. |
| Spaced repetition | `src/domain/scheduler.ts` | Four grades, one ease per card, keyed by question so a regenerated deck keeps progress. `again` is a ten-minute step with a lapse. |
| Context + compaction | `src/domain/context.ts`, `session.chat.*` | A meter over the transcript and an explicit compaction that stores one summary beside an unchanged `chat.jsonl`; the next request sends the summary plus the recent messages. |
| Research briefs | `src/services/teaching/research.ts` | Fetches the learner's named pages under SSRF/content/size guards, then requires `[n]` citations or `(agent explanation)` before anything is written. |
| PDF figures | `src/services/lockin/figures.ts` | Crops a page or a box out of the session's own PDF with `pdftoppm`, stores the PNG inside the session, and serves it to the shell as base64. |
| Teaching citations | `src/domain/teaching.ts` | A step may quote a copied source with an exact excerpt; a citation outside the goal's sources is refused. No citation is labelled `agent explanation`. |
| Learning graph | `src/services/knowledge/learning-graph.ts` | A read-only projection over goals, steps, sources, sessions, tasks, cards, research and figures. Every node is a file and every edge is provable; no model extraction. |
| Prompt notes | `src/domain/prompts.ts`, `[prompts]` | One standing note per generator, appended below the shape and limits. It cannot change the contract, and `settings.patch` cannot write it. |

The non-negotiables still hold: the wall, chill-is-tool-free, source-bound facts,
atomic writes, no retry, and colour never being the only signal. Research and
figures are **not sources**: neither enters coverage or the plan.
