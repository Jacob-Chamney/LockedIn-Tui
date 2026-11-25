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
import '../theme/tokens.dart';
import 'command_line.dart';
import 'leader.dart';
import 'palette.dart';
import '../features/chat/usage_text.dart';

import 'plugin_permission.dart';

enum Surface {
  chat('Chat', '◇', Icons.forum_outlined, 'Enter send · Shift+Enter newline'),
  sessions('Sessions', '▤', Icons.history, '↑↓ move · / search · Esc clear'),
  // Teaching is the harness: measure → plan → teach → practice. The enum id is
  // `teaching` while the protocol keeps its `skill.*` methods and `skills`
  // storage — renaming those is a wire change, and the wall is a path rule, not
  // a label (`desktop/docs/redesign.md` §4a).
  skills(
    // The product name. The enum id and the `skill.*` methods keep the old
    // word: renaming those is a wire change, and the label is what a person
    // reads.
    'Teaching',
    '◈',
    Icons.school_outlined,
    'Enter open · n new goal · Esc back',
  ),
  sources('Sources', '▢', Icons.folder_open_outlined, 'a add · r reload'),
  stats(
    'Stats',
    '▦',
    Icons.insights_outlined,
    'r range · s scope · a achievements · x export',
  ),
  work(
    'Work',
    '⌗',
    Icons.work_outline,
    'n new project · Enter open · Esc back',
  ),
  review(
    'Review',
    '↻',
    Icons.checklist,
    'j/k move · Enter open · k known · m missed · r refresh · s side · Esc back',
  ),
  archive('Archive', '▣', Icons.archive_outlined, 'r refresh · Esc back'),
  knowledge(
    'Knowledge',
    '◍',
    Icons.hub_outlined,
    '/ search · j/k move · Enter open · Esc back',
  ),
  settings('Settings', '◆', Icons.tune, '↑↓ move · Enter edit · Esc back');

  const Surface(this.label, this.glyph, this.icon, this.hint);

  final String label;

  /// The mono glyph the expanded rail and the breadcrumb draw. A Material icon
  /// in a text column is what made the rail read as a phone app; the glyph is
  /// one terminal cell wide and sits on the same baseline as the label.
  final String glyph;

  /// The Material icon the **compact** rail draws. The narrow rail is 40 px and
  /// a glyph alone is hard to hit, so it keeps the icon (and its tests).
  final IconData icon;

  final String hint;
}

/// How the navigation rail is showing.
///
/// Two states only: full labels, or the icon rail. There is no "hidden" state —
/// a desktop window with no navigation is a dead end, and the shrink is what
/// gives the chat its width back. The rail starts **shrunk**, so a new window
/// opens on the chat with the icons down the side (`docs/design.md` §2.2).
enum SidebarMode {
  expanded,
  icons;

  IconData get icon => switch (this) {
    SidebarMode.expanded => Icons.menu_open,
    SidebarMode.icons => Icons.menu,
  };
}

/// Surface shortcuts come from the keymap registry (`Space` + a letter, as in
/// the terminal app), so there is no second table here: the sidebar draws its
/// grouped destinations and the registry decides which chord opens each one.

class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
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
  void _cycleSidebar({bool focus = true}) {
    if (_narrow) {
      if (!focus) return;
      if (_sidebarFocused) {
        _leaveSidebar();
      } else {
        _focusSidebar();
      }
      return;
    }
    if (_sidebarMode == SidebarMode.icons) {
      setState(() => _sidebarMode = SidebarMode.expanded);
      if (focus) _focusSidebar();
      return;
    }
    setState(() => _sidebarMode = SidebarMode.icons);
    _leaveSidebar();
  }

  /// Give the rail the keyboard so `j`/`k`/`Enter` work the moment it opens.
  ///
  /// The request waits for a painted frame (the `Focus` widget has to be in the
  /// tree first); the page subtree is excluded from focus while the flag is
  /// set, so a composer cannot take it back mid-request.
  void _focusSidebar() {
    final current = FocusManager.instance.primaryFocus;
    if (current != null && current != _sidebarFocus && _inPage(current)) {
      _focusBeforeRail = current;
    }
    setState(() => _sidebarFocused = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_sidebarFocused || _overlayOpen) return;
      if (_sidebarFocus.context == null) return;
      _sidebarFocus.requestFocus();
    });
  }

  /// Hand the keyboard back to the page, keeping the rail exactly as it is.
  ///
  /// [restore] is false when the pointer is what took it back: the click itself
  /// is the focus request, and asking for the previous node afterwards would
  /// pull the keyboard out of the field the user just clicked.
  void _leaveSidebar({bool restore = true}) {
    if (!_sidebarFocused && !_sidebarFocus.hasFocus) return;
    setState(() => _sidebarFocused = false);
    final previous = _focusBeforeRail;
    _focusBeforeRail = null;
    if (restore) _returnToPage(previous);
  }

  /// Keep the flag honest when the keyboard leaves the rail another way. The
  /// next frame re-checks, because a transient loss must not drop the cursor,
  /// and an overlay opened from the rail is not a loss at all: the rail gets
  /// the keyboard back when it closes.
  void _onSidebarFocusChange(bool hasFocus) {
    if (hasFocus || !_sidebarFocused) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_sidebarFocused || _overlayOpen) return;
      if (FocusManager.instance.primaryFocus == _sidebarFocus) return;
      setState(() => _sidebarFocused = false);
    });
  }

  bool _inPage(FocusNode node) => node.ancestors.contains(_pageProbe);

  /// Put the keyboard where it belongs once the current frame has settled.
  ///
  /// In order: an open overlay keeps it; a focused rail gets it; [previous] (the
  /// node that had it before an overlay or the rail) gets it back if it is still
  /// in the page. Only when none of those apply and nothing in the page holds
  /// focus is the page remounted so its `autofocus` runs again.
  void _returnToPage([FocusNode? previous]) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _overlayOpen) return;
      if (CoreScope.of(context).pendingPermission != null) return;
      if (_sidebarFocused) {
        if (_sidebarFocus.context != null) _sidebarFocus.requestFocus();
        return;
      }
      final target = previous ?? _focusBeforeOverlay;
      _focusBeforeOverlay = null;
      if (target != null &&
          target != _sidebarFocus &&
          target.context != null &&
          target.canRequestFocus &&
          _inPage(target)) {
        target.requestFocus();
        return;
      }
      // A page mounted in this frame takes focus with `autofocus`, which the
      // focus manager applies in a microtask after the frame. Look afterwards.
      scheduleMicrotask(() {
        if (!mounted || _overlayOpen || _sidebarFocused) return;
        if (_pageProbe.hasFocus) return;
        setState(() => _pageEpoch += 1);
      });
    });
  }

  /// The rail's keyboard rows, in the order the sidebar draws them: every
  /// grouped destination, then the pinned Settings row.
  ///
  /// One list, two readers (the drawn cursor index and this one), so a row can
  /// never be drawn in one place and picked in another.
  List<_SidebarEntry> get _sidebarTargets => [
    for (final group in _sidebarGroups) ...group.$2,
    const _SurfaceEntry(Surface.settings),
  ];

  void _moveSidebar(int delta) {
    final last = _sidebarTargets.length - 1;
    setState(() {
      _sidebarCursor = (_sidebarCursor + delta).clamp(0, last);
    });
    // The rail scrolls when it is taller than the window, so the cursor must
    // follow the picture: `j` past Archive used to walk off the bottom.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _sidebarCursorKey.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  void _activateSidebarRow() {
    final targets = _sidebarTargets;
    final index = _sidebarCursor.clamp(0, targets.length - 1);
    switch (targets[index]) {
      case _SurfaceEntry(:final surface):
        _select(surface);
      case _AchievementsEntry():
        _openAchievements();
    }
    _leaveSidebar();
  }

  /// A rail row picked with the pointer: the same destination as Enter, and the
  /// same release of the keyboard.
  void _pickSidebarSurface(Surface surface) {
    _select(surface);
    _leaveSidebar();
  }

  void _pickSidebarAchievements() {
    _openAchievements();
    _leaveSidebar();
  }

  KeyEventResult _sidebarKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _moveSidebar(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _moveSidebar(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.home) {
      setState(() => _sidebarCursor = 0);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.end) {
      setState(() => _sidebarCursor = _sidebarTargets.length - 1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (event is KeyDownEvent) _activateSidebarRow();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape ||
        key == LogicalKeyboardKey.arrowRight ||
        key == LogicalKeyboardKey.keyL) {
      _leaveSidebar();
      return KeyEventResult.handled;
    }
    // Space is deliberately not handled here. It is the leader everywhere,
    // and the rail has its own switch (`Space e`, or the top-bar button), so a
    // stray Space must not resize the rail under the user's hands.
    return KeyEventResult.ignored;
  }

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

  /// Remember who had the keyboard before the first overlay took it.
  void _rememberFocus() {
    if (_overlayOpen) return;
    final current = FocusManager.instance.primaryFocus;
    _focusBeforeOverlay = current != null && _inPage(current) ? current : null;
  }

  void _openPalette() {
    if (_paletteOpen) return;
    _rememberFocus();
    setState(() => _paletteOpen = true);
  }

  void _closePalette() {
    if (!_paletteOpen) return;
    setState(() {
      _paletteOpen = false;
      _overlayPending = '';
    });
    _returnToPage();
  }

  void _runAction(PaletteAction action) {
    _closePalette();
    action.run();
  }

  void _openCommandLine() {
    if (_commandOpen) return;
    _rememberFocus();
    setState(() => _commandOpen = true);
  }

  void _closeCommandLine() {
    if (!_commandOpen) return;
    setState(() {
      _commandOpen = false;
      _overlayPending = '';
    });
    _returnToPage();
  }

  /// Run one command: dismiss the line first, then dispatch the registry action.
  ///
  /// `close` and `commands` are the line's own two names — closing is the whole
  /// action, so dispatching `close` would also drop the surface underneath.
  void _runCommand(CommandEntry entry) {
    _closeCommandLine();
    if (entry.actionId == 'close' || entry.actionId == 'commands') return;
    _dispatchAction(entry.actionId);
  }

  /// The one key table, merged with the stored overrides the core reported.
  ///
  /// Rebuilt from the store on every build: a `keybinds.set` answer replaces both
  /// maps, so the next frame resolves the new binding and the old one stops
  /// working without a restart.
  KeymapRegistry _keymap(CoreStore store) => KeymapRegistry(
    // One catalogue: the surface/shell defaults plus the non-surface layers
    // (`achievements`), so the leader overlay, the Settings editor and the
    // dispatch all read the same rows.
    catalogue: shellActionCatalogue(),
    keybinds: store.keybinds,
    fixedKeybinds: store.fixedKeybinds,
  );

  void _openLeader() {
    if (_leaderOpen) return;
    _rememberFocus();
    setState(() => _leaderOpen = true);
  }

  void _closeLeader() {
    if (!_leaderOpen) return;
    setState(() => _leaderOpen = false);
    _returnToPage();
  }

  /// Open a goal and read its teaching record beside it.
  ///
  /// The record is a read, so it costs nothing at open; a failure keeps the
  /// previous record and the teaching card says why.
  Future<void> _openSkill(CoreStore store, String id) async {
    await store.openSkill(id);
    if (store.activeSkillId == id) unawaited(store.readTeaching(id));
  }

  void _runLeaderRow(KeymapRow row) {
    // `?` and the two leader rows *are* this overlay: running one from inside
    // it would close and reopen the same table for nothing.
    if (row.id == 'leader' || row.id == 'leader-alt' || row.id == 'help') {
      return;
    }
    _closeLeader();
    _dispatchAction(row.id);
  }

  /// Open the Achievements layer **in place**.
  ///
  /// It used to select Stats first, because the layer was built over the Stats
  /// page — so asking for achievements silently took you to Stats, and `Esc`
  /// left you there rather than where you started. The layer now sits above
  /// whatever surface you are on and `Esc` returns to it.
  void _openAchievements() {
    final store = CoreScope.of(context);
    setState(() {
      _achievementsOpen = true;
      _pageEpoch += 1;
    });
    // The keyboard follows the layer, so `r`/`j`/`k` act on it and not on the
    // surface underneath.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _achievementsOpen) _achievementsFocus.requestFocus();
    });
    unawaited(store.refreshAchievements());
  }

  void _closeAchievements() {
    if (!_achievementsOpen) return;
    setState(() {
      _achievementsOpen = false;
      _pageEpoch += 1;
    });
    // Hand the keyboard back to the surface that was underneath.
    _returnToPage();
  }

  /// Run one action from the registry, from its key or from the overlay.
  ///
  /// Every catalogue entry has a handler here; a row with no handler would be a
  /// validation failure in the TUI's registry, so this switch is the Flutter
  /// half of that contract.
  void _dispatchAction(String id) {
    final store = CoreScope.of(context);
    if (id.startsWith('surface.')) {
      final name = id.substring('surface.'.length);
      for (final surface in Surface.values) {
        if (surface.name == name) {
          _select(surface);
          return;
        }
      }
      return;
    }
    switch (id) {
      case 'palette':
        _openPalette();
      case 'commands':
        _openCommandLine();
      case 'leader':
      case 'leader-alt':
      case 'help':
        // `?` and `Space` show the same generated table: it is the help screen,
        // and it is also how a leader chord's second key is chosen.
        _openLeader();
      case 'refresh':
        unawaited(store.refreshAll());
      case 'retry':
        unawaited(store.retry());
      case 'achievements':
        _openAchievements();
      case 'sidebar':
        _cycleSidebar();
      case 'new-lock-in':
        _select(Surface.sessions);
        setState(() {
          _wizardOpen = true;
          _sessionChatOpen = false;
          _sessionSettingsOpen = false;
        });
      case 'work-agents':
      case 'work-changes':
        // Both live on the project detail; the verbs are the way to it from
        // anywhere, with any other layer collapsed.
        _select(Surface.work);
        final projectId = store.activeProjectId;
        // No open project: the Work list is the next action, and it says so.
        if (projectId == null) return;
        setState(() {
          _workChatOpen = false;
          _workApprovalsOpen = false;
          _swarmOpen = false;
          _workActivityOpen = false;
        });
        unawaited(store.refreshWorkChanges(projectId));
      case 'work-swarms':
        _select(Surface.work);
        final swarmProject = store.activeProjectId;
        if (swarmProject == null) return;
        // Opens the board's newest run as well as the layer: setting the flag
        // alone left `activeSwarm` null, so the page showed its empty card even
        // when runs existed.
        unawaited(_openSwarm(store, swarmProject));
      case 'work-chats':
        _select(Surface.work);
        final chatProject = store.activeProjectId;
        if (chatProject == null) return;
        // Collapse the sibling layers first, or `_work()` keeps rendering the
        // board/approvals/activity the chord was meant to leave.
        setState(() {
          _workApprovalsOpen = false;
          _swarmOpen = false;
          _workActivityOpen = false;
        });
        unawaited(_openWorkChat(store, chatProject));
      case 'flashcards':
        // With a session open the deck is one chord away; without one the
        // sessions manager is where a session comes from, which is what the
        // context-aware rule asks for (`docs/product.md` §5.4). The surface is
        // selected either way: the deck is a layer of Sessions, so from Chill
        // the chord used to change nothing on screen.
        final id = store.activeSessionId;
        _select(Surface.sessions);
        setState(() {
          _sessionChatOpen = false;
          _sessionSettingsOpen = false;
          _wizardOpen = false;
        });
        if (id != null) unawaited(store.readOutput(id, 'flashcards'));
      case 'close':
        _closeLayer();
    }
  }

  /// The review queue's step, consumed by the first build of the detail.
  ///
  /// The value used to be passed on every build, so every remount of the detail
  /// (back from chat, settings or an output) jumped back to that step.
  int? _stepToLandOn() {
    final step = _initialStep;
    if (step == null) return null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _initialStep == step) {
        setState(() => _initialStep = null);
      }
    });
    return step;
  }

  /// Close one layer: an overlay first, then the surface back to chat.
  ///
  /// A page's own `Esc` runs before this, so the root handler only ever sees an
  /// `Esc` nothing more specific wanted.
  void _closeLayer() {
    if (_paletteOpen) {
      _closePalette();
      return;
    }
    if (_leaderOpen) {
      _closeLeader();
      return;
    }
    if (_achievementsOpen) {
      _closeAchievements();
      return;
    }
    if (_surface != Surface.chat) _select(Surface.chat);
  }

  /// The transcript the status bar should report: whichever chat is on screen.
  ChatSnapshot? _visibleChat(CoreStore store) {
    if (_surface == Surface.sessions &&
        (_sessionChatOpen || store.outputKind == 'flashcards')) {
      return store.sessionChat;
    }
    if (_surface == Surface.skills && _skillChatOpen) {
      return store.skillChat;
    }
    if (_surface == Surface.work && _workChatOpen) {
      return store.workChat;
    }
    return store.chat;
  }

  /// True when the focused widget is an editable text field.
  ///
  /// A bare chord (a character, or `Space`) is `INPUT` while the user is typing:
  /// opening the leader on every space in a search field would be hostile. A
  /// modified chord (`Ctrl+K`, `Alt+2`) still resolves, which is why the palette
  /// survives a focused composer.
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
    _narrow = width < 900;
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
                _TopBar(
                  surface: _surface,
                  store: store,
                  sidebar: _sidebarMode,
                  toggleHint: _sidebarToggleLabel(keymap),
                  // The button resizes; only the chord also takes the keys.
                  onToggleSidebar: () => _cycleSidebar(focus: false),
                  onOpenSettings: _openSettings,
                ),
                Expanded(
                  child: Row(
                    children: [
                      _Sidebar(
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
                _StatusBar(
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
      if (chat?.streaming ?? false) return 'Esc stops · $leaderHint';
      if (!store.configured) return 'no model · $leaderHint';
      return 'Enter send · Shift+Enter newline · $leaderHint';
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
          return store.outputKind == 'flashcards'
              ? '↑↓ scroll · R rebuild · Esc back'
              : 'a answers · R rebuild · Esc back';
        }
        if (_sessionSettingsOpen) {
          return 'Ctrl+S save · Esc back';
        }
        return _sessionChatOpen
            ? 'Enter send · Shift+Enter newline · Esc normal'
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
          ? 'Enter send · Shift+Enter newline · Esc normal'
          : 'c chat · p approvals · w swarm · l activity · r refresh · Esc back';
    }
    if (_surface == Surface.skills) {
      if (_goalWizardOpen) return 'Tab next · Enter continue · Esc back';
      if (store.activeSkill != null) {
        if (_skillChatOpen) {
          return 'Enter send · Shift+Enter newline · Esc normal';
        }
        if (store.skillLessonOpen) return 'b build · R rebuild · Esc back';
        if (store.skillChapterOpen) return 'Esc back';
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
  Widget _knowledge(CoreStore store) {
    final page = KnowledgePage(
      hits: store.knowledgeHits,
      groups: store.knowledgeGroups,
      loading: store.knowledgeLoading,
      error: store.knowledgeError,
      query: store.knowledgeQuery,
      scope: store.knowledgeScope,
      active: !store.knowledgeDocumentOpen,
      onSearch: store.searchKnowledge,
      // `s` and a chip change the projection: the store re-runs the search or
      // reloads the tree, and a `work` scope reads the tree with `all`.
      onScope: (scope) => unawaited(store.selectKnowledgeScope(scope)),
      // `r` repeats what is on screen: a search stays a search, and only the
      // tree is re-read when there is no query. Reloading the tree under a
      // result list left the key looking dead.
      onRefresh: () => unawaited(
        store.knowledgeQuery.trim().isEmpty
            ? store.loadKnowledgeTree()
            : store.searchKnowledge(store.knowledgeQuery),
      ),
      // `Enter` reads the row through the core and shows it in the layer above.
      onOpen: (id) => unawaited(store.readKnowledge(id)),
      graph: store.learningGraph ?? LearningGraph.empty,
      graphLoading: store.learningGraphLoading,
      graphError: store.learningGraphError,
      onLoadGraph: () => unawaited(store.readLearningGraph()),
      // Knowledge is a read-only snapshot over the vaults, not a layer: `Esc`
      // goes back to chat, the home surface, instead of inventing a parent.
      onBack: () => _select(Surface.chat),
    );
    return Stack(
      fit: StackFit.expand,
      children: [
        page,
        if (store.knowledgeDocumentOpen)
          Positioned.fill(
            child: KnowledgeReader(
              documentId: store.knowledgeDocumentId ?? '',
              document: store.knowledgeDocument,
              loading: store.knowledgeDocumentLoading,
              error: store.knowledgeDocumentError,
              // The hit list lives in the store: `[`/`]` walk it in place
              // instead of going back to the list.
              hitIds: store.knowledgeHitOrder,
              hitIndex: store.knowledgeHitIndex,
              onNavigate: (index) => unawaited(store.openKnowledgeHit(index)),
              onRetry: () => unawaited(store.retryKnowledgeDocument()),
              onBack: store.closeKnowledgeDocument,
            ),
          ),
      ],
    );
  }

  /// Sessions is three layers: the list, the New lock-in wizard, the open
  /// session's detail, then its chat. The shell owns which layer is visible; the
  /// pages own their own `Esc`.
  Widget _sessions(CoreStore store) {
    if (_wizardOpen) {
      return NewSessionWizard(
        onCreate: (input) {
          // Read on Review, applied when the created session is open: the
          // wizard's completion callback only carries the id.
          _wizardWantsSteps = input.steps;
          return store.createSession(
            name: input.name,
            prompt: input.prompt,
            files: input.files,
            instructionsFile: input.instructionsFile,
            steps: input.steps,
          );
        },
        onCancel: () => setState(() => _wizardOpen = false),
        onCreated: (id) {
          final wantsSteps = _wizardWantsSteps;
          _wizardWantsSteps = true;
          setState(() {
            _wizardOpen = false;
            _sessionSettingsOpen = false;
          });
          // Open the detail first, then build the steps if the user asked for
          // them. The generation is a provider run: it must not hold the create
          // result, and the detail's own pending state shows the work.
          _initialStep = null;
          unawaited(() async {
            await store.openSession(id);
            if (wantsSteps) await store.generateSteps(id);
          }());
        },
      );
    }

    final active = store.activeSession;
    if (active == null) {
      return SessionsPage(
        sessions: store.sessions,
        loading:
            store.status == CoreStatus.connecting && store.sessions.isEmpty,
        error: store.error,
        onRefresh: store.refreshSessions,
        onCreate: () => setState(() {
          _wizardOpen = true;
          _sessionChatOpen = false;
          _sessionSettingsOpen = false;
        }),
        onOpen: (row) {
          // A new row always lands on its detail, never a stale chat layer, and
          // never on a step a review item asked for in another session.
          setState(() {
            _sessionChatOpen = false;
            _sessionSettingsOpen = false;
            _initialStep = null;
          });
          unawaited(store.openSession(row.id));
        },
        onArchive: (id) async {
          final backend = await store.archiveSession(id);
          _sessionLayerGone(store);
          return backend;
        },
        onDelete: (id) async {
          await store.removeSession(id);
          _sessionLayerGone(store);
        },
        onExport: store.exportSession,
      );
    }

    final sessionId = store.activeSessionId;
    if (_sessionSettingsOpen) {
      return SessionSettingsView(
        detail: active,
        instructions: store.sessionInstructions,
        loading:
            store.instructionsLoading ||
            (store.sessionInstructions == null &&
                store.instructionsError == null &&
                store.status == CoreStatus.connecting),
        error: store.instructionsError,
        onSave: sessionId == null
            ? null
            : (text) => store.saveSessionInstructions(sessionId, text),
        onImport: sessionId == null
            ? null
            : (file) => store.importSessionInstructions(sessionId, file),
        onReextract: sessionId == null
            ? null
            : () => store.reextractSessionInstructions(sessionId),
        onRetry: sessionId == null
            ? null
            : () => store.loadSessionInstructions(sessionId),
        onBack: () => setState(() => _sessionSettingsOpen = false),
      );
    }
    if (!_sessionChatOpen) {
      final outputKind = store.outputKind;
      if (outputKind != null) {
        return SessionOutputView(
          sessionName: active.name,
          kind: outputKind,
          markdown: store.outputMarkdown,
          cardsMarkdown: outputKind == 'flashcards'
              ? store.outputMarkdown
              : null,
          answers: store.outputAnswers,
          exists: store.outputExists,
          loading: store.outputLoading,
          error: store.outputError,
          onBuild: sessionId == null
              ? null
              : () => store.buildOutput(sessionId, outputKind),
          onReadAnswers: sessionId == null
              ? null
              : () => store.readOutput(sessionId, outputKind, part: 'answers'),
          onMarkSection: sessionId == null
              ? null
              : (index) => store.markGuideSection(sessionId, index),
          onMarkCard: sessionId == null
              ? null
              : (cardId, result) async {
                  await store.markReview('card:$sessionId:$cardId', result);
                  // The reply is the review queue, not the deck: re-read the
                  // deck so `M:`/`K:` come back from the core's own write.
                  await store.readOutput(sessionId, 'flashcards');
                },
          deckSchedule: store.deckSchedule,
          deckScheduleLoading: store.deckScheduleLoading,
          deckScheduleError: store.deckScheduleError,
          onGradeCard: sessionId == null
              ? null
              : (index, grade) => store.gradeDeckCard(sessionId, index, grade),
          onRetry: sessionId == null ? null : store.retryOutput,
          onBack: store.closeOutput,
        );
      }
      return SessionDetailView(
        detail: active,
        // Consumed once: a later open of the same session starts at step 0.
        initialStep: _stepToLandOn(),
        loading: store.status == CoreStatus.connecting,
        error: store.error,
        coverage: store.coverage,
        coverageLoading: store.coverageLoading,
        coverageError: store.coverageError,
        onRetryCoverage: sessionId == null
            ? null
            : () => unawaited(store.readCoverage(sessionId)),
        mistakes: store.mistakes,
        mistakesLoading: store.mistakesLoading,
        mistakesError: store.mistakesError,
        onRetryMistakes: sessionId == null
            ? null
            : () => unawaited(store.loadMistakes(sessionId)),
        onRecordMistake: sessionId == null
            ? null
            : (text, {step}) =>
                  store.recordMistake(sessionId, text, step: step),
        onPromoteMistake: sessionId == null
            ? null
            : (index, {correction}) => store.promoteMistake(
                sessionId,
                index,
                correction: correction,
              ),
        onCorrectMistake: sessionId == null
            ? null
            : (index, correction) =>
                  store.correctMistake(sessionId, index, correction),
        onBack: store.closeSession,
        onOpenChat: () => setState(() => _sessionChatOpen = true),
        onOpenSettings: () => setState(() {
          _sessionSettingsOpen = true;
          _sessionChatOpen = false;
        }),
        onOpenOutput: sessionId == null
            ? null
            : (kind) => store.readOutput(sessionId, kind),
        onToggleStep: sessionId == null
            ? null
            : (index) => store.toggleStep(sessionId, index),
        onGenerateSteps: sessionId == null
            ? null
            : () => store.generateSteps(sessionId),
        generatingSteps: store.generatingSteps,
        stepsError: store.stepsError,
        documentText: store.documentText,
        documentName: store.documentName,
        documentLoading: store.documentLoading,
        documentError: store.documentError,
        onGenerateDocument: sessionId == null
            ? null
            : (kind, {attempt}) =>
                  store.generateDocument(sessionId, kind, attempt: attempt),
        onRetryDocument: sessionId == null ? null : store.retryDocument,
        onCloseDocument: store.closeDocument,
        figures: store.figures,
        figureImages: store.figureImages,
        figuresLoading: store.figuresLoading,
        figureBusy: store.figureBusy,
        figureError: store.figureError,
        onExtractFigure: sessionId == null
            ? null
            : ({required page, x, y, width, height, caption = ''}) =>
                  store.extractFigure(
                    sessionId,
                    page: page,
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    caption: caption,
                  ),
        onLoadFigure: sessionId == null
            ? null
            : (figureId) => store.loadFigure(sessionId, figureId),
        onRemoveFigure: sessionId == null
            ? null
            : (figureId) => store.removeFigure(sessionId, figureId),
        onRetry: () {
          if (sessionId != null) unawaited(store.openSession(sessionId));
        },
      );
    }

    final sessionDraftKey = sessionId == null ? null : 'session:$sessionId';
    return SessionChatView(
      detail: active,
      chat: store.sessionChat,
      loading: false,
      error: store.sessionChatError ?? store.error,
      initialText: sessionDraftKey == null
          ? null
          : _chatDrafts[sessionDraftKey],
      onDraftChanged: sessionDraftKey == null
          ? null
          : (text) => _chatDrafts[sessionDraftKey] = text,
      onBack: () => setState(() => _sessionChatOpen = false),
      onSend: (text) async {
        if (sessionId == null) return false;
        final accepted = await store.sendSessionChat(sessionId, text);
        if (accepted && sessionDraftKey != null) {
          _chatDrafts.remove(sessionDraftKey);
        }
        return accepted;
      },
      sendError: store.sessionChatError,
      onCancel: () {
        if (sessionId != null) unawaited(store.cancelSessionChat(sessionId));
      },
      onRetry: () {
        if (sessionId != null) unawaited(store.openSession(sessionId));
      },
      onModeChanged: (insert) {
        if (_insert != insert) setState(() => _insert = insert);
      },
      context: store.sessionContext,
      contextLoading: store.sessionContextLoading,
      contextError: store.sessionContextError,
      onContextLoad: sessionId == null
          ? null
          : () => unawaited(store.readSessionContext(sessionId)),
      onCompact: sessionId == null
          ? null
          : () => unawaited(store.compactSessionChat(sessionId)),
      onUncompact: sessionId == null
          ? null
          : () => unawaited(store.uncompactSessionChat(sessionId)),
    );
  }

  /// After a confirmed archive or delete cleared the open session, collapse the
  /// chat layer with it.
  ///
  /// The manager is only visible when no session is open, so this normally does
  /// nothing; it exists so the shell never keeps a chat layer for a session the
  /// core has just archived or deleted.
  void _sessionLayerGone(CoreStore store) {
    if (!mounted) return;
    if (store.activeSessionId != null) return;
    if (!_sessionChatOpen && !_sessionSettingsOpen) return;
    setState(() {
      _sessionChatOpen = false;
      _sessionSettingsOpen = false;
    });
  }

  /// Skills has four layers: the goal list, the New skill goal wizard over it,
  /// one goal's course index, and a chapter reader over that. The shell owns
  /// which layer is visible; `Esc` climbs one layer, so the reader returns to
  /// the goal, the wizard to the list and the goal to the list. Switching
  /// surfaces collapses the wizard and the reader but keeps the goal open,
  /// exactly like a lock-in session.
  Widget _skills(CoreStore store) {
    if (_goalWizardOpen) {
      return GoalWizard(
        onCreate: ({required goal, required prior}) =>
            store.createSkill(goal: goal, prior: prior),
        onCancel: () => setState(() => _goalWizardOpen = false),
        onCreated: (_) {
          // `createSkill` already refreshed the rows and opened the new goal;
          // this callback only lands the shell on its detail. A create that
          // opened nothing leaves the list up with the core's own message,
          // never a second automatic open.
          setState(() => _goalWizardOpen = false);
        },
      );
    }

    final skill = store.activeSkill;
    final skillId = store.activeSkillId;
    if (skill == null) {
      return SkillsPage(
        skills: store.skills,
        loading: store.status == CoreStatus.connecting && store.skills.isEmpty,
        error: store.error,
        onRefresh: store.refreshSkills,
        onCreate: () => setState(() {
          _goalWizardOpen = true;
        }),
        onOpen: (row) {
          // A new goal always lands on its page, never a stale chat layer.
          setState(() => _skillChatOpen = false);
          unawaited(_openSkill(store, row.id));
        },
        onArchive: store.archiveSkill,
        onDelete: store.removeSkill,
        onExport: store.exportSkill,
      );
    }

    final chatId = store.activeSkillChatId;
    if (_skillChatOpen && chatId != null) {
      final goalDraftKey = skillId == null ? null : 'goal:$skillId:$chatId';
      return SkillChatView(
        skill: skill,
        chatId: chatId,
        chat: store.skillChat,
        loading: store.status == CoreStatus.connecting,
        error: store.skillChatError ?? store.error,
        initialText: goalDraftKey == null ? null : _chatDrafts[goalDraftKey],
        onDraftChanged: goalDraftKey == null
            ? null
            : (text) => _chatDrafts[goalDraftKey] = text,
        onBack: () => setState(() => _skillChatOpen = false),
        onSend: skillId == null
            ? null
            : (text) async {
                final accepted = await store.sendSkillChat(
                  skillId,
                  chatId,
                  text,
                );
                if (accepted && goalDraftKey != null) {
                  _chatDrafts.remove(goalDraftKey);
                }
                return accepted;
              },
        sendError: store.skillChatError,
        onCancel: skillId == null
            ? null
            : () => unawaited(store.cancelSkillChat(skillId, chatId)),
        onRetry: skillId == null
            ? null
            : () => unawaited(store.openSkillChat(skillId, chatId: chatId)),
        onModeChanged: (insert) {
          if (_insert != insert) setState(() => _insert = insert);
        },
      );
    }

    final stageId = store.activeSkillStageId;
    if (store.skillLessonOpen && stageId != null) {
      final stage = store.activeSkillStage;
      return SkillLessonView(
        stageId: stageId,
        stageTitle: stage?.title ?? 'staged lesson',
        stageStatus: stage?.status ?? '',
        goalName: skill.name,
        markdown: store.skillLessonMarkdown,
        exists: store.skillLessonExists,
        status: store.skillLessonStatus,
        citations: store.skillLessonCitations,
        loading: store.skillLessonLoading,
        error: store.skillLessonError,
        onBack: store.closeSkillLesson,
        needsConfirm: store.skillLessonNeedsConfirm,
        onBuild: skillId == null
            ? null
            : () => unawaited(store.buildSkillLesson(skillId, stageId)),
        onRebuild: skillId == null
            ? null
            : () => unawaited(_rebuildLesson(store, skillId, stageId)),
        onReplace: skillId == null
            ? null
            : () => unawaited(_replaceLesson(store, skillId, stageId)),
        onRetry: skillId == null ? null : store.retrySkillLesson,
      );
    }

    return SkillDetailView(
      detail: skill,
      loading: store.status == CoreStatus.connecting,
      error: store.error,
      teaching: store.teaching,
      teachingLoading: store.teachingLoading,
      teachingError: store.teachingError,
      teachingVerdict: store.teachingVerdict,
      onMeasure: skillId == null
          ? null
          : () => unawaited(store.measureTeaching(skillId)),
      onNextStep: skillId == null
          ? null
          : () => unawaited(store.teachNextStep(skillId)),
      onCheck: skillId == null
          ? null
          : (answer, thinking, confidence) => unawaited(
              store.checkTeaching(
                skillId,
                answer,
                thinking: thinking,
                confidence: confidence,
              ),
            ),
      sideMessages: store.teachingSide,
      sideLoading: store.teachingSideLoading,
      sideError: store.teachingSideError,
      onSideOpen: skillId == null
          ? null
          : () {
              final stepId = store.teaching?.current?.stepId;
              if (stepId != null) {
                unawaited(store.openTeachingSide(skillId, stepId));
              }
            },
      onSideSend: skillId == null
          ? null
          : (text) {
              final stepId = store.teaching?.current?.stepId;
              if (stepId != null) {
                unawaited(store.askTeachingSide(skillId, stepId, text));
              }
            },
      onSideClear: skillId == null
          ? null
          : () {
              final stepId = store.teaching?.current?.stepId;
              if (stepId != null) {
                unawaited(store.clearTeachingSide(skillId, stepId));
              }
            },
      research: store.research,
      researchLoading: store.researchLoading,
      researchRunning: store.researchRunning,
      researchError: store.researchError,
      researchMarkdown: store.researchMarkdown,
      researchOpenId: store.researchOpenId,
      onResearch: skillId == null
          ? null
          : (question, urls) =>
                unawaited(store.startResearch(skillId, question, urls)),
      onOpenResearch: skillId == null
          ? null
          : (id) => unawaited(store.openResearch(skillId, id)),
      onCloseResearch: store.closeResearch,
      onPractise: skillId == null
          ? null
          : () => unawaited(store.practiseTeaching(skillId)),
      onPracticeResult: skillId == null
          ? null
          : (problemId, verdict) =>
                unawaited(store.answerPractice(skillId, problemId, verdict)),
      chapterOpen: store.skillChapterOpen,
      chapter: store.activeSkillChapter,
      chapterLoading: store.skillChapterLoading,
      chapterError: store.skillChapterError,
      chats: store.skillChats,
      onBack: store.closeSkill,
      onRetry: () {
        if (skillId != null) unawaited(store.openSkill(skillId));
      },
      onOpenChapter: skillId == null
          ? null
          : (chapterId, {practical = false}) => unawaited(
              store.openSkillChapter(skillId, chapterId, practical: practical),
            ),
      onCloseChapter: store.closeChapter,
      onRetryChapter: store.retrySkillChapter,
      onOpenStage: skillId == null
          ? null
          : (target) => unawaited(store.openSkillLesson(skillId, target)),
      onBuildStage: skillId == null
          ? null
          : (target) => unawaited(store.buildSkillLesson(skillId, target)),
      onOpenChat: skillId == null
          ? null
          : () => unawaited(_openSkillChat(store, skillId)),
      onNewChat: skillId == null
          ? null
          : () => unawaited(_newSkillChat(store, skillId)),
      sources: store.skillSources,
      sourcesLoading: store.skillSourcesLoading,
      sourcesError: store.skillSourcesError,
      onAddSources: skillId == null
          ? null
          : (paths) => store.addSkillSources(skillId, paths),
      onRetrySources: skillId == null
          ? null
          : () => unawaited(store.refreshSkillSources(skillId)),
      onSaveStages: skillId == null
          ? null
          : (stages, {confirmed = false}) =>
                store.saveSkillStages(skillId, stages, confirmed: confirmed),
    );
  }

  /// Start a new transcript for the goal, then open it. A goal keeps many chats,
  /// so this is the only path that gets past the newest one.
  Future<void> _newSkillChat(CoreStore store, String goalId) async {
    final created = await store.createSkillChat(goalId);
    if (!mounted || !created) return;
    // A lesson reader is another layer of the same goal; collapse it so the new
    // chat is what the user sees.
    store.closeSkillLesson();
    setState(() => _skillChatOpen = true);
  }

  /// Open the goal chat from the page: resume the chat the user last had open,
  /// or let the core pick the newest one. The goal page stays on screen until
  /// the core answers, so a refusal shows its message instead of an empty chat.
  Future<void> _openSkillChat(CoreStore store, String goalId) async {
    final opened = await store.openSkillChat(
      goalId,
      chatId: store.activeSkillChatId,
    );
    if (!mounted || !opened) return;
    setState(() {
      _skillChatOpen = true;
      // The chat layer reports its own mode; never inherit a stale INSERT.
      _insert = false;
    });
  }

  /// Work is three layers: the registered projects, the open project's detail,
  /// then one of its chats. The shell owns which layer is visible; `Esc` climbs
  /// one layer, so the chat returns to the detail and the detail closes the
  /// project. Switching surfaces collapses the chat but keeps the project open,
  /// exactly like a lock-in session.
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

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.surface,
    required this.store,
    required this.sidebar,
    required this.toggleHint,
    required this.onToggleSidebar,
    required this.onOpenSettings,
  });

  final Surface surface;
  final CoreStore store;

  /// The rail's current state, so the toggle can say what the next press does.
  final SidebarMode sidebar;

  /// The registry's chord for that action (`Space e` by default).
  final String toggleHint;

  final VoidCallback onToggleSidebar;

  /// Settings, from the model badge.
  final VoidCallback onOpenSettings;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 38,
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(
          bottom: BorderSide(
            color: LockedInColors.line,
            width: Stroke.hairline,
          ),
        ),
      ),
      child: Row(
        children: [
          // A pointer path for the same registry action the chord runs, so the
          // sidebar is reachable with a mouse without being mouse-only.
          _RailToggle(mode: sidebar, hint: toggleHint, onTap: onToggleSidebar),
          const SizedBox(width: Space.sm),
          Text(
            'LOCKEDIN',
            style: LockedInType.micro.copyWith(
              color: LockedInColors.primary,
              letterSpacing: 2.2,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(width: Space.xs),
          Text(
            '›',
            style: LockedInType.micro.copyWith(color: LockedInColors.line),
          ),
          const SizedBox(width: Space.xs),
          Flexible(
            child: Text(
              surface.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: LockedInType.label.copyWith(
                color: LockedInColors.foreground,
                fontSize: 12.5,
              ),
            ),
          ),
          const Spacer(),
          // The badge may shrink; the breadcrumb keeps its space.
          Flexible(
            child: Align(
              alignment: Alignment.centerRight,
              child: _CoreChip(store: store, onOpenSettings: onOpenSettings),
            ),
          ),
          const SizedBox(width: Space.sm),
        ],
      ),
    );
  }
}

/// The rail's pointer toggle: a glyph, a hairline, and the chord in its tooltip.
class _RailToggle extends StatelessWidget {
  const _RailToggle({
    required this.mode,
    required this.hint,
    required this.onTap,
  });

  final SidebarMode mode;
  final String hint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final active = mode == SidebarMode.expanded;
    return Tooltip(
      message: '${active ? 'Shrink' : 'Expand'} sidebar ($hint)',
      waitDuration: const Duration(milliseconds: 400),
      child: InkWell(
        key: const ValueKey('sidebar-toggle'),
        onTap: onTap,
        child: Container(
          width: 38,
          height: 37,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border(
              right: BorderSide(
                color: LockedInColors.line,
                width: Stroke.hairline,
              ),
            ),
          ),
          child: Text(
            '≡',
            style: LockedInType.key.copyWith(
              color: active ? LockedInColors.primary : LockedInColors.muted,
              fontSize: 15,
            ),
          ),
        ),
      ),
    );
  }
}

class _CoreChip extends StatelessWidget {
  const _CoreChip({required this.store, this.onOpenSettings});

  final CoreStore store;

  /// The badge is the app's only model indicator, so it is also the way to
  /// Settings → Providers with a mouse.
  final VoidCallback? onOpenSettings;

  @override
  Widget build(BuildContext context) {
    final configured = store.configured;
    final model = store.workspace?.model ?? '';
    // Glyph + word, so the state never depends on colour alone.
    final (glyph, label, tone) = switch (store.status) {
      CoreStatus.connecting => ('◌', 'connecting…', LockedInColors.warning),
      CoreStatus.failed => ('×', 'core offline', LockedInColors.error),
      CoreStatus.offline => ('○', 'core offline', LockedInColors.muted),
      CoreStatus.online when !configured => (
        '!',
        'no model',
        LockedInColors.warning,
      ),
      CoreStatus.online => ('●', model, LockedInColors.success),
    };
    return Tooltip(
      message: configured ? label : 'open Settings → Providers',
      waitDuration: const Duration(milliseconds: 500),
      child: InkWell(
        key: const ValueKey('model-badge'),
        onTap: onOpenSettings,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Space.xs,
            vertical: Space.xxs,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(glyph, style: LockedInType.micro.copyWith(color: tone)),
              const SizedBox(width: Space.xxs + 2),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LockedInType.label.copyWith(
                    color: configured ? LockedInColors.foreground : tone,
                    fontSize: 11.5,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One destination in the sidebar: a surface, or the Achievements layer that
/// lives over Stats.
sealed class _SidebarEntry {
  const _SidebarEntry();
}

class _SurfaceEntry extends _SidebarEntry {
  const _SurfaceEntry(this.surface);
  final Surface surface;
}

class _AchievementsEntry extends _SidebarEntry {
  const _AchievementsEntry();
}

/// A heading in the sidebar and the destinations under it. `docs/design.md`
/// §2.4 asks for grouped destinations rather than one flat list; a null title
/// is the first, unlabelled group (Chill).
typedef _SidebarGroup = (String?, List<_SidebarEntry>);

const _sidebarGroups = <_SidebarGroup>[
  (null, [_SurfaceEntry(Surface.chat)]),
  (
    'LEARN',
    [
      _SurfaceEntry(Surface.sessions),
      _SurfaceEntry(Surface.skills),
      _SurfaceEntry(Surface.review),
    ],
  ),
  ('PRODUCTIVITY', [_SurfaceEntry(Surface.work)]),
  (
    'REFERENCE',
    [
      _SurfaceEntry(Surface.stats),
      _AchievementsEntry(),
      _SurfaceEntry(Surface.archive),
      _SurfaceEntry(Surface.knowledge),
    ],
  ),
];

class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.compact,
    required this.cursorKey,
    required this.active,
    required this.footer,
    required this.shortcuts,
    required this.onSelect,
    this.counts = const {},
    this.achievements = '',
    this.achievementsActive = false,
    this.onAchievements,
    this.recent = const [],
    this.onRecent,
    this.focusNode,
    this.onKey,
    this.onFocusChange,
    this.focused = false,
    this.cursor = -1,
  });

  /// The node the rail takes when it is opened from the keyboard, and the
  /// handler for `j`/`k`/`Enter`/`Esc` while it owns the keyboard.
  final FocusNode? focusNode;
  final KeyEventResult Function(FocusNode, KeyEvent)? onKey;

  /// Told when the keyboard arrives or leaves, so the shell's `focused` flag
  /// describes the rail rather than guessing.
  final ValueChanged<bool>? onFocusChange;

  /// True while the rail owns the keyboard; [cursor] is then the row under it
  /// (-1 when the rail is not focused).
  final bool focused;
  final int cursor;

  final bool compact;
  final Surface active;

  /// Each destination's size (`3` sessions, `12` review items). An absent or
  /// empty value draws no count, so a surface with nothing countable stays
  /// quiet instead of showing a meaningless zero.
  final Map<Surface, String> counts;

  /// `earned/total` for the Achievements row, or empty before it is read.
  final String achievements;

  /// True while the Achievements layer is open.
  final bool achievementsActive;

  /// Open the Achievements layer. Null when the shell cannot.
  final VoidCallback? onAchievements;

  /// The last few readable sessions, newest first. The sidebar lists them as
  /// destinations: selecting one opens that session, exactly as the Sessions
  /// manager would. Empty is a valid state and the section disappears rather
  /// than showing a placeholder list.
  final List<SessionRow> recent;

  /// Open one of [recent] by id. Null when the shell cannot open sessions.
  final ValueChanged<String>? onRecent;

  /// The generated shortcut summary, already resolved from the registry.
  final String footer;

  /// Each surface's real binding label, also resolved from the registry.
  final Map<Surface, String> shortcuts;

  final ValueChanged<Surface> onSelect;

  /// The cursor row's key, owned by the shell so `j` can scroll it into view.
  final GlobalKey cursorKey;

  /// Every destination in the order the rail draws them, then Settings.
  static final _entries = <_SidebarEntry>[
    for (final group in _sidebarGroups) ...group.$2,
  ];

  /// The keyboard cursor's index for a drawn row: its position in [_entries],
  /// and `_entries.length` for the pinned Settings row.
  static int _indexOf(_SidebarEntry entry) => _entries.indexOf(entry);

  String _countFor(_SidebarEntry entry) => switch (entry) {
    _SurfaceEntry(:final surface) => counts[surface] ?? '',
    _AchievementsEntry() => achievements,
  };

  String _shortcutFor(_SidebarEntry entry) => switch (entry) {
    _SurfaceEntry(:final surface) => shortcuts[surface] ?? '',
    // The achievements layer has no surface chord of its own; `a` is the
    // registry's action and the leader overlay documents it.
    _AchievementsEntry() => '',
  };

  bool _selected(_SidebarEntry entry) => switch (entry) {
    // While the Achievements layer is open it owns the screen, so the surface
    // underneath is not also lit. Two highlighted rows made it look as if the
    // layer had navigated to Stats.
    _SurfaceEntry(:final surface) => !achievementsActive && active == surface,
    // The layer is open or it is not; before, this row could never be active
    // because it was not a surface.
    _AchievementsEntry() => achievementsActive,
  };

  @override
  Widget build(BuildContext context) {
    final body = Container(
      width: compact ? 64 : 208,
      color: LockedInColors.surface,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The destinations scroll; the shortcut footer stays pinned. A short
          // window would otherwise overflow once `RECENT` is populated.
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final (index, group) in _sidebarGroups.indexed) ...[
                    if (group.$1 != null && !compact)
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          10,
                          index == 0 ? 6 : 14,
                          10,
                          6,
                        ),
                        child: Text(
                          group.$1!,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: 10,
                            letterSpacing: 1.4,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    if (group.$1 == null && !compact) const SizedBox(height: 4),
                    for (final entry in group.$2)
                      _SidebarRow(
                        key: focused && _indexOf(entry) == cursor
                            ? cursorKey
                            : null,
                        cursor: focused && _indexOf(entry) == cursor,
                        glyph: switch (entry) {
                          _SurfaceEntry(:final surface) => surface.glyph,
                          _AchievementsEntry() => '★',
                        },
                        countKey: switch (entry) {
                          _SurfaceEntry(:final surface) => surface.name,
                          _AchievementsEntry() => 'achievements',
                        },
                        label: switch (entry) {
                          _SurfaceEntry(:final surface) => surface.label,
                          _AchievementsEntry() => 'Achievements',
                        },
                        icon: switch (entry) {
                          _SurfaceEntry(:final surface) => surface.icon,
                          _AchievementsEntry() => Icons.emoji_events_outlined,
                        },
                        count: compact ? '' : _countFor(entry),
                        // The chord stays in the tooltip in the icon rail: it
                        // is the only place a keyboard user can learn it there.
                        shortcut: _shortcutFor(entry),
                        selected: _selected(entry),
                        compact: compact,
                        onTap: switch (entry) {
                          _SurfaceEntry(:final surface) => () => onSelect(
                            surface,
                          ),
                          _AchievementsEntry() => onAchievements,
                        },
                      ),
                  ],
                  if (!compact && recent.isNotEmpty && onRecent != null) ...[
                    const SizedBox(height: 14),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 0, 10, 6),
                      child: Text(
                        'RECENT',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 10,
                          letterSpacing: 1.4,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    for (final row in recent)
                      _RecentItem(row: row, onTap: () => onRecent!(row.id)),
                  ],
                ],
              ),
            ),
          ),
          // Settings is pinned under a rule: it is the destination a user
          // reaches for mid-task, and scrolling to find it would be a
          // regression from the flat list this replaced.
          if (!compact)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Container(height: 1, color: LockedInColors.line),
            ),
          _SidebarRow(
            key: focused && cursor == _entries.length ? cursorKey : null,
            cursor: focused && cursor == _entries.length,
            glyph: Surface.settings.glyph,
            label: Surface.settings.label,
            icon: Surface.settings.icon,
            count: '',
            shortcut: shortcuts[Surface.settings] ?? '',
            selected: active == Surface.settings,
            compact: compact,
            onTap: () => onSelect(Surface.settings),
          ),
          if (!compact)
            Padding(
              padding: const EdgeInsets.all(10),
              child: Text(
                footer,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 11,
                  height: 1.4,
                ),
              ),
            ),
        ],
      ),
    );
    return Focus(
      focusNode: focusNode,
      onKeyEvent: onKey,
      onFocusChange: onFocusChange,
      child: body,
    );
  }
}

/// One `RECENT` row: a session name and its date, opening on click.
///
/// It is deliberately not a `_SidebarRow`: a recent entry is a *destination*
/// inside Sessions, not a surface, so it carries no shortcut chip and no
/// selected state — the surface row already shows that Sessions is open.
///
/// The name and the date are one text node so the row reads as a destination
/// (`Physics — Unit 4 · 2026-11-15`) rather than a second copy of the title the
/// open session shows.
class _RecentItem extends StatelessWidget {
  const _RecentItem({required this.row, required this.onTap});

  final SessionRow row;
  final VoidCallback onTap;

  /// `name · YYYY-MM-DD`, or just the name when the core sent no date.
  String get _label {
    final name = row.name.isEmpty ? row.id : row.name;
    if (row.date.isEmpty) return name;
    final day = row.date.length >= 10 ? row.date.substring(0, 10) : row.date;
    return '$name · $day';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: onTap,
          child: Container(
            height: 32,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Row(
              children: [
                Icon(
                  Icons.chevron_right,
                  size: 14,
                  color: LockedInColors.muted,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _label,
                    key: ValueKey('recent-session-${row.id}'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: LockedInColors.muted, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A destination row: icon, label, its size, and the key that opens it.
///
/// The shortcut is drawn as a keycap on purpose. A bare muted digit beside a
/// label reads as a count, which is exactly what the old sidebar did: `Sessions
/// 2` looked like two sessions whether the user had two or twenty. The count
/// now sits next to the label and the digit sits in a bordered keycap.
class _SidebarRow extends StatelessWidget {
  const _SidebarRow({
    super.key,
    required this.label,
    required this.glyph,
    required this.icon,
    required this.count,
    this.countKey,
    required this.shortcut,
    required this.selected,
    required this.compact,
    required this.onTap,
    this.cursor = false,
  });

  final String label;

  /// The stable id the count key uses (`sessions`, `skills`, `work`). It is the
  /// surface name, not the label: renaming the product name must not move a
  /// test key.
  final String? countKey;

  /// The mono glyph the expanded rail draws.
  final String glyph;

  /// The Material icon the compact rail draws.
  final IconData icon;
  final String count;
  final String shortcut;
  final bool selected;
  final bool compact;
  final VoidCallback? onTap;

  /// True for the row under the rail's keyboard cursor: an accent border, so
  /// the keyboard's place is visible without relying on colour alone.
  final bool cursor;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      // `shortcut` is the registry's display form (`Space e`, `Ctrl+K`), so the
      // tooltip can never disagree with the binding.
      message: shortcut.isEmpty ? label : '$shortcut · $label',
      waitDuration: const Duration(milliseconds: 500),
      child: Padding(
        // The keyboard cursor is a widget of its own so a test can assert
        // *which* row it is on, not merely that some row has it.
        key: cursor ? const ValueKey('sidebar-row-cursor') : null,
        padding: const EdgeInsets.only(bottom: 1),
        child: Material(
          color: selected ? LockedInColors.panel : Colors.transparent,
          borderRadius: BorderRadius.circular(Radii.control),
          child: InkWell(
            borderRadius: BorderRadius.circular(Radii.control),
            onTap: onTap,
            child: Container(
              height: 30,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(Radii.control),
                // The keyboard cursor is a fill *and* an outline: a colour on
                // its own would vanish for a colour-blind user, and the active
                // row keeps its own accent bar (`docs/design.md` §2.3).
                color: cursor ? LockedInColors.panel : null,
                // Always one pixel wide, transparent when the row is not under
                // the cursor: the label must not jump as `j` walks the rail.
                border: Border.all(
                  color: cursor ? LockedInColors.accent : Colors.transparent,
                ),
              ),
              // The active destination keeps its accent bar pinned to the row's
              // left edge in both rail widths; the keyboard cursor is the
              // outline above, so the two never collide. The bar is a layer
              // (not a row child) so a centred icon stays centred beside it.
              child: Stack(
                children: [
                  if (selected)
                    Positioned(
                      left: 0,
                      top: 6,
                      bottom: 6,
                      child: Container(
                        key: ValueKey('sidebar-selected-${countKey ?? label}'),
                        width: 2,
                        color: LockedInColors.primary,
                      ),
                    ),
                  Positioned.fill(
                    child: Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: compact ? 0 : 10,
                      ),
                      child: Row(
                        mainAxisAlignment: compact
                            ? MainAxisAlignment.center
                            : MainAxisAlignment.start,
                        children: [
                          if (compact)
                            Icon(
                              icon,
                              size: 17,
                              color: selected
                                  ? LockedInColors.primary
                                  : LockedInColors.muted,
                            )
                          else
                            // One cell wide, so every label starts on the same
                            // column whatever the glyph is.
                            SizedBox(
                              width: 18,
                              child: Text(
                                glyph,
                                maxLines: 1,
                                style: LockedInType.body.copyWith(
                                  fontSize: 12,
                                  color: selected
                                      ? LockedInColors.primary
                                      : LockedInColors.muted,
                                ),
                              ),
                            ),
                          if (!compact) ...[
                            const SizedBox(width: Space.xs),
                            Expanded(
                              child: Text(
                                label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: LockedInType.body.copyWith(
                                  fontSize: 12.5,
                                  color: selected
                                      ? LockedInColors.foreground
                                      : LockedInColors.muted,
                                  fontWeight: selected
                                      ? FontWeight.w600
                                      : FontWeight.w400,
                                ),
                              ),
                            ),
                            // The size sits in a fixed, right-aligned column. The
                            // chord is not drawn here on purpose: beside a count it read
                            // as a second count ("Sessions 3 2"). It stays in the
                            // tooltip, the palette and the footer summary, which is
                            // where a keyboard user looks for a binding.
                            if (count.isNotEmpty)
                              SizedBox(
                                width: 30,
                                child: Text(
                                  count,
                                  key: ValueKey('sidebar-count-$countKey'),
                                  textAlign: TextAlign.right,
                                  maxLines: 1,
                                  style: LockedInType.label.copyWith(
                                    color: LockedInColors.muted,
                                    fontSize: 11,
                                    fontFeatures: const [
                                      FontFeature.tabularFigures(),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  const _StatusBar({
    required this.chat,
    required this.insert,
    required this.label,
    required this.hint,
    required this.helpKey,
  });

  /// The transcript the bar reports usage for: the one on screen.
  final ChatSnapshot? chat;
  final bool insert;

  /// The scope name: the surface label, or `SESSION` / `SESSION CHAT` inside a
  /// lock-in. Uppercased by the caller so the layout never changes.
  final String label;

  /// The keys for the layer that has focus, already resolved by the shell.
  final String hint;

  /// The registry's help chord, e.g. `?`.
  final String helpKey;

  String _usageLabel() {
    final chat = this.chat;
    // No snapshot is "not read", not "zero tokens spent".
    if (chat == null) return '— tok · cost unknown';
    // The same formatter the chats use: this copy kept the `.0`, so the status
    // bar said `2.0K` beside a chat that said `2K`.
    final compact = compactTokens(chat.usage.tokens);
    final cost = chatCostLabel(chat.usage.costMicroUsd);
    final duration = chat.usage.durationMs == null
        ? ''
        : ' · ${(chat.usage.durationMs! / 1000).toStringAsFixed(1)}s';
    return '$compact tok · $cost$duration';
  }

  @override
  Widget build(BuildContext context) {
    final micro = LockedInType.micro;
    return Container(
      height: 26,
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(
          top: BorderSide(color: LockedInColors.line, width: Stroke.hairline),
        ),
      ),
      child: Row(
        children: [
          // The scope, as a filled tab: the one place the accent is a surface.
          Container(
            height: 26,
            padding: const EdgeInsets.symmetric(horizontal: Space.xs),
            alignment: Alignment.center,
            color: LockedInColors.primary,
            child: Text(
              label,
              style: micro.copyWith(
                color: Theme.of(context).colorScheme.onPrimary,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.9,
              ),
            ),
          ),
          const _BarDivider(),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.xs),
            child: Text(
              insert ? 'INSERT' : 'NORMAL',
              style: micro.copyWith(
                color: insert
                    ? LockedInColors.primary
                    : LockedInColors.foreground,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.9,
              ),
            ),
          ),
          const _BarDivider(),
          const SizedBox(width: Space.xs),
          Expanded(
            child: Text(
              key: const ValueKey('status-hint'),
              hint,
              overflow: TextOverflow.ellipsis,
              style: micro.copyWith(
                color: LockedInColors.muted,
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
              ),
            ),
          ),
          const SizedBox(width: Space.xs),
          Text(
            _usageLabel(),
            style: micro.copyWith(
              color: LockedInColors.muted,
              fontWeight: FontWeight.w500,
              letterSpacing: 0,
            ),
          ),
          const _BarDivider(),
          const SizedBox(width: Space.xs),
          Text(
            '$helpKey help',
            style: micro.copyWith(
              color: LockedInColors.secondary,
              fontWeight: FontWeight.w600,
              letterSpacing: 0,
            ),
          ),
          const SizedBox(width: Space.sm),
        ],
      ),
    );
  }
}

/// A hairline cell separator in the status bar.
class _BarDivider extends StatelessWidget {
  const _BarDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: Stroke.hairline,
      height: 26,
      color: LockedInColors.line,
    );
  }
}
