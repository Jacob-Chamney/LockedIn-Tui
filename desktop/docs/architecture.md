# Desktop architecture

The desktop app is a Flutter shell over the existing Bun core. The core is not a
new service; it is the same domain, services, storage and stats code with a
stdio adapter.

## Layers

| Layer | Path | Owns | Must not |
|---|---|---|---|
| Domain/services/storage/stats | `src/domain`, `src/services`, `src/storage`, `src/stats` | rules, files, providers, keychain, stats | import UI |
| Core adapter | `src/server/` | JSON-RPC, boot, command/event mapping | import `src/ui/` or `src/app/App.tsx` |
| Flutter shell | `desktop/lib/` | layout, focus, theme, native dialogs | read files, hold secrets, re-derive totals |
| Contract | `desktop/lib/bridge/protocol.dart`, `desktop/lib/bridge/core_methods.g.dart`, `src/server/protocol.ts` | framing, version, methods | contain domain rules |

The dependency direction is one-way: `desktop → src/server → src/{domain,services,storage,stats}`.
No cycles.

## Process lifecycle

1. The shell starts the sidecar with `CoreClient.start()`.
   - Dev: `bun run ../src/server/main.ts`
   - Release: the bundled `lockedin-core` binary next to the shell executable.
2. The shell sends `initialize` with `{ protocol: 1, client: "flutter" }`.
3. The core returns `{ protocol, server, capabilities }`; a mismatch shows a
   blocking banner and does not continue.
4. The shell loads the initial snapshot (`session.list`, `settings.get`,
   `stats.summary`) and subscribes to events.
5. On exit, crash or protocol failure, pending calls fail with `RpcException`;
   the shell shows a reconnect banner and restarts with backoff.

The sidecar writes protocol messages to stdout only. Logs go to stderr and the
shell's log file.

## State ownership

- **Core:** workspace path, config, sessions, sources, chats, model/provider
  keys, MCP sessions, stats, archives, history. This survives a shell restart.
- **Shell:** surface selection, scroll position, focus, draft composer text,
  window geometry, transient dialogs, theme preview. This is safe to lose.
- **No duplicated domain state.** A list rendered in Flutter is a projection of
  a core event/snapshot; the shell sends an intent and waits for the new state.
- **No optimistic domain writes.** A write succeeds only after the core accepts
  it. The UI may show a pending state, but never a fake success.

## Transport

- Newline-delimited JSON-RPC 2.0 over stdio.
- Requests have an `id`; notifications do not and get no response.
- Streaming events are notifications; the UI batches appends at ~16 ms.
- Cancellation is an explicit request (`chat.cancel` with the turn id).
- Backpressure: the core coalesces deltas; a snapshot can replace a lagging
  stream.
- The protocol version is checked once at startup. Additive methods bump the
  minor capability list, not the version.

See `protocol.md` for the method table.

## UI composition

- `desktop/lib/app.dart` — `MaterialApp`, theme, home.
- `desktop/lib/shell/shell.dart` — top bar, sidebar, status bar, surface switch,
  the leader (`Space` + a key) and `Alt+0`-style shortcuts are gone; every
  surface is a leader chord, as in the terminal app.
- `desktop/lib/features/<feature>/` — one folder per surface. Feature widgets
  do not own chrome; they compose the shell.
- `desktop/lib/theme/palette.dart` — the single palette. Mirrors
  `src/ui/theme/palettes.ts` (crimson) until the core exposes theme tokens.
- `desktop/lib/bridge/core_client.dart` — process + framing only. Feature
  controllers own their request state.

## Charts

Flutter paints charts itself; there is no Qt Charts/Graphs dependency.

- Use `CustomPainter` for area/line/bar charts and `CustomPaint` for the
  heatmap/strip.
- Keep the existing data semantics: the trend is the busiest sample per column,
  the figures come from `StatsSummary`, and cost is `unknown` when unpriced.
- Do not add a GPL chart package. Prefer MIT/BSD/Apache packages or a local
  painter.
- Charts must have an empty state and a text alternative (numbers in the cards).

## Linux renderer selection

Flutter 3.50.0 has an OpenGL-compositor offset bug on NVIDIA's proprietary
driver: the first layer is drawn at `(-width/2, -height/2)` when
`glBlitFramebuffer` is blocklisted (flutter/flutter#195885, fixed in 3.50.1).

`desktop/linux/runner/my_application.cc` therefore selects
`FLUTTER_LINUX_RENDERER=software` and disables Impeller when
`/dev/nvidiactl` exists, before the engine is created. The software compositor
avoids the broken OpenGL path at a CPU-rendering cost.

- `LOCKEDIN_RENDERER=opengl` opts out (use it to test a fixed engine).
- An explicit `FLUTTER_LINUX_RENDERER` value always wins.
- Delete the fallback when the pinned Flutter is 3.50.1 or newer.

## Native integration

Qt is not used. Flutter owns the window and native integration:

- File dialogs: `file_selector` or a small platform channel; the chosen path is
  sent to the core, which validates it.
- Clipboard: `Clipboard` from `services`.
- Menus/tray: desktop plugins or platform channels in a later packet.
- Keychain: only the core touches it; the shell sends the key text once and
  never logs or stores it.
- Window sizing/position: `window_manager` or native runner args; keep the
  minimum at 800×600.

## Generated bindings

Two generated files keep the Flutter bridge tied to the core:

- **`desktop/lib/bridge/core_methods.g.dart`** — generated from `CAPABILITIES`
  by `scripts/generate-dart-bindings.ts`. The client calls
  `CoreMethod.sessionList` rather than `'session.list'`, so a renamed capability
  changes the constant and a stale call site stops compiling instead of failing
  at runtime with `-32601`.
- **`desktop/lib/bridge/core_models.g.dart`** — the model decoders.
  `scripts/generate-dart-models.ts` reads the allowlisted exported types with
  the TypeScript compiler API and emits a tolerant `fromJson`. It covers the
  Knowledge search/tree models, the whole Stats + learning-graph surface and
  the settings view (14 models): strings, `int`/`double` (the `ints` list),
  booleans, string arrays, nested models and arrays of them (nullable too),
  `Record<string, string|number>` maps, optional/`| null` fields as nullable
  Dart fields, and a union of object shapes flattened into one class (a field
  every member shares stays required; a member-only field becomes nullable).
  `models.dart` exports the generated classes and keeps the presentation
  getters (`tokens`, `isAgent`, `node()`) and the `learningGraphEmpty` sentinel
  as hand-written glue. Adding a model means adding it to `MODEL_SPECS`; the
  generator refuses a shape it cannot map (a field whose type differs across
  union members is the one unsupported case).

Both files are marked `dart format off` because the generator owns their bytes.
`tests/unit/generated-bindings.test.ts` and `tests/unit/generated-models.test.ts`
fail when a file is stale, and the client must not regress to raw method
literals. Run `bun run scripts/generate-dart-bindings.ts` and
`bun run scripts/generate-dart-models.ts` after a protocol change.

## Testing

| Level | Tool | What |
|---|---|---|
| Protocol | Bun test | `src/server/protocol.ts` pure behaviour |
| Core | Bun tests | existing domain/service/storage/stats suite |
| Widget | `flutter test` | shell, chat, stats, empty states |
| Golden | `flutter test --update-goldens` | stable surfaces (later) |
| E2E | integration_test | shell + real core, Linux first |
| Packaging | CI | `flutter build linux/windows --release` |

The core suite is the safety net; the Flutter suite covers rendering and
interaction, not domain rules.

## Packaging

- Linux: AppImage or a `bin/` + `lib/` tarball. Bundle the Flutter engine,
  assets and the compiled core sidecar.
- Windows: `flutter build windows`, NSIS/MSIX; sign the installer.
- The core binary is built with `bun build --compile`; bundle it under
  `desktop/` resources or next to the executable and resolve the path from the
  shell's executable. The compile cannot embed the native keychain `.node`, so
  the bundle also carries `node_modules/@napi-rs/keyring` and the shell sets
  `LOCKEDIN_KEYRING_ADDON` to its entry file.
- Version handshake covers UI/core skew; ship them together.
- No Qt libraries, so no Qt LGPL/source-offer obligations. Flutter/Dart and
  third-party package notices still apply.
