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
import 'command_line.dart';
import 'leader.dart';
import 'palette.dart';
import 'plugin_permission.dart';

enum Surface {
  chat('Chat', Icons.forum_outlined, 'Enter send · Shift+Enter newline'),
  sessions('Sessions', Icons.history, '↑↓ move · / search · Esc clear'),
  skills('Skills', Icons.school_outlined, 'Enter open · n new goal · Esc back'),
  sources('Sources', Icons.folder_open_outlined, 'a add · r reload'),
  stats('Stats', Icons.insights_outlined, 'r range · s scope · x export'),
  work('Work', Icons.work_outline, 'n new project · Enter open · Esc back'),
  review(
    'Review',
    Icons.checklist,
    'r refresh · s side · k known · m missed · Esc back',
  ),
  archive('Archive', Icons.archive_outlined, 'r refresh · Esc back'),
  knowledge(
    'Knowledge',
    Icons.hub_outlined,
    '/ search · j/k move · Enter open · Esc back',
  ),
  settings('Settings', Icons.tune, 'connect a model · ↑↓ move');

  const Surface(this.label, this.icon, this.hint);

  final String label;
  final IconData icon;
  final String hint;
}

/// How the navigation rail is showing.
///
/// The terminal UI hid its explorer by default; a desktop window that starts
/// with no navigation is hostile, so the default is [expanded] and `Ctrl+B`
/// cycles through the three states the research notes ask for: full labels,
/// an icon rail, and nothing but a re-open chip (`docs/design.md` §2.2).
enum SidebarMode {
  expanded('expanded'),
  icons('icons'),
  hidden('hidden');

  const SidebarMode(this.label);

  final String label;

  /// The next state in the cycle.
  SidebarMode get next =>
      SidebarMode.values[(index + 1) % SidebarMode.values.length];

  IconData get icon => switch (this) {
    SidebarMode.expanded => Icons.menu_open,
    SidebarMode.icons => Icons.menu,
    SidebarMode.hidden => Icons.menu,
  };
}

/// Surface shortcuts come from the keymap registry (`alt+<n>` defaults: `1…9`
/// then `0` for the tenth), so there is no second table here: the sidebar draws
/// `Surface.values` and the registry decides which chord opens each one.

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

  /// The focus that held the keyboard when the leader opened, so closing it (or
  /// running a chord) returns the user to the page they were on.
  FocusNode? _focusBeforeLeader;

  /// Bumped whenever a page should start fresh: a surface switch, or an overlay
  /// action that ran. Pages take focus with `autofocus` on mount, and an overlay
  /// leaves the keyboard on the shell root, so a remount is how a page-local key
  /// (`n`, `g`, `/`, `Esc`) works again afterwards.
  int _pageEpoch = 0;

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

  /// How the navigation rail is showing. A cycle, not a boolean: the icon rail
  /// is the useful middle state on a laptop, and `hidden` is the TUI's default.
  SidebarMode _sidebarMode = SidebarMode.expanded;

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

  FocusNode? _focusBeforePalette;

  /// The focus that held the keyboard when the command line opened, so closing
  /// it returns the user to where they were (a page's search field, a list).
  FocusNode? _focusBeforeCommand;

  /// `Ctrl+B` as the registry spells it, for the rail's tooltips.
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
      Surface.sessions: '${store.sessions.length}',
      Surface.skills: '${store.skills.length}',
      Surface.work: '${store.projects.length}',
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
    });
    await store.openSession(id);
  }

  /// Cycle the navigation rail: expanded → icons → hidden → expanded.
  ///
  /// The window is untouched, so the chat column widens and narrows instead of
  /// being covered — a hidden rail is a reflow, never an overlay.
  void _cycleSidebar() {
    setState(() => _sidebarMode = _sidebarMode.next);
  }

  void _select(Surface surface) {
    if (_paletteOpen) _closePalette();
    if (_commandOpen) _closeCommandLine();
    if (_surface == surface) {
      // Same surface: the page is still the destination, but it should be the
      // thing holding the keyboard again.
      if (_leaderOpen) _closeLeader();
      setState(() => _pageEpoch += 1);
      return;
    }
    setState(() {
      _surface = surface;
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
      if (surface != Surface.stats) _achievementsOpen = false;
    });
    final store = CoreScope.of(context);
    if (surface == Surface.settings) {
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
        hint: 'cycle expanded, icons, hidden (${_sidebarMode.label} now)',
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

  void _openPalette() {
    if (_paletteOpen) return;
    _focusBeforePalette = FocusManager.instance.primaryFocus;
    setState(() => _paletteOpen = true);
  }

  void _closePalette() {
    if (!_paletteOpen) return;
    setState(() => _paletteOpen = false);
    final previous = _focusBeforePalette;
    _focusBeforePalette = null;
    if (previous == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // The node may have left the tree with its surface; a dead node keeps no
      // context and is simply skipped.
      if (previous.context != null) previous.requestFocus();
    });
  }

  void _runAction(PaletteAction action) {
    _closePalette();
    action.run();
    setState(() => _pageEpoch += 1);
  }

  void _openCommandLine() {
    if (_commandOpen) return;
    _focusBeforeCommand = FocusManager.instance.primaryFocus;
    setState(() => _commandOpen = true);
  }

  void _closeCommandLine() {
    if (!_commandOpen) return;
    setState(() => _commandOpen = false);
    final previous = _focusBeforeCommand;
    _focusBeforeCommand = null;
    if (previous == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // The node may have left the tree with its surface; a dead node keeps no
      // context and is simply skipped.
      if (previous.context != null) previous.requestFocus();
    });
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
    // Remember the page's focus node: the overlay takes the keyboard, and the
    // page has to get it back or its own keys (Enter, /, g, Esc) stop working.
    _focusBeforeLeader = FocusManager.instance.primaryFocus;
    setState(() => _leaderOpen = true);
  }

  void _closeLeader() {
    if (!_leaderOpen) return;
    setState(() => _leaderOpen = false);
    final previous = _focusBeforeLeader;
    _focusBeforeLeader = null;
    if (previous == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (previous.context != null) previous.requestFocus();
    });
  }

  void _runLeaderRow(KeymapRow row) {
    _closeLeader();
    _dispatchAction(row.id);
    // A row that did not change surface (refresh, retry, sidebar) still has to
    // hand the keyboard back to the page.
    setState(() => _pageEpoch += 1);
  }

  /// Open the Achievements layer over Stats.
  ///
  /// The layer belongs to Stats, so entering from anywhere else first selects
  /// Stats — its dashboard stays loaded underneath and `Esc` returns there. The
  /// read is a snapshot (and the core may record award dates), so it is fetched
  /// on open rather than kept live.
  void _openAchievements() {
    final store = CoreScope.of(context);
    if (_surface != Surface.stats) _select(Surface.stats);
    setState(() => _achievementsOpen = true);
    unawaited(store.refreshAchievements());
  }

  void _closeAchievements() {
    if (!_achievementsOpen) return;
    setState(() => _achievementsOpen = false);
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
      case 'flashcards':
        // With a session open the deck is one chord away; without one the
        // sessions manager is where a session comes from, which is what the
        // context-aware rule asks for (`docs/product.md` §5.4).
        final id = store.activeSessionId;
        if (id == null) {
          _select(Surface.sessions);
        } else {
          unawaited(store.readOutput(id, 'flashcards'));
        }
      case 'close':
        _closeLayer();
    }
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
    if (_surface == Surface.stats && _achievementsOpen) {
      _closeAchievements();
      return;
    }
    if (_surface != Surface.chat) _select(Surface.chat);
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
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // An overlay owns the keyboard: its own handler runs first, and the surface
    // underneath must not also act on the same press. A pending plugin write
    // prompt is the strictest case: the core is waiting on that answer.
    if (_paletteOpen ||
        _commandOpen ||
        _leaderOpen ||
        CoreScope.of(context).pendingPermission != null) {
      return KeyEventResult.ignored;
    }
    final row = _keymap(CoreScope.of(context)).resolve(event);
    if (row == null) return KeyEventResult.ignored;
    // `:` is the one bare chord that still fires over a page's text field: a
    // focused search box must not swallow the command line (the palette solves
    // the same problem with Ctrl+K, a modified chord). A chat composer is the
    // exception — it reports INSERT, and there `:` is a character to type.
    if (row.id == 'commands' && !_insert) {
      _dispatchAction(row.id);
      return KeyEventResult.handled;
    }
    // A bare chord only fires in NORMAL mode with no text field focused.
    if (!row.binding.hasModifier && (_insert || _editingText())) {
      return KeyEventResult.ignored;
    }
    _dispatchAction(row.id);
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    // Below 900 px the rail is icons whatever the mode says: the labels do not
    // fit, and hiding the only navigation would strand a narrow window.
    final compact = width < 900 || _sidebarMode == SidebarMode.icons;
    final railHidden = width >= 900 && _sidebarMode == SidebarMode.hidden;
    final store = CoreScope.of(context);
    final keymap = _keymap(store);
    final pending = store.pendingPermission;
    final surfaceRows = [
      for (final surface in Surface.values)
        keymap.rowFor('surface.${surface.name}'),
    ].whereType<KeymapRow>().toList();
    final paletteKey = keymap.rowFor('palette')?.binding.display ?? 'Ctrl+K';
    final sidebarFooter = surfaceRows.isEmpty
        ? '$paletteKey palette'
        : '${surfaceRows.first.binding.display}…${surfaceRows.length} '
              'surfaces · $paletteKey palette';
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
                  onToggleSidebar: _cycleSidebar,
                  railHidden: railHidden,
                ),
                Expanded(
                  child: Row(
                    children: [
                      if (railHidden)
                        _SidebarRail(
                          onShow: _cycleSidebar,
                          hint: _sidebarToggleLabel(keymap),
                        )
                      else
                        _Sidebar(
                          compact: compact,
                          active: _surface,
                          footer: sidebarFooter,
                          shortcuts: {
                            for (final surface in Surface.values)
                              surface: _shortcutLabel(
                                keymap.rowFor('surface.${surface.name}'),
                              ),
                          },
                          onSelect: _select,
                          counts: _sidebarCounts(store),
                          achievements: _achievementsCount(store),
                          onAchievements: _openAchievements,
                          recent: _recentSessions(store),
                          onRecent: (id) =>
                              unawaited(_openRecentSession(store, id)),
                        ),
                      VerticalDivider(width: 1, color: LockedInColors.line),
                      Expanded(
                        child: KeyedSubtree(
                          key: ValueKey('page-$_pageEpoch'),
                          child: _body(store, keymap),
                        ),
                      ),
                    ],
                  ),
                ),
                _StatusBar(
                  store: store,
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
    if (_surface == Surface.stats && _achievementsOpen) return 'ACHIEVEMENTS';
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
      if (_goalWizardOpen) return 'NEW SKILL';
      if (store.activeSkill != null) {
        if (_skillChatOpen) return 'SKILL CHAT';
        if (store.skillLessonOpen) return 'SKILL LESSON';
        return store.skillChapterOpen ? 'SKILL CHAPTER' : 'SKILL';
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
  /// registry's own binding, not a literal.
  String _statusHint(CoreStore store, KeymapRegistry keymap) {
    if (_surface == Surface.stats && _achievementsOpen) {
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
            ? 'Enter send · Shift+Enter newline · Esc back'
            : '↑↓ move · Space toggle · c chat · Esc back';
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
        return '↑↓ move · Space hunk · y approve · n reject · Esc back';
      }
      return _workChatOpen
          ? 'Enter send · Shift+Enter newline · Esc back'
          : 'Esc back';
    }
    if (_surface == Surface.skills) {
      if (_goalWizardOpen) return 'Tab next · Enter continue · Esc back';
      if (store.activeSkill != null) {
        if (_skillChatOpen) {
          return 'Enter send · Shift+Enter newline · Esc back';
        }
        if (store.skillLessonOpen) return 'b build · R rebuild · Esc back';
        if (store.skillChapterOpen) return 'Esc back';
        if (store.activeSkill?.hasStages ?? false) {
          return '↑↓ move · Enter lesson · b build · c chat · N new chat · Esc back';
        }
        return '↑↓ move · Enter lesson · p practical · c chat · Esc back';
      }
    }
    return _surface == Surface.chat
        ? '${_surface.hint} · '
              '${keymap.rowFor('leader')?.binding.display ?? 'Space'} '
              'leader'
        : _surface.hint;
  }

  Widget _body(CoreStore store, KeymapRegistry keymap) {
    final page = switch (_surface) {
      Surface.chat => ChatPage(
        chat: store.chat,
        online: store.isOnline,
        configured: store.configured,
        error: store.error,
        initialText: _chatDraft,
        onDraftChanged: (text) => _chatDraft = text,
        onSend: (text) {
          // A sent turn clears the draft; a refused send keeps it for another
          // try, so the text is never lost to a blocked composer.
          _chatDraft = '';
          store.sendChat(text);
        },
        onSendImages: (text, images) => store.sendChat(text, images: images),
        onCancel: store.cancelChat,
        onRetry: store.retry,
        onModeChanged: (insert) {
          if (_insert != insert) setState(() => _insert = insert);
        },
      ),
      Surface.stats =>
        _achievementsOpen
            ? AchievementsPage(
                rows: store.achievements,
                earned: store.achievementsEarned,
                total: store.achievementsTotal,
                warning: store.achievementsWarning,
                loading: store.achievementsLoading,
                error: store.achievementsError,
                onRefresh: () => unawaited(store.refreshAchievements()),
                onBack: _closeAchievements,
              )
            : StatsPage(
                summary: store.stats,
                loading: store.status == CoreStatus.connecting,
                error: store.status == CoreStatus.failed ? store.error : null,
                onRetry: store.retry,
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
        error: store.status == CoreStatus.failed ? store.error : null,
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
      onRefresh: () => unawaited(store.loadKnowledgeTree()),
      // `Enter` reads the row through the core and shows it in the layer above.
      onOpen: (id) => unawaited(store.readKnowledge(id)),
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
        error: store.status == CoreStatus.failed ? store.error : null,
        onRefresh: store.refreshSessions,
        onCreate: () => setState(() {
          _wizardOpen = true;
          _sessionChatOpen = false;
          _sessionSettingsOpen = false;
        }),
        onOpen: (row) {
          // A new row always lands on its detail, never a stale chat layer.
          setState(() {
            _sessionChatOpen = false;
            _sessionSettingsOpen = false;
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
          onMarkCard: sessionId == null
              ? null
              : (cardId, result) async {
                  await store.markReview('card:$sessionId:$cardId', result);
                  // The reply is the review queue, not the deck: re-read the
                  // deck so `M:`/`K:` come back from the core's own write.
                  await store.readOutput(sessionId, 'flashcards');
                },
          onRetry: sessionId == null ? null : store.retryOutput,
          onBack: store.closeOutput,
        );
      }
      return SessionDetailView(
        detail: active,
        loading: store.status == CoreStatus.connecting,
        error: store.error,
        coverage: store.coverage,
        coverageLoading: store.coverageLoading,
        coverageError: store.coverageError,
        onRetryCoverage: sessionId == null
            ? null
            : () => unawaited(store.readCoverage(sessionId)),
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
      onSend: (text) {
        if (sessionId != null) {
          if (sessionDraftKey != null) _chatDrafts.remove(sessionDraftKey);
          unawaited(store.sendSessionChat(sessionId, text));
        }
      },
      onCancel: () {
        if (sessionId != null) unawaited(store.cancelSessionChat(sessionId));
      },
      onRetry: () {
        if (sessionId != null) unawaited(store.openSession(sessionId));
      },
      onModeChanged: (insert) {
        if (_insert != insert) setState(() => _insert = insert);
      },
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
          unawaited(store.openSkill(row.id));
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
            : (text) {
                if (goalDraftKey != null) _chatDrafts.remove(goalDraftKey);
                unawaited(store.sendSkillChat(skillId, chatId, text));
              },
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
        onBuild: skillId == null
            ? null
            : () => unawaited(store.buildSkillLesson(skillId, stageId)),
        onRebuild: skillId == null
            ? null
            : () => unawaited(store.buildSkillLesson(skillId, stageId)),
        onRetry: skillId == null ? null : store.retrySkillLesson,
      );
    }

    return SkillDetailView(
      detail: skill,
      loading: store.status == CoreStatus.connecting,
      error: store.error,
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
            : (text) {
                if (projectDraftKey != null) {
                  _chatDrafts.remove(projectDraftKey);
                }
                unawaited(store.sendWorkChat(projectId, chatId, text));
              },
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
    required this.railHidden,
  });

  final Surface surface;
  final CoreStore store;

  /// The rail's current state, so the button's icon and tooltip can say what
  /// the next press will do.
  final SidebarMode sidebar;

  /// The registry's chord for that action (`Ctrl+B` by default).
  final String toggleHint;

  final VoidCallback onToggleSidebar;

  /// True when the rail is fully hidden: the top-bar button is then the second
  /// way back, beside the rail chip itself.
  final bool railHidden;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      height: 46,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          // A pointer path for the same registry action the chord runs, so the
          // sidebar is reachable with a mouse without being mouse-only.
          Tooltip(
            message: '${railHidden ? 'Show' : 'Cycle'} sidebar ($toggleHint)',
            waitDuration: const Duration(milliseconds: 400),
            child: InkWell(
              key: const ValueKey('sidebar-toggle'),
              borderRadius: BorderRadius.circular(4),
              onTap: onToggleSidebar,
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: Icon(
                  sidebar.icon,
                  size: 18,
                  color: railHidden
                      ? LockedInColors.primary
                      : LockedInColors.muted,
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            'LOCKEDIN',
            style: theme.textTheme.labelLarge?.copyWith(
              color: LockedInColors.primary,
              letterSpacing: 1.6,
            ),
          ),
          const SizedBox(width: 12),
          Text('›', style: TextStyle(color: LockedInColors.muted)),
          const SizedBox(width: 12),
          Text(
            surface.label,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: LockedInColors.foreground,
            ),
          ),
          const Spacer(),
          _CoreChip(store: store),
        ],
      ),
    );
  }
}

class _CoreChip extends StatelessWidget {
  const _CoreChip({required this.store});

  final CoreStore store;

  @override
  Widget build(BuildContext context) {
    final configured = store.configured;
    final model = store.workspace?.model ?? '';
    final (label, color, icon) = switch (store.status) {
      CoreStatus.connecting => (
        'connecting…',
        LockedInColors.warning,
        Icons.sync,
      ),
      CoreStatus.failed => (
        'core offline',
        LockedInColors.error,
        Icons.error_outline,
      ),
      CoreStatus.offline => (
        'core offline',
        LockedInColors.muted,
        Icons.circle_outlined,
      ),
      CoreStatus.online when !configured => (
        'no model connected',
        LockedInColors.warning,
        Icons.warning_amber_rounded,
      ),
      CoreStatus.online => (
        model,
        LockedInColors.success,
        Icons.check_circle_outline,
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
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
    required this.active,
    required this.footer,
    required this.shortcuts,
    required this.onSelect,
    this.counts = const {},
    this.achievements = '',
    this.onAchievements,
    this.recent = const [],
    this.onRecent,
  });

  final bool compact;
  final Surface active;

  /// Each destination's size (`3` sessions, `12` review items). An absent or
  /// empty value draws no count, so a surface with nothing countable stays
  /// quiet instead of showing a meaningless zero.
  final Map<Surface, String> counts;

  /// `earned/total` for the Achievements row, or empty before it is read.
  final String achievements;

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
    _SurfaceEntry(:final surface) => active == surface,
    _AchievementsEntry() => false,
  };

  @override
  Widget build(BuildContext context) {
    return Container(
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
                        label: switch (entry) {
                          _SurfaceEntry(:final surface) => surface.label,
                          _AchievementsEntry() => 'Achievements',
                        },
                        icon: switch (entry) {
                          _SurfaceEntry(:final surface) => surface.icon,
                          _AchievementsEntry() => Icons.emoji_events_outlined,
                        },
                        count: compact ? '' : _countFor(entry),
                        shortcut: compact ? '' : _shortcutFor(entry),
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
            label: Surface.settings.label,
            icon: Surface.settings.icon,
            count: '',
            shortcut: compact ? '' : (shortcuts[Surface.settings] ?? ''),
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
  }
}

/// One `RECENT` row: a session name and its date, opening on click.
///
/// It is deliberately not a `_SidebarRow`: a recent entry is a *destination*
/// inside Sessions, not a surface, so it carries no shortcut label and no
/// selected state — the surface row already shows that Sessions is open.
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
/// The 24 px rail left behind by a hidden sidebar.
///
/// It is deliberately not a 64 px icon rail: hiding is about giving the chat the
/// width, so what remains is one affordance that says the navigation is there
/// (`docs/design.md` §2.2: the explorer never covers the chat).
class _SidebarRail extends StatelessWidget {
  const _SidebarRail({required this.onShow, required this.hint});

  final VoidCallback onShow;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 26,
      color: LockedInColors.surface,
      alignment: Alignment.topCenter,
      padding: const EdgeInsets.only(top: 8),
      child: Tooltip(
        message: 'Show sidebar ($hint)',
        waitDuration: const Duration(milliseconds: 400),
        child: InkWell(
          key: const ValueKey('sidebar-rail'),
          borderRadius: BorderRadius.circular(4),
          onTap: onShow,
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: Icon(
              Icons.chevron_right,
              size: 16,
              color: LockedInColors.muted,
            ),
          ),
        ),
      ),
    );
  }
}

class _SidebarRow extends StatelessWidget {
  const _SidebarRow({
    required this.label,
    required this.icon,
    required this.count,
    required this.shortcut,
    required this.selected,
    required this.compact,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final String count;
  final String shortcut;
  final bool selected;
  final bool compact;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Tooltip(
      // `shortcut` is the registry's display form (`Space e`, `Ctrl+K`), so the
      // tooltip can never disagree with the binding.
      message: shortcut.isEmpty ? label : '$shortcut · $label',
      waitDuration: const Duration(milliseconds: 500),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 2),
        child: Material(
          color: selected ? LockedInColors.panel : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
          child: InkWell(
            borderRadius: BorderRadius.circular(6),
            onTap: onTap,
            child: Container(
              height: 40,
              padding: EdgeInsets.symmetric(horizontal: compact ? 0 : 10),
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(
                    color: selected
                        ? LockedInColors.primary
                        : Colors.transparent,
                    width: 2,
                  ),
                ),
              ),
              child: Row(
                mainAxisAlignment: compact
                    ? MainAxisAlignment.center
                    : MainAxisAlignment.start,
                children: [
                  Icon(
                    icon,
                    size: 18,
                    color: selected
                        ? LockedInColors.primary
                        : LockedInColors.muted,
                  ),
                  if (!compact) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium?.copyWith(
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
                          key: ValueKey('sidebar-count-${label.toLowerCase()}'),
                          textAlign: TextAlign.right,
                          maxLines: 1,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: 11,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ),
                  ],
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
    required this.store,
    required this.insert,
    required this.label,
    required this.hint,
    required this.helpKey,
  });

  final CoreStore store;
  final bool insert;

  /// The scope name: the surface label, or `SESSION` / `SESSION CHAT` inside a
  /// lock-in. Uppercased by the caller so the layout never changes.
  final String label;

  /// The keys for the layer that has focus, already resolved by the shell.
  final String hint;

  /// The registry's help chord, e.g. `?`.
  final String helpKey;

  String _usageLabel() {
    final chat = store.chat;
    if (chat == null) return '0 tok · cost unknown · $helpKey help';
    final tokens = chat.usage.tokens;
    final compact = tokens >= 1000000
        ? '${(tokens / 1000000).toStringAsFixed(1)}M'
        : tokens >= 1000
        ? '${(tokens / 1000).toStringAsFixed(1)}K'
        : '$tokens';
    final cost = chat.usage.costMicroUsd == null
        ? 'cost unknown'
        : '\$${(chat.usage.costMicroUsd! / 1000000).toStringAsFixed(4)}';
    final duration = chat.usage.durationMs == null
        ? ''
        : ' · ${(chat.usage.durationMs! / 1000).toStringAsFixed(1)}s';
    return '$compact tok · $cost$duration · $helpKey help';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 30,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(top: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(
              color: LockedInColors.background,
              backgroundColor: LockedInColors.primary,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            insert ? 'INSERT' : 'NORMAL',
            style: TextStyle(
              color: insert
                  ? LockedInColors.primary
                  : LockedInColors.foreground,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Text(
              key: const ValueKey('status-hint'),
              hint,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
          Text(
            _usageLabel(),
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ],
      ),
    );
  }
}
