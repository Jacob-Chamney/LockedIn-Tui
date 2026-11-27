part of 'shell.dart';

/// The root key router: mode, overlays, shortcuts and printable input.
extension _ShellKeys on _ShellState {
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
        refresh(() => _overlayPending += event.character!);
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
      if (_insert) refresh(() => _insert = false);
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
}
