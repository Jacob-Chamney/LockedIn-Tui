part of 'shell.dart';

/// Moving in and out of the sidebar rail.
///
extension _ShellSidebarKeys on _ShellState {
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
      refresh(() => _sidebarMode = SidebarMode.expanded);
      if (focus) _focusSidebar();
      return;
    }
    refresh(() => _sidebarMode = SidebarMode.icons);
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
    refresh(() => _sidebarFocused = true);
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
    refresh(() => _sidebarFocused = false);
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
      refresh(() => _sidebarFocused = false);
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
        refresh(() => _pageEpoch += 1);
      });
    });
  }

  /// The rail's keyboard rows, in the order the sidebar draws them: every
  /// grouped destination, then the pinned Settings row.
  ///
  /// One list, two readers (the drawn cursor index and this one), so a row can
  /// never be drawn in one place and picked in another.
  List<SidebarEntry> get _sidebarTargets => [
    for (final group in sidebarGroups) ...group.$2,
    const SurfaceEntry(Surface.settings),
  ];

  void _moveSidebar(int delta) {
    final last = _sidebarTargets.length - 1;
    refresh(() {
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
      case SurfaceEntry(:final surface):
        _select(surface);
      case AchievementsEntry():
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
    // A modified chord is not a letter: `Ctrl+J` used to walk the rail because
    // the handler read `j` and ignored the modifier (the same class of bug the
    // review found in Settings). Every key below is unmodified.
    if (HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isAltPressed ||
        HardwareKeyboard.instance.isMetaPressed) {
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
      refresh(() => _sidebarCursor = 0);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.end) {
      refresh(() => _sidebarCursor = _sidebarTargets.length - 1);
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
}
