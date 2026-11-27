import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';

import '../bridge/core_client.dart';
import '../bridge/core_scope.dart';
import '../bridge/models.dart';
import '../features/achievements/achievements_page.dart';
import '../features/archive/archive_page.dart';
import '../features/chat/chat_page.dart';
import '../features/knowledge/knowledge_page.dart';
import '../features/knowledge/knowledge_reader.dart';
import '../features/review/review_page.dart';
import '../features/sessions/new_session.dart';
import '../features/sessions/session_chat.dart';
import '../features/sessions/session_detail.dart';
import '../features/sessions/session_outputs.dart';
import '../features/sessions/session_settings.dart';
import '../features/sessions/sessions_page.dart';
import '../features/settings/settings_page.dart';
import '../features/skills/goal_wizard.dart';
import '../features/skills/skill_chat.dart';
import '../features/skills/learning_pane.dart';
import '../features/skills/skill_detail.dart';
import '../features/skills/skill_lesson.dart';
import '../features/skills/skills_page.dart';
import '../features/sources/sources_page.dart';
import '../features/stats/stats_page.dart';
import '../features/work/activity_page.dart';
import '../features/work/swarm_page.dart';
import '../features/work/work_approvals.dart';
import '../features/work/work_chat.dart';
import '../features/work/work_page.dart';
import '../keymap/registry.dart';
import '../theme/palette.dart';
import '../theme/breakpoints.dart';
import 'bars.dart';
import 'command_line.dart';
import 'sidebar.dart';
import 'surfaces.dart';

export 'surfaces.dart';
import 'leader.dart';
import 'palette.dart';

import 'plugin_permission.dart';

part 'shell_sidebar_keys.dart';
part 'shell_overlays.dart';
part 'shell_surfaces.dart';

/// Surface shortcuts come from the keymap registry (`Space` + a letter, as in
/// the terminal app), so there is no second table here: the sidebar draws its
/// grouped destinations and the registry decides which chord opens each one.

class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  /// Rebuild the shell from a helper extracted out of this file.
  ///
  /// `setState` is protected, so a part-file extension cannot call it directly.
  void refresh(VoidCallback fn) => setState(fn);

  Surface _surface = Surface.chat;
  bool _insert = false;
  bool _paletteOpen = false;

  /// Whether the `:` command line is open over the current surface.
  ///
  /// It is the typed twin of the palette: one text field, a live-filtered list
  /// of the registry's own actions, and `Esc` to dismiss. It owns the keyboard
  /// while it is open, so a focused page field underneath cannot also act on the
  /// same press.
  bool _commandOpen = false;

  /// Whether the which-key overlay is open over the surface.
  ///
  /// It is the leader (`Space`) and the help screen (`?`): the same generated
  /// table, grouped, with `j/k` + `Enter` to run a row and `Esc` to cancel. The
  /// overlay owns the keyboard while it is open, so the second key of a leader
  /// chord never reaches the surface underneath.
  bool _leaderOpen = false;

  /// Characters caught in the frame before the palette's or the command line's
  /// field held focus.
  ///
  /// Both fields request focus in a post-frame callback, so a fast hand's first
  /// character landed where nothing was listening. The shell keeps those
  /// keystrokes and the overlay seeds its field with them. Cleared whenever the
  /// overlay closes, so a later open never inherits them.
  String _overlayPending = '';

  /// The node that held the keyboard before the first overlay opened.
  ///
  /// One slot for the palette, the command line and the leader: an overlay
  /// opened *from* another overlay must return to where the first one came
  /// from, not to the previous overlay's dead node. It is consumed when the
  /// last overlay closes.
  FocusNode? _focusBeforeOverlay;

  /// The node that held the keyboard before the rail took it.
  FocusNode? _focusBeforeRail;

  /// A probe around the page: `hasFocus` is true while anything inside the
  /// page holds the keyboard. It never takes focus itself.
  final FocusNode _pageProbe = FocusNode(
    debugLabel: 'page',
    canRequestFocus: false,
    skipTraversal: true,
  );

  /// The last resort for a page nothing can hand the keyboard back to.
  ///
  /// Focus is normally *returned* to the node that had it. A page is only
  /// remounted (so its `autofocus` runs again) when that node is gone and
  /// nothing in the page holds focus. Remounting on every overlay action, as
  /// this used to, threw away a half-filled wizard, an unsaved `prompt.md`
  /// edit, and every list's search and selection.
  int _pageEpoch = 0;

  bool get _overlayOpen => _paletteOpen || _commandOpen || _leaderOpen;

  /// The step to land on when a review item names one. Set as the session
  /// opens, consumed by the detail, and cleared by the next plain open so it
  /// cannot leak into another session.
  int? _initialStep;

  /// Whether an open session is showing its chat instead of its detail.
  ///
  /// The sheet has two layers: the session detail, then that session's chat.
  /// Leaving Sessions collapses back to the detail, so returning from another
  /// surface never drops the user into a transcript they did not ask for.
  bool _sessionChatOpen = false;

  /// Whether the open session is showing its settings layer.
  ///
  /// Settings sits above the detail and below nothing else: it is a layer of
  /// Sessions, so leaving Sessions collapses it, and `Esc` returns to the
  /// detail with the chat, steps and reader untouched.
  bool _sessionSettingsOpen = false;

  /// Whether an open project is showing its chat instead of its detail.
  ///
  /// Work has the same two layers as Sessions: the project detail, then one of
  /// its chats. Leaving Work collapses back to the detail and keeps the project
  /// open, so returning never drops the user into a transcript they did not ask
  /// for. The store keeps the active chat id and its snapshot, so `c` reopens
  /// the same conversation.
  bool _workChatOpen = false;

  /// Whether the open project is showing its pending-approval layer.
  ///
  /// Approvals sit above the project detail and below nothing else: `p` opens
  /// them, `Esc` returns to the detail, and leaving Work collapses them. A
  /// pending proposal from a chat keeps the card's count live without opening
  /// the layer.
  bool _workApprovalsOpen = false;

  /// Whether the open project is showing its swarm board.
  ///
  /// The board is a layer of Work above the project detail: `w` opens it,
  /// `Esc` returns to the detail, and leaving Work collapses it. The store keeps
  /// the open run, so `w` reopens the same board.
  bool _swarmOpen = false;

  /// Whether the open project is showing its activity log.
  ///
  /// The log is a layer of Work above the project detail: `l` opens it with the
  /// active project id, `Esc` returns to the detail, and leaving Work collapses
  /// it. The store keeps the kind filter while the project stays open, so
  /// reopening the log keeps the filter the user picked.
  bool _workActivityOpen = false;

  /// Whether the New lock-in wizard is open over the Sessions list.
  ///
  /// It is a layer of Sessions, not a separate surface: leaving Sessions closes
  /// it back to the list while keeping any session that was already open.
  bool _wizardOpen = false;

  /// Whether the wizard's last create asked for generated steps.
  ///
  /// The wizard's `onCreated` only carries the id, so the shell records the
  /// Review step's toggle as the create starts and reads it when the session is
  /// open. It resets to the wizard default afterwards.
  bool _wizardWantsSteps = true;

  /// Whether the New skill goal wizard is open over the Skills list.
  ///
  /// It is a layer of Skills, not a separate surface: leaving Skills closes it
  /// back to the list while keeping any goal that was already open.
  bool _goalWizardOpen = false;

  /// Whether an open goal is showing its chat instead of its page.
  ///
  /// Skills has the same two layers as Sessions and Work: the goal page, then
  /// one of its chats. Leaving Skills collapses back to the page and keeps the
  /// goal open; the store keeps the active chat id and its snapshot, so `c`
  /// reopens the same conversation.
  bool _skillChatOpen = false;

  /// How the navigation rail is showing: full labels, or the icon rail.
  ///
  /// It starts shrunk so a new window opens on the chat without giving up its
  /// navigation, and the toggle is a switch — there is no hidden state.
  SidebarMode _sidebarMode = SidebarMode.icons;

  /// The first frame chooses the rail for the window: wide windows show the
  /// destination labels, narrow ones start as icons. A later toggle is the
  /// user's and is never overridden.
  var _sidebarSized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_sidebarSized) return;
    _sidebarSized = true;
    if (MediaQuery.sizeOf(context).width >= Breakpoints.railWide) {
      _sidebarMode = SidebarMode.expanded;
    }
  }

  /// True while the rail owns the keyboard. `Space e` expands *and* focuses it;
  /// `Esc` gives the keyboard back and leaves it expanded, and activating a row
  /// returns to the page.
  bool _sidebarFocused = false;

  /// The rail row under the keyboard cursor, in `_sidebarTargets` order.
  int _sidebarCursor = 0;

  /// The focus the rail takes when it is opened from the keyboard.
  final FocusNode _sidebarFocus = FocusNode(debugLabel: 'sidebar');

  /// The cursor row's key, so `j` keeps it on screen in a short rail.
  final GlobalKey _sidebarCursorKey = GlobalKey(debugLabel: 'sidebar-cursor');

  /// True below 900 px, where the rail is icons whatever the mode says.
  bool _narrow = false;

  @override
  void initState() {
    super.initState();
    FocusManager.instance.addEarlyKeyEventHandler(_earlyKey);
  }

  @override
  void dispose() {
    FocusManager.instance.removeEarlyKeyEventHandler(_earlyKey);
    _sidebarFocus.dispose();
    _pageProbe.dispose();
    super.dispose();
  }

  /// The Chill composer's unsent text. It lives in the shell because switching
  /// surfaces disposes the page, and a chat-first app must never lose a draft
  /// (the same rule OpenCode's composer follows).
  String _chatDraft = '';

  /// Drafts for the other chats, keyed `session:<id>`, `project:<id>:<chat>`
  /// and `goal:<id>:<chat>`. One map, one rule: every composer keeps its text
  /// across navigation, not just Chill.
  final _chatDrafts = <String, String>{};

  /// Whether the Achievements layer is open over Stats.
  ///
  /// Achievements is a layer of Stats, not a surface: `a` (and the registry's
  /// `achievements` action) opens it, `Esc` returns to the dashboard, and
  /// leaving Stats collapses it.
  bool _achievementsOpen = false;

  /// The Achievements layer's key handler. The shell requests focus on open:
  /// the page's `autofocus` loses to the shell root, which already holds the
  /// keyboard, so `r` used to fall through to the registry's refresh.
  final _achievementsFocus = FocusNode(debugLabel: 'achievements');

  /// `Space e` as the registry spells it, for the rail's tooltips.
  String _sidebarToggleLabel(KeymapRegistry keymap) {
    final row = keymap.rowFor('sidebar');
    return row == null ? 'sidebar' : row.binding.display;
  }

  /// The count each sidebar row shows, when it has one.
  ///
  /// Counts are the destinations' real sizes (`docs/design.md` §5: "counts in
  /// section headers"), read from the snapshot the core already sent — the
  /// sidebar never asks for a list of its own. A surface with nothing countable
  /// (Chat, Sources, Settings) simply has no entry, and a list the shell has not
  /// read yet (Review, Archive, Knowledge) shows none until it is opened: a
  /// count of `0` would be a guess.
  Map<Surface, String> _sidebarCounts(CoreStore store) {
    final review = store.review?.counts.total ?? 0;
    return {
      Surface.sessions: store.sessionsLoaded ? '${store.sessions.length}' : '',
      Surface.skills: store.skillsLoaded ? '${store.skills.length}' : '',
      Surface.work: store.projectsLoaded ? '${store.projects.length}' : '',
      Surface.review: review == 0 ? '' : '$review',
      Surface.archive: store.archiveRows.isEmpty
          ? ''
          : '${store.archiveRows.length}',
      Surface.knowledge: store.knowledgeGroups.isEmpty
          ? ''
          : '${store.knowledgeGroups.length}',
    };
  }

  /// `earned/total`, once the achievements snapshot has been read. An unread
  /// snapshot shows nothing rather than `0/0`.
  String _achievementsCount(CoreStore store) {
    if (store.achievements.isEmpty) return '';
    final earned = store.achievements.where((row) => row.unlocked).length;
    return '$earned/${store.achievements.length}';
  }

  /// The sidebar's `RECENT` rows: the newest readable sessions, at most three.
  ///
  /// An archived or broken session is not "recent" — it is not somewhere the
  /// user can go without first fixing or restoring it, so it stays in the
  /// manager where it is labelled.
  List<SessionRow> _recentSessions(CoreStore store) {
    final rows =
        store.sessions
            .where((row) => !row.archived && row.broken == null)
            .toList()
          ..sort((a, b) => b.date.compareTo(a.date));
    return rows.take(3).toList();
  }

  /// Open a session from the sidebar's `RECENT` list.
  ///
  /// It is the manager's open path with the surface switch in front, so a
  /// stale chat or settings layer never covers the session the user picked.
  Future<void> _openRecentSession(CoreStore store, String id) async {
    _select(Surface.sessions);
    setState(() {
      _sessionChatOpen = false;
      _sessionSettingsOpen = false;
      _initialStep = null;
    });
    await store.openSession(id);
  }

  /// Switch the navigation rail between expanded and the icon rail.
  ///
  /// The window is untouched, so the chat column widens and narrows instead of
  /// being covered — the shrink is a reflow, never an overlay.
  /// Settings, for the badge and the composer's link: one destination, one
  /// path, whether the user pressed `Space ,` or clicked.
  void _openSettings() {
    _select(Surface.settings);
    if (_insert) setState(() => _insert = false);
  }

  /// The rail's switch: expand it, or shrink it and hand the keyboard back.
  ///
  /// [focus] is true for the chord (`Space e`): a keyboard user who opens the
  /// rail wants to walk it. The top-bar button passes false — a pointer user
  /// expanding the rail is about to click, and taking the keyboard there left
  /// the page unable to accept focus.
  ///
  /// Below 900 px the rail is icons whatever the mode says, so the chord only
  /// moves the keyboard in and out of it and the mode is left alone.
  void _select(Surface surface) {
    if (surface == Surface.settings) {
      final store = CoreScope.of(context);
      if (store.appVersion == null) unawaited(store.refreshUpdateInfo());
      unawaited(store.refreshPrompts());
    }
    if (_paletteOpen) _closePalette();
    if (_commandOpen) _closeCommandLine();
    if (_surface == surface) {
      // Same surface: the page is still the destination, but it should be the
      // thing holding the keyboard again, in NORMAL.
      if (_leaderOpen) _closeLeader();
      setState(() {
        _sidebarFocused = false;
        _insert = false;
      });
      _returnToPage();
      return;
    }
    setState(() {
      _surface = surface;
      // Navigating gives the keyboard to the page that opens.
      _sidebarFocused = false;
      _focusBeforeRail = null;
      // The next surface starts in NORMAL and reports INSERT itself when its
      // composer takes focus.
      _insert = false;
      if (surface != Surface.sessions) {
        _sessionChatOpen = false;
        _sessionSettingsOpen = false;
        _wizardOpen = false;
      }
      if (surface != Surface.skills) _goalWizardOpen = false;
      if (surface != Surface.work) _workChatOpen = false;
      if (surface != Surface.work) _workApprovalsOpen = false;
      if (surface != Surface.work) _swarmOpen = false;
      if (surface != Surface.work) _workActivityOpen = false;
      if (surface != Surface.skills) _skillChatOpen = false;
      // The inventory is a Stats layer, so it closes whenever Stats is left.
      _achievementsOpen = false;
    });
    final store = CoreScope.of(context);
    if (surface == Surface.settings) {
      // Re-read the config on entry: a save elsewhere (or a failed read) must
      // not leave the rows stale, and the page's Retry only works if a read can
      // clear its own error.
      unawaited(store.refreshSettings());
      unawaited(store.refreshProviders());
      // MCP rows are read only when Settings opens: `mcp.list` is a core read and
      // `mcp.refresh` (the page's `r`) is the explicit reconnect, never startup.
      unawaited(store.refreshMcp());
      // The decision layer is a config read, so it costs nothing at startup.
      unawaited(store.refreshDecision());
      unawaited(store.refreshWorkPermissions());
    } else if (surface == Surface.stats) {
      // Returning to Stats refetches: usage changes while the user is in chat.
      unawaited(store.selectStats());
    } else if (surface == Surface.sessions) {
      unawaited(store.refreshSessions());
    } else if (surface == Surface.skills) {
      // Goal folders change while the user is elsewhere; refresh on entry. A
      // failure keeps the previous list, and the open goal is left alone.
      unawaited(store.refreshSkills());
    } else if (surface == Surface.work) {
      // Project metadata changes while the user is elsewhere; refresh on entry
      // rather than at startup. A failure keeps the previous list.
      unawaited(store.refreshProjects());
    } else if (surface == Surface.review) {
      // The queue is a snapshot of what the workspace records, so it is read on
      // entry rather than kept live: finishing a step elsewhere must be visible
      // here. A failure keeps the previous snapshot and the page says so.
      unawaited(store.refreshReview());
    } else if (surface == Surface.archive) {
      // The archive is a snapshot over the configured backend, so it is read on
      // entry rather than polled. A failure keeps the previous rows and the page
      // shows the core's message with a retry.
      unawaited(store.refreshArchive());
    } else if (surface == Surface.knowledge) {
      // The tree is a snapshot over the vaults: Markdown changes while the user
      // is elsewhere, so it is read on entry. A failure keeps the previous
      // groups and the page shows the core's message with a retry.
      unawaited(store.loadKnowledgeTree());
      unawaited(store.readLearningGraph());
    }
    // Skills keeps the open goal like Sessions and Work do, but the chapter
    // reader and the staged-lesson reader are layers of that surface: leaving
    // it collapses them back to the goal page, so returning never drops the
    // user into a lesson they did not ask for.
    if (surface != Surface.skills) {
      store.closeChapter();
      store.closeSkillLesson();
    }
    // A generated output is a layer of the session, not a surface: leaving
    // Sessions collapses it back to the detail while keeping the session open.
    if (surface != Surface.sessions) store.closeOutput();
    // The Knowledge reader is a layer of the surface too: leaving Knowledge
    // drops the open item and keeps the list's selection for the return.
    if (surface != Surface.knowledge) store.closeKnowledgeDocument();
  }

  /// One registry: every surface from the enum, then the core commands and the
  /// palette itself. The sidebar draws the same [Surface] values, and the core
  /// commands run through [_dispatchAction] so there is one handler per action,
  /// not one per surface that offers it.
  List<PaletteAction> _paletteActions() {
    // Every row that is a registry action shows that action's chord, so the
    // palette teaches the shortcut it stands for (`docs/design.md` §7.2).
    final keymap = _keymap(CoreScope.of(context));
    String? chord(String id) => keymap.rowFor(id)?.binding.display;
    return [
      for (final surface in Surface.values)
        PaletteAction(
          id: 'surface.${surface.name}',
          label: surface.label,
          hint: surface.hint,
          icon: surface.icon,
          binding: chord('surface.${surface.name}'),
          run: () => _select(surface),
        ),
      PaletteAction(
        // The registry's one `commands` action: the palette row is a name for
        // it, not a second implementation, and the binding is the same.
        id: 'commands',
        label: 'commands',
        hint: 'type : to run a command by name',
        icon: Icons.terminal,
        binding: chord('commands'),
        run: () => _dispatchAction('commands'),
      ),
      PaletteAction(
        id: 'core.refresh',
        label: 'refresh',
        hint: 'reload workspace and settings',
        icon: Icons.refresh,
        run: () => _dispatchAction('refresh'),
      ),
      PaletteAction(
        id: 'core.retry',
        label: 'retry',
        hint: 'reconnect the core',
        icon: Icons.restart_alt,
        run: () => _dispatchAction('retry'),
      ),
      PaletteAction(
        // The registry's one `achievements` action: the palette row is a name
        // for it, not a second implementation, and the binding is the same.
        id: 'achievements',
        label: 'achievements',
        hint: 'what you have unlocked',
        icon: Icons.emoji_events_outlined,
        binding: chord('achievements'),
        run: () => _dispatchAction('achievements'),
      ),
      PaletteAction(
        id: 'sidebar',
        label: 'sidebar',
        hint: _sidebarMode == SidebarMode.icons
            ? 'expand the rail and take its keys'
            : 'shrink the rail to icons',
        icon: Icons.vertical_split_outlined,
        binding: chord('sidebar'),
        run: () => _dispatchAction('sidebar'),
      ),
      const PaletteAction(
        id: 'palette.close',
        label: 'close',
        hint: 'dismiss this palette',
        icon: Icons.close,
        // Dismissal is the palette's own; running this row only closes it.
        run: _noop,
      ),
    ];
  }

  static void _noop() {}

  /// The trailing shortcut a sidebar row shows: the real registry binding, so
  /// the tenth surface reads `0` (Alt+0) rather than `10`, and a rebound
  /// surface reads the chord that actually opens it.
  static String _shortcutLabel(KeymapRow? row) {
    if (row == null) return '';
    final binding = row.binding;
    return binding.alt ? binding.key : binding.display;
  }

  bool _editingText() {
    final context = FocusManager.instance.primaryFocus?.context;
    if (context == null) return false;
    if (context.widget is EditableText) return true;
    return context.findAncestorWidgetOfExactType<EditableText>() != null;
  }

  /// Root-level key resolution through the registry, so a focused composer or
  /// search field cannot swallow a modifier chord and no second key list exists.
  KeyEventResult _rootKey(FocusNode node, KeyEvent event) {
    // One press, one action. Auto-repeat used to re-dispatch: a held `Esc`
    // closed Achievements and then left Stats as well, and a held `Ctrl+R`
    // restarted the core over and over.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    // A pending plugin write prompt is the strictest case: the core is waiting
    // on that answer, so nothing else may answer for it.
    if (CoreScope.of(context).pendingPermission != null) {
      return KeyEventResult.ignored;
    }
    // The leader's second key is resolved here, synchronously with the key that
    // opened it. The overlay's own `Focus` asks for focus in a post-frame
    // callback, so a chord typed within one frame — a fast hand on a 120 Hz
    // display, or a held `Space` — arrived while nothing had focus yet, and the
    // press was dropped. `_leaderOpen` is set in the same turn as the opening
    // key, so this path cannot miss it.
    if (_leaderOpen) {
      if (event.logicalKey == LogicalKeyboardKey.escape) {
        _closeLeader();
        return KeyEventResult.handled;
      }
      final leaderRow = leaderRowForKey(
        _keymap(CoreScope.of(context)).leaderRows(),
        event,
      );
      if (leaderRow != null) {
        _runLeaderRow(leaderRow);
        return KeyEventResult.handled;
      }
      // Navigation and `Enter` belong to the overlay once it holds focus; a key
      // nothing claims stays swallowed, so the surface underneath never sees it.
      return KeyEventResult.handled;
    }
    // Any other overlay owns the keyboard: its own handler runs first, and the
    // surface underneath must not also act on the same press. The exception is
    // the one frame before a text overlay's field holds focus: a printable
    // character typed there is buffered for the field rather than dropped.
    if (_overlayOpen) {
      if ((_paletteOpen || _commandOpen) && _isPrintable(event)) {
        setState(() => _overlayPending += event.character!);
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    final row = _keymap(CoreScope.of(context)).resolve(event);
    if (row == null) return KeyEventResult.ignored;
    final typing = _insert || _editingText();
    // `Esc` in a text field nobody else claimed leaves the field, not the
    // surface: the keyboard goes back to the page, which is NORMAL mode.
    if (row.id == 'close' && typing) {
      FocusManager.instance.primaryFocus?.unfocus(
        disposition: UnfocusDisposition.previouslyFocusedChild,
      );
      if (_insert) setState(() => _insert = false);
      return KeyEventResult.handled;
    }
    // A bare chord only fires in NORMAL mode with no text field focused. That
    // includes `:`: opening the command line from a text field meant a colon
    // could not be typed into the lock-in instructions or a goal.
    if (!row.binding.hasModifier && typing) return KeyEventResult.ignored;
    _dispatchAction(row.id);
    return KeyEventResult.handled;
  }

  /// A character a text field would accept: no chord modifier, no control key.
  ///
  /// `event.character` is set for the keys a field inserts and null for Enter,
  /// Tab, the arrows and the function keys, so this never swallows a navigation
  /// press meant for the overlay's own handler.
  bool _isPrintable(KeyEvent event) {
    final character = event.character;
    if (character == null || character.isEmpty) return false;
    if (character.codeUnitAt(0) < 0x20) return false;
    final keyboard = HardwareKeyboard.instance;
    return !keyboard.isControlPressed && !keyboard.isAltPressed;
  }

  /// Modified chords (`Ctrl+K`, `Ctrl+R`) resolve before any page sees them.
  ///
  /// A page's `Focus` handler runs before the shell's root handler, and every
  /// page reads bare letters: `Ctrl+K` was `k` to them. On Review and the deck
  /// that marked an item *known* on disk instead of opening the palette. An
  /// early handler runs ahead of the focus tree, so the registry's modified
  /// chords win everywhere, and a chord the registry does not bind (`Ctrl+S`,
  /// `Ctrl+C`) is left for the page and the platform.
  KeyEventResult _earlyKey(KeyEvent event) {
    if (event is! KeyDownEvent || !mounted) return KeyEventResult.ignored;
    final keyboard = HardwareKeyboard.instance;
    if (!keyboard.isControlPressed && !keyboard.isAltPressed) {
      return KeyEventResult.ignored;
    }
    // A dialog route owns its keys; so does an overlay or a consent prompt.
    if (!(ModalRoute.of(context)?.isCurrent ?? true)) {
      return KeyEventResult.ignored;
    }
    final store = CoreScope.of(context);
    if (_overlayOpen || store.pendingPermission != null) {
      return KeyEventResult.ignored;
    }
    final row = _keymap(store).resolve(event);
    if (row == null || !row.binding.hasModifier) return KeyEventResult.ignored;
    _dispatchAction(row.id);
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    // Below 900 px the rail is icons whatever the mode says: the labels do not
    // fit, and a narrow window still needs its navigation.
    _narrow = width < Breakpoints.rail;
    final compact = _narrow || _sidebarMode == SidebarMode.icons;
    final store = CoreScope.of(context);
    final keymap = _keymap(store);
    final pending = store.pendingPermission;
    final surfaceRows = [
      for (final surface in Surface.values)
        keymap.rowFor('surface.${surface.name}'),
    ].whereType<KeymapRow>().toList();
    final paletteKey = keymap.rowFor('palette')?.binding.display ?? 'Ctrl+K';
    // One line that fits the rail: the count of destinations and the chord that
    // lists every action. Individual chords live in each row's tooltip.
    final sidebarFooter = surfaceRows.isEmpty
        ? '$paletteKey palette'
        : '${surfaceRows.length} surfaces · $paletteKey';
    return Focus(
      autofocus: true,
      onKeyEvent: _rootKey,
      child: Scaffold(
        body: Stack(
          children: [
            Column(
              children: [
                TopBar(
                  surfaceLabel: _surface.label,
                  store: store,
                  sidebarExpanded: _sidebarMode == SidebarMode.expanded,
                  toggleHint: _sidebarToggleLabel(keymap),
                  // The button resizes; only the chord also takes the keys.
                  onToggleSidebar: () => _cycleSidebar(focus: false),
                  onOpenSettings: _openSettings,
                ),
                Expanded(
                  child: Row(
                    children: [
                      Sidebar(
                        cursorKey: _sidebarCursorKey,
                        focusNode: _sidebarFocus,
                        onKey: _sidebarKey,
                        onFocusChange: _onSidebarFocusChange,
                        focused: _sidebarFocused,
                        cursor: _sidebarFocused ? _sidebarCursor : -1,
                        compact: compact,
                        active: _surface,
                        footer: sidebarFooter,
                        shortcuts: {
                          for (final surface in Surface.values)
                            surface: _shortcutLabel(
                              keymap.rowFor('surface.${surface.name}'),
                            ),
                        },
                        onSelect: _pickSidebarSurface,
                        counts: _sidebarCounts(store),
                        achievements: _achievementsCount(store),
                        achievementsActive: _achievementsOpen,
                        onAchievements: _pickSidebarAchievements,
                        recent: _recentSessions(store),
                        onRecent: (id) =>
                            unawaited(_openRecentSession(store, id)),
                      ),
                      VerticalDivider(width: 1, color: LockedInColors.line),
                      Expanded(
                        // While the rail owns the keyboard the page may not
                        // take it back: the composer's `autofocus` and the
                        // leader's focus restore both run in the same frame,
                        // and a request that lands second would steal the rail
                        // mid-chord.
                        // `_pageProbe` never takes focus; it only answers
                        // "is the keyboard somewhere in the page". A click in
                        // the page is the pointer's way of saying "here", so it
                        // releases the rail and lets the click itself focus.
                        child: Listener(
                          onPointerDown: (_) {
                            if (_sidebarFocused) {
                              _leaveSidebar(restore: false);
                            }
                          },
                          child: Focus(
                            focusNode: _pageProbe,
                            // The probe answers "is the keyboard in the page"
                            // by being an ancestor; it must never *hold* focus,
                            // or it swallows autofocus when a page is swapped
                            // in (opening Achievements left `r` dead).
                            canRequestFocus: false,
                            child: KeyedSubtree(
                              key: ValueKey('page-$_pageEpoch'),
                              child: _body(store, keymap),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                StatusBar(
                  // The tokens and cost belong to the transcript on screen,
                  // not always to Chill's.
                  chat: _visibleChat(store),
                  insert: _insert,
                  label: _statusLabel(store),
                  hint: _statusHint(store, keymap),
                  helpKey: keymap.rowFor('help')?.binding.display ?? '?',
                ),
              ],
            ),
            if (_paletteOpen)
              Positioned.fill(
                child: CommandPalette(
                  pendingInput: _overlayPending,
                  actions: _paletteActions(),
                  onRun: _runAction,
                  onClose: _closePalette,
                ),
              ),
            // The command line is the typed twin of the palette: one field, a
            // live-filtered list of the registry's actions, `Esc` to dismiss.
            if (_commandOpen)
              Positioned.fill(
                child: CommandLine(
                  pendingInput: _overlayPending,
                  entries: commandEntries(keymap),
                  onRun: _runCommand,
                  onClose: _closeCommandLine,
                ),
              ),
            if (_leaderOpen)
              Positioned.fill(
                child: LeaderOverlay(
                  rows: keymap.leaderRows(),
                  onRun: _runLeaderRow,
                  onClose: _closeLeader,
                ),
              ),
            // The plugin write prompt is above every other layer: the core is
            // blocked on this one decision, so neither the palette nor a leader
            // chord may sit between the user and the answer.
            if (pending != null)
              Positioned.fill(
                child: PluginPermissionModal(
                  key: ValueKey('plugin-permission-${pending.requestId}'),
                  request: pending,
                  queued: store.queuedPermissions,
                  expired: store.permissionExpired(pending.requestId),
                  onDismissExpired: () =>
                      store.dismissPermission(pending.requestId),
                  error: store.pluginPermissionError,
                  onConfirm: (allow) =>
                      store.confirmPermission(pending.requestId, allow),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// The status bar's scope name. A session is its own scope, so the bar never
  /// says `SESSIONS` while a detail or transcript is on screen.
  String _statusLabel(CoreStore store) {
    if (_commandOpen) return 'COMMAND';
    if (_achievementsOpen) return 'ACHIEVEMENTS';
    if (_surface == Surface.sessions) {
      if (_wizardOpen) return 'NEW LOCK-IN';
      if (store.activeSession != null) {
        if (store.outputKind != null) {
          return store.outputKind == 'flashcards'
              ? 'FLASHCARDS'
              : 'STUDY GUIDE';
        }
        if (_sessionSettingsOpen) return 'SESSION SETTINGS';
        return _sessionChatOpen ? 'SESSION CHAT' : 'SESSION';
      }
    }
    if (_surface == Surface.work && store.activeProject != null) {
      if (_workActivityOpen) return 'ACTIVITY';
      if (_swarmOpen) return 'SWARM';
      if (_workApprovalsOpen) return 'APPROVALS';
      return _workChatOpen ? 'PROJECT CHAT' : 'PROJECT';
    }
    if (_surface == Surface.skills) {
      if (_goalWizardOpen) return 'NEW SESSION';
      if (store.activeSkill != null) {
        if (_skillChatOpen) return 'TEACHING CHAT';
        if (store.skillLessonOpen) return 'LESSON';
        return store.skillChapterOpen ? 'CHAPTER' : 'TEACHING';
      }
    }
    return _surface.label.toUpperCase();
  }

  /// The status bar's key hint for the layer that actually has focus.
  ///
  /// The surface hint is the default; a session, the wizard and an open project
  /// each explain their own keys instead, so the bar never advertises a list's
  /// controls while a transcript or form is on screen. The chat hint names the
  /// leader so the generated table is one key away, and the key it names is the
  /// registry's own binding, not a literal: rebinding the leader changes this
  /// line with it.
  String _statusHint(CoreStore store, KeymapRegistry keymap) {
    final leader = keymap.rowFor('leader')?.binding.display ?? 'Space';
    final leaderHint = '$leader leader';
    // Chat's hint depends on whether a turn can be sent: naming "Enter send"
    // over a disabled composer taught a key that did nothing.
    if (_surface == Surface.chat) {
      final chat = store.chat;
      final blocked = chat?.blocked;
      if (blocked != null) return '${blocked.reason} · $leaderHint';
      if (!store.configured) return 'no model · $leaderHint';
      // The composer strip owns the input keys (send, newline, attach, Esc).
      // Repeating them here was the review's duplicated-hint finding: the same
      // line appeared twice on one screen. The bar keeps the global chord.
      return leaderHint;
    }
    // Archive's own page names restore/delete; the status bar must not hide
    // them behind a different name for `r`.
    if (_surface == Surface.archive) {
      return 'j/k move · Enter restore · d delete · r refresh · Esc back';
    }
    if (_surface == Surface.sources) {
      return 'a add · r refresh · Esc back';
    }
    if (_achievementsOpen) {
      return 'hjkl / arrows move · Enter detail · r reload · Esc back';
    }
    if (_surface == Surface.knowledge && store.knowledgeDocumentOpen) {
      return 'j/k scroll · PgUp/PgDn page · Esc back';
    }
    if (_surface == Surface.sessions) {
      if (_wizardOpen) return 'Tab next · Enter continue · Esc back';
      if (store.activeSession != null) {
        if (store.outputKind != null) {
          // The deck's real keys (`session_outputs.dart`): Tab flips, 1-4
          // answers, h/l move, a/f/g/e grade, m/k mark, Shift+R rebuilds. The
          // old line named arrow scrolling and `R` for a deck that used
          // neither.
          return store.outputKind == 'flashcards'
              ? 'Tab flip · 1-4 answer · h/l move · a/f/g/e grade · Esc back'
              : 'a answers · R rebuild · Esc back';
        }
        if (_sessionSettingsOpen) {
          return 'Ctrl+S save · Esc back';
        }
        return _sessionChatOpen
            ? leaderHint
            : '↑↓ move · Space toggle · c chat · \\ leader · Esc back';
      }
    }
    if (_surface == Surface.work && store.activeProject != null) {
      if (_workActivityOpen) {
        return 'j/k move · s kind · r re-read · Esc back';
      }
      if (_swarmOpen) {
        return 'j/k move · Enter retry · n new run · x cancel · d remove · '
            'r refresh · Esc back';
      }
      if (_workApprovalsOpen) {
        return store.lastCommandOutcome != null
            ? '↑↓ move · Space hunk · y approve · n reject · x dismiss · '
                  '\\ leader · Esc back'
            : '↑↓ move · Space hunk · y approve · n reject · \\ leader · '
                  'Esc back';
      }
      // The project page's own keys: the statusline is where a keyboard user
      // looks first, and `Esc back` alone hid all of them.
      return _workChatOpen
          ? leaderHint
          : 'c chat · i instructions · p approvals · w swarm · l activity · r refresh · Esc back';
    }
    if (_surface == Surface.skills) {
      if (_goalWizardOpen) return 'Tab next · Enter continue · Esc back';
      if (store.activeSkill != null) {
        if (_skillChatOpen) {
          return leaderHint;
        }
        if (store.skillLessonOpen) return 'b build · R rebuild · Esc back';
        if (store.skillChapterOpen) return 'Esc back';
        // The teaching loop owns these keys (`skill_detail.dart`). The old
        // line named stage/chapter keys only, so the harness it advertises
        // looked inaccessible from the keyboard.
        final teaching = store.teaching;
        if (teaching != null) {
          return teaching.measured
              ? '1-4 jump · n next · i answer · s ask · c chat · a sources · Esc back'
              : '1-4 jump · m measure · a sources · Esc back';
        }
        if (store.activeSkill?.hasStages ?? false) {
          return '↑↓ move · Enter lesson · b build · c chat · Shift+N new chat · Esc back';
        }
        return '↑↓ move · Enter lesson · p practical · c chat · Esc back';
      }
    }
    return _surface.hint;
  }

  Widget _body(CoreStore store, KeymapRegistry keymap) {
    // Achievements is a layer over whatever surface you are on, not a detour
    // through Stats.
    if (_achievementsOpen) {
      return AchievementsPage(
        rows: store.achievements,
        earned: store.achievementsEarned,
        total: store.achievementsTotal,
        warning: store.achievementsWarning,
        loading: store.achievementsLoading,
        error: store.achievementsError,
        focusNode: _achievementsFocus,
        onRefresh: () => unawaited(store.refreshAchievements()),
        onBack: _closeAchievements,
      );
    }
    final page = switch (_surface) {
      Surface.chat => ChatPage(
        chat: store.chat,
        online: store.isOnline,
        configured: store.configured,
        error: store.error,
        initialText: _chatDraft,
        onDraftChanged: (text) => _chatDraft = text,
        onLinkModel: _openSettings,
        onSend: (text) async {
          // The draft clears only when the core accepted the turn; a refusal
          // keeps it, and the banner above the composer says why.
          final accepted = await store.sendChat(text);
          if (accepted) _chatDraft = '';
          return accepted;
        },
        onSendImages: (text, images) => store.sendChat(text, images: images),
        sendError: store.chatSendError,
        connecting: store.status == CoreStatus.connecting,
        onCancel: store.cancelChat,
        // A failed turn is retried by re-reading the transcript; restarting
        // the core would drop approvals, swarms and every chat controller.
        onRetry: () => unawaited(store.refreshChat()),
        onReconnect: store.retry,
        onModeChanged: (insert) {
          if (_insert != insert) setState(() => _insert = insert);
        },
      ),
      Surface.stats => StatsPage(
        summary: store.stats,
        loading: store.status == CoreStatus.connecting,
        error: store.error,
        onRetry: () => unawaited(store.selectStats()),
        range: store.stats?.range ?? 'all',
        scope: store.stats?.scope ?? 'all',
        onRange: (value) => store.selectStats(range: value),
        onScope: (value) => store.selectStats(scope: value),
        onExport: store.exportStats,
        onAchievements: _openAchievements,
      ),
      Surface.sessions => _sessions(store),
      Surface.skills => _skills(store),
      Surface.work => _work(store),
      Surface.review => ReviewPage(
        queue: store.review,
        loading: store.reviewLoading,
        error: store.reviewError,
        side: store.reviewSide,
        onRefresh: () => unawaited(store.refreshReview()),
        onSide: store.selectReviewSide,
        onMark: store.markReview,
        markingId: store.reviewMarkingId,
        onReview: () {
          final cards = store.review?.items.where(
            (item) => item.kind == 'card',
          );
          final first = cards == null || cards.isEmpty ? null : cards.first;
          if (first != null) _openReviewCard(store, first.contextId);
        },
        // The queue's rows open their own surface: a lock-in for steps, cards
        // and memory, a skill goal for a stage. Like every other open, it is
        // one click or Enter.
        onOpen: (item) {
          // A review card belongs in its deck, not on the session's step page:
          // pressing a missed card used to land somewhere it could not be
          // answered.
          if (item.kind == 'card') {
            _openReviewCard(store, item.contextId);
            return;
          }
          if (item.kind == 'task') {
            // A task belongs on its project, where the swarm board and the
            // verify action live; opening a session here would be a dead end.
            _select(Surface.work);
            unawaited(store.openProject(item.contextId));
            return;
          }
          if (item.kind == 'stage') {
            _select(Surface.skills);
            unawaited(store.openSkill(item.contextId));
          } else {
            _select(Surface.sessions);
            // `step:<sessionId>:<index>` names the step the queue row is about,
            // so the detail lands on it instead of the first step.
            final step = item.kind == 'step'
                ? _stepFromReviewId(item.id)
                : null;
            setState(() {
              _sessionChatOpen = false;
              _sessionSettingsOpen = false;
              _initialStep = step;
            });
            unawaited(_openSessionFromQueue(store, item.contextId));
          }
        },
        // Review is a snapshot over the workspace, not a layer: `Esc` goes
        // back to chat, the home surface, instead of inventing a parent list.
        onBack: () => _select(Surface.chat),
      ),
      Surface.archive => ArchivePage(
        rows: store.archiveRows,
        loading: store.archiveLoading,
        error: store.archiveError,
        onRefresh: () => unawaited(store.refreshArchive()),
        onRestore: (row) => store.restoreArchive(id: row.id, side: row.side),
        onDelete: (row) => store.removeArchive(id: row.id, side: row.side),
        // Archive is a snapshot over the workspace, not a layer: `Esc` goes back
        // to chat, the home surface, instead of inventing a parent list.
        onBack: () => _select(Surface.chat),
      ),
      Surface.knowledge => _knowledge(store),
      Surface.sources => SourcesPage(
        session: store.activeSession,
        sources: store.activeSession?.sources ?? const [],
        loading: store.status == CoreStatus.connecting,
        error: store.error,
        onAdd: store.activeSessionId == null
            ? null
            : (paths) => store.addSources(store.activeSessionId!, paths),
        onRefresh: store.activeSessionId == null
            ? null
            : () => store.refreshSources(store.activeSessionId!),
      ),
      Surface.settings => SettingsPage(
        settings: store.settings,
        loading:
            store.status == CoreStatus.connecting && store.settings == null,
        // Settings' own read error. The global slot belongs to whichever surface
        // wrote it, so a Chill failure used to say "Settings could not load" —
        // and the page's Retry could not clear a field it did not own.
        error: store.settingsError,
        onRefresh: store.refreshSettings,
        providers: store.providers,
        providersError: store.providersError,
        onLoadProviders: store.refreshProviders,
        onLinkProvider: (providerId, key, baseUrl) => store.linkProvider(
          providerId: providerId,
          key: key,
          baseUrl: baseUrl,
        ),
        onSaveSettings: store.saveSettings,
        mcpServers: store.mcpServers,
        mcpPolicy: store.mcpPolicy,
        mcpError: store.mcpError,
        onRefreshMcp: store.refreshMcpServers,
        onSetMcpPolicy: (command, server, value) =>
            store.setMcpPolicy(command, server, value),
        keymap: keymap,
        onSetKeybind: store.setKeybind,
        decision: store.decision,
        decisionLoading: store.decisionLoading,
        decisionError: store.decisionError,
        onSetDecision: store.setDecision,
        workPermissions: store.workPermissions,
        workPermissionsLoading: store.workPermissionsLoading,
        workPermissionsError: store.workPermissionsError,
        onSetWorkPermissions: store.setWorkPermissions,
        appVersion: store.appVersion,
        update: store.updateState,
        updateChecking: store.updateChecking,
        updateError: store.updateError,
        onCheckUpdate: () => unawaited(store.checkForUpdates()),
        prompts: store.prompts,
        promptsError: store.promptsError,
        onSetPrompt: store.setPrompt,
      ),
    };

    // A quiet FocusScope per shell layer. Pages autofocus their own `Focus`;
    // that request only applies inside a scope with no focused child, and the
    // shell's root `Focus` would otherwise own the single app-wide scope for
    // the whole session. A fresh scope per layer keeps `c`, arrows and `Esc`
    // working after every surface or session-layer switch.
    final layer = _workActivityOpen
        ? 'work-activity'
        : _swarmOpen
        ? 'swarm'
        : _workApprovalsOpen
        ? 'work-approvals'
        : _wizardOpen
        ? 'wizard'
        : _goalWizardOpen
        ? 'skill-wizard'
        : _sessionSettingsOpen
        ? 'session-settings'
        : store.outputKind != null
        ? 'session-output'
        : _sessionChatOpen || _workChatOpen || _skillChatOpen
        ? 'chat'
        : (store.activeSkill != null && store.skillChapterOpen)
        ? 'reader'
        : 'list';
    // The goal wizard is a layer with no goal of its own: keying it by the open
    // goal would tear the form down (and reset it) the moment the create opens
    // the new course. It keeps one identity for as long as it is open.
    final layerKey = _goalWizardOpen
        ? 'shell-body-${_surface.name}-$layer'
        : 'shell-body-${_surface.name}-$layer-'
              '${store.activeSessionId ?? ''}-${store.activeProjectId ?? ''}-'
              '${store.activeSkillId ?? ''}-${store.activeSkillChapterId ?? ''}-'
              '${store.activeSkillStageId ?? ''}-'
              '${store.outputKind ?? ''}-${store.activeSwarmId ?? ''}';
    return FocusScope(key: ValueKey(layerKey), autofocus: true, child: page);
  }

  /// Knowledge is two layers: the list, then one item read in the reader.
  ///
  /// The list stays mounted under the reader (first in the stack, and the reader
  /// is opaque), so the selection, the query and the scroll position are exactly
  /// where the user left them when `Esc` closes the item. The stack is always
  /// present — even with no reader — so adding the layer never re-creates the
  /// page and loses that state.
  Widget _work(CoreStore store) {
    final project = store.activeProject;
    if (project == null) {
      return WorkPage(
        projects: store.projects,
        loading:
            store.status == CoreStatus.connecting && store.projects.isEmpty,
        error: store.error,
        onRefresh: store.refreshProjects,
        onOpen: (row) {
          setState(() {
            _workChatOpen = false;
            _workApprovalsOpen = false;
            _swarmOpen = false;
          });
          unawaited(_openProject(store, row.id));
        },
        onCreate:
            ({
              required String name,
              required String folder,
              required String mode,
            }) async {
              final created = await store.createProject(
                name: name,
                folder: folder,
                mode: mode,
              );
              final opened = store.activeProjectId;
              if (opened != null) unawaited(store.refreshWorkChanges(opened));
              return created;
            },
      );
    }
    final projectId = store.activeProjectId;
    final chatId = store.activeWorkChatId;
    if (_workActivityOpen) {
      return ActivityPage(
        records: store.activityRecords,
        skipped: store.activitySkipped,
        empty: store.activityEmpty,
        loading: store.activityLoading,
        error: store.activityError,
        kind: store.activityKind,
        project: store.activityProject,
        onBack: () => setState(() => _workActivityOpen = false),
        onRefresh: () => unawaited(
          store.refreshActivity(
            kind: store.activityKind,
            project: store.activityProject,
          ),
        ),
        onKind: (kind) => unawaited(
          store.refreshActivity(kind: kind, project: store.activityProject),
        ),
      );
    }
    if (_swarmOpen) {
      return SwarmPage(
        project: project,
        runs: store.swarmRuns,
        board: store.activeSwarm,
        loading: store.swarmLoading,
        error: store.swarmError,
        onBack: () => setState(() => _swarmOpen = false),
        onRefresh: projectId == null
            ? null
            : () => unawaited(store.refreshSwarms(projectId)),
        onOpenRun: projectId == null
            ? null
            : (runId) => unawaited(store.openSwarm(projectId, runId)),
        onNewRun: projectId == null
            ? null
            : ({
                required String objective,
                required List<SwarmPlanEntry> plan,
                required int parallel,
              }) => store.runSwarm(
                projectId,
                objective: objective,
                plan: plan,
                parallel: parallel,
              ),
        onCancel: projectId == null
            ? null
            : (runId) => store.cancelSwarm(projectId, runId),
        onRemove: projectId == null
            ? null
            : (runId) => store.removeSwarm(projectId, runId),
        onRetry: projectId == null
            ? null
            : (runId, taskId) => store.retrySwarmTask(projectId, runId, taskId),
        onVerify: projectId == null
            ? null
            : (runId, taskId, verified) => store.verifySwarmTask(
                projectId,
                runId,
                taskId,
                verified: verified,
              ),
      );
    }
    if (_workApprovalsOpen) {
      return WorkApprovalsView(
        approvals: store.workApprovals,
        projectName: project.name,
        permissions: store.workPermissions,
        loading: store.approvalsLoading,
        error: store.approvalsError,
        onBack: () => setState(() => _workApprovalsOpen = false),
        onDecideWrite: projectId == null
            ? null
            : (id, decision, {hunks}) =>
                  store.decideWrite(id, decision, hunks: hunks),
        onDecideCommand: projectId == null
            ? null
            : (id, decision) => store.decideCommand(id, decision),
        lastCommand: store.lastCommandOutcome,
        onDismissLastCommand: store.dismissCommandOutcome,
      );
    }
    if (_workChatOpen && chatId != null) {
      final projectDraftKey = projectId == null
          ? null
          : 'project:$projectId:$chatId';
      return WorkChatView(
        project: project,
        chatId: chatId,
        chat: store.workChat,
        loading: store.status == CoreStatus.connecting,
        error: store.workChatError ?? store.error,
        initialText: projectDraftKey == null
            ? null
            : _chatDrafts[projectDraftKey],
        onDraftChanged: projectDraftKey == null
            ? null
            : (text) => _chatDrafts[projectDraftKey] = text,
        onBack: () => setState(() => _workChatOpen = false),
        onSend: projectId == null
            ? null
            : (text) async {
                final accepted = await store.sendWorkChat(
                  projectId,
                  chatId,
                  text,
                );
                if (accepted && projectDraftKey != null) {
                  _chatDrafts.remove(projectDraftKey);
                }
                return accepted;
              },
        sendError: store.workChatError,
        onCancel: projectId == null
            ? null
            : () => unawaited(store.cancelWorkChat(projectId, chatId)),
        onRetry: projectId == null
            ? null
            : () => unawaited(store.openWorkChat(projectId, chatId: chatId)),
        onModeChanged: (insert) {
          if (_insert != insert) setState(() => _insert = insert);
        },
      );
    }
    return WorkDetailView(
      project: project,
      loading: store.status == CoreStatus.connecting,
      error: store.error,
      chatCount: store.projectChats.length,
      latestChatId: store.projectChats.isEmpty ? null : store.projectChats.last,
      changes: store.workChanges,
      changesLoading: store.workChangesLoading,
      changesError: store.workChangesError,
      approvals: store.workApprovals,
      approvalsLoading: store.approvalsLoading,
      approvalsError: store.approvalsError,
      onOpenApprovals: projectId == null
          ? null
          : () => setState(() => _workApprovalsOpen = true),
      swarmRuns: store.swarmRuns,
      swarmLoading: store.swarmLoading,
      swarmError: store.swarmError,
      onOpenSwarm: projectId == null
          ? null
          : () => unawaited(_openSwarm(store, projectId)),
      activityCount: store.activityRecords.length,
      activityLoading: store.activityLoading,
      activityError: store.activityError,
      onOpenActivity: projectId == null
          ? null
          : () => unawaited(_openActivity(store, projectId)),
      onBack: () {
        setState(() {
          _swarmOpen = false;
          _workActivityOpen = false;
        });
        store.closeProject();
        if (_workApprovalsOpen) setState(() => _workApprovalsOpen = false);
      },
      onRetry: () {
        final id = store.activeProjectId;
        if (id != null) unawaited(store.openProject(id));
      },
      onOpenChat: projectId == null
          ? null
          : () => unawaited(_openWorkChat(store, projectId)),
      onRefreshChanges: projectId == null
          ? null
          : () => unawaited(store.refreshWorkChanges(projectId)),
      onSaveAgent: projectId == null
          ? null
          : (agent) => store.saveAgent(projectId, agent),
      onDeleteAgent: projectId == null
          ? null
          : (agentId) => store.deleteAgent(projectId, agentId),
      onSetDefaultAgent: projectId == null
          ? null
          : (agentId) => store.setDefaultAgent(projectId, agentId),
      onSaveInstructions: projectId == null
          ? null
          : (text) => store.saveProjectInstructions(projectId, text),
    );
  }

  /// Open a project, then read its working tree without blocking the detail.
  ///
  /// The detail paints as soon as `work.open` answers; `work.changes` is a
  /// second, page-local read that fills the CHANGES card when it lands. A failed
  /// open leaves the user where they were and the changes read is skipped.
  Future<void> _openProject(CoreStore store, String id) async {
    await store.openProject(id);
    if (!mounted) return;
    final opened = store.activeProjectId;
    if (opened == null || opened != id) return;
    if (_workApprovalsOpen) setState(() => _workApprovalsOpen = false);
    if (_swarmOpen) setState(() => _swarmOpen = false);
    if (_workActivityOpen) setState(() => _workActivityOpen = false);
    unawaited(store.refreshWorkChanges(opened));
  }

  /// Open the activity log for the open project.
  ///
  /// The detail already read the project's rows for its count, so this paints
  /// them immediately and refreshes them; a failure keeps the rows and shows
  /// the core's one-line reason on the page. The other Work layers collapse, so
  /// exactly one layer sits above the detail.
  Future<void> _openActivity(CoreStore store, String projectId) async {
    setState(() {
      _workActivityOpen = true;
      _swarmOpen = false;
      _workApprovalsOpen = false;
      _workChatOpen = false;
    });
    await store.refreshActivity(kind: store.activityKind, project: projectId);
  }

  /// Open the swarm board from the detail: show the runs already loaded, then
  /// read them and open the run the user last had, or the newest one. The board
  /// paints as soon as `work.swarm.board` answers, so a refusal shows its
  /// message on the page instead of an empty board.
  /// Rebuild a lesson the user may already have read: ask by name first.
  ///
  /// The core refuses an unconfirmed rebuild of a `ready` lesson, so this is
  /// the only path that replaces one; `buildSkillLesson` with `confirmed: true`
  /// runs after the answer, and the store's ticket makes a late reply safe.
  Future<void> _rebuildLesson(
    CoreStore store,
    String goalId,
    String stageId,
  ) async {
    if (!await _confirmLessonReplace(store, stageId)) return;
    if (!mounted) return;
    await store.buildSkillLesson(goalId, stageId, confirmed: true);
  }

  /// Replace a lesson from the `confirm` refusal card, after the same prompt.
  Future<void> _replaceLesson(
    CoreStore store,
    String goalId,
    String stageId,
  ) async {
    if (!await _confirmLessonReplace(store, stageId)) return;
    if (!mounted) return;
    await store.buildSkillLesson(goalId, stageId, confirmed: true);
  }

  Future<bool> _confirmLessonReplace(CoreStore store, String stageId) async {
    final title = store.activeSkillStage?.title ?? stageId;
    final answer = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('replace the lesson'),
        content: Text(
          'Replace the ready lesson “$title”? Its generated sections are '
          'rewritten from the goal’s sources; the file stays until the new one '
          'is written.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('lesson-replace-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('lesson-replace-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Replace'),
          ),
        ],
      ),
    );
    return answer ?? false;
  }

  Future<void> _openSwarm(CoreStore store, String projectId) async {
    setState(() => _swarmOpen = true);
    await store.refreshSwarms(projectId);
    if (!mounted) return;
    final runs = store.swarmRuns;
    if (runs.isEmpty) return;
    final current = store.activeSwarmId;
    final target = current != null && runs.any((run) => run.runId == current)
        ? current
        : runs.last.runId;
    await store.openSwarm(projectId, target);
  }

  /// Open the project chat from the detail: resume the chat the user last had
  /// open, or let the core pick the newest one. The detail stays on screen until
  /// the core answers, so a refusal shows its message instead of an empty chat.
  /// Open a session from the review queue: the detail, never a stale layer.
  /// Open a review card's session and put its deck on screen.
  ///
  /// A card is answered in the reader, not on the session's step page; this is
  /// the one route both the row and the primary `review cards` button use.
  void _openReviewCard(CoreStore store, String sessionId) {
    _select(Surface.sessions);
    setState(() {
      _sessionChatOpen = false;
      _sessionSettingsOpen = false;
      _initialStep = null;
    });
    unawaited(() async {
      await store.openSession(sessionId);
      await store.readOutput(sessionId, 'flashcards');
    }());
  }

  Future<void> _openSessionFromQueue(CoreStore store, String id) async {
    await store.openSession(id);
  }

  /// The step ordinal a review id names (`step:<session>:<index>`), or null.
  static int? _stepFromReviewId(String id) {
    final parts = id.split(':');
    if (parts.length < 3) return null;
    final index = int.tryParse(parts.last);
    return index != null && index >= 0 ? index : null;
  }

  Future<void> _openWorkChat(CoreStore store, String projectId) async {
    final opened = await store.openWorkChat(
      projectId,
      chatId: store.activeWorkChatId,
    );
    if (!mounted || !opened) return;
    setState(() {
      _workChatOpen = true;
      // The chat layer reports its own mode; never inherit a stale INSERT.
      _insert = false;
    });
  }
}
