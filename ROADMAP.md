# Roadmap

This is the public plan for LockedIn-Tui. It lists outcomes, not dates, and it
changes when users and evidence say it should.

## Now — 1.0.x

- Fix reported bugs, provider/API drift and terminal compatibility.
- Finish native verification for arm64 Linux and the Windows UI.
- Keep install docs, checksums and notices current.

## Next — 1.1 “Think it through”

- **Reasoning checkpoints** in Skills and Lock-in: explain your approach in
  your own words.
- The agent names what is sound and asks about the first weak step **before**
  explaining it. A direct “explain it” is always available.
- **Rate understanding 1–10 per concept** after a lesson or step.
- **Adaptive review:** below 6 rebuilds prerequisites; 6–7 uses Socratic
  questioning; the user can switch modes.
- **Understanding view:** rating trend, evidence, weak concepts and open
  questions per topic, with links to the material.
- **Unified search** across notes, session memory, source excerpts, reasoning
  records and cards.
- **Export** decks and weak concepts to Markdown, CSV or Anki-compatible files.

## Later — 2.0.0 “Talk it through”

- Local, lightweight voice-to-text for reasoning checkpoints in Skills and
  Lock-in.
- Push-to-talk; the transcript is editable before it is sent; audio is
  discarded by default.
- The model is downloaded on demand, not bundled; audio never leaves the
  machine.
- The same questioning and adaptive review, without typing.

## Later — after 2.0.0

- **Work loop:** per-hunk write review, per-command approval, swarm board.
- **Editable curricula and synthesis:** add or reorder chapters, concept maps
  and comparison notes built from sources.
- **First five minutes:** guided provider setup, key validation, local-model
  presets and budget preview.
- **Every machine:** Homebrew/Scoop/winget/AUR, signing and notarization.

## Not planned

- Accounts, sync or real-time collaboration.
- Web or mobile clients.
- A marketplace for courses, skills or plugins.
- Silent model routing, automatic fallback or hidden retries.
- Time-decaying spaced repetition.
