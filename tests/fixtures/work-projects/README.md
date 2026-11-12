# `work-projects` fixtures

`meta.json` is a documented sample of `work/projects/<id>/meta.json`
(`docs/data-model.md` §6.1): two agents with one default, one pending task, and
a stable key order.

`root` uses `/projects/example-app` as a **placeholder** — no test may depend on
a path outside a temp directory. `tests/integration/work-register.test.ts`
copies this file and replaces `root` with a real temp folder before calling
`home()`.
