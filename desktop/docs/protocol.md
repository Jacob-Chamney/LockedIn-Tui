# Desktop shell ↔ core protocol

Transport: **one JSON-RPC 2.0 object per line** over the sidecar's stdin/stdout.
UTF-8, `\n` terminated. The core writes protocol lines to stdout only; logs go
to stderr.

## Handshake

```json
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocol":1,"client":"flutter"}}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":1,"server":"lockedin-core","capabilities":["workspace.info","session.list","session.open","session.coverage","session.create","session.toggleStep","session.generateSteps","session.document","session.instructions.get","session.instructions.save","session.instructions.import","session.instructions.reextract","session.archive","session.remove","session.export","session.output.build","session.output.read","session.output.mark","session.deck.state","session.deck.grade","session.deck.reset","session.figure.list","session.figure.extract","session.figure.read","session.figure.annotate","session.figure.remove","session.mistake.list","session.mistake.record","session.mistake.promote","session.mistake.correct","archive.list","archive.restore","archive.remove","source.list","source.add","stats.summary","stats.export","achievements.list","settings.get","decision.get","decision.set","keybinds.get","keybinds.set","chat.snapshot","chat.send","chat.cancel","session.chat.snapshot","session.chat.send","session.chat.cancel","session.chat.context","session.chat.compact","session.chat.uncompact","provider.list","provider.link","settings.patch","theme.custom.get","theme.custom.set","work.list","work.open","work.create","work.templates.list","work.agent.save","work.agent.delete","work.defaultAgent","work.instructions.save","work.changes","work.write.propose","work.write.decide","work.command.propose","work.command.decide","work.permissions.get","work.permissions.set","work.approvals.list","work.chat.list","work.chat.open","work.chat.send","work.chat.cancel","work.swarm.run","work.swarm.board","work.swarm.runs","work.swarm.cancel","work.swarm.remove","work.swarm.retry","work.swarm.verify","activity.list","mcp.list","mcp.refresh","mcp.policy.get","mcp.policy.set","mcp.confirm","skill.list","skill.open","skill.chapter","skill.create","skill.stages.save","skill.archive","skill.remove","skill.export","skill.lesson.build","skill.lesson.read","teach.state","teach.measure","teach.step","teach.check","teach.practice","teach.practice.result","teach.side.snapshot","teach.side.send","teach.side.clear","research.start","research.list","research.read","research.cancel","prompts.list","prompts.set","update.info","update.check","skill.sources.list","skill.sources.add","skill.chat.list","skill.chat.open","skill.chat.create","skill.chat.send","skill.chat.cancel","review.queue","review.mark","knowledge.search","knowledge.tree","knowledge.read","knowledge.graph"]}}
```

- `protocol` is an integer. A mismatch is a blocking shell error, not a retry.
- `capabilities` is an additive list of feature names. The shell must ignore
  unknown capabilities and never assume a method exists without checking.
- `initialize`, `ping` and `shutdown` never touch the workspace, so the handshake
  answers even when the app cannot boot. The first data method boots the real
  workspace, config and services exactly once; later calls reuse that result.
- A boot refusal is `-32000` with `retryable: false` and
  `data: { kind: "boot", path, message, next }`. The shell shows `message` and
  `next` and must not silently re-send the request; restarting the core after
  the user acts is the only retry.

## Envelope

Request:

```json
{"jsonrpc":"2.0","id":7,"method":"chat.send","params":{"chatId":"...","text":"..."}}
```

Success:

```json
{"jsonrpc":"2.0","id":7,"result":{"turnId":"..."}}
```

Failure:

```json
{"jsonrpc":"2.0","id":7,"error":{"code":-32602,"message":"Invalid params","data":{"field":"text"}}}
```

Notification:

```json
{"jsonrpc":"2.0","method":"chat.delta","params":{"turnId":"...","delta":"Hello"}}
```

- Requests have `id` (number or string). Notifications have no `id`.
- A notification never gets a response.
- `params` is an object. Arrays and scalars are rejected.
- Unknown methods return `-32601`; malformed JSON returns `-32700` with
  `id: null`.

## Method surface

Implemented today (`src/server/protocol.ts`, capability names in the handshake):

| Method | Params | Result |
|---|---|---|
| `initialize` | `{protocol, client}` | `{protocol, server, capabilities}` |
| `ping` | — | `{pong: true}` |
| `workspace.info` | — | `{path, dataDir, configured, model, provider}` |
| `session.list` | `{query?}` | `{sessions: SessionRow[]}` |
| `session.open` | `{id}` | `{session: SessionDetail}` |
| `session.coverage` | `{id}` | `{coverage: CoverageReport}` |
| `session.create` | `{name, prompt?, files?, instructionsFile?, steps?, requestId?}` | `{id, name}` |
| `session.toggleStep` | `{id, index}` | `{index, checked, done, total, markdown, hash}` |
| `session.generateSteps` | `{id}` | `{markdown, kept, lost}` |
| `session.document` | `{id, kind, attempt?}` | `{text, name}` |
| `session.instructions.get` | `{id}` | `{prompt, instructionsSource?}` |
| `session.instructions.save` | `{id, text}` | `{prompt}` |
| `session.instructions.import` | `{id, file}` | `{prompt, instructions, added}` |
| `session.instructions.reextract` | `{id}` | `{prompt, instructions}` |
| `session.archive` | `{id}` | `{action: "archive", backend: "folder" \| "github"}` |
| `session.remove` | `{id}` | `{action: "delete"}` |
| `session.export` | `{id}` | `{action: "export", path}` |
| `session.output.build` | `{id, kind}` | `{kind, markdown, answers?, files}` |
| `session.output.read` | `{id, kind, part?}` | `{markdown, exists}` |
| `session.mistake.list` | `{id}` | `{entries: MistakeRow[]}` |
| `session.mistake.record` | `{id, text, step?}` | `{entries: MistakeRow[]}` |
| `session.mistake.promote` | `{id, index, correction?, title?}` | `{note, already}` |
| `session.mistake.correct` | `{id, index, correction}` | `{note}` |
| `archive.list` | — | `{rows: ArchiveListRow[]}` |
| `archive.restore` | `{id, side}` | `{action: "restore", side, id}` |
| `archive.remove` | `{id, side}` | `{action: "delete", side, id}` |
| `source.list` | `{sessionId}` | `{sources: SourceRow[]}` |
| `source.add` | `{sessionId, paths}` | `{added, skipped}` |
| `stats.summary` | `{range, scope}` | `StatsSummary` |
| `stats.export` | `{range, scope, format?}` | `{text, format}` |
| `achievements.list` | — | `{achievements, earned, total, warning}` |
| `settings.get` | — | `SettingsView` |
| `decision.get` | — | `{enabled, model, rulesOnly: true, localModel}` |
| `decision.set` | `{enabled?, model?}` | the same view after the write |
| `chat.snapshot` | — | `ChatSnapshot` |
| `chat.send` | `{text, images?}` | `{turnId}` + `chat.state` / `chat.done` / `chat.error` events |
| `chat.cancel` | — | `{ok: true}` |
| `session.chat.snapshot` | `{id}` | `ChatSnapshot` |
| `session.chat.send` | `{id, text}` | `{turnId: id}` + `session.chat.state` / `session.chat.done` / `session.chat.error` events |
| `session.chat.cancel` | `{id}` | `{ok: true}` |
| `provider.list` | — | `{providers: ProviderRow[], linked: string[]}` |
| `provider.link` | `{providerId, key, baseUrl?}` | `{providerId, models, secretRef, requests, modelSelected: null}` |
| `settings.patch` | `{patch}` | the updated `SettingsView` |
| `keybinds.get` | — | `{keybinds, fixedKeybinds}` |
| `keybinds.set` | `{action, binding, fixed?}` | `{keybinds, fixedKeybinds}` |
| `theme.custom.get` | — | `{tokens}` |
| `theme.custom.set` | `{tokens}` | `{tokens}` |
| `work.list` | — | `{projects: ProjectRow[]}` |
| `work.open` | `{id}` | `{project: WorkProjectDetail}` |
| `work.create` | `{name, folder, mode}` | `{id, name}` |
| `work.templates.list` | `{projectId?}` | `{templates: AgentTemplateRow[]}` |
| `work.agent.save` | `{projectId, agent}` | `{id}` |
| `work.agent.delete` | `{projectId, agentId}` | `{ok: true}` |
| `work.defaultAgent` | `{projectId, agentId?}` | `{defaultAgent: string \| null}` |
| `work.instructions.save` | `{projectId, instructions}` | `{instructions}` |
| `work.changes` | `{projectId}` | `{changes: ChangeSummary}` |
| `work.write.propose` | `{projectId, path, newContent}` | `{id, path, kind, diff, hunks, stats, baseHash}` |
| `work.write.decide` | `{id, decision, hunks?}` | `{decision, applied, path, hunks, bytes}` |
| `work.command.propose` | `{projectId, argv, cwd?, reason?}` | `{id, argv, cwd, reason, risk}` |
| `work.command.decide` | `{id, decision, reason?}` | `{decision, argv, cwd, exitCode, stdout, stderr, timedOut}` |
| `work.permissions.get` | — | `{allowWrite, allowCommand}` |
| `work.permissions.set` | `{allowWrite?, allowCommand?}` | the same view after the write |
| `work.approvals.list` | `{projectId?}` | `{writes: WriteProposalView[], commands: CommandProposalView[]}` |
| `work.chat.list` | `{projectId}` | `{chats: string[]}` |
| `work.chat.open` | `{projectId, chatId?}` | `{chatId, snapshot}` |
| `work.chat.send` | `{projectId, chatId, text}` | `{turnId}` + `work.chat.state` / `work.chat.done` / `work.chat.error` events |
| `work.chat.cancel` | `{projectId, chatId}` | `{ok: true}` |
| `work.swarm.run` | `{projectId, objective, plan, parallel?}` | `{runId, board}` + `work.swarm.updated` events |
| `work.swarm.board` | `{projectId, runId}` | `{board}` |
| `work.swarm.runs` | `{projectId}` | `{runs: SwarmBoard[]}` |
| `work.swarm.cancel` | `{projectId, runId}` | `{board}` |
| `work.swarm.remove` | `{projectId, runId}` | `{removed, reportPath}` |
| `work.swarm.retry` | `{projectId, runId, taskId}` | `{runId, board}` + `work.swarm.updated` events |
| `work.swarm.verify` | `{projectId, runId, taskId, verified?}` | `{task, board}` |
| `activity.list` | `{kind?, project?, limit?}` | `{records, skipped, empty}` |
| `mcp.list` | — | `{servers: PluginRow[], policy: PluginPolicy}` |
| `mcp.refresh` | — | `{servers: PluginRow[]}` |
| `mcp.policy.get` | — | `{policy: PluginPolicy}` |
| `mcp.policy.set` | `{command, server, value}` | `{policy: PluginPolicy}` |
| `mcp.confirm` | `{requestId, allow}` | `{ok: true}` |
| `skill.list` | — | `{skills: SkillRow[]}` |
| `skill.open` | `{id}` | `{skill: SkillDetail}` |
| `skill.chapter` | `{id, chapterId, practical?}` | `{text, practical, chapter: {id, title}}` |
| `skill.create` | `{goal, prior?}` | `{id, name, plan}` |
| `skill.stages.save` | `{goalId, stages, confirmed?}` | `{stages}` |
| `skill.archive` | `{goalId}` | `{action: "archive", backend: "folder" \| "github"}` |
| `skill.remove` | `{goalId}` | `{action: "delete"}` |
| `skill.export` | `{goalId}` | `{action: "export", path}` |
| `skill.lesson.build` | `{goalId, stageId, includeSolution?, confirmed?}` | `{path, markdown, status, citations}` |
| `skill.lesson.read` | `{goalId, stageId}` | `{markdown, exists}` |
| `skill.sources.list` | `{goalId}` | `{sources: SkillSourceRow[]}` |
| `skill.sources.add` | `{goalId, files}` | `{added, skipped}` |
| `skill.chat.list` | `{goalId}` | `{chats: SkillChatRow[]}` |
| `skill.chat.open` | `{goalId, chatId?}` | `{chatId, snapshot}` |
| `skill.chat.create` | `{goalId}` | `{chatId, snapshot}` |
| `skill.chat.send` | `{goalId, chatId, text}` | `{turnId: "<goalId>:<chatId>"}` + `skill.chat.state` / `skill.chat.done` / `skill.chat.error` events |
| `skill.chat.cancel` | `{goalId, chatId}` | `{ok: true}` |
| `review.queue` | `{side?}` | `{queue: ReviewQueueResult}` |
| `review.mark` | `{itemId, result}` | `{queue: ReviewQueueResult}` |
| `knowledge.search` | `{query, scope?}` | `{hits: KnowledgeHit[]}` |
| `knowledge.tree` | `{side?}` | `{groups: KnowledgeTopicGroup[]}` |
| `knowledge.read` | `{id}` | `{hit: KnowledgeHit, body, truncated}` |
| `shutdown` | — | `{ok: true}` |

- `workspace.info`: `configured` is a non-empty chat model; `provider` is the
  model's prefix before `/` (`""` when there is none, `""` when unconfigured).
- `session.list`: `query` is an optional case-insensitive substring over id and
  name. The scope filter is not implemented yet — only the school side has rows.
- `session.open`: the id is a folder name, never a path. The core reads
  `meta.json`, `prompt.md` and `assignment-steps.md` itself and returns:

  ```json
  {"session":{
    "id":"2026-11-01-0900-physics-unit-4",
    "name":"Physics — Unit 4",
    "created":"2026-11-01T09:00:00.000Z",
    "archived":false,
    "prompt":"…",
    "sources":[{"name":"lecture-4.md","originalPath":"…","storedPath":"sources/…","hash":"sha256:…","kind":"markdown"}],
    "steps":{"done":1,"total":2,"exists":true,"markdown":"…"},
    "memory":{"points":["Boundary conditions set the limits"],"folded":[],"updated":"2026-11-01T15:00:00.000Z"}
  }}
  ```

  `steps.markdown` is the whole file; `exists` is false and `markdown` empty when
  the session has no steps yet. `memory` is the session's stored memory note
  (`memory.md`) read through `readMemory`: `points` are the kept key points in
  order, `folded` their overflowing `earlier:` lines, and `updated` the ISO-8601
  instant of the last written turn. The key is **absent** when no memory has been
  written yet (a memory read failure is the same absent block, not a session
  error), and the shell reads absent and `null` alike.
  Memory is **history, labelled session memory — never a source**: it never
  appears in `sources`, never counts as a fact a chat may cite and never enters
  source coverage (`docs/product.md` §4.5). A missing or broken folder is
  `-32000` with `data: {kind: "session", id, message}` and `retryable: false`,
  never a crash.
- `session.coverage`: the session's **source coverage** report
  (`docs/product.md` §4.3). `id` is a session folder name, never a path. The
  reply is the domain's `CoverageReport` (`src/domain/coverage.ts`) unchanged —
  the core adds no rule of its own:

  ```json
  {"coverage":{
    "sources":[
      {"hash":"sha256:…","name":"lecture-4.md","originalPath":"/home/me/input/lecture-4.md","count":3,"documents":["steps","chat"],"firstLine":"Read lecture-4.md and summarise the limits","referenced":true,"fromMemoryOnly":false},
      {"hash":"sha256:…","name":"reading-notes.md","originalPath":"/home/me/input/reading-notes.md","count":0,"documents":[],"firstLine":null,"referenced":false,"fromMemoryOnly":false}
    ],
    "unreferenced":[{"hash":"sha256:…","name":"reading-notes.md","originalPath":"/home/me/input/reading-notes.md","count":0,"documents":[],"firstLine":null,"referenced":false,"fromMemoryOnly":false}],
    "total":2,
    "referencedCount":1
  }}
  ```

  - `sources` holds one entry per copied source, deduped by `hash`, sorted by
    `count` descending then by name. `count` is the number of case-insensitive
    mentions of the source's `name` or its origin file name across the
    documents; `documents` lists the document kinds that mention it, in the
    order `steps`, `chat`, `outputs`, `memory`; `firstLine` is the first
    matching line, trimmed and capped at 160 characters (`null` when there is
    none).
  - `referenced` is `count > 0`. This is a **lexical** fact, not proof that a
    claim came from that source: a mention is all the report claims.
  - `unreferenced` is the gap list — the same entries with `referenced: false`,
    sorted by name. `total` is the number of deduped sources and
    `referencedCount` the number that are referenced. There is **no separate
    fully-covered field**: fully covered means `total > 0 && referencedCount ===
    total` (the domain's `isFullyCovered`), and a session with no sources is
    never covered.
  - The sources and the documents are exactly what `loadSessionHome` reads for
    the session home: the copied `sources/` and the non-empty
    `assignment-steps.md` (`steps`), `chat.jsonl` (`chat`), study
    guide/flashcards under `school/outputs/<id>/` (`outputs`) and `memory.md`
    (`memory`). The panel and the home therefore cannot disagree.
  - **Memory is a document, never a source.** `memory.md` is labelled session
    memory and contributes mentions like any other document; a source mentioned
    only there keeps `referenced: true` with `fromMemoryOnly: true` so the shell
    can show it as history rather than a fact the session cites from its
    sources. `memory` never appears in `sources` as an entry.
  - A session with no sources is a **valid empty report**:
    `{"sources":[],"unreferenced":[],"total":0,"referencedCount":0}` — an empty
    coverage state with a next action (add sources), not an error.
  - **Read-only.** The call opens files for reading only: it writes nothing (no
    note, no steps toggle, no output, no chat record), makes no model call and
    contacts no network. The session folder is byte-identical afterwards.
  - A blank, missing or non-string `id` is `-32602` (`a session id is required`).
    An unknown, missing or unreadable session is the shared session error shape
    `-32000`, `retryable: false`, `data: {kind: "session", id, message}`. One
    message, no retry.
- `session.create`: the wizard's Review step. `name` is required, trimmed and
  capped at 120 characters; `prompt` is optional text; `files` is an optional
  array of absolute paths the **user picked**; `instructionsFile` is an optional
  single path whose extracted text becomes `prompt.md` (its original is copied
  into `sources/`). At least one of `files`, `prompt` or `instructionsFile` is
  required; the blocked message names that rule. `steps: false` records the
  session without a steps file. The core copies the sources and writes
  `meta.json` and `prompt.md` in one transaction, so a failure leaves no folder
  and no half-written file. Success is `{id, name}` only — the shell calls
  `session.open` for the detail rather than receiving it twice. A bad shape is
  `-32602` naming the field; a refusal is `-32000`, `retryable: false`, with
  `data: {kind: "session-create", message, field?}`, where `field` appears for
  an invalid-session/field error and is absent for a blocked or storage failure.

  `requestId` is an optional idempotency key for **one** wizard attempt: a
  non-empty string of at most 128 characters. The core keeps the result by key,
  so a repeat of a successful key returns the same `{id, name}` and writes
  nothing, and a repeat while the first create is still running is `-32000`,
  `retryable: false`, with
  `data: {kind: "session-create", requestId, status: "creating", message}` and
  the message `still creating — check Sessions`. A **failed** create is not
  cached: a corrected retry with the same key runs. The map is process state,
  holds the last 32 successes, and is empty after a restart.

  The shell gives this one method a **60 s deadline** instead of the
  no-deadline rule for model runs (`desktop/lib/bridge/core_client.dart`), which
  is what gives the wizard a way out; a create that finishes after the deadline
  appears in `session.list` on the next read. The wizard generates one key per
  attempt, keeps it across a Retry, and drops it when the user goes back to edit
  the input.
- `session.toggleStep`: the steps reader's only write. `id` is a session folder
  name (never a path) and `index` is the 0-based ordinal of a task-list item in
  `assignment-steps.md`. The core rewrites **exactly two things** — that item's
  bracket character and the single progress line — and leaves every other byte
  alone, so toggling the same index twice restores the original file byte for
  byte. The response is the whole new document:

  ```json
  {"index":1,"checked":true,"done":2,"total":2,"markdown":"# Assignment steps\n…","hash":"sha256:…"}
  ```

  `markdown` is the file after the write; the shell replaces its rendered copy
  and never re-reads or re-parses it. `checked` is the new state of that step,
  `done`/`total` are the counts in the new document, and `hash` is
  `sha256:<hex>` of the same bytes (the form source hashes already use). A blank
  or non-string `id`, or an `index` that is not a non-negative integer, is
  `-32602`. An unknown session is the session error shape (`-32000`,
  `data: {kind: "session", id, message}`, `retryable: false`); a session with no
  steps file or an out-of-range `index` is `-32000`, `retryable: false`,
  `data: {kind: "steps", id, message}`, and the file is untouched.
- `session.generateSteps`: build or rebuild `assignment-steps.md` from the
  session's own sources. `id` is a session folder name (never a path). The core
  supplies its one-shot completion (`booted.generate`), so this is a provider run:
  the shell shows a pending state and must not send it twice. The context is the
  session's `prompt.md` plus its copied sources; the previous steps and the
  generated outputs are deliberately excluded, so a regeneration derives a fresh
  plan instead of copying the old one. The response is the whole new document
  plus what the merge did with checked work:

  ```json
  {"markdown":"# Assignment steps\n…","kept":2,"lost":1}
  ```

  Checked work is merged **by exact step text** (`src/domain/progress.ts`):
  a checked step whose text appears in the new plan stays checked, an unchecked
  step stays unchecked, a checked step whose text the new plan does not contain
  is gone. `kept` counts the checked steps that survived and `lost` counts the
  checked steps that did not, so the shell can say "kept 2, dropped 1" without
  reading the old file. The `markdown` bytes are the file after the write; the
  shell replaces its rendered copy from this reply. Any failure — a workspace
  with no model, an unreadable source, a provider error, a rejected plan — is
  **one** message with `retryable: false` and
  `data: {kind: "generation", id, message}`, and the previous steps are left
  untouched (nothing partial is written). With no model configured the message
  is `link a model in Settings → Providers`. A blank or non-string `id` is
  `-32602`; an unknown session is the session error shape. The shell may offer a
  retry (`session.generateSteps` again after the user acts), which is a new
  request, never an automatic one.
- `session.document`: generate one **session study document** from the
  session's own sources — the assignment's done-when `contract`, the source
  `contradictions` report, or the `check` of one learner attempt
  (`docs/product.md` §4.3, `docs/data-model.md` §4). `id` is a session folder
  name (never a path) and `kind` is exactly one of `contract`,
  `contradictions`, `check`. The core supplies its one-shot completion
  (`booted.generate`), so this is a provider run: the shell shows a pending
  state and must not send it twice.

  ```json
  {"text":"# Done when\n\n- [ ] …\n","name":"contract.md"}
  ```

  `text` is the document's own Markdown (the generated text, trimmed) and
  `name` is the session-relative file it was written to: `contract.md`,
  `contradictions.md` or `check.md`. The service writes that file atomically
  inside the session folder, so `text` and the bytes on disk always agree and
  no partial document survives a failure. These are **generated session
  documents, not sources**: they never become a source row, never enter source
  coverage, and no chat turn is created or appended — `chat.jsonl` is identical
  before and after.

  `attempt` is an optional string with the learner's answer. It is **only
  meaningful for `check`**, where it is folded into the review prompt; a
  non-blank `attempt` supplied with `contract` or `contradictions` is a
  `-32602` refusal rather than a silent drop. A blank or whitespace-only
  attempt is treated as absent. A wrong type for `id`, `kind` or `attempt`, an
  unknown `kind` (the message names the accepted set), or a non-string `id` is
  `-32602` and never boots the app.

  Any failure — an unknown session, a workspace with no model, a provider
  error, an unreadable source, a refused generation — is **one** message with
  `retryable: false`, and the previous document, if any, is left
  byte-identical (nothing partial is written):

  - an unknown, missing or unreadable session is the shared session shape
    `data: {kind: "session", id, message}`;
  - every later failure is `data: {kind: "generation", id, message}`. With no
    model configured the message is `link a model in Settings → Providers`.

  The shell may offer a retry (`session.document` again after the user acts),
  which is a new request, never an automatic one.
- `session.instructions.*`: the session settings pane (`docs/product.md` §4.3).
  These methods edit **`prompt.md`** — the text the model reads — and the
  matching `prompt` value in `meta.json`. They never accept a write destination
  from the shell: `id` is a session folder name, and the only other input is
  instruction text or a user-picked file the core copies into that session.

  `instructionsSource`/`instructions` is the provenance of the copied original,
  not a second prompt:

  ```json
  {"name":"assignment.md","storedPath":"sources/<hash>-assignment.md","hash":"sha256:…","kind":"markdown","extractedAt":"2026-11-16T10:00:00.000Z","characters":248,"pages":2}
  ```

  `pages` is present for a PDF and absent otherwise; `characters` is the
  extracted text length when the record carries it. `originalPath` is
  deliberately omitted: the shell only needs the copy the session owns.

  - `session.instructions.get` `{id}` → `{prompt, instructionsSource?}`. Reads
    `prompt.md` (an empty string when the file is empty) and returns
    `instructionsSource` only when `meta.json` records an original file. A
    text-only session is exactly `{prompt}`. This is a read: it writes nothing.
  - `session.instructions.save` `{id, text}` → `{prompt}`. `text` must be a
    string; an empty string is the service's own rule and clears the prompt.
    The service writes `prompt.md` and `meta.json` atomically, so a failure
    leaves the previous bytes in place. The original instruction file, when
    there is one, stays as provenance; this method does not copy or delete it.
  - `session.instructions.import` `{id, file}` → `{prompt, instructions, added}`.
    `file` is an absolute path the **user picked**, never a destination. The
    core checks the wall (a file on the skills side is refused), extracts its
    text (UTF-8 text, Markdown, code, DOCX or a PDF with a text layer), copies
    the original into that session's `sources/`, writes the extracted text to
    `prompt.md`, and records the provenance in `meta.json` — one transaction.
    `added` is `false` when identical bytes were already a source, so the copy
    was reused rather than written twice. A scanned PDF with no text layer is
    the service's typed refusal (`OCR is not supported`); nothing is written.
  - `session.instructions.reextract` `{id}` → `{prompt, instructions}`. Re-reads
    the **copied original** and replaces `prompt.md`, discarding manual edits.
    A session with no instruction file is the service's blocked message.

  A blank or non-string `id` (or a missing/blank `file`, or a non-string
  `text`) is `-32602`. Every later failure — an unreadable file, an extraction
  failure, an archived session, an unwritable prompt or metadata, a text-only
  session asked to re-extract — is **one** message with `retryable: false` and
  `data: {kind: "instructions", id, message}`, and the previous prompt and
  metadata are byte-identical. An unknown or unreadable session is the shared
  session shape `data: {kind: "session", id, message}`, like every other
  `session.*` method. Nothing here retries, generates a chat turn, or writes a
  note or output.
- `session.archive`, `session.remove` and `session.export`: the three session
  manager verbs (`docs/product.md` §4.4). **`archive` and `delete` are the only
  destructive methods in this protocol**, and the shell must ask before calling
  either: a named confirmation that says what happens (an archive moves the live
  folder into the archive; a delete removes it). The core executes the confirmed
  action; there is no "cancel" parameter and no undo. `export` is additive and
  never asks.

  `id` is a session folder name for all three, never a path; a blank or
  non-string value is `-32602`.

  - `session.archive` → `{action: "archive", backend: "folder" | "github"}`.
    The backend is **configuration**, not a parameter: `settings.get` reports
    `archiveBackend` and `archiveFolder`, and those decide the destination.
    A folder archive moves the session to
    `<archive.folder>/school/session/<id>/` (chat history excluded, `archived:
    true`; the move is staged in a temp folder and renamed, so no partial copy
    survives); a GitHub archive uploads it and only then removes the live folder.
    When no backend is usable — `archiveBackend` is `folder` with an empty
    `archiveFolder`, or `github` with no backend in this build, an unconfigured
    repo or a missing keychain token — the reply is one actionable `-32000` with
    `data: {kind: "archive", id, message}` and **nothing is moved or deleted**.
    That refusal happens before the session is read, so the fix is always
    Settings, not the session row.
  - `session.remove` → `{action: "delete"}`. Deletes the live session folder
    (its `meta.json`, sources, steps, chat and outputs). Nothing else is touched:
    no note, no Work project and no archived copy, so an archive of the same id
    still restores later. The shell confirms first; the core passes
    `confirmed: true` to the service.
  - `session.export` → `{action: "export", path}`. Writes one deterministic zip
    to **this workspace's** `exports/session-<id>.zip` (entries sorted, timestamps
    pinned, chat history excluded) and returns that path. There is no destination
    parameter: the shell cannot point an export at a path the core does not own,
    and a path outside `exports/` is refused rather than returned. The live
    session is untouched, so export is safe to repeat.

  Failure shapes, both `-32000`, `retryable: false`, and never retried:

  - an unknown, missing or unreadable session is the session shape every
    `session.*` method uses: `data: {kind: "session", id, message}`;
  - an action that was attempted and did not happen is
    `data: {kind: "session-action", id, action, message}` with `action` set to
    `archive`, `delete` or `export`. The message is the service's own one-line
    reason (for example an occupied archive destination), and the live folder is
    left exactly as it was.
- `session.output.build` and `session.output.read`: the first Outputs packet
  (`docs/product.md` §5.1–§5.3) — a lock-in session's study guide and flashcard
  deck. These are **generated outputs, not sources**: they never become a
  source row, never enter source coverage and never count as a fact a chat may
  cite. Building an output does not mark a section reviewed, flip a card, answer
  a question or record a miss: `session.output.mark` and `review.mark` own
  those writes.

  Both methods name the session by folder id, never a path, and write only
  inside `<workspace>/school/outputs/<id>/`.

  - `session.output.build` `{id, kind}` → `{kind, markdown, answers?, files}`.
    `kind` is exactly `study-guide` or `flashcards`; anything else is `-32602`
    naming the accepted set. A build is **one model call and is never retried**:

    - `study-guide` asks for
      `{"sections":[{"heading":"...","question":"...","answer":"..."}]}` and
      writes two files: `study-guide.md` (`# Study guide — <session name>`,
      `> 0 of N sections reviewed`, then one `## <heading>` block with the
      question and `- [ ] Reviewed`) and `study-guide-answers.md` (the same
      headings with each answer). `answers` carries the answers document.
    - `flashcards` asks for
      `{"cards":[{"question":"...","answer":"...","choices":["...","...","...","..."],"correct":0}]}`
      with **exactly four choices and one 0-based `correct` index**, and writes
      `flashcards.md` (`# Flashcards — <name>`, then one `## Card n` block with
      `Q:`, `A:`, `M: no`, `K: no`, `### Choices` and one `- [x]`/`- [ ]` row
      per choice).

    ```json
    {"kind":"study-guide","markdown":"# Study guide — Physics — Unit 4\n…","answers":"# Study guide answers — …","files":{"guide":"study-guide.md","answers":"study-guide-answers.md"}}
    ```

    `markdown` is the guide/card document the shell renders and `files` names
    the files inside the session's outputs folder (never an absolute path). The
    shell replaces its rendered copy from `markdown`; it does not re-read or
    re-parse the files. The context is the session's own sources plus
    `prompt.md` and, when it exists, `assignment-steps.md`; the previous outputs
    are deliberately excluded, so a rebuild derives a fresh document instead of
    paraphrasing the old one.

    The write is an atomic replace per file, staged in the outputs folder. A
    malformed reply — no JSON, no sections/cards, a section missing a heading,
    question or answer, a card without exactly four choices or a `correct` that
    is not 0–3 — is **one** `-32000`, `retryable: false`,
    `data: {kind: "generation", id, message}`, and **writes nothing**: no file
    and no temp file is left behind, and an existing output keeps its previous
    bytes. A workspace with no model is the same shape with the message
    `link a model in Settings → Providers`; a session with no readable sources
    says `this session has no readable sources`. Those two refusals happen
    before the model is called. The shell may offer a retry (a new
    `session.output.build` request after the user acts), never an automatic one.

  - `session.output.read` `{id, kind, part?}` → `{markdown, exists}`. This is
    the reader's read half and never generates. `kind` is `study-guide` or
    `flashcards`; `part` is optional and one of `guide`, `answers`, `cards`,
    defaulting to the kind's primary document (`guide` for a study guide,
    `cards` for a deck). A part that belongs to another kind — `answers` on a
    deck, `cards` on a guide — is `-32602` rather than a silent substitution, as
    is an unknown `part`.

    ```json
    {"markdown":"# Study guide — Physics — Unit 4\n…","exists":true}
    ```

    A missing file is a **success**: `{"markdown":"","exists":false}` — the
    reader's empty state with a next action (`session.output.build`), not an
    error. An unknown or unreadable session is the shared session shape
    `data: {kind: "session", id, message}`; a blank/non-string `id` is `-32602`.
    Nothing on this path writes, generates, marks or archives.
- `session.output.mark`: mark one **study-guide** section reviewed, or clear it.
  This is the guide's only write (`docs/product.md` §5.2). `id` names the
  session folder and `index` is the 0-based section ordinal in file order; a
  blank id or an index that is not a non-negative whole number is `-32602`.

  The core reads `study-guide.md`, flips **one bracket character** and the
  `> N of M sections reviewed` line, and replaces the file atomically
  (`src/domain/guide.ts`). Every other byte — including the learner's own prose —
  survives, so toggling the same section twice restores the document byte for
  byte.

  ```json
  {"index":1,"checked":true,"done":1,"total":3,"markdown":"# Study guide — …","hash":"sha256:…"}
  ```

  `markdown` is the file after the write, `checked` the new state, `done`/`total`
  the recomputed counts and `hash` `sha256:<hex>` of the same bytes. A session
  with no guide is `-32000`, `retryable: false`,
  `data: {kind: "output", id, message}` with `build the study guide first`;
  an out-of-range section is the same shape and the file is untouched. The
  shell replaces what it renders from `markdown` and never re-reads the file.

- `session.mistake.*`: a lock-in session's misconception ledger and its
  graduation into a knowledge note (`docs/product.md` §4.3 `:mistake`). The
  ledger is **process history, never a source**: it never becomes a source row
  and never enters source coverage. All three methods name the session by folder
  id, never a path.

  ```json
  {"entries":[
    {"index":0,"text":"Energy is conserved per object.","step":"Derive the energy balance","note":null},
    {"index":1,"text":"A derivative is a fraction.","step":null,"note":{"path":"school/vault/knowledge/a-derivative-is-a-fraction.md","title":"A derivative is a fraction.","created":"2026-11-01T10:00:00.000Z","status":"open"}}
  ]}
  ```

  - `session.mistake.list` `{id}` → `{entries}`. One row per `- text` bullet in
    the session's `misconceptions.md`, in file order; `index` is the bullet's
    0-based ordinal and is the key `promote` takes. `step` is the two-space
    `step:` line under the bullet, or absent. `note` is the knowledge note the
    entry graduated into, or `null` while it is still only a ledger entry. A
    session with no ledger is `{entries: []}` — the card's empty state with a
    next action, not an error.
  - `session.mistake.record` `{id, text, step?}` → `{entries}`. Normalises the
    text to one line, refuses a blank entry (`a mistake needs some text`) and a
    text over **500 characters** (the message names the length), appends the
    bullet to `misconceptions.md`, and returns the whole ledger. `step` is
    optional and is stored under the bullet.
  - `session.mistake.promote` `{id, index, correction?, title?}` → `{note,
    already}`. Writes a **school knowledge note** at
    `school/vault/knowledge/<slug>.md` through the note store (atomic replace,
    index refreshed) and returns its workspace-relative `path`, `title` and
    `created`. The frontmatter records the provenance — `origin:
    "session-mistake"`, `session`, `premise_index`, `status: "open" |
    "corrected"`, `topics: ["Session mistakes"]`, `promoted_from`, and `step`
    when the entry named one — and the body says in words that the note is the
    learner's own record, **not one of the session's sources**. `correction` is
    the learner's right answer: with it the note is `corrected`; without it the
    note says the correction is not written yet and stays `open`. `title`
    defaults to the mistake text cut on a word boundary at 80 characters.
    Promoting the same entry twice returns the existing note with `already:
    true` and writes nothing, so a double click cannot duplicate it. Because the
    note is an ordinary vault note, `knowledge.search`, `knowledge.tree` and
    `knowledge.read` find and open it immediately, with `side: "school"`.
  - `session.mistake.correct` `{id, index, correction}` → `{note}`. Promotion is
    not one-way: a note promoted before the learner knew the answer can be
    completed later. This replaces **only** the `## Corrected understanding`
    section of the note (the mistake, the session label and the provenance line
    stay), sets `status: corrected` and `corrected_at`, and returns the updated
    note. A second correction replaces the first. A blank correction
    (`a correction needs some text`) and an entry that was never promoted are
    one `-32000`, `retryable: false`, `data: {kind: "mistake", id, message}`, and
    the note is left byte-identical. `status` is part of every `note` projection:
    `open` until a correction is written, then `corrected`, or `reviewed` when
    Review's `known` filed it without a correction. A `corrected` note is
    settled and never enters the Review queue.

  A blank or non-string `id` (or a missing/non-string `text`, a non-string
  `step`, an `index` that is not a non-negative whole number, or a non-string
  `correction`/`title`) is `-32602`. An unknown session is the shared session
  shape `data: {kind: "session", id, message}`. Every later failure — a ledger
  or note write that fails, an index beyond the ledger, a blank or over-long
  text, a blank or over-long correction — is one `-32000`, `retryable: false`,
  with `data: {kind: "mistake", id, message}`, and nothing is written. No model is
  called and no network is contacted.

- `archive.list`: the **read-only** archive picker (`docs/product.md` §9). It
  lists what is already archived on both sides of the wall and takes no
  parameters; it never restores, deletes, exports, moves or writes anything. The
  backend is **configuration**, exactly as for `session.archive`:
  `settings.get` reports `archiveBackend` and `archiveFolder`, and those decide
  where the listing is read from.

  ```json
  {"rows":[{"id":"2026-11-01-0900-physics-unit-4","side":"school","name":"Physics — Unit 4","date":"2026-11-01T10:00:00.000Z","sizeBytes":18422,"backend":"folder","kind":"session"}]}
  ```

  Each row is `{id, side, name, date, sizeBytes, backend, kind}`: `side` is
  `school` or `skills`, `name` is the archive's title, `date` is the archive
  timestamp (ISO-8601), `backend` is the adapter that produced the row and
  `kind` is `session`, `goal` or `project`. Rows from both sides are combined in
  one reply; the shell groups them by `side` (`docs/product.md` §9 requires the
  wall to hold in the archive too). Rows come from the backends themselves, so
  the local `archive-index/*.json` files are a **cache**: a missing or corrupt
  index still lists the archived folders, and deleting the index is safe.

  - A folder backend with an empty `archiveFolder` (first run) has nowhere to
    look: the reply is `{rows: []}` — an empty picker, **not** an error. A
    configured folder that exists but holds nothing is the same empty success.
  - A GitHub backend this build cannot build — no backend, an unconfigured
    `archive.github.repo`, consent not granted or a missing keychain token — is
    **one** `-32000`, `retryable: false`, with
    `data: {kind: "archive", message}` and the backend's own one-line reason.
    That refusal happens before any row is read; the fix is Settings, not a
    retry.

  `archive.list` is the only read of the picker. Restore and delete are the two
  write verbs below (`archive.restore`, `archive.remove`); the shell makes a new
  `archive.list` request after either, because no change event is emitted. A
  genuine listing failure is the same `-32000` archive shape, reported once and
  never retried.
- `archive.restore`: bring one archived item back into the live workspace.
  **Both backends support both sides** — a school row is a session restore, a
  skills row is a goal restore. The method has exactly two parameters:

  ```json
  → {"jsonrpc":"2.0","id":9,"method":"archive.restore","params":{"id":"2026-11-01-0900-physics-unit-4","side":"school"}}
  ← {"jsonrpc":"2.0","id":9,"result":{"action":"restore","side":"school","id":"2026-11-01-0900-physics-unit-4"}}
  ```

  `id` is a folder name (never a path) and `side` is `school` or `skills`. The
  backend is **configuration**, exactly as for `session.archive` and
  `archive.list`: `settings.get` reports `archiveBackend` and `archiveFolder`.
  There is no destination parameter, no "confirm" parameter and no undo — the
  shell asks the user before calling and the core executes the confirmed move.

  A GitHub backend must be **built** before anything is read: an unconfigured
  `archive.github.repo`, a missing keychain token, or a build with no GitHub
  adapter at all is one refusal naming Settings (below). The one-time archive
  consent is the prerequisite for **pushing** to GitHub, not for restoring; the
  adapter re-verifies the repository is private before it downloads, and a
  public, missing or unverifiable repository is refused by the adapter with its
  own one-line reason. A restore never uploads and never stores a credential in
  config.

  **School side.** With the folder backend, `restoreSession` moves the archived
  folder back through the same service the TUI uses. With the GitHub backend,
  the adapter copies the item's files into `school/sessions/<id>`, the core
  normalises the metadata, then removes the remote copy. Either way what comes
  back is the **session's own folder**: `meta.json` (with `archived: false` and
  no `chat_archived` claim), `prompt.md`, `sources/`, `assignment-steps.md` and
  `progress.jsonl`. Chat history is **not** restored: the archive never carried
  it, and `chat.jsonl` is removed so a restore cannot imply a conversation that
  was never stored. Outputs already in `<workspace>/school/outputs/<id>/` are
  neither moved nor deleted by either direction. The row then disappears from
  `archive.list` and appears again in `session.list`.

  **Skills side.** The core copies the archived goal into
  `<workspace>/skills/goals/<id>` through the backend's `restore` (the folder
  adapter stages a temp folder and renames it; the GitHub adapter downloads the
  item's files), clears `archived` in that goal's `meta.json` when the archived
  copy carried it, then removes the archived copy so the restore is a **move**.
  The goal keeps its curriculum `stages`, chapters, gathered sources and
  progress; its chats are not carried, because `chats/` is excluded from every
  archive. The id is confined to the goals root: a goal that is already open is
  refused rather than overwritten, and any failure after the copy removes that
  fresh folder, leaving the archive and the live goals folder exactly as they
  were. The row then disappears from `archive.list` and appears again in
  `skill.list`.

  Refusals happen in this order, all `-32000`, `retryable: false`, and none of
  them reads, moves or deletes a byte:

  - A GitHub backend that cannot be built — no adapter in this build, an
    unconfigured repo, or a missing keychain token — is one
    `data: {kind: "archive", id, side, message}` naming Settings. The fix is
    Settings, not a retry.
  - A folder backend with an empty `archiveFolder` — the same
    `data: {kind: "archive", id, side, message}` shape, with
    `set an archive folder in Settings → Storage and archive first`.
  - A malformed request is `-32602` and never boots: a blank/non-string `id`
    says `archive.restore requires a session id`, and a `side` outside
    `school`/`skills` names the accepted set.

  Once a move is attempted, a school failure is the shared session-action shape:
  `-32000`, `retryable: false`,
  `data: {kind: "session-action", id, action: "restore", message}`. An id that
  is not in the archive gives `there is no archived session "<id>"`; an already
  open session with that id is refused rather than overwritten. The folder
  service stages the restore in a temp folder and renames it; the GitHub path
  removes the fresh folder if the metadata cannot be normalised or the remote
  delete fails, so a failure leaves both the archive and the live folder exactly
  as they were.

  A skills failure is one `-32000`, `retryable: false`, with
  `data: {kind: "archive", id, side: "skills", message}`: an id that is not in
  the archive, an id that is not a goal id, an already-open goal, a malformed
  `meta.json`, or a storage failure. The message is one line the shell can show.

  There is no automatic retry on either side; the shell sends a new request
  after the user acts.
- `archive.remove`: delete one **archived** item. This is the picker's delete
  verb (`docs/product.md` §9) and it is **destructive**: the shell confirms
  first, naming the item and saying that the archive copy goes, and this method
  is the execution half of that confirmation. It never deletes the live session
  or goal — `session.remove` owns that with its own confirmation.

  ```json
  → {"jsonrpc":"2.0","id":10,"method":"archive.remove","params":{"id":"2026-11-01-0900-physics-unit-4","side":"school"}}
  ← {"jsonrpc":"2.0","id":10,"result":{"action":"delete","side":"school","id":"2026-11-01-0900-physics-unit-4"}}
  ```

  `id` is an archived folder name (never a path) and `side` is `school` or
  `skills`; the side decides the kind — a school row is a session, a skills row
  is a goal. The backend is **configuration**, resolved exactly as
  `archive.list` does: a folder backend needs an absolute `archiveFolder`, and a
  GitHub backend is built on demand. The adapter's `remove` only ever deletes
  inside the archive root (a symlinked or escaping location is refused by the
  backend), so the live workspace is untouched by this path. The GitHub adapter
  additionally requires `confirm: true` — the core always sends it after the
  shell's named confirmation — and deletes only the `side/kind/id` prefix inside
  the repository, never another item. The archive index entry is dropped with
  the folder; the index is a cache, so a stale index cannot resurrect the row.

  Refusals, all `-32000`, `retryable: false`:

  - the backend cannot be resolved — GitHub not available in this build, an
    unconfigured repo/token, or a folder backend with no `archiveFolder` — is
    one `data: {kind: "archive", id, side, message}` naming Settings, before
    anything is read or deleted;
  - an item that is not in the archive is the same shape, with a message naming
    the id and the side (`there is no archived session "<id>" on the school
    side`). The picker was showing a row that is no longer there;
  - a backend error while deleting is the same shape with the adapter's one-line
    reason, and the archived folder is left as it was.

  A malformed request is `-32602` and never boots: a blank/non-string `id` says
  `archive.remove requires an archived item id`, and a `side` outside
  `school`/`skills` names the accepted set. A successful delete returns
  `{action: "delete", side, id}`; the shell makes a new `archive.list` request,
  because no change event is emitted. Nothing here restores, exports or touches
  the live item, and there is no undo.
- `source.list`: `sessionId` is a session folder name, never a path. Returns the
  same rows `session.open` carries, so a picker can refresh without re-opening
  the session:

  ```json
  {"sources":[{"name":"lecture-4.md","originalPath":"…","storedPath":"sources/…","hash":"sha256:…","kind":"markdown"}]}
  ```

  An unknown or broken session is `-32000` with
  `data: {kind: "session", sessionId, message}` and `retryable: false`. A blank
  or non-string `sessionId` is `-32602`.
- `source.add`: `paths` is a non-empty array of absolute paths to files the
  **user picked**. They are sources, never destinations: the core copies each
  file into that session's `sources/`, hashes it and records it in `meta.json`,
  so the shell cannot name a write target. A path that belongs to the skills
  side is refused. Identical bytes are stored once; the duplicate is counted in
  `skipped` and no second row appears. The originals are never moved or deleted.
  A blank entry, an empty array or a non-array is `-32602`. An unknown session is
  `-32000` `data: {kind: "session", sessionId, message}`; a file that cannot be
  copied is `-32000` `data: {kind: "source", sessionId, message}`. Both are
  `retryable: false` and leave the session without a half-written source.
- `stats.summary`: `range` is one of `7d · 30d · 90d · all` and `scope` one of
  `all · school · skills · work`; anything else is `-32602`.
- `stats.export`: the Stats **export** action. `range` and `scope` are validated
  exactly as `stats.summary`, so any view that can be shown can be exported.
  `format` is optional and one of `md` or `csv`; **an omitted format is `md`**
  (the shell may always send it explicitly). The reply is the document text, not
  a path:

  ```json
  {"text":"# Stats — all · all\n\n> Estimates, not a bill.\n…","format":"md"}
  ```

  The core **writes no file**: saving or copying the text is the shell's job, and
  the shell picks the destination. This method never touches the workspace, a
  note, a chat or the network; it reads the same `usage.json` / `stats.json`
  counters as `stats.summary` and leaves them byte-identical. An empty data
  directory is a valid document of zeros, never an error. The Markdown carries
  the `Estimates, not a bill.` line and the CSV carries the same numbers, because
  usage and cost are estimates rather than a bill. `format` in the reply echoes
  what was produced so the shell can choose an extension.

  A missing `range` or `scope`, an unknown value for either, or an unknown
  `format` is `-32602` naming the accepted set, and the app is never booted for
  it. A genuine service failure is `-32000`, `retryable: false`, with
  `data: {kind: "stats", message}`; one message, no retry.
- `achievements.list`: the **Achievements** surface (`docs/product.md` §2.2,
  Explorer → Achievements). It takes no parameters and returns the achievement
  inventory for the current workspace:

  ```json
  {"achievements":[{"id":"first-light","name":"First Light","task":"Send your first message.","category":"starter","metric":"messages","target":1,"value":1,"progress":1,"unlocked":true,"difficulty":"easiest","awardedAt":"2026-11-01"}],"earned":1,"total":35,"warning":null}
  ```

  Each row is exactly
  `{id, name, task, category, metric, target, value, progress, unlocked, difficulty, awardedAt?}`:

  - `id`, `name`, `task`, `category` (`starter`, `learning`, `work`,
    `collection`), `metric` and `target` come from the domain catalogue
    (`src/domain/achievements.ts`) and are sent unchanged, one row per entry **in
    catalogue order**, so the shell never keeps a second copy of the list.
  - `value` is the bar value: `achievementValue(metrics)` **clamped to
    `target`**. `progress` is the same counter **unclamped**, so the page can say
    `142 / 100` for an over-achieved row while the bar stays full. Both are
    non-negative integers.
  - `unlocked` is `achievementUnlocked(metrics)` and `awardedAt` is the stored
    `YYYY-MM-DD` day the achievement was first seen unlocked, **omitted** (not
    `null`) when there is none. `difficulty` is `difficultyLabel(target)`
    (`easiest … legendary`) and is presentational only.
  - `earned` is the number of `unlocked` rows and `total` is the catalogue size,
    so `earned of total` is the header count. Both are computed from the rows in
    the same reply and can never disagree with them.

  Dev and test builds unlock the whole catalogue on purpose
  (`UNLOCK_ALL_ACHIEVEMENTS = !RELEASE_BUILD`), so a source run reports every row
  unlocked; a release build lets the counters decide. That rule is the domain's,
  not this transport's, and the shell must not re-derive it.

  **This is the one read that can write.** `loadAchievementSnapshot` records the
  UTC day of each newly unlocked achievement in
  `<dataDir>/achievements.json` (`AWARDS_FILE`). The file lives in the platform
  data directory, **never inside the workspace**: the workspace is
  byte-identical before and after the call, and nothing else — no note, chat,
  output, session or config value — is touched. The write is best-effort and
  atomic (temp + rename); a failure only costs award dates, never the reply.

  `warning` passes the snapshot's own sentence through: an unreadable or corrupt
  awards file is a **note beside the rows** (`award dates could not be read` /
  `award dates are not valid JSON`), not an error, and the rows still render.
  Because the read also awards what is unlocked, a corrupt file is rewritten with
  valid dates in the same call whenever at least one achievement is unlocked, so
  the next read is clean; a workspace with nothing earned keeps reporting it until
  something is earned, which is honest rather than a retry.

  A read failure — anything the snapshot could not tolerate — is one `-32000`,
  `retryable: false`, with `data: {kind: "achievements", message}`; the shell
  shows the message once and offers an explicit re-read. There is no `-32602`
  because the method has no parameters, and no automatic retry. A boot refusal is
  the shared boot shape.
- `session.chat.*`: one controller per session, built on first use. History is
  the session's own `chat.jsonl`, scoped by `ui.chill_history_limit`; tools and
  context are the session's read-only `sources/` toolbox. `send` requires a
  non-empty `text` (`-32602`) and a known session (`-32000`). `turnId` is the
  session id because a session has at most one active turn; `cancel` takes the
  session id and is a no-op when nothing is streaming. `session.chat.state`
  carries `sessionId` plus the same fields as `ChatSnapshot`; `session.chat.done`
  is `{sessionId, ...SendOutcome}`; `session.chat.error` is
  `{sessionId, message}`.

  A **completed** turn (`session.chat.done` with `outcome: "done"`) also records
  that answer's key points to the session's `memory.md`, after the terminal event
  so the shell never waits for the write. See *Session memory* below.

Planned (target surface; still packets in `desktop/tasks/`): none. Every
method in the table above is implemented, and `mcp.confirm` moved out of this
list with the permission gate.

Events (notifications): `chat.state`, `chat.done`, `chat.error`,
`session.chat.state`, `session.chat.done`, `session.chat.error`,
`work.chat.state`, `work.chat.done`, `work.chat.error`,
`work.write.proposal`, `work.command.proposal`, `work.approval.resolved`,
`work.swarm.updated`, `skill.chat.state`, `skill.chat.done`, `skill.chat.error`,
`mcp.permission`; planned: `chat.delta`, `chat.tool`, `settings.changed`,
`session.changed`, `core.exit` (synthetic shell event when the process ends).

`provider.link` runs one authenticated validation. A rejection is `-32000` with
`data: { kind, provider, hint? }`, `retryable: false`, and nothing is saved; the
key is written to the OS keychain only after success and is never echoed back.
`modelSelected` is always `null`: linking must not pick a model. `settings.patch`
persists through `config.toml`, applies the new config to the live service, and
returns the new view; setting `models.chat` also rebuilds the chat controller so
the next turn uses the new model without a restart.

`chat.state` carries the full transcript projection: `status`, `model`,
`streamed`, `messages`, `blocked`, `error`, and `usage` (`tokens`,
`costMicroUsd`, `durationMs`). The core coalesces updates at ~33 ms; the shell
does not append a local message. `chat.send` returns immediately and the state
events are authoritative.

`chat.send` carries an optional `images` array so Chill can ask about a
picture (`docs/product.md` §3.1). `text` is the document, so an empty `text` is
accepted **only** when at least one image is attached; a text-only request keeps
the non-empty rule.

- `images` is an array of at most **four** non-empty strings, each an absolute
  local path the **user picked** (a file dialog, a clipboard save or a dropped
  file). A non-array, a non-string entry, a blank entry or a fifth path is
  `-32602` and nothing is attached or sent. Paths are never destinations and
  nothing is written to them.
- Each path is attached to the controller before the turn is claimed, as
  `{path, name: basename(path), mediaType}`. The media type comes from the
  extension — `png`, `jpg`/`jpeg`, `webp`, `gif` — and anything else is
  `application/octet-stream`. The core does not open the file here, so a
  missing, unreadable or oversized image is the LLM layer's typed error when
  the turn is sent.
- An image the controller refuses — a fifth image already on the composer, or a
  reply already streaming — is one `-32000`, `retryable: false`, with
  `data: {kind: "image", message}`, and no turn starts. It is not retried.
- Images are **not** persisted: `chat.jsonl` and the local Chill history stay
  text only, and the data URL is derived from the local file at send time, never
  stored.
- Each attached image is sent as a `file` model part whose data URL is derived
  by reading the local file at send time, and the core appends the request's
  images to the **last user message** (adding one when the request has no user
  turn). Message-level images on a stored turn keep working the same way.
- A **vision-capable model is required**, but there is no capability precheck:
  the core has no model vision metadata, so a text-only model's rejection is the
  **provider's own error**, reported once with no retry and no partial answer.
  The shell should say `pick a vision model in Settings → Models` and let the
  user retry explicitly.

`work.*` is the Work project surface (T-013). Nothing here reads, writes, moves,
copies or deletes a file inside a project root: the only writes are
`work/projects/<id>/meta.json` (project registration, agent profiles and the
default agent) and, for project chat (T-019), that project's own
`work/projects/<id>/chats/chat-<n>.jsonl` transcript. A project whose `meta.json`
cannot be parsed is skipped by the registry, so `work.list` never returns an
invented row.

- `work.list` → `{projects: ProjectRow[]}`:

  ```json
  {"projects":[{"id":"my-app-4f2a1c","name":"My app","folder":"/home/me/Projects/my-app","mode":"chat","swarmName":"","archived":false,"agents":[{"id":"reviewer-9ab12c","name":"Reviewer","task":"Review only.","model":"","permissions":"read-only"}]}]}
  ```

- `work.open` `{id}` → `{project: WorkProjectDetail}`. An unknown, unreadable or
  invalid project is `-32000`, `retryable: false`,
  `data: {kind: "project", id, message}`; a blank or non-string id is `-32602`.

  ```json
  {"project":{"id":"my-app-4f2a1c","name":"My app","root":"/home/me/Projects/my-app","rootMissing":false,"mode":"chat","swarmName":"","archived":false,"instructions":"","defaultAgent":"reviewer-9ab12c","agents":[{"id":"reviewer-9ab12c","name":"Reviewer","role":"builder","instructions":"Review only.","model":"","maxToolCalls":8,"allowedTools":[],"allowWrite":false,"allowCommand":false,"template":""}],"tasks":0,"hasGit":false,"lastOpened":"2026-11-01T09:00:00.000Z"}}
  ```

  `agents` in the list row is the shell's `ProjectAgent`; in the detail it is the
  full `AgentProfile`, because the sidebar needs the capability flags.
  `defaultAgent` is `null` when no profile is the default, `tasks` is the task
  count, and `rootMissing` is true when the registered folder vanished after
  registration (the metadata still opens).

- `work.create` `{name, folder, mode, instructions?}` → `{id, name}`, where
  `mode` is `chat` or `swarm`. The id is derived from the name (`makeProjectId`),
  the folder may not exist yet (it is created), and a folder that is already
  registered is refused rather than duplicated. The root is never moved or
  deleted. `instructions` is optional and saved with the registration; agent
  profiles are added with `work.agent.save`. A refusal is `-32000`,
  `retryable: false`, `data: {kind: "project-create", message}`.
- `work.instructions.save` `{projectId, instructions}` → `{instructions}`.
  Replaces the project's standing instructions in
  `work/projects/<id>/meta.json`; every other key is preserved and nothing
  inside the project root is read or written. The same 20,000-character rule as
  creation applies; a blank string clears them. A wrong type is `-32602`; an
  unknown project or a failed write is `-32000`, `retryable: false`,
  `data: {kind: "project", projectId, message}`, and the previous text stays.

`work.agent.*` and `work.defaultAgent` edit the project's **agent profiles**
(`docs/product.md` §8.3). They write only `work/projects/<id>/meta.json` — the
`agents` array and `default_agent` — and never read, write, move, copy or delete
a file inside the project root. Unknown keys in `meta.json` are preserved.

- `work.agent.save` `{projectId, agent}` → `{id}` creates or updates one profile.
  `agent` is `{id?, name, role, instructions, model, maxToolCalls, allowedTools,
  allowWrite, allowCommand, template}`:

  - `id` omitted → **create**. The id is generated exactly as the TUI does
    (`makeAgentId(name, takenIds)`, e.g. `reviewer-9ab12c`) from the ids already
    in `meta.json`, so it is stable for the life of the agent. `name` is
    required.
  - `id` present → **update in place**. The stored id is kept, so renaming or
    retargeting the model does not break references, and only the supplied
    fields change (the rest keep their saved values). `name` is optional here.

  Bounds are the service's own: `name` non-empty and at most 60 characters,
  `role` 60, `instructions` 20 000, `model` 200, `template` 80, `maxToolCalls` a
  whole number from 1 to 32 (default 8), `allowedTools` an array of non-empty
  tool names (empty means every tool the capabilities permit), `allowWrite` and
  `allowCommand` booleans (default false). A wrong type or an out-of-range value
  is `-32602` naming the field, and nothing is written.

  Two rules stay in the service, so its message is preserved: a name already
  used by another agent in the project is refused (case-insensitive), and an
  unknown tool name is refused with the accepted set named. Both are `-32000`,
  `retryable: false`, `data: {kind: "agent", projectId, message}`.

  An unknown, unreadable or invalid project is `-32000`, `retryable: false`,
  `data: {kind: "project", projectId, message}`; every later failure is the
  `agent` shape. (The project error names the parameter — `projectId` — while
  `work.open` names its own `id`.)

  `allowCommand`/`allowWrite` are stored as requested. The product rule "swarm
  workers never inherit command access" is enforced at the swarm boundary: a
  worker receives a read-only copy (`forSwarm`), so a save in a `swarm` project
  is neither widened nor silently narrowed.

- `work.agent.delete` `{projectId, agentId}` → `{ok: true}`. Deleting the default
  agent clears `default_agent` in the same atomic write, so the project is left
  with **no** default (the documented blocked state) rather than a silent
  promotion of a neighbour. An unknown project is the `project` shape; an
  unknown agent is `-32000`, `retryable: false`,
  `data: {kind: "agent", projectId, agentId, message}`.

- `work.defaultAgent` `{projectId, agentId?}` → `{defaultAgent: string | null}`
  sets the one project default. `agentId: null` or an omitted `agentId` clears
  it; the reply is the value stored now, so `null` means "this project has no
  default". An id that does not name a valid saved profile is refused with the
  `agent` shape (including `agentId`), so `meta.json` can never point at a
  profile that cannot run.

`work.templates.list` is the agent editor's **template picker**
(`docs/product.md` §8.3). It is a read: it lists what can seed a profile and
writes nothing, and it is not a save path.

A template **seeds** an editor's fields. Nothing here applies one, and no
template is ever applied implicitly: the user picks a row, the editor fills the
fields, and the profile is still saved through `work.agent.save` when the user
presses Save. `template` there stays the free string field it has always been,
so an agent saved before this method existed keeps loading unchanged.

- `work.templates.list` `{projectId?}` → `{templates: AgentTemplateRow[]}`.
  `projectId` is optional. When it is supplied it must name a registered
  project; the built-ins are listed either way, because they ship with the app
  and mean the same thing in every project.

  ```json
  {"templates":[
    {"id":"reviewer","name":"Reviewer","role":"reviewer","summary":"Review the work for correctness, regressions, security issues and missing tests. Report findings and cite file paths; do not change files.","source":"built-in","instructions":"Review the work for correctness, regressions, security issues and missing tests. Report findings and cite file paths; do not change files.","maxToolCalls":8,"allowedTools":["list_files","read_file","search_files"]},
    {"id":"pair-programmer","name":"Pair programmer","role":"pair","summary":"Work one small step at a time and explain each edit.","source":"project","instructions":"Work one small step at a time and explain each edit.","maxToolCalls":6,"allowedTools":["read_file","search_files"]}
  ]}
  ```

  Each row is `{id, name, role, summary, source, instructions, maxToolCalls,
  allowedTools}`:

  - `source` is `built-in` for the three shipped profiles (`reviewer`,
    `implementer`, `researcher`) and `project` for a
    `work/templates/NAME.json` file. Built-ins come first, then project
    templates by id, so the picker's order is stable.
  - `instructions`, `maxToolCalls` and `allowedTools` are the fields the picker
    fills, sent verbatim from the template. The shell keeps no template table of
    its own and never re-derives them.
  - `summary` is the template's instructions collapsed to one line and capped at
    160 characters (with `…`), for the picker row. It is derived from
    `instructions`, never authored twice.
  - A row never carries `allowWrite` or `allowCommand`: a template may ask for
    write access, but the picker deliberately fills only the five fields above,
    and command access is a per-agent setting the user turns on explicitly. The
    editor's own capability switches are left exactly as the user set them.

  The templates come from `listTemplates` in the service
  (`src/services/work/templates.ts`): the built-in table plus every usable
  `work/templates/*.json`. A file that is not JSON, not a template object, or
  invalid is **skipped** and reported by the service as an issue, never offered
  and never an error here; the rest of the list still renders. A project file
  that tries to shadow a built-in id is skipped for the same reason — `reviewer`
  must mean the same thing in every project.

  A blank or non-string `projectId` is `-32602` (`projectId must be a string` /
  `must be a non-empty string when supplied`) and never boots the app. A
  supplied id that is not registered is one `-32000`, `retryable: false`, with
  the shared project shape `data: {kind: "project", projectId, message}`; it is
  not an empty list.

  A workspace with no `work/templates/` folder is the built-ins only — an empty
  picker is never an error, and a missing folder is not created by a read. No
  model is called, no plugin runs, and the workspace is byte-identical
  afterwards.

`work.changes` is the **read-only Changes summary** for one project
(`docs/product.md` §8.5): what the working tree looks like now, not a diff to
approve. It never stages, commits, checks anything out, or writes a byte inside
the project root. It is **not** the write-approval surface: `work.write.propose`
and `work.write.decide` own per-write approval and per-hunk review.

- `work.changes` `{projectId}` → `{changes: ChangeSummary}`. `projectId` is a
  registered project id, never a path. The reply is the service's summary
  unchanged:

  ```json
  {"changes":{"available":true,"branch":"main","detached":false,"dirty":true,"staged":0,"unstaged":1,"files":[{"path":"notes.md","status":"modified","added":1,"removed":1,"staged":false,"unstaged":true}]}}
  ```

  `available: false` is a **success**, not an error: the folder is gone, the
  folder is not a git repository (or sits inside another repository), or `git`
  is not installed. Every such reply carries `reason` and a one-sentence
  `message` the shell prints, and the rest of Work keeps working:

  ```json
  {"changes":{"available":false,"reason":"not a git repository","message":"“My app” is not a git repository, so there are no changes to show"}}
  ```

  `reason` is one of `not a git repository`, `git not found`, `missing folder`.
  A file row's `status` is one of `added`, `modified`, `deleted`, `renamed`,
  `copied`, `typechange`, `untracked`, `conflicted`; `files` is sorted by
  `path`, and the row's `staged`/`unstaged` flags say where that change lives.
  `added`/`removed` are summed line counts (`0` for a binary file), so the shell
  renders them and never re-reads the repository.

  Only a git command that actually fails on a real repository is an error:
  `-32000`, `retryable: false`, `data: {kind: "changes", projectId, message}`,
  reported once and never retried. An unknown project is the shared project
  error shape (`data: {kind: "project", projectId, message}`, like every other
  `work.*` method; `work.open` names its own parameter `id`), and a blank or
  non-string `projectId` is `-32602`.

  The core runs git with a fixed argv list and `GIT_OPTIONAL_LOCKS=0` (plus
  `--no-optional-locks`), so listing changes cannot refresh or rewrite the
  index. `tests/integration/server-data.test.ts` asserts `git status
  --porcelain` is byte-identical before and after the call.

`work.write.*` and `work.command.*` are the write and command approval surface
(`docs/product.md` §8.2, `swarm/contracts.md` §4.3–§4.4). They are split in two
on purpose:

- **`propose` is a value, never a side effect.** It resolves and confines the
  request, builds the diff or the argv value, and returns it. It never writes a
  file and never starts a process.
- **`decide` is the only method that can apply a write or start a process.**
  Nothing here is wired to a model tool yet and there is no UI; the shell must
  put a named confirmation in front of every `decide`.

**Proposals live in process memory only.** A proposal is a value the user has
not decided on, so it is never written to disk. The core keeps the whole value
(including `newContent` and the exact argv) in an in-memory map keyed by a fresh
`id`; **a core restart forgets every proposal** and the shell must propose
again. `decide` consumes the proposal on both paths (approve/deny and
reject/deny), so a second decide on the same id is the documented "no pending
proposal" refusal, never a replay:

```json
{"jsonrpc":"2.0","id":4,"error":{"code":-32000,"message":"there is no pending write proposal \"…\"; propose it again","data":{"kind":"write","id":"…","message":"…"},"retryable":false}}
```

An unknown proposal id never boots the app; an unknown project is the shared
project error shape (`data: {kind: "project", projectId, message}`).

**An approval needs two independent permissions.** `decide` applies a write or
starts a command only when **both** gates are on, and the refusal names the side
that is off:

1. **The global Settings opt-in**, read from `config.toml` `[work]`
   (`allow_write` / `allow_command`, both `false` by default). This is
   configuration: a tool call, a swarm worker or a plugin cannot switch it on,
   and `settings.patch` refuses a `work` key so no generic config write can
   change the gate's own read. Write it with `work.permissions.set`.
2. **The resolved agent profile's own flag.** `decide` resolves the project's
   default agent (`work.defaultAgent`/`meta.default_agent`), or the first valid
   profile when there is no default. No profile at all is a refusal with a
   one-line next step, never an implicit permission.

The global gate runs first, so a project with no profile is still told to turn
writes/commands on in Settings; a profile that refuses is told which profile to
change. There is **no "remember this session"**: every decision re-reads both
gates, and nothing is remembered between proposals. A rejection or a denial
needs no permission at all: it applies nothing and starts nothing.

A permission refusal is `-32000`, `retryable: false`, with
`data: {kind: "write"|"command", projectId, message}` (plus `path` for a write),
and nothing is written or run. The refusal does **not** consume the proposal, so
the user can turn the gate on and decide the same proposal again; the messages
are `Writes are switched off in Settings → Work; turn them on to approve a
write.`, `Commands are switched off in Settings → Work; turn them on to approve
a command.`, or the profile's own sentence (`the agent “Builder” is not allowed
to write; give it permission in its profile first`). After both gates pass, the
transport calls `applyWrite`/`runCommand` with `settings: {allowWrite: true}` /
`settings: {allowCommand: true}`.

- `work.write.propose` `{projectId, path, newContent}` →
  `{id, path, kind, diff, hunks, stats, baseHash}`.

  `path` is relative to the registered project root, never an absolute path:
  `..`, a drive/absolute name, a null byte and a symlink escape are typed
  refusals from `proposeWrite`. `newContent` is the full new text, or `null` to
  propose a delete. The reply is the service's proposal:

  ```json
  {"id":"0f0c…","path":"notes.md","kind":"create","diff":"--- a/notes.md\n+++ b/notes.md\n@@ -0,0 +1,1 @@\n+# Notes\n","hunks":[{"index":0,"oldStart":0,"oldCount":0,"newStart":1,"newCount":1,"lines":[{"kind":"add","text":"# Notes","newline":true}],"oldLines":[],"newLines":["# Notes\n"]}],"stats":{"added":1,"removed":0},"baseHash":null}
  ```

  `kind` is `create`, `update` or `delete`; `baseHash` is `sha256:` of the bytes
  the diff was made against, or `null` for a create. `hunks[*].index` is the
  stable index `decide` accepts, and `diff` only ever names `a/<path>` and
  `b/<path>` — an absolute path never crosses the wire. **Nothing is written.**
  A path escape, an unsupported/binary/oversized target, or a proposal with
  exactly the current bytes is `-32000`, `retryable: false`,
  `data: {kind: "write", projectId, path, message}`. A blank or non-string
  `projectId`, `path` or a `newContent` that is neither a string nor `null` is
  `-32602` and never boots.

- `work.write.decide` `{id, decision, hunks?}` →
  `{decision, applied, path, hunks, bytes}`. `decision` is `approve` or
  `reject`; anything else is `-32602`. `hunks` is optional and only accepted
  with `approve`: an array of non-negative whole hunk indices, absent means
  "all". An empty selection, an unknown index, or a partial delete is the
  service's typed selection refusal and writes nothing.

  ```json
  {"decision":"approve","applied":true,"path":"notes.md","hunks":[0],"bytes":8}
  ```

  A rejection returns `{decision: "reject", applied: false, path, hunks: [],
  bytes: 0}` and **writes nothing**. Success is the service's outcome, so
  `hunks` names exactly what was applied. A blocked profile, a hash conflict, a
  selection error or a storage failure is `-32000`, `retryable: false`,
  `data: {kind: "write", projectId, path, message}`; the service stages the
  replace through a temp file + fsync + rename, so a failure leaves the previous
  bytes in place.

- `work.command.propose` `{projectId, argv, cwd?, reason?}` →
  `{id, argv, cwd, reason, risk}`.

  `argv` is a **non-empty array of non-empty strings**, never a shell line.
  `validateArgv` refuses a string, an empty program name, a non-string argument,
  a control character/newline, shell metacharacters (`; | & $ ` > < * ?`), glob
  brackets, and a shell asked to run a command string (`sh -c …`). `cwd` is an
  optional path relative to the project root (default `"."`); `resolveCommandCwd`
  refuses an absolute path, `..` and a symlink escape, and a folder that does
  not exist. `reason` is optional context for the approval screen.

  ```json
  {"id":"5a1d…","argv":["printf","ok"],"cwd":".","reason":"check the approval path","risk":"This process can read and write outside the project and can reach the network."}
  ```

  `risk` is the service's fixed sentence, never model text, so the warning
  cannot be talked out of the approval. **No process is started.** An argv
  validation or cwd confinement error is `-32000`, `retryable: false`,
  `data: {kind: "command", projectId, message}`. A non-string `cwd`/`reason` is
  `-32602`. Argv is always passed to the OS as an array: there is no shell, so
  `;`, `|`, `$(…)` and `>` in a token would be inert — they are refused anyway
  because approving a command *line* teaches the wrong mental model.

- `work.command.decide` `{id, decision, reason?}` →
  `{decision, argv, cwd, exitCode, stdout, stderr, timedOut}`. `decision` is
  `approve` or `deny`; `reason` is optional and only meaningful for a denial.
  An approval needs the resolved profile's `allowCommand: true`; a denial starts
  nothing and needs no permission.

  ```json
  {"decision":"approve","argv":["printf","ok"],"cwd":".","exitCode":0,"stdout":"ok","stderr":"","timedOut":false}
  ```

  A denial returns `{decision: "deny", argv, cwd, exitCode: null, stdout: "",
  stderr: "", timedOut: false}`. On approval `stdout`/`stderr` are capped per
  stream (64 KiB, with the service's truncation marker), `exitCode` is the
  process's code and `timedOut` says whether the command hit the service's
  120 s limit (partial output is kept). A command that cannot start, a timeout,
  a blocked profile or an opt-in refusal is `-32000`, `retryable: false`,
  `data: {kind: "command", projectId, message}`. There is no shell interpolation
  anywhere on this path and no automatic retry.

`work.permissions.get` / `work.permissions.set` are the **global opt-in** half of
that gate (`docs/product.md` §8.2, `docs/data-model.md` §2 `[work]`). They read
and write two stored booleans and nothing else: no chat turn, no session, no
proposal and no process.

```json
→ {"jsonrpc":"2.0","id":14,"method":"work.permissions.get"}
← {"jsonrpc":"2.0","id":14,"result":{"allowWrite":false,"allowCommand":false}}
```

- `work.permissions.get` takes no parameters and returns the stored values. Both
  default to `false`, so a fresh workspace refuses every approval even when a
  profile allows it. This is a read: it writes nothing and creates nothing.
- `work.permissions.set` `{allowWrite?, allowCommand?}` → the same view **after**
  the write, read back from `config.toml`, not an echo. An omitted field keeps
  its stored value; a request with neither is a no-op success. The write is one
  `patchConfig` of `[work]` and the live boot config is updated in the same call.
- A wrong type (`"yes"`, `1`) is `-32602` naming the field, and nothing is
  written. A build with no config writer is `-32601`, `retryable: false`
  (`Work permission editing is not available in this build`). A failed write is
  `-32000`, `retryable: false`, with `data: {kind: "config", message}`, and the
  previous values are untouched. Neither is retried.
- `settings.patch` **refuses** a `work` key with `-32602` (`settings.patch cannot
  change Work permissions; use work.permissions.set`), so the gate's read and the
  file cannot disagree and no generic config write can bypass the gate.
- Turning a flag on does not approve anything by itself: every `decide` still
  needs the per-action approval, and the resolved profile's flag must also be on.
  There is no "remember this session".
- The reply is the stored view, so the shell replaces its snapshot from this one
  message. Neither method emits a change event; no proposal is created, applied
  or consumed.

`work.chat.*` is project-scoped chat (T-019). One controller per
`projectId:chatId`, built on first use and reused thereafter, exactly like a
session chat: the transcript is that project's `chats/<chat>.jsonl`, scoped by
`ui.chill_history_limit`, and the toolbox is `projectTools` — the project's own
files, confined to the registered root. **The default remains read-only:** the
base tool set is `list_files`, `read_file` and `search_files`, and the request
runs with `scope: "work"` and `mode: "work"`.

The project's approving profile is the default agent (or the first valid profile
when no default is set). Its capability flags decide whether the chat is also
offered **proposal-only** tools:

| Profile flag | Extra tool | Effect |
|---|---|---|
| `allowWrite: true` | `write_file {path, content}`, `delete_file {path}` | builds a diff proposal; writes nothing |
| `allowCommand: true` | `run_command {argv, cwd?, reason?}` | builds an argv proposal; starts nothing |

A read-only profile, or a project with no profile at all, gets exactly the three
read tools. The global Settings opt-in is a separate gate on the **decision**
(`work.permissions.get`/`set`), not on what the chat may propose: a profile may
build a proposal while the global flag is off, and `work.write.decide`/
`work.command.decide` still refuse to apply or run it until both are on.

- A proposal tool resolves the same `proposeWrite`/`proposeCommand` services the
  explicit methods use, stores the value in the **same in-memory maps** `decide`
  consumes, and emits `work.write.proposal` / `work.command.proposal`. It returns
  JSON to the model: `{ok: true, status: "pending-approval", id, path|argv,
  message: "the user must approve this before it is applied"}`.
- The model is told these are proposals and must never claim a change was made
  or a command ran. The read-only context sentence (“Writes and commands are
  off…”) is replaced when a proposal tool is offered.
- **Nothing is written and nothing runs** until the shell calls `decide`; a
  proposal is a value, and a core restart forgets it.
- A `settings.patch` that touches `models` drops every project controller, so the
  next `open`/`send` is built with the saved model; an unrelated settings patch
  leaves an open chat alone.

- `work.chat.list` `{projectId}` → `{chats: string[]}`. The ids are the
  project's `chats/chat-<n>.jsonl` files in numeric order (`[]` when the folder
  does not exist yet). An unknown project is `-32000`, `retryable: false`,
  `data: {kind: "project", projectId, message}`; a blank or non-string
  `projectId` is `-32602`.

- `work.chat.open` `{projectId, chatId?}` → `{chatId, snapshot}`. An omitted
  `chatId` resumes the newest existing chat, or starts `chat-<n+1>` when the
  project has none. An explicit `chatId` must already exist: a well-formed id
  with no file is refused (it never quietly opens another transcript), and a
  non-string or blank value is `-32602`. An unknown chat is `-32000`,
  `retryable: false`, `data: {kind: "chat", projectId, chatId, message}`.

  ```json
  {"chatId":"chat-2","snapshot":{"status":"idle","model":null,"streamed":"","messages":[{"id":"history-0","role":"user","text":"…","outcome":"done"}],"blocked":null,"error":null,"usage":{"tokens":0,"costMicroUsd":null,"durationMs":null}}}
  ```

  `snapshot` is the standard `ChatSnapshot`, loaded once here, so the shell does
  not read the file itself. With no model configured it is an idle snapshot with
  `model: null` — never an error and never a crash.

- `work.chat.send` `{projectId, chatId, text}` → `{turnId}`, where `turnId` is
  `"<projectId>:<chatId>"` (one active turn per chat). `text` is required and
  non-empty and `chatId` is required; a blank value is `-32602`. The chat must
  exist on disk or have been opened in this run, otherwise the reply is the
  `chat` error shape and nothing is sent. The request returns as soon as the turn
  is claimed; the state events are authoritative and the shell never appends a
  local message.

  - `work.chat.state` — `{projectId, chatId, ...ChatSnapshot}`, coalesced at
    ~33 ms.
  - `work.chat.done` — `{projectId, chatId, ...SendOutcome}` (`kind`, `reason`,
    `fix`, or `requestId`/`outcome`).
  - `work.chat.error` — `{projectId, chatId, message}`; one message, no retry.

- `work.chat.cancel` `{projectId, chatId}` → `{ok: true}`. A chat with nothing in
  flight is a no-op and builds no controller. A missing `chatId` is `-32602`; an
  unknown project is the `project` error shape.

`work.approvals.list` is the **read-only** pending-approvals list for the Work
surface. A proposal lives in process memory only, so a view that renders it can
ask again after a tab switch; this method never applies, runs, writes or consumes
anything.

```json
→ {"jsonrpc":"2.0","id":12,"method":"work.approvals.list","params":{"projectId":"my-app-4f2a1c"}}
← {"jsonrpc":"2.0","id":12,"result":{
    "writes":[{"id":"0f0c…","projectId":"my-app-4f2a1c","path":"notes.md","kind":"create","diff":"--- a/notes.md\n…","hunks":[…],"stats":{"added":1,"removed":0},"baseHash":null}],
    "commands":[{"id":"5a1d…","projectId":"my-app-4f2a1c","argv":["printf","ok"],"cwd":".","reason":"…","risk":"This process can read and write outside the project and can reach the network."}]
  }}
```

`projectId` is optional; when supplied the reply is filtered to that project, and
an unknown or stale id simply has no rows (it is not an error). The write view is
exactly `{id, projectId, path, kind, diff, hunks, stats, baseHash}` and the
command view exactly `{id, projectId, argv, cwd, reason, risk}`: **`newContent` is
never sent**, because the approval screen reviews the diff, not the raw
replacement. A blank or non-string `projectId` is `-32602`.

When either `decide` method consumes a proposal it emits
`work.approval.resolved {id, kind: "write" | "command"}` as a best-effort
notification (the decision is final whether or not anyone listens), so the shell
can drop the row immediately instead of polling.

`work.swarm.*` is a project's swarm board (`docs/product.md` §8.4): a
coordinator's plan of tasks, each run by **one read-only worker**, and one
Markdown report per run. Tasks are independent unless they declare `requires`.

A worker is always the `forSwarm` copy of a project agent: `allowWrite: false`,
`allowCommand: false`, and a tool list narrowed to `list_files`, `read_file` and
`search_files`. The core builds the toolbox from `projectTools` only — never the
proposal tools a project chat may carry — and its resolver refuses every other
tool name. A run can therefore read the project and change nothing: it cannot
write a file, start a process, ask for approval or widen a profile. Each worker
gets its own in-memory transcript, so no `chat.jsonl` is created; the report
under `work/projects/<id>/reports/<run-id>.md` is the only file a run leaves
behind.

The report is the **durable** record, and it carries each task's id so a
restart can still verify one task:

```md
## Plan

- task-1 · Check the API — Reviewer
- task-2 · Check the offsets — Reviewer

## Task results

- [done] task-1 · Reviewer — read the routes
- [verified] task-2 · Reviewer — read offsets
```

A report written before ids existed (`- [done] Reviewer — …`, no `task-N`) is
still read: the missing id is the line's 1-based position, which is exactly the
id the service assigns because tasks are created in plan order. The parser never
requires an id, so old and new reports coexist.

A work-mode controller may also carry the configured `web-search` plugin's
**read-only** tools, exactly as a project chat does; the plugin runtime never
offers a write tool in this mode and no approval surface exists on this path.

The board is **process state** (`docs/architecture.md` §6.2). A core restart
forgets every run record; reports survive on disk, and `work.swarm.runs` is empty
after a restart.

- `work.swarm.run` `{projectId, objective, plan, parallel?}` → `{runId, board}`.
  `plan` is a non-empty array of `{title, agentId?, assignment, requires?}`; an
  omitted `agentId` means the project's default agent, and an omitted `requires`
  means the task is ready immediately. `requires` is a list of **earlier task
  numbers** (1-based): task 2 that waits for task 1 is `requires: [1]`. Only
  earlier tasks are legal, so the graph is acyclic by construction; a forward or
  self reference is an `invalid-input` refusal and no worker starts.
  `parallel` is an optional whole number from **1 to 4** (the hard cap) and
  absent means 1. The scheduler starts a task only when every prerequisite is
  `done`; when a prerequisite fails, its dependents become `blocked` and the run
  fails. The service trims the objective and caps it at 500 characters, a title
  at 120 and an assignment at 4 000, and a plan at 24 tasks. Each board task
  carries `requires: string[]` (`["task-1"]`), so the shell can show what it
  waited for.

  A board task carries `verified: boolean`. `status: "done"` means the worker
  answered; `verified: true` means a person reviewed it. They are deliberately
  separate — an agent claiming completion is not the same as a finished task.
  The optional `verified` flag on a plan task is not accepted; it is a review
  decision, not a plan field.

  The reply is sent **as soon as the run is registered**, so the shell can cancel
  or poll while the workers are still going: `board` is the board at that moment
  (`live: true`, the first tasks `running`), and `work.swarm.updated` carries
  every later change plus the settled board. One model call per task, never
  retried; a worker's terminal outcome is `done` (the answer becomes a one-line
  summary), `failed` (a provider error) or `blocked` (the controller's no-model
  state). A failed or blocked task makes the run `failed`; the report records
  each status. With no chat factory in the build the method is refused before a
  worker starts (see the error shapes).

- `work.swarm.board` `{projectId, runId}` → `{board}`. The current board: rows,
  statuses, summaries and `reportPath` once the report has been written (`null`
  until then). `runId` is a run id, never a path.

- `work.swarm.runs` `{projectId}` → `{runs: SwarmBoard[]}`, every run this
  process knows for the project, oldest first. `[]` is an empty board surface,
  not an error.

- `work.swarm.cancel` `{projectId, runId}` → `{board}`. Cooperative: the run's
  abort signal fires, each worker stops at its next delta, the running and
  pending tasks become `cancelled`, and the coordinator writes the report with
  `status: cancelled` once the workers have settled. An answer that arrives
  after the abort is discarded. Cancelling a finished run is a no-op that
  returns its board.

- `work.swarm.remove` `{projectId, runId}` → `{removed, reportPath}`. Drops the
  in-memory record only: **the report file stays**. A live run is refused
  (`cancel the swarm before removing its record`), and an unknown run returns
  `{removed: false, reportPath: null}` — a restart forgets records, so a missing
  one is not an error.

- `work.swarm.verify` `{projectId, runId, taskId, verified?}` → `{task, board}`.
  Marks one **done** task verified (or clears it with `verified: false`). A
  pending, running, failed, blocked or cancelled task is refused: verification
  is a review of a completed result. The run's report is rewritten atomically
  (a verified line replaces `[done]`), and the decision is appended to the
  activity log as a `swarm` record with `event: "verified"` and
  `status: "verified" | "unverified"`. When the run is no longer in memory — a
  restart — the same request still verifies the task: the report's one line is
  rewritten atomically, the activity log records the decision, and an
  already-verified task is a no-op success. The reply is the task and the whole
  board while the run is live; a report-only verification has no board to
  return, so callers treat `review.mark` (which returns the queue) as the
  durable path.

- `work.swarm.retry` `{projectId, runId, taskId}` → `{runId, board}`. Starts a
  **new, single-agent read-only run** for one failed or blocked task and returns
  its new id; `retryOf` on that board names the original run and task. The
  original run, its board and its report are untouched. Retrying a task that is
  not `failed` or `blocked` is refused.

`work.swarm.updated` is the best-effort notification: `{projectId, runId, board}`,
coalesced at ~33 ms so four lanes cannot flood the shell. It is sent for task
changes and once when the run settles (by then the report is written). A run
removed by `work.swarm.remove` emits nothing further.

Error shapes: a malformed request is `-32602` and never boots the app — a
missing or blank `projectId`, `objective`, `runId` or `taskId`, an empty plan, a
task without a non-empty `title` or with a non-string `assignment`, an
`agentId` that is present but blank, and a `parallel` outside 1..4 or not a
whole number. An unknown project keeps the shared `project` shape
`data: {kind: "project", projectId, message}`. Every refusal after that is one
`-32000`, `retryable: false`, with
`data: {kind: "swarm", projectId, runId?, message}`: an unknown agent in the
plan, an agent-less task in a project with no default agent, a plan longer than
24 tasks, an unknown run, a remove of a live run, a retry of a task that did not
fail, and any storage failure. `run` (and `retry`) on a build with no chat
factory is
`data: {kind: "generation", projectId, message: "link a model in Settings → Providers"}`:
nothing starts, and retrying it is a new request after the user links a model.

`activity.list` is the read-only **Work activity log** (`docs/product.md` §8.5,
`docs/data-model.md` §6.3). It answers "did I approve that write?" without the
app keeping any of the code it decided about.

```json
→ {"jsonrpc":"2.0","id":13,"method":"activity.list","params":{"kind":"write-decision","project":"my-app-4f2a1c","limit":50}}
← {"jsonrpc":"2.0","id":13,"result":{
    "records":[
      {"kind":"write-decision","project":"my-app-4f2a1c","path":"notes.md","decision":"approve","hunks":[0],"at":"2026-11-01T10:01:00.000Z"}
    ],
    "skipped":0,
    "empty":false
  }}
```

- **What is recorded.** One line per Work decision, written by the service that
  made it:
  - `write-decision` — `{kind, project, path, decision: "approve" | "reject",
    hunks, at}` from `work.write.decide`, including a rejection;
  - `command-decision` — `{kind, project, argv, cwd, decision: "approve" |
    "deny", exitCode, durationMs, timedOut, at}` from `work.command.decide`,
    including a denial;
  - `swarm` — `{kind, project, run, event, status, at, task?}` for the run
    lifecycle (`started`, `finished`, `failed`, `cancelled`) and each task
    (`task`).

  `path` is project-relative and `cwd` is relative to the project root, so no
  absolute path ever reaches a record. A decision the agent profile blocked
  before the service ran (an approval without `allowWrite`/`allowCommand`) is
  not recorded: no decision was applied, and inventing an event for it would
  misreport what happened.

- **What is deliberately not.** The log is metadata only. It never stores a file
  body, a diff, a prompt, a model answer, `stdout`/`stderr`, an image or a
  secret. The service re-serialises every record through a per-kind whitelist, so
  a caller cannot smuggle one in. It never stores an absolute project path
  either.

- **Where it lives.** `<dataDir>/activity.jsonl`, outside the workspace, so an
  export or an archive never carries it and the workspace stays byte-identical
  when a decision is recorded. One log per core process, opened on first use.

- **Writing is best-effort.** A log failure never fails the user's action, is
  never retried and never becomes a second error message: the write is applied
  or the command runs, and the reply is unchanged. A corrupt or truncated line
  is skipped and counted (`skipped`), never fatal, so one interrupted append
  cannot hide every other decision.

- **Reading.** `kind` is optional and one of `write-decision`,
  `command-decision`, `swarm`; `project` is optional and filters to one project
  id; `limit` is optional and a whole number from 1 to 500 (newest records
  first). An absent file is `{records: [], skipped: 0, empty: true}` — an empty
  state with a next action, not an error. The reply never carries the log's
  absolute path, only the records.

- **Errors.** A bad `kind`, a non-string/blank `project` or a `limit` outside
  1..500 is `-32602` naming the accepted set, and the app is never booted for
  it. A log that cannot be opened or read is one `-32000`,
  `retryable: false`, with `data: {kind: "activity", message}`; the shell shows
  the message once and does not retry.

No change event is emitted when a record is appended: a decision is final when
its method returns, and a view that wants to see a background swarm's later
records makes a new `activity.list` request rather than subscribing.

`mcp.*` exposes what is configured, never what it runs with, and never a
credential. Only `mcp.policy.set` writes, and it writes configuration only.

- `mcp.list` → `{servers: PluginRow[], policy: PluginPolicy}`:

  ```json
  {"servers":[{"name":"notes","transport":"stdio","enabled":true,"status":"connected","tools":[{"name":"read_note","write":false}]}],"policy":{"chill":{"notes":"on"},"lockin":{"notes":"explicit"}}}
  ```

  A row is exactly `name`, `transport`, `enabled`, `status`
  (`"connected"` · `"stopped"` · `{"failed": message}`) and `tools`
  (`{name, write}`). The core never returns `command`, `args`, `env` or any
  token: those stay in `config.toml`/the keychain and never cross the wire.
  `policy` is the stored nested matrix (`command → server → on | explicit | off`)
  verbatim; an absent policy is `{}` — the core does not invent cells, and the
  documented defaults are applied by the policy engine when a turn runs.
- `mcp.refresh` → `{servers: PluginRow[]}`. This is the **only** method that may
  spawn the configured stdio servers, and only because the shell explicitly
  asked; boot's own background start remains the startup path. A server that
  fails to connect carries `{"failed": message}` on its row and the request still
  succeeds. A blank/no-op refresh on a workspace with no servers returns `[]`.
- `mcp.policy.get` → `{policy: PluginPolicy}`, the same matrix `mcp.list`
  carries.
- `mcp.policy.set` `{command, server, value}` → `{policy: PluginPolicy}` writes
  **one** policy cell (`docs/product.md` §11). This is the Settings write; the
  per-call permission gate is `mcp.confirm`.

  ```json
  → {"jsonrpc":"2.0","id":12,"method":"mcp.policy.set","params":{"command":"lockin","server":"notes","value":"off"}}
  ← {"jsonrpc":"2.0","id":12,"result":{"policy":{"chill":{"notes":"on"},"lockin":{"notes":"off"}}}}
  ```

  - `command` is one of `chill · lockin · flashcards · study-guide · skill · work` and
    `value` one of `on · explicit · off`; anything else is `-32602` naming the
    accepted set. `server` must be a non-empty string.
  - `on` is **refused** for `flashcards` and `study-guide` with the config
    loader's own copy — `flashcards never calls plugins, so
    plugins.policy.flashcards.notes cannot be "on". Set it to "off"; this
    command never calls a plugin.` Those two commands never call a plugin, so
    `on` is not a storable value and is never silently downgraded. `off` and
    `explicit` are accepted for them.
  - The server must already be configured in `plugins.servers` or already appear
    in the stored matrix. A cell for a server that does not exist is a typo and
    is `-32000`, `retryable: false`, with
    `data: {kind: "plugin", command, server, message}`; nothing is written.
  - Success returns the **whole** stored matrix, read back from the config
    write, and `mcp.policy.get`/`mcp.list` report it immediately in the same
    process. A config write failure is one `-32000`, `retryable: false`, with
    `data: {kind: "config", message}`, and the previous matrix is unchanged. A
    build with no config writer is `-32601`, `retryable: false`.
  - A policy write is **configuration only**: it never starts or refreshes a
    server, never calls a tool and never approves a plugin write. The shell must
    make a new `mcp.policy.get`/`mcp.list` request after a write it did not
    perform itself; there is no change event yet.
  - Defaults when a cell is absent are the policy engine's, not this
    transport's: `chill = on`, `lockin = explicit`, `skill = on`,
    `work = explicit`, `flashcards = off`, `study-guide = off`. The resolved
    cell is enforced by the policy engine: `off` hides the server's tools for
    that command, `explicit` offers them only to a turn that asks for the plugin
    by name, and `on` offers them whenever the server is enabled. The core never
    invents a cell, so
    `mcp.policy.get` keeps returning exactly what `config.toml` stores.
- Tool output obtained through a plugin is labelled **external explanation** in
  every surface and never counts as a source (`docs/product.md` §11). This list
  carries tool *names* only; it never carries tool output.

`mcp.confirm` is the per-call permission gate for **write-capable** plugin tools
(`docs/product.md` §11: "every write-capable tool call asks for permission, per
call"). It answers one in-memory prompt; it is not a policy write and not a
tool call.

- A write tool is **absent** from a chat unless the core has a gate installed.
  `PluginRuntime.sourceFor(mode, {approveWrite})` offers write tools only when
  `approveWrite` is supplied, and the protocol installs one on the runtime after
  boot, so Chill, session, work and skill chats built by boot all share it. With
  no gate there is no approval surface and therefore no write tool — a read-only
  build cannot approve itself into a write. (Lock-in and skill chats run in the
  controller's locked `learn` mode, which drops write specs from the request, so
  a learning turn never reaches the prompt at all.)
- The gate runs **after** the policy layer, so `off` (and lock-in's
  explicit-only rule) wins: a policy-refused tool is never offered, and no
  answer to a prompt can approve it. The gate can only consent to a call the
  policy already allows.
- Each write *call* emits one notification and waits:

  ```json
  {"jsonrpc":"2.0","method":"mcp.permission","params":{"requestId":"…","server":"notes","tool":"write_note","input":{"path":"a.md","body":"…"},"write":true}}
  ```

  `requestId` is a fresh opaque id per call; `input` is the model's tool call
  verbatim, because the user must see what will actually run. It is untrusted
  data, never an instruction.
- The shell answers with `mcp.confirm {requestId, allow}` → `{ok: true}`.
  `allow: true` runs the tool exactly once; `allow: false` does not call the
  plugin and reports a typed tool result to the model instead of failing the
  turn:

  ```json
  {"ok":false,"error":{"kind":"permission","message":"the user declined this plugin write"}}
  ```

  A denial is a normal tool result: the reply continues, the transcript is not
  an error, and nothing on our side was written.
- **Bounded wait: 120 s.** A prompt the user never answers (no UI, a closed
  window) denies on timeout with the same typed message and the timer does not
  keep the process alive. This is a deliberate denial, not a retry.
- **No reuse, no bulk approve.** The pending entry is consumed by the answer
  (or by the timeout); a second write call emits a new `requestId` and asks
  again. A late or unknown `requestId` is a benign `{ok:true}` no-op — the
  decision it referred to is already gone and the tool call is not replayed.
- `mcp.confirm` **never boots the app**: it resolves an in-memory request only
  and touches no workspace, config, keychain or server. Pending prompts are
  process state; a core restart forgets them and the waiting call fails closed.
- A non-string/blank `requestId`, or an `allow` that is not a boolean, is
  `-32602` and changes nothing. `mcp.confirm` has no other failure shape.
- **The gate is a consent check, not a sandbox.** An approved write tool runs
  with the plugin's own permissions and may have side effects of its own; a
  denied tool is simply never called by us. It does not confine paths, inspect
  the plugin's behaviour or undo a previous approved call.

`skill.*` is the Skills surface (T-021, T-022). It lists goals, opens one
goal's course index, reads one chapter body and creates a goal with a chapter
plan. Creation makes **one model call when a model is configured**; without one,
or when the reply is unusable, it writes the built-in template and records
`plan: "template"` (a model-written plan records `"model"`). A staged lesson is
`skill.lesson.build`. Nothing here archives, deletes or sends a chat.

- `skill.list` → `{skills: SkillRow[]}`:

  ```json
  {"skills":[{"id":"read-disassembly-output-confidently-3f9a1c","name":"Read disassembly output confidently","stage":{"done":0,"total":0},"chapters":{"done":1,"total":4},"lastOpened":"2026-11-01T09:00:00.000Z","chats":2,"archived":false}]}
  ```

  A row is the goal manager's projection, exactly as the TUI builds it:
  `id`, `name` (`= the goal text, or the id when a folder has no readable
  name`), `stage` (`done`/`total` curriculum stages), an optional `chapters`
  (`done`/`total`) present only when the folder is a course, `lastOpened`
  (ISO instant; the folder's `created` when it was never opened), `chats` (a
  count), `archived`, and an optional `broken` string. A goal folder whose
  `meta.json` cannot be read is **included** with `broken` set to the reason —
  the manager shows the user's data rather than hiding or inventing a row.
- `skill.open` `{id}` → `{skill: SkillDetail}`. `id` is a goal folder name,
  never a path:

  ```json
  {"skill":{"id":"read-disassembly-output-confidently-3f9a1c","name":"Read disassembly output confidently","goal":"Read disassembly output confidently","prior":"I know a little C","created":"2026-11-01T09:00:00.000Z","plan":"template","chapters":[{"id":"ch-1","title":"Getting started","guide":"01-getting-started.md","practical":"01-getting-started-practical.md","done":false}],"stages":[],"chats":[{"id":"chat-1","title":"Where do I start?","lastUsed":"2026-11-01T09:05:06Z","messages":2}]}}
  ```

  `plan` is `"model"` or `"template"`; a course that predates the flag is
  reported as `"template"`. `chapters` is the index only — `guide` and
  `practical` are file names inside the goal's `chapters/`; the body is read by
  `skill.chapter`, never here. `chats` is
  `{id, title, lastUsed, messages}` per `chats/chat-<n>.jsonl`, where `title`
  is the first user message clipped to 60 characters (the id when the chat is
  empty) and `lastUsed` is the last record's instant (empty for an empty chat).

  `stages` is the goal's curriculum, in curriculum order:
  `{id, title, status, milestone?}`. The ids are exactly the ones
  `skill.lesson.build` and `skill.lesson.read` accept, so the shell picks a
  stage from this list and never derives an id itself; `status` is `pending`,
  `active` or `done`. `milestone` is present only when the goal stores a
  non-empty one (an empty milestone is absent, not `""`).

  A goal folder may be either shape, and `skill.open` serves both:

  - a **course** (`skill.create`, with a `chapters` index) has chapters and
    normally `stages: []` — a template plan has no curriculum, so the stage
    picker is empty rather than an error;
  - a **curriculum goal** (stages, no `chapters`) has `stages` and
    `chapters: []`; `prior` is `""` and `plan` is `"template"` because both are
    course concepts, and the shell renders them only for a course.

  A blank or non-string `id` is `-32602`. An unknown id, a missing folder or a
  corrupt `meta.json` is **one** failure: `-32000`, `retryable: false`,
  `data: {kind: "skill", id, message}`. A folder that carries a `chapters` key
  but cannot be read as a course keeps that same error — a malformed index is
  never reported as an empty course. The shell renders the message and offers
  the list; it never retries on its own.
- `skill.chapter` `{id, chapterId, practical?}` → `{text, practical, chapter: {id, title}}`.

  This is the **only** method that returns a chapter body; `skill.open` returns
  the index. `id` is a goal folder name and `chapterId` is a chapter id from
  that index (`ch-1`), never a path or a file name. `practical` is an optional
  boolean, default `false`: `false` reads the lesson (`guide`), `true` reads the
  exercise. The reply is:

  ```json
  {"text":"# Lesson: Getting started\n…","practical":false,"chapter":{"id":"ch-1","title":"Getting started"}}
  ```

  `text` is the file's own bytes (UTF-8 Markdown), so the shell renders it
  directly and never reads the file itself. `chapter` repeats the id and title
  so the reader header needs no second lookup. The core resolves the file
  through the index and the goal folder; a chapter name that would escape
  `chapters/` is refused when the course is read.

  A blank or non-string `id`, a blank or non-string `chapterId`, or a
  `practical` that is not a boolean is `-32602` and never reaches the workspace.
  A course that cannot be read is the same `-32000` skill shape as `skill.open`
  (`data: {kind: "skill", id, message}`). An unknown chapter id, or a chapter
  file that is missing or unreadable, is `-32000`, `retryable: false`,
  `data: {kind: "chapter", id, chapterId, message}`; one message, no retry, and
  the failed read creates or repairs nothing. No write, no plan generation and
  no network happen on this path.
- `skill.create` `{goal, prior?}` → `{id, name, plan}`. This is the Skills
  wizard's Review step.

  ```json
  {"id":"read-disassembly-output-confidently","name":"Read disassembly output confidently","plan":"template"}
  ```

  `goal` is required: a non-empty string, trimmed, at most 200 characters.
  `prior` is optional: a string, trimmed, at most 2000 characters, describing
  what the learner already knows. A wrong type, an empty/blank goal or an
  over-length value is `-32602` naming the field, and nothing is written.
  Clients must not send a caller-chosen id: the core derives it from the goal
  (`courseSlug`), giving a second goal with the same words a stable `-2` suffix
  rather than overwriting the first.

  **One model call when a model is configured.** The core asks for a chapter
  plan as JSON only — `[{"title":"...","guide":"markdown","practical":"markdown"}]`,
  4–8 ordered chapters, each with both fields — and writes the reply as the
  course. `plan` is `"model"` when the reply was usable and `"template"`
  otherwise.

  With no model configured the built-in template is used and `plan` is
  `"template"`. A failed call, malformed JSON or a reply with no usable chapter
  (missing `title`, `guide` or `practical`, or an empty one) is **not an
  error**: creation still succeeds with the template and reports
  `plan: "template"`. There is no retry and no partial plan is written, so a
  generated outline is either the whole model plan or the whole template. A
  model reply is asked to give exercises that do not hand over a finished
  solution; the shell may treat `"template"` as the honest starting outline
  rather than a generated curriculum.

  The service writes the whole goal folder as one transaction: `meta.json` and
  both chapter files go into a temp directory under `skills/goals/`, which is
  then renamed into place. Any failure — the goal folder cannot be created, the
  temp write fails — is **one** message: `-32000`, `retryable: false`,
  `data: {kind: "skill-create", message}`, and no goal folder or half-written
  file is left behind. The reply carries only `id`, `name` and `plan`; the shell
  calls `skill.open` for the chapter index and `skill.list` for the manager row.

`skill.stages.save`, `skill.archive`, `skill.remove` and `skill.export` are the
Skills surface's curriculum editor and goal manager (`docs/product.md` §7.4).
Every one names the goal by folder id — never a path — and a blank or non-string
`goalId` is `-32602`. An unknown, missing or unreadable goal is the shared
`skill` shape (`data: {kind: "skill", id, message}`, `retryable: false`) that
`skill.open` already uses. None of them makes a model call or contacts the
network.

- `skill.stages.save` `{goalId, stages, confirmed?}` → `{stages}`. The
  curriculum editor's **only** write. `stages` is the **whole** desired
  curriculum, in order: 1–16 entries of `{id?, title, milestone?}`. `title` is a
  non-empty trimmed string of at most 120 characters, `milestone` is an optional
  string of at most 200 characters (an omitted one is stored as empty), and
  `confirmed` is an optional boolean. A bad shape — a non-array, fewer than 1 or
  more than 16 entries, an entry that is not an object, a blank/overlong title, a
  non-string or overlong milestone, two entries sharing an id, a non-boolean
  `confirmed` — is `-32602` naming the field, and nothing is written.

  ```json
  → {"jsonrpc":"2.0","id":9,"method":"skill.stages.save","params":{"goalId":"read-disassembly-output-confidently","stages":[{"id":"stage-2","title":"Control flow"},{"id":"stage-1","title":"Registers"},{"title":"Tooling"}],"confirmed":true}}
  ← {"jsonrpc":"2.0","id":9,"result":{"stages":[{"id":"stage-2","title":"Control flow","status":"active"},{"id":"stage-1","title":"Registers","status":"done"},{"id":"stage-4","title":"Tooling","status":"pending"}]}}
  ```

  - An entry whose `id` names a stage the goal already has **keeps that stage's
    id and status**: reordering, renaming or retitling a milestone never costs
    progress.
  - An entry **without** an id is a new stage: the core derives a fresh
    `stage-<n>` id (the scheme the goal writer uses) and status `pending`. The
    fresh id never reuses one this goal already has, including a stage being
    removed in the same save.
  - An id the goal does **not** have is `-32602` — a stale request, never a
    silently invented stage. Only an entry without an id adds one.
  - A stage absent from the request is removed. Removing a stage whose status is
    `done` **loses completed progress**, so it is refused unless
    `confirmed: true`; the refusal is `-32000`, `retryable: false`,
    `data: {kind: "stage", goalId, message}` and its message names the stage
    titles that would be lost (`removing “Registers” discards completed
    progress; save again with confirmed: true`). Nothing is written, so the
    shell can show the named confirmation and re-send with `confirmed: true`.
  - The save goes through the same atomic metadata writer `archive.restore`
    uses: `meta.json` is replaced with the new `stages` and refreshed `progress`
    and `complete`, and **everything else in it is preserved** (a course's
    `chapters`, `sources`, `chats`, `last_opened_at`, `archived`). A failure is
    `-32000`, `retryable: false`, `data: {kind: "stage", goalId, message}`, and
    the previous bytes stay in place.
  - `curriculum.md` is rewritten in the same call, atomically, so the readable
    mirror always matches `meta.json` (`docs/data-model.md` §5.2). A mirror
    write failure is reported once and a retry rewrites both.
  - The reply is the stored curriculum in order, as
    `{id, title, status, milestone?}` rows (the same projection `skill.open`
    carries; `milestone` is omitted when empty). The shell replaces its copy from
    this reply and does not re-read the file.
- `skill.archive` `{goalId}` → `{action: "archive", backend: "folder" | "github"}`.
  **Destructive:** the shell confirms first, naming the goal and saying the live
  folder is archived. The backend is **configuration**, resolved exactly as
  `session.archive` and `archive.list` do (`settings.get` reports
  `archiveBackend`/`archiveFolder`); there is no backend parameter and no undo.

  An unusable backend — `archive` with an empty `archiveFolder`, a GitHub backend
  this build cannot build, an unconfigured repo or a missing keychain token — is
  one `-32000`, `retryable: false`, `data: {kind: "archive", id, message}`
  naming Settings, refused **before the goal is read**; nothing is moved or
  deleted. The goal is archived to `<archive.folder>/skills/goal/<id>/`, with its
  `meta.json`, `curriculum.md`/`chapters/` and `sources/`; **chat history
  (`chats/`) is never carried**. The live folder is removed only after the
  archived copy lands. A failure after that attempt (an occupied destination, a
  storage error) is `-32000`, `retryable: false`,
  `data: {kind: "skill-action", id, action: "archive", message}`, and the live
  folder is left exactly as it was. The reply repeats which backend was used.
- `skill.remove` `{goalId}` → `{action: "delete"}`. **Destructive:** the shell
  confirms first. Deletes the live goal folder only — its `meta.json`, chapters,
  sources and chats. No archive copy, note, Work project or export is touched, so
  an archived copy of the same id still restores later. A missing goal is the
  shared `skill` shape; a delete that fails after the attempt is `-32000`,
  `retryable: false`, `data: {kind: "skill-action", id, action: "delete",
  message}`.
- `skill.export` `{goalId}` → `{action: "export", path}`. Writes one deterministic
  zip to **this workspace's** `exports/goal-<id>.zip` (chat history excluded) and
  returns that path. There is no destination parameter: the shell cannot point an
  export at a path the core does not own, and a path outside `exports/` is
  refused rather than returned. Export is additive — the live goal and the user's
  original files are untouched — so it is safe to repeat. A failure is
  `-32000`, `retryable: false`, `data: {kind: "skill-action", id, action:
  "export", message}`.

`skill.lesson.*` builds and reads one **staged lesson** of a skill goal
(`docs/product.md` §7.2–§7.3). A goal's `meta.json` lists `stages`; each stage
owns one lesson file at `skills/goals/<goalId>/lessons/NN-<slug>.md`, where the
number is the stage's 1-based position in the curriculum. Both methods name the
goal by folder id and the stage by its stored id — never a path.

- `skill.lesson.build` `{goalId, stageId, includeSolution?, confirmed?}` →
  `{path, markdown, status, citations}`.

  ```json
  {"path":"lessons/02-control-flow.md","markdown":"---\nstage: stage-2\n…","status":"draft","citations":[{"name":"intel.md","location":"sources/sha256-…-intel.md","excerpt":"Registers hold working state across calls."}]}
  ```

  `goalId` and `stageId` are required non-empty strings; a missing or blank one
  is `-32602`. `includeSolution` is optional and must be a boolean; `true` adds a
  `## Solution` section after the checkpoint, `false` or an omitted value never
  writes one.

  The build is **one model call and is never retried**. The prompt carries the
  goal name, the stage title, every citable source name and its saved excerpt,
  and asks for JSON only:
  `{"exercise":["..."],"hints":["..."],"checkpoint":["..."],"solution":["..."]}`.
  Every paragraph must either cite one of the goal's source names as
  `[src: <source name>]` or start with `(agent explanation)`. `exercise`, `hints`
  and `checkpoint` are required and non-empty; `solution` is optional. A reply
  that is not JSON, misses a required array or contains an empty paragraph is
  **one** typed `lesson` failure and writes nothing.

  Only a source with a saved excerpt can be cited. A goal with no such source is
  refused **before** the model is called with the message
  `this goal has no source this lesson can cite`; a source marked unusable or
  without an excerpt is never offered to the model, and a `[src: name]` naming
  anything else is rejected by the service. Plugin output and the model's own
  prose are never sources: an unsourced claim is labelled `(agent explanation)`
  or it is not written.

  The reply is the whole document plus its provenance: `path` is the
  **goal-relative** lesson file (`lessons/NN-<slug>.md`), never an absolute
  path; `markdown` is the file's own bytes (`---` frontmatter with `stage`,
  `sources` and `status`, then `# <stage title>` and the generated sections);
  `status` is `draft` or `ready`; and `citations` is the resolved
  `{name, location, excerpt}` list the frontmatter cites. The shell replaces its
  rendered copy from `markdown` and does not re-read the file.

  The service writes atomically — a temp file beside the destination is written,
  synced and renamed, and only the generated block between its markers is
  replaced, so a rebuild never eats the learner's own paragraphs. A build with no
  existing file writes `draft`; a `ready` lesson is never replaced silently: the
  service returns the `confirm` shape and the shell asks (see below). A failure —
  an unreadable source, a refused citation, a storage error — leaves the previous
  lesson byte-identical and no temp file behind.

  Failure shapes, all `-32000`, `retryable: false`, and never retried:

  - an unknown, missing or unreadable goal is the shared skill shape
    `data: {kind: "skill", id: goalId, message}`;
  - an unknown stage is `data: {kind: "stage", goalId, stageId, message}`;
  - a build with no model configured is
    `data: {kind: "generation", id: goalId, message: "link a model in Settings → Providers"}`,
    and a provider failure on the one call is the same `generation` shape with
    the failure policy's one sentence;
  - a malformed reply, a goal with no citable source, a refused citation and a
    storage error are `data: {kind: "lesson", goalId, stageId, message}`;
  - an existing `ready` lesson is `data: {kind: "confirm", goalId, stageId, status: "ready", message}`.
    `status` repeats the lesson's current status and `message` is the service's
    own sentence. The shell must ask the user before replacing it; the core
    never assumes consent.

  An existing `ready` lesson is **not** replaced silently: without
  `confirmed: true` the reply is `-32000`, `retryable: false`,
  `data: {kind: "confirm", goalId, stageId, status: "ready", message}` and the
  file is untouched. The shell asks by name and re-sends the same request with
  `confirmed: true`; a non-boolean `confirmed` is `-32602`.

  The shell may offer a retry (a new `skill.lesson.build` request after the user
  acts), never an automatic one. Nothing here archives, deletes, sends a chat
  turn or writes an output.

- `skill.lesson.read` `{goalId, stageId}` → `{markdown, exists}`. This is the
  lesson reader's read half and never generates.

  ```json
  {"markdown":"---\nstage: stage-2\n…","exists":true}
  ```

  The file is derived from the goal and the stage with the same
  `lessonFileName(position, title)` rule the build uses, so read and build
  cannot disagree. `markdown` is the file's own UTF-8 bytes and the shell renders
  it directly. A stage with no lesson yet is a **success**:
  `{"markdown":"","exists":false}` — the reader's empty state with a next action
  (`skill.lesson.build`), not an error. An unknown goal is the shared skill shape
  and an unknown stage is the stage shape, exactly as for the build; an
  unreadable file that is not simply missing is one
  `data: {kind: "lesson", goalId, stageId, message}`. Nothing on this path
  writes, generates or marks a stage done.

`skill.sources.*` is a goal's gathered material — the only material a goal chat
may cite as a source (`docs/product.md` §7.3). A **skill source is a copy the
workspace owns**, so no absolute original path and no credential crosses the
wire, and the wall is the goal folder: a source can only be a file inside
`skills/goals/<id>/sources/`. Both methods name the goal by folder id, never by
path.

- `skill.sources.list` `{goalId}` → `{sources: SkillSourceRow[]}`:

  ```json
  {"sources":[{"name":"lecture-4.md","storedPath":"sources/sha256-…-lecture-4.md","kind":"markdown","hash":"sha256:…","excerpt":"Boundary conditions set the limits.","excerptLocation":"sources/sha256-…-lecture-4.md"}]}
  ```

  A row is exactly `{name, storedPath, kind, hash, excerpt, excerptLocation}`, so
  the shell renders citations without re-reading a file. `storedPath` is relative
  to the goal folder and always inside `sources/`; the shell never joins it
  against a path of its own. `excerpt` is the saved excerpt text and
  `excerptLocation` the place it was taken from (the copied file); both are
  `null` when the source has no usable excerpt. Rows are sorted by `name` (then
  `storedPath`), so the same set lists the same way.

  A goal with nothing gathered yet is `{sources: []}` — an empty list with a
  next action, not an error. The read writes nothing.

  A blank or non-string `goalId` is `-32602`. An unknown, missing or unreadable
  goal is the same `-32000` skill shape as `skill.open`
  (`data: {kind: "skill", id, message}`, `retryable: false`). A goal that opens
  but whose `meta.json` has a malformed `sources` list is one `-32000`,
  `retryable: false`, `data: {kind: "source", goalId, message}`, and no partial
  list is returned.

- `skill.sources.add` `{goalId, files}` → `{added, skipped}`. `files` is a
  non-empty array of non-empty strings: **absolute paths the user picked**, never
  destinations. The core copies each file into that goal's `sources/`, extracts
  its text, builds the saved excerpt and records the entry in `meta.json` in one
  service call, so the shell cannot name a write target. Identical bytes are
  stored once, so a repeat add counts the file in `skipped` and adds no row. The
  originals are never moved or deleted.

  ```json
  {"added":2,"skipped":0}
  ```

  `added` and `skipped` are counts, not names: `added` files gained a row,
  `skipped` files were already present. `hash`, `excerpt`, `retrievedAt` and
  `origin` are the core's own values; the shell supplies none of them.

  A missing, empty or non-array `files`, or an entry that is not a non-empty
  string, is `-32602` naming the field, and nothing is written. An unknown goal
  is the `skill` shape above. Every later failure — a path that is missing, not a
  regular file, over the source cap, on the school side of the wall, or a copy
  that cannot be recorded — is **one** `-32000`, `retryable: false`, with
  `data: {kind: "source", goalId, message}`, and the batch leaves **no partial
  row**: the service removes the copies it wrote before reporting.

  This packet gathers **local files only**. No URL or already-fetched text is
  accepted and neither method makes a network request; a web source and an
  agent-gathered import are later packets (the stored record already carries an
  `origin` for them). Facts in a goal chat come from these sources or are
  labelled `(agent explanation)`; plugin output is labelled external explanation
  and never counts as a source.

`skill.chat.*` is goal-scoped chat (T-021). A goal has several chats
(`skills/goals/<id>/chats/chat-<n>.jsonl`), so every method names the goal and
the chat, and every event echoes both ids back.

- `skill.chat.list` `{goalId}` → `{chats: SkillChatRow[]}`:

  ```json
  {"chats":[{"id":"chat-1","title":"Where do I start?","lastUsed":"2026-11-01T09:05:06Z","messages":2}]}
  ```

  `title` is the first user message clipped to 60 characters (the id when the
  chat is empty), `lastUsed` is the last record's instant (empty for an empty
  chat) and `messages` is the record count. This is the same row `skill.open`
  carries, so the manager and the goal page cannot disagree.

- `skill.chat.open` `{goalId, chatId?}` → `{chatId, snapshot}`. An omitted
  `chatId` resumes the newest existing chat, or starts the next `chat-<n>.jsonl`
  (registered in the goal's `meta.json`) when the goal has none. An explicit id
  must already exist: a well-formed id with no chat is refused — it never
  quietly opens or creates a different transcript — and a non-string or blank
  value is `-32602`. **Opening never creates a second chat while one exists**:
  creation is explicit (`skill.chat.create`), because a user with one chat open
  would otherwise never get past `chat-1`.

  ```json
  {"chatId":"chat-2","snapshot":{"status":"idle","model":null,"streamed":"","messages":[{"id":"history-0","role":"user","text":"…","outcome":"done"}],"blocked":null,"error":null,"usage":{"tokens":0,"costMicroUsd":null,"durationMs":null}}}
  ```

  `snapshot` is the standard `ChatSnapshot`, loaded once here, so the shell does
  not read the file itself. With no model configured it is an idle snapshot with
  `model: null` — never an error and never a crash.

- `skill.chat.create` `{goalId}` → `{chatId, snapshot}`. Starts one **new**
  chat, always. The core asks the same chat service `open` uses when it starts a
  chat, so the next id (`chat-<n+1>`) is written as an empty
  `chats/<chatId>.jsonl` and registered in the goal's `meta.json` in one
  operation; an existing id is never reused or overwritten, and two calls in a
  row are `chat-2`, `chat-3` when `chat-1` already exists.

  ```json
  {"chatId":"chat-3","snapshot":{"status":"idle","model":null,"streamed":"","messages":[],"blocked":null,"error":null,"usage":{"tokens":0,"costMicroUsd":null,"durationMs":null}}}
  ```

  `chatId` is the new chat and `snapshot` is the same `ChatSnapshot` `open`
  returns, built by the same lazy controller (history at `chats/<chatId>.jsonl`,
  `skillTools` context and read-only tools), so `skill.chat.send` works on it
  immediately. The new chat appears in `skill.chat.list` and survives a settings
  patch that changes the model: only the controller cache is dropped, and the
  transcript and `meta.json` entry stay on disk. A settings patch never removes
  a chat.

  A blank or non-string `goalId` is `-32602`. An unknown goal is the shared
  `skill` shape (`-32000`, `retryable: false`,
  `data: {kind: "skill", id, message}`). A failure while registering the chat —
  the folder cannot be read, the empty transcript cannot be written, or
  `meta.json` cannot be updated — is one `-32000`, `retryable: false`, with
  `data: {kind: "chat", goalId, message}`, and no chat id is returned or reused.
  There is no automatic retry; the shell sends a new request after the user acts.

- `skill.chat.send` `{goalId, chatId, text}` → `{turnId: "<goalId>:<chatId>"}`
  (one active turn per chat). `text` is required and non-empty and `chatId` is
  required; a blank value is `-32602`. The chat must exist on disk, otherwise
  the reply is the `chat` error shape and nothing is sent. The request returns as
  soon as the turn is claimed; the state events are authoritative and the shell
  never appends a local message.

  - `skill.chat.state` — `{goalId, chatId, ...ChatSnapshot}`, coalesced at
    ~33 ms.
  - `skill.chat.done` — `{goalId, chatId, ...SendOutcome}` (`kind`, `reason`,
    `fix`, or `requestId`/`outcome`).
  - `skill.chat.error` — `{goalId, chatId, message}`; one message, no retry.

- `skill.chat.cancel` `{goalId, chatId}` → `{ok: true}`. A chat with nothing in
  flight is a no-op and builds no controller. A missing `chatId` is `-32602`.

A goal chat is **source-bound and read-only**. The transcript is the goal's own
`chats/<id>.jsonl`, scoped by `ui.chill_history_limit`; the context and tools
are `skillTools(workspace, goalId)`, bound to that goal's gathered `sources/`
with `list_sources`, `read_source` and `search_sources` only. Nothing on this
path writes a lesson, an output, a source, a meta field other than the chat
registration, or an archive. Facts must come from the gathered sources or be
labelled `(agent explanation)` (`docs/product.md` §7.3); plugin output, when
present, is labelled external explanation, never a source. A `settings.patch`
that touches `models` drops every skill chat controller, so the next
`open`/`send` is built with the saved model; an unrelated settings patch leaves
an open chat alone.

Error shapes, all `-32000` with `retryable: false`:

- an unknown, missing or corrupt goal is the `skill` shape `skill.open` uses:
  `data: {kind: "skill", id, message}`. A goal folder with no readable course
  index (a non-course goal) is refused the same way: this surface chats about a
  course, and `skill.list` still shows the folder;
- a chat that does not exist is `data: {kind: "chat", goalId, chatId, message}`.

`review.queue` is the read-only **Review** surface (`docs/product.md` §6.1). It
reports what the workspace already records — unchecked lock-in steps, missed
flashcards, unfinished skill stages, promoted mistakes whose correction is still
missing, session memory, and Work tasks that are done but not verified — and
nothing else.

- `review.queue` `{side?}` → `{queue: ReviewQueueResult}`. `side` is optional and
  one of `all`, `school`, `skills`, `work` (`all` when absent); any other value
  is `-32602` naming the accepted set, and the app is never booted for it.

  ```json
  {"queue":{"items":[{"id":"step:2026-11-01-0900-physics-unit-4:1","kind":"step","label":"Derive the energy balance","context":"Physics — Unit 4","contextId":"2026-11-01-0900-physics-unit-4","reason":"unchecked","priority":1,"count":0,"origin":"steps"}],"nudge":{"intensity":"balanced","threshold":3,"due":[],"suggestions":[]},"coverage":[{"sessionId":"2026-11-01-0900-physics-unit-4","name":"Physics — Unit 4","report":{"sources":[{"hash":"sha256:…","name":"lecture-4.md","originalPath":"/home/me/input/lecture-4.md","count":2,"documents":["steps"],"firstLine":"Read lecture-4.md and summarise the limits","referenced":true,"fromMemoryOnly":false}],"unreferenced":[],"total":1,"referencedCount":1}}],"counts":{"total":1,"byKind":{"step":1,"card":0,"stage":0,"mistake":0,"memory":0,"task":0}},"diagnostics":[],"intensity":"balanced"}}
  ```

  `items` keep the domain order (missed cards, then steps, then stages, then
  uncorrected mistakes, then memory history, then unverified Work tasks) and
  every item carries its `kind`, `reason`, `origin` and `count` (recorded
  misses). `nudge` is the suggestion state for the configured
  intensity, `counts` is the per-kind total, and `intensity` repeats the setting
  the queue was built with.

  `coverage` is the read-only **source coverage** of each readable school
  session, one entry per session (`docs/product.md` §4.3, §6.1):

  ```json
  {"sessionId":"2026-11-01-0900-physics-unit-4","name":"Physics — Unit 4","report":{"sources":[],"unreferenced":[],"total":0,"referencedCount":0}}
  ```

  `sessionId` is the folder name (never a path), `name` is the session's display
  name, and `report` is exactly the `CoverageReport` `session.coverage` returns
  for that session — same sources, document kinds, gaps and counts, because both
  are `computeCoverage` over the same `loadSessionHome` read. Derived, never
  stored: nothing is written, no model is called and no network is contacted.

  - A session with sources but no remaining review items still has an entry, so
    `coverage` can be non-empty while `items` is empty. A session with no
    sources has the valid empty report above.
  - A folder the queue reports as a broken diagnostic contributes **no** entry;
    it stays a diagnostic, never a request failure.
  - `side: "skills"` and `side: "work"` carry `"coverage":[]` — coverage is
    school-side material, and neither projection may leak across the wall.
    `all` and `school` carry the reports.
  - Memory is a document here, never a source: a source mentioned only in
    `memory.md` is still `referenced` but keeps `fromMemoryOnly: true`.

  `side` projects one side of the wall: `school` keeps steps, flashcards,
  promoted mistakes and session memory; `skills` keeps curriculum stages; `work`
  keeps the done-but-unverified swarm tasks. `counts` and the nudge ids are
  recomputed from what survives. `side: "all"` (or no `side`) returns the whole
  queue, learning items before Work. The service reads the learning sides in one
  pass, so the filter is a projection of that result, not a second read.

  Two kinds are newer and worth naming:

  | kind | id | enters when |
  |---|---|---|
  | `mistake` | `mistake:<sessionId>:<premiseIndex>` | a promoted note (`origin: session-mistake`) still has `status: open` |
  | `task` | `task:<projectId>:<runId>:<taskId>` | a swarm task is `status: "done"` and `verified: false` |

  - A **mistake** row is the learner's own promoted note, never a source. Its
    `label` is the note title, `context` the session name, `reason`
    `"uncorrected"`, `origin` `"session-mistake"`, and `count` the note's stored
    `misses`. A note with `status: corrected` or `status: reviewed` never enters.
  - A **task** row is derived from the run's **report**, with the live board
    taking precedence for a run this process still knows. A core restart forgets
    every board, but the report keeps the task ids and statuses, so a done,
    unverified task is still listed after a restart. `reason` is `"unverified"`,
    `origin` `"swarm"` and `count` is `0`. Work tasks sort after memory, so the
    learning queue keeps its shape under `all`. A report that cannot be read is
    skipped, exactly like a broken session.

- `diagnostics` are **not** request failures. A session or goal folder whose
  metadata cannot be read becomes one entry `{kind: "review", path, message,
  next}` and is skipped, so one broken folder never hides the rest of the queue.
  The shell prints the entry and offers the stated next action.

`review.mark` is the write half of that surface: it records the learner's
verdict for one item and returns the rebuilt queue.

- `review.mark` `{itemId, result}` → `{queue: ReviewQueueResult}`. `itemId` is
  the exact `id` from `review.queue`; `result` is `known` or `missed`. A blank
  or non-string `itemId`, an unknown `result`, a malformed id or an unknown kind
  is `-32602` naming the accepted shape or set, and the app is never booted for
  it.

  | id | `known` | `missed` |
  |---|---|---|
  | `step:<sessionId>:<index>` | check the step through the same service the steps reader uses; an already-checked step is a no-op success | append one `{"event":"review","index":N,"result":"missed","at":ISO}` line to the session's `progress.jsonl`; the Markdown is untouched |
  | `card:<sessionId>:<card-N>` | set `K: yes` / `M: no` on that card | set `M: yes` / `K: no` on that card |
  | `stage:<goalId>:<stageId>` | complete the stage through the curriculum transition; the next pending stage is promoted | no-op success: there is no stage miss store yet, so nothing is written and the stage nudge is not persisted |
  | `mistake:<sessionId>:<index>` | set the promoted note's frontmatter `status: reviewed` (and `reviewed_at`); the note and its body stay, so it leaves the queue without claiming a correction | increment `misses` and set `last_missed`; the note stays `open` and stays in the queue |
  | `task:<projectId>:<runId>:<taskId>` | verify the task: with a live board `work.swarm.verify` flips it, and after a restart the report's line is rewritten in place; either way the activity log records the decision | refused: a completed task has no miss signal |
  | `memory:<sessionId>:<noteId>` | refused | refused |

  Steps and cards live on the school side and are resolved by session folder id
  (never a path). A card is read from and written to
  `<workspace>/school/outputs/<sessionId>/flashcards.md`: the whole deck is
  re-rendered from its parsed cards and atomically replaced (temp + fsync +
  rename), so the file and the reply agree and no temp file survives. A stage is
  resolved by goal folder id and writes that goal's `meta.json`.

  ```json
  {"queue":{"items":[],"nudge":{"intensity":"balanced","threshold":3,"due":[],"suggestions":[]},"coverage":[],"counts":{"total":0,"byKind":{"step":0,"card":0,"stage":0,"mistake":0,"memory":0,"task":0}},"diagnostics":[],"intensity":"balanced"}}
  ```

  The reply is the **whole queue after the mark**, coverage included, so the
  shell replaces its snapshot and never patches it locally or asks for
  `review.queue` again.

- **Session memory is read-only.** It is labelled history, not a source and not
  a reviewable item: marking one is `-32000`, `retryable: false`, with
  `data: {kind: "review", itemId, message}` and a message saying it is
  read-only.

- Every other refusal is the same `-32000`, `retryable: false`,
  `data: {kind: "review", itemId, message}` shape: an unknown session, a
  session with no steps or no deck, an out-of-range step index or card, an
  unknown goal or stage, and a failed write. The message is one line the shell
  can show, and the previous file bytes are left exactly as they were. Nothing
  is retried automatically; the shell makes a new request after the user acts.

`review.queue` itself remains read-only and nothing on its path writes. A
failure of the service itself (an unexpected read error) is one `-32000` with
`retryable: false` and `data: {kind: "review", message}`; it is never retried
automatically.

The exact shapes are defined by the TS types in `src/server/` and mirrored in
Dart `desktop/lib/bridge/`. A shape change is a protocol change and needs a test.

### Knowledge base

`knowledge.search`, `knowledge.tree` and `knowledge.read` are the read-only
**Knowledge** surface
(`docs/product.md` §6.3). They read Markdown, session metadata, copied sources
and the local archive index; they never write a note, rebuild the search index,
call a model or contact the network. Both sides of the wall are labelled on
every row, and a broken folder contributes no row rather than failing the
request.

- `knowledge.search` `{query, scope?}` → `{hits: KnowledgeHit[]}`.

  ```json
  {"hits":[{"id":"note:school:school/vault/concepts/boundary.md","kind":"note","title":"Boundary conditions","excerpt":"…","side":"school","path":"school/vault/concepts/boundary.md","updated":"2026-11-01T10:00:00.000Z","score":3}]}
  ```

  - `query` is required and non-empty; it is trimmed. A blank or non-string
    value is `-32602` and never boots the app.
  - `scope` is optional: `all` (default), `school`, `skills` or `work`. Anything
    else is `-32602` naming the accepted set. The scope is a **projection over
    one read**, never a second pass: `school` returns only school-side rows,
    `skills` only skills-side rows and `work` only project rows. A cross-wall row
    cannot appear because each row is labelled when it is built.
  - A hit is exactly
    `{id, kind, title, excerpt, side, path, updated, score}`. `kind` is one of
    `note · memory · source · session · goal · project · archive`; `side` is
    `school`, `skills` or `work`; `path` is **relative to the workspace root**
    (never absolute, never content); `updated` is ISO-8601 or `""`; and `score`
    is `3` (title/name prefix), `2` (whole-word match) or `1` (body substring).
  - Ranking is deterministic and lexical: `score` descending, then the most
    recently updated, then path, then id. At most **50** hits are returned.
  - `excerpt` is one line, capped at 160 characters, with the match in context.
  - Sources are: school and skills vault Markdown notes (`note`), session
    `memory.md` points (`memory`), session copied sources with their extracted
    text (`source`), session `meta.json` (`session`), goal `meta.json` (`goal`),
    project `meta.json` (`project`) and the local
    `archive-index/<side>.json` rows (`archive`).
  - Session memory is **history, not a source**: it has its own `memory` kind and
    is never counted as a `source` row. The activity log, lessons and other
    process history are never results.
  - The archive index is a **cache**: a missing or corrupt index contributes no
    `archive` hit, and deleting it cannot fail the search.
  - The vault notes are searched through the side's FTS index (with a literal
    substring supplement, so `gradient` still finds `subgradient`). The index is
    a cache: a missing index is not built by this read-only call, and a query no
    indexed note matches falls back to the Markdown so a stale cache cannot hide
    a new note. No Markdown is rewritten, no model is called and no network is
    contacted. A broken session, goal or project folder becomes no hit, never an
    error.
  - An empty workspace is `{hits: []}` — an empty state with a next action, not
    an error.

- `knowledge.tree` `{side?}` → `{groups: KnowledgeTopicGroup[]}`.

  ```json
  {"groups":[{"topic":"Physics","notes":[{"path":"school/vault/concepts/boundary.md","title":"Boundary conditions","updated":"2026-11-01T10:00:00.000Z"}]}]}
  ```

  - `side` is optional: `all` (default), `school` or `skills`. Anything else is
    `-32602` naming the accepted set.
  - The forest comes from each vault note's `topics` frontmatter: one group per
    **first-level** topic, with that group's notes sorted by full topic path then
    title. A note with no topics is grouped under `(no topic)`. A note appears
    under its primary (first) topic.
  - `path` is workspace-relative and `updated` is the note's frontmatter
    `updated`, or the file mtime when the note records none.
  - This reads the Markdown directly. It never opens or rebuilds `index.db`, and
    writes nothing.

- `knowledge.read` `{id}` → `{hit: KnowledgeHit, body, truncated}`. This is the
  reader's open action: it takes an id that `knowledge.search` produced (or a
  bare note `path` from `knowledge.tree`) and returns the item's content.

  ```json
  {"hit":{"id":"note:school:school/vault/concepts/boundary.md","kind":"note","title":"Boundary conditions","excerpt":"…","side":"school","path":"school/vault/concepts/boundary.md","updated":"2026-11-01T10:00:00.000Z","score":0},"body":"\n## Limits\n\nBoundary conditions set the integral limits.\n","truncated":false}
  ```

  - `id` is exactly a row id from `knowledge.search`
    (`note:<side>:<path>`, `memory:<sessionId>:<index>`,
    `source:<sessionId>:<hash>`, `session:<sessionId>`, `goal:<goalId>`,
    `project:<projectId>`, `archive:<side>:<entryId>`) or a bare
    `school/…`/`skills/…` note path from `knowledge.tree`. The scheme is one
    helper shared with the row builders, so a list row round-trips without a
    second lookup rule. A blank or non-string id is `-32602` and never boots.
  - **Readable kinds** are all seven: `note`, `memory`, `source`, `session`,
    `goal`, `project` and `archive`. Each body is content, shaped for a reader:
    - `note` — the Markdown body with the frontmatter stripped, unchanged
      otherwise;
    - `memory` — the session's points as a Markdown bullet list, with an
      `Updated:` line and the label "session memory — history, not a source";
    - `source` — the copied source's extracted text;
    - `session` / `goal` / `project` — a short Markdown summary rendered from
      `meta.json` (name, created/last-opened, source/stage or agent/task counts,
      archived flag), never the raw JSON;
    - `archive` — the local archive-index row rendered as Markdown.
  - **A body is content, not a citation.** Opening a `source` or a note says
    what the file says; it does not make that text a fact a chat may cite, and it
    never becomes a source row. `hit.side` is still the wall: a `school` item is
    school-side even when its text mentions skills material.
  - `hit` is the row's own projection: `path` stays workspace-relative, `side`,
    `kind`, `title` and `updated` are the same values the list row carries, and
    `score` is `0` because a read has no query (the shell keeps the score from the
    row it opened). No absolute path appears in the reply.
  - **Cap.** `body` is capped at 64 KiB (UTF-8 bytes), cut on a character
    boundary; `truncated: true` says the content continues. A body under the cap
    is `truncated: false` and byte-identical to the file.
  - **Confined.** A `note` id is confined to its own vault: an absolute path, a
    `..` segment, or a path that resolves into the other side is refused, and a
    session/source id is resolved through the session folder, never a path.
  - **Read-only.** Every file is opened for reading. Nothing is written, no
    index is rebuilt, no model is called and no network is contacted; the
    workspace is byte-identical afterwards.
  - Failures are all `-32000`, `retryable: false`, with
    `data: {kind: "knowledge", id, message}`: an unknown id names it, an
    escaping id is refused, and a missing or unreadable file is reported once.
    The shell shows the message and offers the list; it never retries.

### Teaching

`teach.state`, `teach.measure`, `teach.step` and `teach.check` are the learning
harness (`desktop/docs/redesign.md` §2.1). A session moves measure → plan →
teach → check → repair, and every reply is **structured data the shell renders**:
it never parses model prose to guess.

The record lives at `skills/goals/<id>/teaching.json` (atomic replace):

```json
{"schema":1,"state":{"schema":1,"goal":"…","prior":"…","measuredAt":"…","held":["…"],"gaps":["…"],"plan":[{"id":"step-1","title":"…","requires":[]},{"id":"step-2","title":"…","requires":["step-1"]}]},"current":{"stepId":"step-1","prose":"…","question":"…"},"checks":[{"stepId":"step-1","verdict":"correct","correction":"…","at":"…"}],"practice":{"problems":[{"id":"practice-1","prompt":"…","answer":"…"}],"attempts":[{"problemId":"practice-1","verdict":"solved","at":"…"}],"generatedAt":"…"}}
```

- `teach.state` `{goalId}` → `{record}` — the record, or `null` before a measure.
  Read-only.
- `teach.measure` `{goalId, prior?}` → `{record}` — one model call. The reply is
  validated: no held propositions, or fewer than three plan steps, is a refusal
  naming the count. `prior` defaults to the goal's `statement` + `level`.
- `teach.step` `{goalId, stepId?, again?}` → `{record, step, index, total}` —
  teaches the first step with no passing check, or the named step. `stepId` lets
  a learner choose between unlocked branches: it must name a step in the plan,
  a locked step is refused with the blocking titles, and a held step returns
  `step: null` without a model call (its check and correction are on the
  record). While a step is open the same record is returned (no model call)
  unless `again: true`. `step: null` when every step is passed. A step reply may
  carry `citations: [{name, quote}]`: each name must be
  one of the goal's copied sources with a saved excerpt, and each quote is the
  exact words that prove it (≤240 characters). An unknown name, or a citation
  when the goal has no sources, is a `{kind:"teaching"}` refusal — the step is
  not rewritten to drop it. No citations means the prose is the model's own
  explanation, labelled `agent explanation` in the UI and `grounded: "agent"` in
  the graph.
- `teach.check` `{goalId, answer, thinking?, confidence?}` → `{record, verdict,
  correction, passed, nextIndex, total}` — one verdict (`correct` | `partial` |
  `incorrect`) and one correction. `thinking` is the learner's own reasoning
  (≤ 2000 characters) and `confidence` a whole number 1–5; both are stored on
  the check record and included in the marking prompt as context, never as
  evidence that the answer is right. `correct` passes the step and clears the
  open one, so the next `teach.step` moves on; anything else keeps it open for a
  repair. A wrong type or out-of-range value is `-32602`.

A plan is a **map**, not a queue: each step carries `requires`, the ids of the
earlier steps it builds on (an omitted `requires` is read as a chain). The next
step is the first unpassed step whose prerequisites are all held, so a branch
becomes available as soon as its own root passed. A forward reference, a
self-reference or a non-integer index is a malformed plan and the measure is
refused rather than silently repaired.
- `teach.practice` `{goalId}` → `{record, problems}` — the fourth phase. One
  model call, no retry: 1–5 problems that state a situation and ask for an
  outcome, each with an `answer` that is a **criterion**, never a worked
  solution. The prompt forbids naming the idea, the lesson or the step, so the
  learner has to bring it to mind. Only steps that passed a check are practised:
  with nothing held the reply is one `{kind:"teaching"}` refusal,
  `teach a step and pass its check before practising`. The set is stored under
  `teaching.practice`; regenerating keeps attempts whose problem ids survive.
- `teach.practice.result` `{goalId, problemId, verdict}` → `{record, verdict,
  solved, missed, total}` — `solved` or `missed`, one attempt per problem (a
  second answer replaces the first rather than stacking), and the counts for the
  set. It never touches the step checks: practice is a different claim from "the
  step landed", and the two must not overwrite each other. An unknown problem id
  is one `{kind:"teaching"}` refusal naming it.

Limits are enforced by refusal, not truncation, in `src/domain/teaching.ts`:
goal ≤ 140 chars, held/gap items ≤ 120 (≤ 8 held, ≤ 4 gaps), 3–8 plan steps,
step titles ≤ 80, one step's prose ≤ 130 words, a check question ≤ 220, a
correction ≤ 320. Every prompt forbids preambles, headings, bullet lists and
method narration ("in this step", "we will").

Failures are `-32000`, `retryable: false`, never retried: `{kind:"teaching",
goalId, message}` for a refusal or a malformed reply, `{kind:"skill"}` for an
unknown goal, and `link a model in Settings → Providers` when no model is
configured. A malformed reply writes nothing.

### Side questions

One small, tool-free conversation per teaching step. It never enters the lesson
chat or changes the plan, and it is stored beside the goal at
`skills/goals/<id>/side/<stepId>.jsonl` (append-only).

- `teach.side.snapshot` `{goalId, stepId}` → `{messages}` — the thread, or `[]`.
  Read-only. `stepId` must be `step-<n>` and must exist in the plan.
- `teach.side.send` `{goalId, stepId, text}` → `{messages, reply}` — one model
  call, no retry. `text` is non-empty and ≤ 2000 characters. The exchange is
  appended **only after** the reply exists, so a failure leaves the thread
  unchanged. The prompt carries the step, its check and the thread so far, and
  asks for one or two sentences.
- `teach.side.clear` `{goalId, stepId}` → `{messages: []}`.

An unknown goal is the shared `{kind:"skill"}` error; a teaching refusal is
`{kind:"teaching", goalId, message}`, `-32000`, `retryable: false`.

### Flashcard schedule

The deck Markdown stays the truth for a card's content and its `M:`/`K:` lines;
a schedule beside it (`school/outputs/<id>/flashcards-schedule.json`) records
**when** to ask again. It is keyed by the card's question, so regenerating the
deck keeps the progress of a question that survived.

- `session.deck.state` `{id}` → `{due, total, cards:[{index, question, due,
  dueAt, intervalDays, ease, reps, lapses, lastGrade?}]}`. Read-only; a missing
  schedule means every card is due now.
- `session.deck.grade` `{id, index, grade}` → the same state after the write.
  `grade` is `again`, `hard`, `good` or `easy`; `index` is the 0-based deck
  index. One atomic write. `again` is a ten-minute step, a lapse and a lower
  ease; the other grades move the card out. The scheduler is pure and lives in
  `src/domain/scheduler.ts` (ease 1.3–3.0, interval ≤ 365 days).
- `session.deck.reset` `{id}` → the state with the schedule deleted, so every
  card is due again.

A session without a deck is one `{kind:"deck", id, message}` refusal naming
`build one first`; a bad grade or index is `-32602`.

### Context and compaction

`session.chat.context` is the conversation's meter, read-only:

```json
{"messages":12,"kept":8,"summaryChars":210,"through":4,"tokens":1840,
 "window":128000,"fraction":0.014,"compactable":true}
```

`tokens` is a four-characters-per-token estimate of the summary plus the kept
messages, never a provider call. `through` is how many transcript records the
stored summary covers; `compactable` is true when more than eight messages sit
before the keep window.

- `session.chat.compact` `{id}` → the same view plus `summary`. One model call,
  no retry, explicit only: the last eight messages are untouched and everything
  older becomes one ≤ 4000-character paragraph in `<session>/context.json`. The
  transcript (`chat.jsonl`) is **byte-identical** afterwards; compaction is a
  view used to build the next request. A failure or an empty summary writes
  nothing.
- `session.chat.uncompact` `{id}` → the view with the summary removed.

`session.chat.send` installs the stored plan on the controller; a summary read
failure falls back to the full history rather than failing the turn.

### Research

A background brief, grounded in pages the learner names. Every source is fetched
under the service's guards (HTTPS only, no credentials, no loopback/private
host, text content type, 8 s timeout, 20 000 characters) and the model must cite
at least one supplied source with `[n]`; an unsourced sentence is prefixed
`(agent explanation)`. A brief with no citation is refused and writes nothing.

- `research.start` `{goalId, question, urls}` → `{id, status:"running"}`. One
  to six URLs, all validated before any fetch. Returns immediately; the job
  emits `research.updated {goalId, id, status: "done"|"failed"|"cancelled",
  item?, message?}` when it settles.
- `research.list` `{goalId}` → `{items:[{id, question, created, sources}]}`,
  newest first. Read-only.
- `research.read` `{goalId, id}` → `{item, markdown}`. Read-only.
- `research.cancel` `{goalId, id}` → `{cancelled}`. The fetch or model call is
  not aborted; its result is discarded.

Files live at `skills/goals/<id>/research/<id>.md` and `<id>.json`. Research is
not a source: it never enters `sources`, coverage or the lesson plan.

### Figures

Crop a diagram out of the session's own copied PDF. The core confines the source
to `sources/`, renders with `pdftoppm` (argv, no shell), requires a PNG, and caps
the image at 8 MB. A machine without poppler gets one actionable
`{kind:"figure"}` refusal.

- `session.figure.extract` `{id, page, source?, x?, y?, width?, height?, dpi?,
  caption?, note?}` → `{figure}`. `page` is 1–500; a crop is all four of x/y/
  width/height (otherwise `-32602`); `dpi` is 72–200 (default 110). `source` is
  a copied PDF's stored path; omitted, the instructions PDF or the first PDF
  source is used.
- `session.figure.list` `{id}` → `{figures}`.
- `session.figure.read` `{id, figureId}` → `{figure, base64, mediaType:
  "image/png"}` for the shell's `Image.memory`.
- `session.figure.annotate` `{id, figureId, caption?, note?}` → `{figure}`.
- `session.figure.remove` `{id, figureId}` → `{removed}`.

Metadata lives in `<session>/figures/index.json`; images are
`<session>/figures/figure-<n>.png`. A figure is not a source and does not enter
coverage.

### Updates

- `update.info` → `{current, repo}`. Offline; answers before a workspace boots.
- `update.check` → `{current, kind: "available"|"current"|"unavailable",
  version?, latest?, asset?, url?, message?}`. One explicit request to the
  public release feed, no retry and no automatic download. `url` is the release
  page, not an artifact: the desktop shell opens or copies it, and never replaces
  its own bundle. A failed check is one `{kind:"update"}` refusal.

### Themes

`theme.custom.get` / `theme.custom.set` store the twelve token overrides. The
overrides are a **layer** over whichever base palette is selected, so a panel
colour set over Crimson survives switching the base to Codex. `theme.custom.set`
replaces the whole map (an omitted token is cleared), and the shell exports /
imports the same shape as JSON (`{name, base, tokens}`); an unknown token, a
value that is not `#RRGGBB` or an unknown base is refused by name.

### Learning graph

`knowledge.graph` derives a read-only graph from the artifacts already on disk;
it takes no parameters and writes nothing.

```json
{"graph":{"nodes":[{"id":"goal:read-disassembly","kind":"goal","label":"Read disassembly","detail":"goal","side":"skills","context":"Read disassembly","grounded":"record"}],"edges":[{"from":"source:read-disassembly:sha256:…","to":"goal:read-disassembly","kind":"bound-to"}],"counts":{"goal":1,"step":4,"source":2,"session":3,"task":11,"card":8,"research":1,"figure":2},"diagnostics":[],"truncated":false}}
```

- Node kinds are `goal`, `step`, `source`, `session`, `task`, `card`,
  `research`, `figure`; edges are `contains`, `bound-to`, `cites`, `tests`,
  `answers`, `cropped-from`. `grounded` is `source` (a copied source), `agent`
  (the model's explanation, e.g. a teaching step with no citation) or `record`
  (session/task/card/… state).
- The derivation is exactly the files the rest of the core reads: goal `meta.json`
  and `teaching.json`, the copied `sources/`, session metadata and
  `assignment-steps.md`, `flashcards.md`, `figures/index.json`, and the
  `research/*.json` sidecars. A folder that cannot be read becomes a
  `diagnostics` line and is skipped; it never fails the request. The node cap is
  2 000 (`truncated: true` past it), and two reads of an unchanged workspace are
  byte-identical.
- This is not an extraction pipeline: no model call, no invented proposition.
  Deleting it loses nothing, and a source that is removed from a goal removes
  its node on the next read.
- The Knowledge surface opens it with `g`, groups rows by kind and expands one
  row's relations with `Enter`. **Research and figures are not sources**: they
  are nodes in their own right and never enter coverage.

### Prompt notes

`prompts.list` / `prompts.set` store one standing note per generator. A note is
**guidance**, not a replacement for a prompt: it is appended below the shape,
the length limits and the safety rules, and the parser still refuses a reply
that breaks them.

```json
→ {"jsonrpc":"2.0","id":11,"method":"prompts.set","params":{"id":"measure","text":"prefer short sentences"}}
← {"jsonrpc":"2.0","id":11,"result":{"items":[{"id":"measure","label":"measure and plan","description":"…","note":"prefer short sentences","custom":true}]}}
```

- Ids are `measure`, `step`, `check`, `practice`, `side`, `research` and
  `compact`. An unknown id, a non-string text or a note over 2 000 characters is
  `-32602`; nothing is written. An omitted `text` (or an empty string) clears the
  note.
- The note is stored under `[prompts]` in `config.toml`; `settings.patch`
  refuses a `prompts` key so the generic patch cannot bypass the id and length
  checks. A build with no config writer is `-32601`.
- The reply is the whole catalogue after the write, so the shell replaces its
  snapshot from this one message. No change event is emitted.
- A note cannot add a source, change the JSON shape, raise a length limit or
  alter a write/approval rule. A malformed reply is still one refusal.

### Keybinds

`keybinds.get` / `keybinds.set` are the **storage half** of the rebindable
keymap registry: they read and write the two stored tables and nothing else.

```json
→ {"jsonrpc":"2.0","id":11,"method":"keybinds.get"}
← {"jsonrpc":"2.0","id":11,"result":{"keybinds":{"navigator":"space+e"},"fixedKeybinds":{"quit":"ctrl+q"}}}
```

- `keybinds.get` → `{keybinds, fixedKeybinds}`, read from `ui.keybinds` and
  `ui.fixed_keybinds` in `config.toml` (`docs/data-model.md` §2). An absent or
  empty table is `{}`. **The core invents no defaults**: the default action
  catalogue is the UI registry's, so a fresh workspace reads `{}` and the shell
  fills in every action row it wants to show. An entry whose value is an empty
  string is a cleared override and is omitted from the reply.

- `keybinds.set` `{action, binding?, fixed?}` → the full
  `{keybinds, fixedKeybinds}` **after** the write, i.e. what the config now
  stores, not an echo of the request. Nothing else changes: no chat turn, no
  session, no provider call.

  - `action` is the **stable action id** (`navigator`, `work-swarms`,
    `add-sources`). The core does not validate it against a catalogue — that
    catalogue belongs to the UI — but it must be a non-empty string; a blank or
    non-string action is `-32602` and never boots the app.
  - `binding` is the documented string form: `space+e` (leader), one printable
    character (`?`, `:`, `/`, `i`, `0`), a named key (`escape`, `enter`, `tab`,
    `space`), or `ctrl+<character>` (`ctrl+q`). It is stored lowercase and
    trimmed, so two spellings of one chord cannot be saved twice. `null` (or an
    omitted `binding`) **clears** that action back to its default. Any other
    form — `ctrl+shift+k`, `space+`, `space+escape`, `f6`, `banana` — is
    `-32602`, the message names the accepted forms, and nothing is written.
  - `fixed` is optional and selects the table: `false` or absent is
    `ui.keybinds` (leader and direct chords, `navigator = "space+e"`); `true` is
    `ui.fixed_keybinds` (mode and navigation keys, `quit = "ctrl+q"`). With no
    `fixed` flag, an action already overridden in `fixed_keybinds` keeps its
    place rather than moving tables on a rename. A non-boolean is `-32602`.
  - **Duplicates are refused across both tables.** If another action already
    holds that binding, the reply is `-32000`, `retryable: false`, with

    ```json
    {"code":-32000,"message":"Space x is already bound to work-swarms.","data":{"kind":"keybind","action":"navigator","binding":"space+x","conflict":"work-swarms","message":"Space x is already bound to work-swarms."},"retryable":false}
    ```

    `conflict` is the other action's id, and the message is
    `<binding as a person reads it> is already bound to <conflict>.` — `Space x`,
    `Esc`, `Enter`, `Tab`, `Space`, `Ctrl+Q`, or the character itself
    (`Esc is already bound to escape.`, `Ctrl+Q is already bound to quit.`). The
    comparison is on the normalised form, so `Ctrl+Q` collides with `ctrl+q`.
    Nothing is written and `keybinds.get` is unchanged.
  - Clearing an action that has no override is a success that writes nothing at
    all. A move between tables is a clear of the old entry plus the set.
  - A build with no config writer is `-32601`, `retryable: false`
    (`Keybinding editing is not available in this build`). A failed write is
    `-32000`, `retryable: false`, with `data: {kind: "keybind", action, message}`,
    and the previous tables are untouched. Neither is retried.

  A clear is stored as an empty binding (`navigator = ""`) rather than by
  deleting the key, because a config patch merges tables; every reader treats an
  empty binding as "no override", so a reset survives a restart and the TUI's
  own parser rejects it while keeping its default.

- The reply is the stored tables, so the shell replaces its snapshot from this
  one message and never re-derives what it asked for. `keybinds.set` emits no
  change event and does not touch chat, sessions, sources or plugins; the
  in-process cache is refreshed from the config write, so `keybinds.get`
  immediately reports the new keys. The display catalogue is
  `desktop/lib/keymap/registry.dart` and the editor is the KEYBINDS group in
  Settings.

### Custom palette

`theme.custom.get` / `theme.custom.set` are the storage half of the **custom
palette** (`docs/product.md` §12 Themes, `docs/data-model.md` §2
`[ui.custom_theme]`). The **shell owns the catalogue**: the twelve token names,
crimson and every other built-in palette, and the per-token fallback. The core
only **stores and validates** the overrides, so it never invents a colour and an
empty map is a complete answer.

```json
→ {"jsonrpc":"2.0","id":12,"method":"theme.custom.get"}
← {"jsonrpc":"2.0","id":12,"result":{"tokens":{"background":"#101820"}}}
```

- `theme.custom.get` → `{tokens}`, read from `ui.custom_theme` in
  `config.toml`. An absent table, or one holding no overrides, is `{}`. An entry
  whose value is empty is a cleared override (the same sentinel `ui.keybinds`
  uses) and is omitted, so a reset reads back as absent. This is a read: it
  writes nothing, invents no default and boots no new state.
- `theme.custom.set` `{tokens}` → `{tokens}` **after** the write, i.e. what the
  config now stores, not an echo of the request. The map is a **replacement**:
  a token the request omits is cleared, which is what "reset one token" means in
  the editor, and `{}` clears the palette. Nothing else changes: no chat turn,
  no session, no output, no provider call.

  - `tokens` must be an object. Each key is exactly one of the twelve token
    names — `background surface panel foreground muted primary secondary accent
    success warning error line` — and each value is a `#RRGGBB` string (stored
    upper-cased, so one colour has one spelling; the read path returns what the
    file holds). An unknown token name is `-32602` **naming the token**; a value
    that is not `#RRGGBB` is `-32602` **naming the token** and the accepted form.
    A non-object `tokens` (or an absent one) is `-32602` and never boots the app.
  - **A token never changes meaning.** `success` stays the done colour, `error`
    the failure colour, and `primary` the accent; the editor cannot rename or
    repurpose one, and colour is still paired with a label or glyph everywhere
    it carries meaning (`docs/design.md` §3.1). `settings.patch` refuses a
    `ui.custom_theme` key (`use theme.custom.set`), so this validation cannot be
    bypassed by the generic config patch.
  - A build with no config writer is `-32601`, `retryable: false`
    (`Custom palette editing is not available in this build`). A failed write is
    `-32000`, `retryable: false`, `data: {kind: "config", message}`, and the
    previous tokens are untouched. Neither is retried.
  - The reply is the stored map, so the shell replaces its snapshot from this one
    message. No change event is emitted; the app repaints from the shell's own
    palette, which fills any missing token from crimson per token.

### Decision layer

`decision.get` / `decision.set` expose the **optional** decision layer
(`docs/product.md` §10.4, `docs/data-model.md` §2 `[decision_layer]`). It is
**off by default** and, in this build, **rules-only**.

```json
→ {"jsonrpc":"2.0","id":12,"method":"decision.get"}
← {"jsonrpc":"2.0","id":12,"result":{"enabled":false,"model":"","rulesOnly":true,"localModel":{"supported":false,"reason":"No local model runtime is bundled in this build, so the decision layer runs rules only."}}}
```

- Both methods return the same view: `enabled` and `model` are the stored
  `decision_layer.enabled` / `decision_layer.model` values (defaults `false` and
  `""`), `rulesOnly` is always the literal `true`, and `localModel` is always
  `{supported: false, reason}`. The reason is one sentence and says exactly what
  is true: no local model runtime is bundled, so no local model can classify or
  rank anything. It is not a setting the user can close, and the shell must not
  render an enable-a-local-model control from this view.
- **The rules are always on**, regardless of `enabled`. They are the cheap,
  deterministic decisions the app makes without a model: which tool set a turn
  gets, whether a context-aware shortcut has a session to open (or must open the
  source picker), file-size thresholds for reading or attaching, and which side
  of the wall a request belongs to (`school` / `skills` / `work`). `enabled`
  records only whether the optional ranking layer may run; with no local runtime
  it changes nothing today.
- **The layer never decides anything with a consequence.** It must never approve
  or reject a write, archive or restore anything, move a request across the
  school/skills wall, or judge risk for a command or plugin call. Those are
  explicit user decisions and path-scoped service rules (`docs/product.md` §10.4);
  a model, local or hosted, cannot make them.
- **The local model is not shipped.** `localModel.supported` is `false` and no
  install, download or selection flow exists. The view is honest rather than a
  placeholder that later promises a feature: there is no bundled 1–3B model, no
  runtime to host one, and no fallback that silently ignores the setting.

`decision.set` `{enabled?, model?}` writes the two stored values and returns the
same view **after** the write, read back from `config.toml`, not an echo of the
request. The write is one `patchConfig` of `decision_layer` in `main.ts`; no
other method writes these values. In particular, `settings.patch` refuses a
`decision_layer` key with `-32602` and tells the caller to use `decision.set`, so
the refusal rules cannot be bypassed by the generic config patch.

- `enabled` must be a boolean and `model` a string when present; anything else is
  `-32602` and never boots the app. A request with neither field is a no-op
  success that returns the current view and writes nothing.
- **Any request that would store a non-empty `model` is refused**, including
  enabling while a hand-edited model is already present. This build has no local
  model runtime, so storing a model name would be a promise the app never keeps;
  the alternative (store it, report `supported: false`) would leave `config.toml`
  claiming a capability the app does not have. The one rule is therefore:
  `decision_layer.model` is only ever empty.
- The refusal is `-32000`, `retryable: false`, `data: {kind: "decision", message}`
  with the message `This build has no local model runtime, so the decision layer
  is rules-only; leave the model empty.` Nothing is written and `decision.get` is
  unchanged.
- **Enabling with an empty model is allowed** and is exactly the rules-only mode,
  so `decision.set {enabled: true}` succeeds and persists
  `[decision_layer] enabled = true` (with `model = ""`). Disabling likewise
  writes `enabled = false`.
- A build with no config writer is `-32601`, `retryable: false`
  (`Decision-layer editing is not available in this build`). A failed write is
  `-32000`, `retryable: false`, with `data: {kind: "config", message}`, and the
  previous values are untouched. Neither is retried.

The reply is the stored view, so the shell replaces its snapshot from this one
message. Neither method emits a change event; no chat, session, source, plugin
or archive is touched, and no model call is made.

## Session memory

A lock-in session keeps a small memory note beside its chat
(`<session>/memory.md`, shape in `docs/data-model.md` §4.5). It is written by one
path only: a session chat turn that reaches `session.chat.done` with
`outcome: "done"`.

- **Completed turns only.** A cancelled turn, a failed turn, a no-model reply and
  a blocked or ignored send write nothing; the store no-ops any outcome other
  than `done`. A second identical turn adds nothing either, because points are
  deduped by normalised text.
- **What it contains.** Up to five points extracted deterministically from the
  assistant's final text — never tool narration, never a streamed partial: list
  items are preferred, otherwise the first sentences; Markdown emphasis, links
  and fenced code are stripped, each point is one line of at most 200 characters,
  empties and duplicates are dropped, and the document order is kept. No model
  call is made, so recording memory costs nothing. The service then applies its
  own per-turn store cap and folds anything over its bullet cap into `earlier:`
  lines.
- **It is history, not a source.** The note is labelled session memory: it never
  becomes a source row, never enters source coverage, and a chat may not cite it
  as a fact from the session's sources.
- **It feeds the review queue.** `review.queue` reads `memory.md` and reports one
  `memory:<sessionId>:<noteId>` item per point, in its own "session memory"
  kind. Those items are read-only: `review.mark` refuses them (see `review.queue`
  and `review.mark` in the method notes above).
- **The write is best-effort.** It happens after the terminal event, so the shell
  never waits for it, and a storage failure is dropped silently rather than
  turning a delivered answer into an error; the transcript is unaffected. The
  next `session.open` reports whatever is actually on disk.

## Streaming

- `chat.send` returns immediately with a `turnId`.
- `chat.delta` carries a small append; the shell batches at ~16 ms.
- `chat.done` marks the turn complete; `chat.error` carries the failure.
- `chat.cancel` stops the turn; the core emits `chat.done` with
  `{cancelled: true}`.
- Session chats stream through `session.chat.state` snapshots (coalesced at
  ~33 ms), then `session.chat.done` or `session.chat.error`; there is no
  separate delta event today.
- Project chats follow the same shape with `work.chat.state` (carrying
  `projectId` and `chatId`), then `work.chat.done` or `work.chat.error`.
- Skill chats follow it too, with `skill.chat.state` / `skill.chat.done` /
  `skill.chat.error` carrying `goalId` and `chatId`.
- Every chat state frame (`chat.state`, `session.chat.state`, `work.chat.state`,
  `skill.chat.state`) and every chat snapshot carries `seq`: one monotonic
  counter per chat stream. A freshly built stream starts at 0 and increments
  once per emitted frame, and the counter survives a coalesced flush, so two
  frames never share a number.
- The shell keeps the highest `seq` it applied per stream (`chat`,
  `session:<id>`, `work:<projectId>:<chatId>`, `skill:<goalId>:<chatId>`) and
  drops a state frame at or below it. That is what makes a reconnect, a
  delayed snapshot reply or a flush racing a request safe: the older frame
  cannot overwrite a newer transcript.
- A snapshot is whole state, so it may repeat the last sequence and sets the
  baseline; an older snapshot is ignored. A model change rebuilds the core's
  controllers and restarts each per-controller counter, so the shell clears
  its maxima after `settings.patch` and on a new process.
- A core that omits `seq` is accepted unchanged, so this stays additive.
- A reconnect/snapshot may replace a lagging stream; never append after a
  snapshot for the same turn.

## Versioning

- `protocol` changes only for breaking envelope/semantic changes.
- Additive methods/events are listed in `capabilities`; the version stays.
- The shell and core ship together. A mismatched version shows a blocking
  banner; do not attempt a best-effort connection.

## Security

- stdio only; no TCP port, no network listener.
- The core validates every path against the workspace; the shell never reads
  files directly.
- Secrets are sent once to the core on link and never logged, cached or put in
  a widget. The core owns the keychain.
- The shell's logs may contain method names and ids, never params with secrets.
- No shell interpolation: the core runs commands without a shell and asks for
  permission per command.
- A swarm worker is always the `forSwarm` copy: read-only tools, no write or
  command capability, no approval surface and no wider toolbox than a project
  chat. The transport refuses a worker tool name that is not on that list.
