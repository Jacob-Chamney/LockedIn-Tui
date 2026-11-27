# UI notes — what the desktop shell borrows, and from where

The Flutter shell is not a port of the TUI, but every rule below came from the
apps this project is measured against: LazyVim/Neovim (keyboard grammar),
OpenCode (chat-first framing) and the Flutter animation guidance (motion that
costs nothing). Each note names the rule, the app it comes from, and where it
lives in `desktop/lib`.

## Navigation and layout

1. **One toggle key per rail, and it is a switch, not a cycle.** Neovim users
   expect a toggle, not a menu, but a *hidden* rail is a dead end in a desktop
   window: `<leader>e` (the terminal app's `navigator`) moves **icons →
   expanded → icons**. It is a registry action (`keymap/registry.dart` →
   `sidebarAction`), so the tooltip, the palette and the Settings editor all
   read the same binding. `Space` inside the rail runs the same switch.
2. **The rail starts shrunk.** A new window opens on the chat with the icons
   down the side, so the first frame has navigation and a wide composer. The
   shrink is a reflow, never an overlay: the chat column widens and nothing
   covers it.
3. **Opening the rail gives it the keyboard.** `Space e` expands *and* focuses
   the rail, so `j`/`k` walk the rows, `Home`/`End` jump, and `Enter` opens the
   row and hands the keyboard back to the page. `Esc` (or `→`/`l`) gives the
   keyboard back **without** shrinking. Only the switch resizes the rail: the
   chord (`Space e`) or the top-bar button. `Space` stays the leader inside the
   rail — a stray Space opens the leader overlay, it never shrinks the rail
   under the user's hands. Two different states — page keys and rail keys —
   never share one key silently.
4. **The rail's keyboard and the rail's picture are one list.** The cursor index
   counts the rows `_sidebarGroups` draws and then the pinned Settings row; it
   is not `Surface.values`, which also carries Sources (leader-only) and orders
   Review differently. One list, two readers, so a row can never be drawn in one
   place and picked in another. The page is excluded from focus while the rail
   owns the keyboard, so a composer `autofocus` cannot steal it between frames.
5. **Exactly one focused pane, marked by shape.** The focused surface row keeps a
   left bar as well as colour, and the row under the keyboard cursor gets a
   panel fill plus an accent outline — two non-hue signals, so neither depends on
   colour alone. The outline is always one pixel wide (transparent when unset),
   so the label does not jump as `j` walks the rail.
6. **Below 900 px the rail is icons whatever the mode says** — labels do not fit,
   and a narrow window still needs its navigation.
7. **Counts live on the destination, chords live in tooltips.** A bare muted
   digit beside a label reads as a count; that is why `Sessions 3 2` was
   ambiguous. Counts are read from the snapshot the core already sent; the
   review queue, archive and knowledge tree show theirs only once opened,
   because the archive can hit the network and coverage scoring is not a
   first-frame cost.

## Chat-first framing (OpenCode)

8. **The transcript is the app; panels are layers over it.** Every surface is a
   reflow or an overlay, and `Esc` peels one layer at a time: a narrow window
   closes a star's detail before it leaves Achievements, and a deck returns to
   its session before the session list.
9. **The composer keeps the draft.** The shell owns the Chill composer's text
   (`_chatDraft`), because switching surfaces disposes the page: leaving for
   Sessions and coming back must not lose a half-typed question. A sent turn
   clears it; a blocked send keeps it.
10. **Statusline is state, panels are content.** Mode, scope, tokens and cost stay
   in the one status line; hints for the focused layer go in its footer.
11. **Empty states name the next key.** No screen says "nothing here": a list
   says what creates the first row, a search says `Esc clears the search`.

## Motion (Flutter guidance)

12. **A burst is one-shot and repaint-only.** `EffectHost` owns one
    `AnimationController` per burst, hands it to the painter through `repaint:`,
    and wraps the layer in a `RepaintBoundary`. Frames skip build and layout.
13. **Particles are a pure function of time.** `Effect.confetti()` seeds a
    `Random`, materialises particles once, and positions them with
    `origin + v·t + ½g·t²`. A test asserts bounds and "spent at t=1" without a
    golden image.
14. **The flip swaps faces at 90°.** Only the edge-on frame has no readable text,
    so that is where the faces change; the back is pre-rotated by π so it is not
    mirrored.
15. **Reduced motion degrades, never breaks.** No particles; the flip becomes an
    instant face swap (not a cross-fade — two Columns of different heights
    cross-fading overlap each other's text).
16. **Nothing loops forever.** A repeating animation would make every
    `pumpAndSettle` in the shell suite hang and would keep the compositor awake;
    the sky is static, and only the selection ring animates, once.

17. **The leader is `<leader>e` for the rail and `Space` + a letter for every
    surface**, exactly as `src/ui/keymap/defaults.ts` has it: `c` Chill, `h`
    lock-in sessions, `g` skill goals, `s` sources, `t` stats, `p` work, `v`
    review, `f` archive, `n` knowledge, `,` settings. `i` is achievements,
    `l` starts a lock-in, `k` opens the open session's deck, and Work keeps the
    terminal app's verbs: `m` agents, `u` chats, `x` swarms, `d` changes. The
    temporary `Alt+1…0` desktop switcher is gone; two switchers for one action is
    the drift the one-registry rule exists to stop.
18. **`\` is the alternate leader** (`leaderAltAction`). `Space` is a local
    action on the deck, the steps reader and the approvals view, so those
    surfaces need a second way in (`docs/design.md` §7.3).
19. **The deck flips on `Tab`**, as in the terminal app, which is what frees
    `Space` to be the leader everywhere.

## The keyboard's ownership

20. **One `Esc`, one layer — in a text field too.** In a chat composer, `Esc`
    moves the keyboard to the page (`NORMAL`); the text stays. An `Esc` in
    `NORMAL` is "back". The shell blurs the focused field for the one chord it
    owns and every page returns `ignored` for keys it does not use, so an
    overlay or the leader is never dead because a field was focused.
21. **A modified chord belongs to the registry.** A page handler runs before the
    shell's, and pages read bare letters: `Ctrl+K` was `k` to Review (which
    marks an item known) and to the deck (which marks a card). The shell
    resolves `Ctrl`/`Alt` chords in an early key handler, ahead of the focus
    tree, and every page returns `ignored` while a modifier is held. A page may
    own a chord of its own (`Ctrl+U`/`Ctrl+D` scroll, `Ctrl+S` saves), and then
    says so in its own handler.
22. **A bare key in a text field is a character.** Every list with a search box
    checks `focusNode.hasFocus` before its verbs: typing `a`, `d`, `x`, `n`,
    `j` or `k` into a query never archives, deletes, exports or moves. The
    palette does not move on `j`/`k` for the same reason — both are text there.
23. **No remount to give the keyboard back.** An overlay returns focus to the
    node that had it before it opened, or to the page's own scope. The page is
    remounted only when nothing in it holds focus any more. Remounting on every
    action threw away a half-filled wizard, an unsaved `prompt.md` and every
    list's search.
24. **The rail has two owners, not one.** `Space e` expands it *and* takes the
    keyboard; the top-bar button only resizes, because a pointer user is about
    to click and a page cannot accept focus while the rail is excluded from it.
    A click anywhere in the page releases the rail; an overlay opened from the
    rail hands the keyboard back to the rail when it closes.
25. **A scrolling surface scrolls from the keyboard.** `j`/`k` by a line, `d`/`u`
    by half a page, PgUp/PgDn, `g`/`G` for the ends, one implementation
    (`transcript_scroll.dart`) for the four chats, the Stats dashboard, a
    chapter and a lesson. A streaming reply is followed only while the reader is
    at the bottom.
26. **A command's result is shown.** `work.command.decide` consumes the proposal
    row, so the approvals view keeps the last command's exit code, timeout and
    output beside the remaining rows (`x` dismisses it). A button that runs a
    process takes the same path as its key: the named confirmation, the busy
    flag and the inline error.
27. **A network or model call has no client deadline.** The shell's 30 s
    timeout is for reads; `session.generateSteps`, `skill.create`,
    `session.output.build`, `work.command.decide` and the archive's transfers
    wait for the core, which is the only side that knows when they end. A crash
    still fails them, because the exit handler completes every pending call.

## Mouse

28. **The pointer is an accelerator, never the only path.** Every click target
    has a chord and every chord that changes or destroys something has a button:
    sidebar rows (click = select, `Enter` opens), the rail toggle (click =
    `<leader>e`), stars (hover = move, click = select, `Enter` = detail), deck
    choices (click = `1`–`4`), deck flip (click = `Tab`), approvals (buttons =
    `y`/`n`), settings rows (chevron = `Enter`), stats header (buttons = `a`/`x`).
29. **A queue row opens what it is about.** A review item carries the step it
    names, so opening it lands the session reader on that step — a deep link,
    not just the session. Activity rows expand independently, because the log is
    a list to compare.
30. **Hover only tints; it never steals the selection.** A row highlights under
    the pointer with the theme's hover wash, and nothing moves until the click.
31. **A destructive decision is never keyboard-only.** Approve/reject and
    approve-and-run/deny are buttons on the card *and* keys, and a card's own
    button selects that card first so it can only act on what it shows.
32. **`Esc` stops a reply before it means "back".** With a turn streaming, Esc
    cancels from any mode, in Chill and in every session/project/goal chat.
33. **A reader keeps its document's grammar.** The study guide reveals with
    `Enter`, builds with `b`, and marks a section with `[`/`]` + `x` or by
    clicking its chip (`session.output.mark` writes the file). `a`/`R` remain as
    aliases. The deck flips with `Tab`, answers with `1`–`4`,
    moves with `h`/`l`.
34. **A step is toggled by the glyph it is drawn with.** The `☐` in the steps
    reader is a button that toggles that step, not the cursor's step.

## Plugins

35. **Effects are a registry, not a hard-coded celebration.** `EffectRegistry`
    maps a name to an `Effect` factory; a plugin can register one and the shell
    can play it without knowing what it is. Effects paint only: they cannot read
    files, reach the core or hold a key.

## §32 — the plugin prompt arms Allow after ~150 ms

The prompt accepts **Deny** immediately and lets **Allow** wait 150 ms after it
paints. The risk is asymmetric: a denied call applies nothing, while an approved
write runs. A held `y` (or a click aimed at the surface underneath) that lands
with the prompt therefore cannot approve anything; the footer says
`allow arms in a moment · n deny · Esc deny` until it does. Injected through
`PluginPermissionModal.armDelay`, so the tests drive it instead of sleeping.
