# `work-chat` fixtures

A tiny project tree plus two `meta.json` templates for WP-502.

- `project/` is copied into a temp directory for every test. It contains the
  same term (`boundary`) on a known line in two files, so `search_files` can be
  asserted exactly; the 200 KiB truncation file is generated at runtime so the
  repository stays small.
- `meta.json` is a project with one default agent (`reviewer-1a2b3c`).
- `meta-no-default.json` has no default agent, for the blocked-send case.
- `chat-resume.jsonl` holds 22 valid records (11 pairs) so a resumed chat can
  prove it replays the **last 20** and appends to the same file.

`root` in both meta templates is the documented placeholder
`/projects/work-chat-fixture`; tests replace it with the resolved temp folder
and replace `id` with the registered project id. No fixture path points at a
real machine location.
