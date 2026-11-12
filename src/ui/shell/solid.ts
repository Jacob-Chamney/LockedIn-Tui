/**
 * One place that binds the shell to Solid's reactive runtime.
 *
 * Import the package root, never `solid-js/dist/solid.js`: under Bun that deep
 * path resolves to the server build, whose signals are inert, and the whole UI
 * silently renders its first frame forever (spike S1, finding L1).
 *
 * Reactive JSX also requires `@opentui/solid/preload`; `bunfig.toml` preloads it
 * so a bare `bun test` and the app itself always run through the transform.
 */
export {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  getOwner,
  Index,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  untrack,
  type Accessor,
  type Owner,
} from "solid-js"
