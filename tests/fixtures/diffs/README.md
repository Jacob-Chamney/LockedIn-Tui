# Diff fixture — four hunks, two approved

| File | What it is |
|---|---|
| `base.txt` | the bytes on disk when the proposal was made |
| `proposed.txt` | the full `newContent` the model proposed |
| `expected-hunks-1-3.txt` | `base.txt` after applying **hunk indices 1 and 3** |

There are four single-line edits, each separated by four unchanged lines, so the
default three-line context cannot merge them: `base.txt` → `proposed.txt` is
exactly four hunks.

Indices are **0-based**, matching `Hunk.index`. Applying the set `[1, 3]`
therefore approves the second and fourth edits (`beta`, `delta`) and leaves the
first and third (`alpha`, `gamma`) exactly as they were. Hunk index 2 is the
untouched region the integration and unit tests compare byte for byte.

Both files end with the same single trailing newline. A fixture with a missing
final newline is covered separately by `diffContent` in the unit test, because a
missing terminator is the case that breaks naive line splitting.
