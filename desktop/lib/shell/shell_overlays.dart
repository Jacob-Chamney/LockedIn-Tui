part of 'shell.dart';

/// The overlay wiring: palette, command line, leader and layer close.
extension _ShellOverlays on _ShellState {
  /// Remember who had the keyboard before the first overlay took it.
  void _rememberFocus() {
    if (_overlayOpen) return;
    final current = FocusManager.instance.primaryFocus;
    _focusBeforeOverlay = current != null && _inPage(current) ? current : null;
  }

  void _openPalette() {
    if (_paletteOpen) return;
    _rememberFocus();
    refresh(() => _paletteOpen = true);
  }

  void _closePalette() {
    if (!_paletteOpen) return;
    refresh(() {
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
    refresh(() => _commandOpen = true);
  }

  void _closeCommandLine() {
    if (!_commandOpen) return;
    refresh(() {
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
    refresh(() => _leaderOpen = true);
  }

  void _closeLeader() {
    if (!_leaderOpen) return;
    refresh(() => _leaderOpen = false);
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
    refresh(() {
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
    refresh(() {
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
      case 'clear-chat':
        // The core refuses mid-reply with its own sentence; the banner shows it.
        unawaited(store.clearChat());
      case 'achievements':
        _openAchievements();
      case 'sidebar':
        _cycleSidebar();
      case 'new-lock-in':
        _select(Surface.sessions);
        refresh(() {
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
        refresh(() {
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
        refresh(() {
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
        refresh(() {
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
        refresh(() => _initialStep = null);
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
}
