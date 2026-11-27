part of 'settings_page.dart';

/// The settings actions: prompts, themes, the palette, policies and toggles.
extension _SettingsActions on _SettingsBodyState {
  /// shape, so there is no raw prompt to edit.
  Future<void> _editPrompt(SettingRow row) async {
    final write = widget.onSetPrompt;
    final promptId = row.promptId;
    if (write == null || promptId == null) return;
    final item = widget.prompts.firstWhere(
      (entry) => entry.id == promptId,
      orElse: () => PromptNoteView(
        id: promptId,
        label: row.label,
        description: row.hint,
        note: '',
        custom: false,
      ),
    );
    final text = await showDialog<String>(
      context: context,
      builder: (_) => PromptNoteDialog(prompt: item),
    );
    if (!mounted || text == null) return;
    refresh(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
      _noticeId = null;
      _notice = null;
    });
    try {
      await write(promptId, text);
      if (!mounted) return;
      refresh(() {
        _noticeId = row.id;
        _notice = text.trim().isEmpty
            ? '${row.label}: note cleared'
            : '${row.label}: note saved';
      });
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) refresh(() => _savingId = null);
    }
  }

  /// Choose a theme from the catalogue (`Enter` on the theme row).
  ///
  /// One `settings.patch` of `ui.theme`, then the palette is applied locally so
  /// the app repaints before the new snapshot arrives. A refusal keeps the old
  /// theme and prints the core's sentence under the row. Choosing the theme
  /// already in use writes nothing.
  Future<void> _openThemePicker() async {
    final save = widget.onSaveSettings;
    if (save == null) return;
    final picked = await showDialog<String>(
      context: context,
      builder: (_) => ThemePickerDialog(
        current: widget.settings.theme,
        customTokens: widget.customThemeTokens?.values ?? const {},
        overrideTokens: widget.customThemeTokens?.values ?? const {},
      ),
    );
    if (!mounted || picked == null) return;
    final tokens = widget.customThemeTokens?.values;
    if (picked == widget.settings.theme.trim()) {
      refresh(() {
        _noticeId = 'theme';
        _notice = 'already using ${paletteLabel(picked)}';
      });
      return;
    }
    refresh(() {
      _savingId = 'theme';
      _rowErrorId = null;
      _rowError = null;
      _noticeId = null;
      _notice = null;
    });
    try {
      await save({
        'ui': {'theme': picked},
      });
      if (!mounted) return;
      applyPaletteOr(picked, tokens: tokens);
      refresh(() {
        _savingId = null;
        _customApplied = picked == 'custom';
        _noticeId = 'theme';
        _notice = 'theme: ${paletteLabel(picked)}';
      });
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _rowErrorId = 'theme';
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) refresh(() => _savingId = null);
    }
  }

  /// Pick the custom palette (`c` on the theme row).
  ///
  /// This stores `ui.theme = "custom"` through the ordinary settings patch and
  /// applies the current tokens immediately, so the app repaints before the new
  /// snapshot arrives. An empty or partial token map is fine: crimson fills the
  /// gaps per token. A refusal keeps the old theme and prints the core's reason
  /// under the row.
  Future<void> _applyCustomTheme() async {
    final save = widget.onSaveSettings;
    if (save == null || _savingId != null) return;
    refresh(() {
      _savingId = 'theme';
      _rowErrorId = null;
      _rowError = null;
      _noticeId = null;
      _notice = null;
    });
    try {
      await save({
        'ui': {'theme': 'custom'},
      });
      if (!mounted) return;
      applyPalette('custom', tokens: widget.customThemeTokens?.values);
      refresh(() {
        _savingId = null;
        _customApplied = true;
      });
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _rowErrorId = 'theme';
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) refresh(() => _savingId = null);
    }
  }

  /// Open the twelve-token custom palette editor (`e` on the theme row).
  ///
  /// The dialog edits a local copy and only `s` writes it through
  /// `theme.custom.set`; a refusal keeps the dialog open with the core's own
  /// sentence. On success the palette repaints when `custom` is the stored (or
  /// just-applied) theme — editing tokens for a built-in theme stores them
  /// without changing what is on screen.
  Future<void> _openCustomPalette() async {
    final write = widget.onSetCustomTheme;
    if (write == null) {
      refresh(() {
        _noticeId = 'theme';
        _notice = 'this build cannot store a custom palette';
      });
      return;
    }
    final initial = widget.customThemeTokens ?? ThemeTokens.empty;
    final saved = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) =>
          CustomPaletteDialog(initial: initial.values, onSave: write),
    );
    if (!mounted || saved == null) return;
    final customIsActive =
        _customApplied || widget.settings.theme.trim() == 'custom';
    if (customIsActive) {
      applyPalette('custom', tokens: saved);
    }
    refresh(() {
      _noticeId = 'theme';
      _notice = saved.isEmpty
          ? 'custom palette cleared · crimson applies'
          : 'custom palette saved · ${saved.length} of '
                '${customThemeTokenNames.length} tokens';
    });
  }

  /// Export the base theme and every override as JSON on the clipboard.
  ///
  /// The app has no file picker of its own for a text document, and the
  /// clipboard is the path a desktop user already expects: `x`, then paste
  /// wherever they keep their themes. The shape is stable and human-editable.
  Future<void> _exportThemeJson() async {
    final tokens = widget.customThemeTokens?.values ?? const <String, String>{};
    final payload = themeDocumentJson(
      base: widget.settings.theme,
      tokens: tokens,
    );
    await Clipboard.setData(ClipboardData(text: payload));
    if (!mounted) return;
    refresh(() {
      _noticeId = 'theme';
      _notice = tokens.isEmpty
          ? 'theme JSON copied · no overrides'
          : 'theme JSON copied · ${tokens.length} overrides';
    });
  }

  /// Import a theme JSON document from the clipboard (or a pasted string).
  ///
  /// The document is validated before a byte is written: an unknown token or a
  /// value that is not `#RRGGBB` is refused by name, and the dialog stays open
  /// so the user can fix it. A `base` that names a known palette is selected on
  /// the same import; an unknown base is refused rather than silently ignored.
  Future<void> _importThemeJson() async {
    final write = widget.onSetCustomTheme;
    final save = widget.onSaveSettings;
    if (write == null) {
      refresh(() {
        _noticeId = 'theme';
        _notice = 'this build cannot store a custom palette';
      });
      return;
    }
    final imported = await showDialog<ImportedTheme>(
      context: context,
      builder: (_) => const ThemeJsonDialog(),
    );
    if (!mounted || imported == null) return;
    try {
      await write(imported.tokens);
      if (!mounted) return;
      if (imported.base != null &&
          imported.base != widget.settings.theme.trim()) {
        await save?.call({
          'ui': {'theme': imported.base},
        });
        if (!mounted) return;
      }
      final base = imported.base ?? widget.settings.theme.trim();
      applyPaletteOr(base, tokens: imported.tokens);
      refresh(() {
        _customApplied = base == 'custom';
        _noticeId = 'theme';
        _notice = imported.tokens.isEmpty
            ? 'theme imported · base ${paletteLabel(base)}'
            : 'theme imported · ${imported.tokens.length} overrides on '
                  '${paletteLabel(base)}';
      });
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _rowErrorId = 'theme';
        _rowError = userMessage(failure);
      });
    }
  }

  /// Cycle one policy cell and write it through the core once.
  ///
  /// `on` is skipped for the two commands that never call a plugin, so those
  /// cells move `explicit ↔ off`. The row keeps its stored value until the core
  /// accepts the write; a refusal leaves it unchanged with the message inline,
  /// and pressing Enter or Space again retries the same next value.
  Future<void> _advancePolicy(SettingRow row) async {
    final cell = row.policy;
    final write = widget.onSetMcpPolicy;
    if (cell == null || write == null) return;
    final next = nextPolicyValue(cell.command, cell.value);
    refresh(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
    });
    try {
      await write(cell.command, cell.server, next);
      if (!mounted) return;
      refresh(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) refresh(() => _savingId = null);
    }
  }

  /// True while the cursor sits on a keybind row, whose own footer already
  /// explains rebind/clear/reset.
  bool get _onKeybindRow =>
      _rows.isNotEmpty && _rows[_selected].id.startsWith('keybind-');

  /// Flip the decision layer through `decision.set`.
  ///
  /// The row keeps the stored value until the core answers: there is no
  /// optimistic flip, so a refusal leaves the toggle where it was with the
  /// core's own sentence inline. The shell re-renders `on`/`off` from the new
  /// `decision.get` view the store projects after the write.
  Future<void> _toggleDecision(
    SettingRow row,
    DecisionCell cell,
    Future<void> Function({bool? enabled, String? model}) write,
  ) async {
    if (_savingId != null) return;
    refresh(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
      _noticeId = null;
      _notice = null;
    });
    try {
      await write(enabled: !cell.enabled);
      if (!mounted) return;
      refresh(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) refresh(() => _savingId = null);
    }
  }

  /// Flip the global Work opt-in through `work.permissions.set`.
  ///
  /// The row keeps the stored value until the core answers: there is no
  /// optimistic flip, so a refusal leaves the row where it was with the core's
  /// own sentence inline. The shell re-renders the two flags from the view the
  /// store projects after the write.
  Future<void> _toggleWork(
    SettingRow row,
    WorkCell cell,
    Future<void> Function({bool? allowWrite, bool? allowCommand}) write,
  ) async {
    if (_savingId != null) return;
    refresh(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
    });
    try {
      await write(
        allowWrite: cell.kind == WorkKind.write ? !cell.allowed : null,
        allowCommand: cell.kind == WorkKind.command ? !cell.allowed : null,
      );
      if (!mounted) return;
      refresh(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) refresh(() => _savingId = null);
    }
  }

  /// Restate why the local model is unavailable.
  ///
  /// This is deliberately not an editor: no local model runtime is bundled, so
}
