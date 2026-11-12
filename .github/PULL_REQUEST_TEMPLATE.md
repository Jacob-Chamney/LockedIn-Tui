## Summary

<!-- What changed, and why? Keep this to a few sentences. -->

## Related issue

<!-- Closes #... or "None — small internal cleanup". -->

## What changed

- 
- 
- 

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] UI / layout / component change
- [ ] Storage / config / data-model change
- [ ] LLM / provider / usage change
- [ ] Tests or docs only
- [ ] Refactor with no behaviour change

## Area

- [ ] Chat / composer
- [ ] Lock-in sessions
- [ ] Skill sessions / reader
- [ ] Work / projects / agents
- [ ] Settings / providers / models
- [ ] Archive / sources
- [ ] Storage / index
- [ ] LLM / streaming / usage
- [ ] Keys / navigation / shell
- [ ] Packaging / CI

## Verification

<!-- Paste the exact commands and the result. -->

```sh
bun run check
```

Result:

```text
# e.g. 2030 pass, 0 fail; startup within budget
```

If this fixes a bug, describe the failing case that now passes. If this adds UI,
name the test or the frame you checked.

## UI evidence

<!-- Required for layout/visual changes: a short text frame or recording. -->

```text

```

Keep generated artifacts and local screenshots out of the commit.

## Invariants

- [ ] The school/skills wall is enforced by `Vault` or tool construction, not by prompt text.
- [ ] Writes are atomic and only happen after a successful response.
- [ ] No automatic retries, silent model fallback, or automatic archiving were added.
- [ ] Secrets stay in the OS keychain; none appear in config, logs, prompts, tests or fixtures.
- [ ] Markdown remains the source of truth; the SQLite index stays rebuildable.
- [ ] Progress toggles rewrite only the checkbox character and progress line.
- [ ] New UI composes `FloatingWindow`, `WindowHeader`, `WindowBody`, `WindowFooter`, `ListRow` and the shared primitives instead of re-implementing the chrome.
- [ ] New panes are added through `ui/shell/panes.ts` and the renderer map in `app/panes.tsx`.

## Risks and follow-ups

<!-- Anything not covered, known limitations, or a follow-up issue. -->

## Checklist

- [ ] I branched from `main` and this PR targets `main`.
- [ ] I ran `bun run check`.
- [ ] I added or updated tests for the behaviour.
- [ ] I updated the README or contribution notes when necessary.
- [ ] I did not include unrelated refactors in this PR.
