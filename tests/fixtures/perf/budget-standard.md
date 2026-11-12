# Budget fixture — the first-frame threshold

This file is the single source of the startup-gate budget. `scripts/perf.ts`
reads the row below; changing it is a deliberate, reviewable edit.

| Metric | Budget | Measurement |
|---|---|---|
| First frame, compiled artifact, cold empty workspace | ≤160 ms | instrumented launch |
