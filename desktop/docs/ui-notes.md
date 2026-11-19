# UI notes — what the desktop shell borrows, and from where

The Flutter shell is not a port of the TUI, but every rule below came from the
apps this project is measured against: LazyVim/Neovim (keyboard grammar),
OpenCode (chat-first framing) and the Flutter animation guidance (motion that
costs nothing). Each note names the rule, the app it comes from, and where it
lives in `desktop/lib`.

## Navigation and layout

1. **One toggle key per rail, and it cycles.** Neovim users expect a toggle,
   not a menu: `<leader>e` (the terminal app's `navigator`) moves expanded →
   icons → hidden. It is a registry action
   (`keymap/registry.dart` → `sidebarAction`), so the tooltip, the palette and
   the Settings editor all read the same binding.
2. **Hiding is a reflow, never an overlay.** The chat column widens; nothing
   covers it. A hidden rail leaves a 26 px chip (`_SidebarRail`) because a
   window with no visible navigation is a dead end.
3. **Exactly one focused pane, marked by shape.** The focused surface row gets a
   left bar as well as colour, so focus never depends on hue alone.
4. **Below 900 px the rail is icons whatever the mode says** — labels do not fit,
   and hiding the only navigation would strand a narrow window.
5. **Counts live on the destination, chords live in tooltips.** A bare muted
   digit beside a label reads as a count; that is why `Sessions 3 2` was
   ambiguous. Counts are read from the snapshot the core already sent; the
   review queue, archive and knowledge tree show theirs only once opened,
   because the archive can hit the network and coverage scoring is not a
   first-frame cost.

## Chat-first framing (OpenCode)

6. **The transcript is the app; panels are layers over it.** Every surface is a
   reflow or an overlay, and `Esc` peels one layer at a time: a narrow window
   closes a star's detail before it leaves Achievements, and a deck returns to
   its session before the session list.
7. **The composer keeps the draft.** The shell owns the Chill composer's text
   (`_chatDraft`), because switching surfaces disposes the page: leaving for
   Sessions and coming back must not lose a half-typed question. A sent turn
   clears it; a blocked send keeps it.
8. **Statusline is state, panels are content.** Mode, scope, tokens and cost stay
   in the one status line; hints for the focused layer go in its footer.
9. **Empty states name the next key.** No screen says "nothing here": a list
   says what creates the first row, a search says `Esc clears the search`.

## Motion (Flutter guidance)

10. **A burst is one-shot and repaint-only.** `EffectHost` owns one
    `AnimationController` per burst, hands it to the painter through `repaint:`,
    and wraps the layer in a `RepaintBoundary`. Frames skip build and layout.
11. **Particles are a pure function of time.** `Effect.confetti()` seeds a
    `Random`, materialises particles once, and positions them with
    `origin + v·t + ½g·t²`. A test asserts bounds and "spent at t=1" without a
    golden image.
12. **The flip swaps faces at 90°.** Only the edge-on frame has no readable text,
    so that is where the faces change; the back is pre-rotated by π so it is not
    mirrored.
13. **Reduced motion degrades, never breaks.** No particles; the flip becomes an
    instant face swap (not a cross-fade — two Columns of different heights
    cross-fading overlap each other's text).
14. **Nothing loops forever.** A repeating animation would make every
    `pumpAndSettle` in the shell suite hang and would keep the compositor awake;
    the sky is static, and only the selection ring animates, once.

15. **The leader is `<leader>e` for the rail and `Space` + a letter for every
    surface**, exactly as `src/ui/keymap/defaults.ts` has it: `c` Chill, `h`
    lock-in sessions, `g` skill goals, `s` sources, `t` stats, `p` work, `v`
    review, `f` archive, `n` knowledge, `,` settings. `i` is achievements,
    `l` starts a lock-in, `k` opens the open session's deck, and Work keeps the
    terminal app's verbs: `m` agents, `u` chats, `x` swarms, `d` changes. The
    temporary `Alt+1…0` desktop switcher is gone; two switchers for one action is
    the drift the one-registry rule exists to stop.
16. **`\` is the alternate leader** (`leaderAltAction`). `Space` is a local
    action on the deck, the steps reader and the approvals view, so those
    surfaces need a second way in (`docs/design.md` §7.3).
17. **The deck flips on `Tab`**, as in the terminal app, which is what frees
    `Space` to be the leader everywhere.

## Mouse

18. **The pointer is an accelerator, never the only path.** Every click target
    has a chord and every chord that changes or destroys something has a button:
    sidebar rows (click = select, `Enter` opens), the rail toggle (click =
    `<leader>e`), stars (hover = move, click = select, `Enter` = detail), deck
    choices (click = `1`–`4`), deck flip (click = `Tab`), approvals (buttons =
    `y`/`n`), settings rows (chevron = `Enter`), stats header (buttons = `a`/`x`).
19. **Hover only tints; it never steals the selection.** A row highlights under
    the pointer with the theme's hover wash, and nothing moves until the click.
20. **A destructive decision is never keyboard-only.** Approve/reject and
    approve-and-run/deny are buttons on the card *and* keys, and a card's own
    button selects that card first so it can only act on what it shows.
21. **`Esc` stops a reply before it means "back".** With a turn streaming, Esc
    cancels from any mode, in Chill and in every session/project/goal chat.
22. **A reader keeps its document's grammar.** The study guide reveals with
    `Enter` and builds with `b` (the terminal app's keys); `a`/`R` remain as
    aliases. The deck flips with `Tab`, answers with `1`–`4`, moves with `h`/`l`.
23. **A step is toggled by the glyph it is drawn with.** The `☐` in the steps
    reader is a button that toggles that step, not the cursor's step.

## Plugins

16. **Effects are a registry, not a hard-coded celebration.** `EffectRegistry`
    maps a name to an `Effect` factory; a plugin can register one and the shell
    can play it without knowing what it is. Effects paint only: they cannot read
    files, reach the core or hold a key.
