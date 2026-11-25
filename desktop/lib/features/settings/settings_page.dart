import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';

import '../../bridge/core_scope.dart';
import '../../bridge/errors.dart';
import '../keys.dart';

import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../keymap/binding.dart';
import '../../keymap/registry.dart';
import '../../shell/chrome.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../../theme/tokens.dart';
import 'theme_picker.dart';
import 'keybinds_section.dart';

/// Projection of the core's settings snapshot with one write flow.
///
/// The shell passes the real [SettingsView] in and owns the core calls. The
/// only mutation offered here is connecting a model: link a provider key, then
/// choose a chat model. Everything else stays read-only.
class SettingsPage extends StatelessWidget {
  const SettingsPage({
    super.key,
    required this.settings,
    required this.loading,
    this.error,
    this.onRefresh,
    this.providers = const <ProviderRow>[],
    this.providersError,
    this.onLoadProviders,
    this.onLinkProvider,
    this.onSaveSettings,
    this.mcpServers = const <McpServerView>[],
    this.mcpPolicy = PluginPolicy.empty,
    this.mcpError,
    this.onRefreshMcp,
    this.onSetMcpPolicy,
    this.decision,
    this.decisionLoading = false,
    this.decisionError,
    this.onSetDecision,
    this.workPermissions,
    this.workPermissionsLoading = false,
    this.workPermissionsError,
    this.onSetWorkPermissions,
    this.keymap,
    this.onSetKeybind,
    this.customThemeTokens,
    this.onSetCustomTheme,
    this.appVersion,
    this.update,
    this.updateChecking = false,
    this.updateError,
    this.onCheckUpdate,
    this.prompts = const <PromptNoteView>[],
    this.promptsError,
    this.onSetPrompt,
  });

  final SettingsView? settings;
  final bool loading;
  final String? error;
  final VoidCallback? onRefresh;
  final List<ProviderRow> providers;
  final String? providersError;
  final Future<List<ProviderRow>> Function()? onLoadProviders;
  final Future<ProviderLink> Function(
    String providerId,
    String key,
    String? baseUrl,
  )?
  onLinkProvider;
  final Future<void> Function(Map<String, dynamic> patch)? onSaveSettings;

  /// Configured MCP servers (`mcp.list` / `mcp.refresh`), read-only here.
  final List<McpServerView> mcpServers;

  /// The stored per-command policy matrix, verbatim. Absent cells read
  /// `default`; the page never invents one.
  final PluginPolicy mcpPolicy;

  /// The last MCP read failure; the previous rows stay visible beside it.
  final String? mcpError;

  /// Reconnect through `mcp.refresh`. The only explicit child-process action on
  /// this page, bound to `r`.
  final Future<void> Function()? onRefreshMcp;

  /// Write one policy cell through `mcp.policy.set`.
  ///
  /// Non-null turns the matrix into one editable row per configured server and
  /// command; null keeps the read-only summary the page rendered before the set
  /// surface existed. A write is configuration only: it never starts or calls a
  /// server.
  final Future<void> Function(String command, String server, String value)?
  onSetMcpPolicy;

  /// The decision layer's stored view (`decision.get`), read by the shell when
  /// Settings opens. Null before the first read: the group then says the layer
  /// has not been read rather than inventing a local model.
  final DecisionView? decision;

  /// True while `decision.get` is in flight.
  final bool decisionLoading;

  /// The last decision-layer read failure; the previous view stays visible.
  final String? decisionError;

  /// Write one decision-layer value through `decision.set`.
  ///
  /// Non-null makes the `enabled` row an actionable toggle. Null keeps the group
  /// read-only: selection still works, but no write is offered. There is no
  /// writer for the `model` row in any build: the core refuses a non-empty model
  /// because no local model runtime is bundled.
  final Future<void> Function({bool? enabled, String? model})? onSetDecision;

  /// The global Work opt-in (`work.permissions.get`), or null before the first
  /// read. Null renders `not loaded yet`, never an implicit permission.
  final WorkPermissions? workPermissions;

  /// True while `work.permissions.get` is in flight.
  final bool workPermissionsLoading;

  /// The last Work-permissions read failure; the previous view stays visible.
  final String? workPermissionsError;

  /// Write one global opt-in through `work.permissions.set`. Non-null makes the
  /// two `WORK` rows actionable; null keeps the group read-only.
  final Future<void> Function({bool? allowWrite, bool? allowCommand})?
  onSetWorkPermissions;

  /// The one key table. Null renders the built-in catalogue, so the `KEYBINDS`
  /// group is never empty even before the shell supplies its registry.
  final KeymapRegistry? keymap;

  /// Write one binding through `keybinds.set`. Null keeps the group read-only:
  /// selection still works, but no capture, clear or reset writes anything.
  final Future<void> Function(String action, String? binding, {bool fixed})?
  onSetKeybind;

  /// The stored `[ui.custom_theme]` overrides (`theme.custom.get`). Null falls
  /// back to the enclosing [CoreScope]'s store, which is what the shell uses;
  /// an empty map is a valid answer and the editor fills crimson per token.
  final ThemeTokens? customThemeTokens;

  /// Replace the custom palette (`theme.custom.set`). Null falls back to the
  /// [CoreScope] store and, with neither available, keeps the editor read-only.
  final Future<ThemeTokens> Function(Map<String, String> tokens)?
  onSetCustomTheme;

  /// The running build's version (`update.info`), or null before it is read.
  final String? appVersion;

  /// The last explicit update check, or null before one ran.
  final UpdateView? update;

  /// True while a check is in flight.
  final bool updateChecking;

  /// The last update failure, shown under the row.
  final String? updateError;

  /// Run one check (`update.check`).
  final VoidCallback? onCheckUpdate;

  /// The prompt catalogue with its notes (`prompts.list`).
  final List<PromptNoteView> prompts;
  final String? promptsError;

  /// Set or clear one note (`prompts.set`). Null keeps the group read-only.
  final Future<void> Function(String id, String text)? onSetPrompt;

  bool get _canConnect => onLinkProvider != null && onSaveSettings != null;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final narrow = constraints.maxWidth < Breakpoints.stack;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Chrome, not a title: a section label, the scope on the right and
            // a hairline, the same shape as every other surface's header.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.lg,
                Space.md,
                Space.lg,
                Space.xs,
              ),
              child: Row(
                children: [
                  const Expanded(child: SectionLabel('settings')),
                  Text(
                    'workspace',
                    style: LockedInType.micro.copyWith(
                      color: LockedInColors.muted,
                      fontWeight: FontWeight.w500,
                      letterSpacing: 0,
                    ),
                  ),
                ],
              ),
            ),
            const Rule(),
            Expanded(child: _body(context, narrow)),
          ],
        );
      },
    );
  }

  Future<void> _openConnect(BuildContext context) async {
    final snapshot = settings;
    final link = onLinkProvider;
    final save = onSaveSettings;
    if (snapshot == null || link == null || save == null) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _ConnectModelDialog(
        settings: snapshot,
        providers: providers,
        providersError: providersError,
        onLoadProviders: onLoadProviders,
        onLinkProvider: link,
        onSaveSettings: save,
      ),
    );
  }

  Widget _body(BuildContext context, bool narrow) {
    if (loading) {
      return const _StateMessage(
        icon: Icons.hourglass_empty,
        title: 'loading settings…',
        body: 'Reading the workspace configuration from the core.',
      );
    }
    final failure = error;
    if (failure != null && failure.isNotEmpty) {
      return _StateMessage(
        icon: Icons.error_outline,
        tone: LockedInColors.error,
        title: 'Settings could not load',
        body: failure,
        action: onRefresh,
      );
    }
    final snapshot = settings;
    if (snapshot == null) {
      return _StateMessage(
        icon: Icons.link_off,
        tone: LockedInColors.warning,
        title: 'Settings unavailable',
        body:
            'The core is not connected. Settings load from the workspace '
            'once the shell links to the core.',
        action: onRefresh,
      );
    }
    // The custom palette is the one group with no prop of its own in the shell
    // today: the page reads the enclosing store, so a Settings write reaches the
    // same `theme.custom.*` methods a future prop would pass explicitly.
    final store = CoreScope.maybeOf(context);
    return _SettingsBody(
      settings: snapshot,
      narrow: narrow,
      onConnect: _canConnect ? () => _openConnect(context) : null,
      onSaveSettings: onSaveSettings,
      mcpServers: mcpServers,
      mcpPolicy: mcpPolicy,
      mcpError: mcpError,
      onRefreshMcp: onRefreshMcp,
      onSetMcpPolicy: onSetMcpPolicy,
      decision: decision,
      decisionLoading: decisionLoading,
      decisionError: decisionError,
      onSetDecision: onSetDecision,
      workPermissions: workPermissions,
      workPermissionsLoading: workPermissionsLoading,
      workPermissionsError: workPermissionsError,
      onSetWorkPermissions: onSetWorkPermissions,
      // The default catalogue keeps the group complete for a page rendered
      // without a shell; the shell passes the merged registry so stored
      // overrides show exactly as the leader overlay and dispatch use them.
      keymap: keymap ?? KeymapRegistry(),
      onSetKeybind: onSetKeybind,
      customThemeTokens: customThemeTokens ?? store?.customThemeTokens,
      onSetCustomTheme: onSetCustomTheme ?? store?.setCustomTheme,
      appVersion: appVersion,
      update: update,
      updateChecking: updateChecking,
      updateError: updateError,
      onCheckUpdate: onCheckUpdate,
      prompts: prompts,
      promptsError: promptsError,
      onSetPrompt: onSetPrompt,
    );
  }
}

/// One snapshot rendered as grouped rows with a selectable cursor.
///
/// Rows with an editor open on Enter (or toggle on Space) when the shell has
/// supplied [onSaveSettings]; every other row stays a read-only projection.
class _SettingsBody extends StatefulWidget {
  const _SettingsBody({
    required this.settings,
    required this.narrow,
    this.onConnect,
    this.onSaveSettings,
    this.mcpServers = const <McpServerView>[],
    this.mcpPolicy = PluginPolicy.empty,
    this.mcpError,
    this.onRefreshMcp,
    this.onSetMcpPolicy,
    this.decision,
    this.decisionLoading = false,
    this.decisionError,
    this.onSetDecision,
    this.workPermissions,
    this.workPermissionsLoading = false,
    this.workPermissionsError,
    this.onSetWorkPermissions,
    required this.keymap,
    this.onSetKeybind,
    this.customThemeTokens,
    this.onSetCustomTheme,
    this.appVersion,
    this.update,
    this.updateChecking = false,
    this.updateError,
    this.onCheckUpdate,
    this.prompts = const <PromptNoteView>[],
    this.promptsError,
    this.onSetPrompt,
  });

  final SettingsView settings;
  final bool narrow;
  final VoidCallback? onConnect;
  final Future<void> Function(Map<String, dynamic> patch)? onSaveSettings;
  final List<McpServerView> mcpServers;
  final PluginPolicy mcpPolicy;
  final String? mcpError;
  final Future<void> Function()? onRefreshMcp;
  final Future<void> Function(String command, String server, String value)?
  onSetMcpPolicy;

  /// The decision layer's stored view, or null before the first read.
  final DecisionView? decision;
  final bool decisionLoading;
  final String? decisionError;

  /// Null keeps the `DECISION LAYER` toggle read-only.
  final Future<void> Function({bool? enabled, String? model})? onSetDecision;

  /// The global Work opt-in, or null before the first read.
  final WorkPermissions? workPermissions;
  final bool workPermissionsLoading;
  final String? workPermissionsError;

  /// Null keeps the `WORK` rows read-only.
  final Future<void> Function({bool? allowWrite, bool? allowCommand})?
  onSetWorkPermissions;

  /// The merged key table the editor renders and writes against.
  final KeymapRegistry keymap;

  /// Null keeps the `KEYBINDS` group read-only.
  final Future<void> Function(String action, String? binding, {bool fixed})?
  onSetKeybind;

  /// The stored custom palette overrides, or null when the shell has not read
  /// them. The editor fills crimson per token, never inventing a stored colour.
  final ThemeTokens? customThemeTokens;

  /// Replace the custom palette. Null keeps `edit custom palette` read-only.
  final Future<ThemeTokens> Function(Map<String, String> tokens)?
  onSetCustomTheme;

  /// The running build's version (`update.info`), or null before it is read.
  final String? appVersion;

  /// The last explicit update check, or null before one ran.
  final UpdateView? update;

  /// True while a check is in flight.
  final bool updateChecking;

  /// The last update failure, shown under the row.
  final String? updateError;

  /// Run one check (`update.check`).
  final VoidCallback? onCheckUpdate;

  /// The prompt catalogue with its notes (`prompts.list`).
  final List<PromptNoteView> prompts;
  final String? promptsError;
  final Future<void> Function(String id, String text)? onSetPrompt;

  @override
  State<_SettingsBody> createState() => _SettingsBodyState();
}

class _SettingsBodyState extends State<_SettingsBody> {
  final _scroll = ScrollController();
  late List<_SettingGroup> _groups;
  late List<_SettingRow> _rows;
  late List<GlobalKey> _rowKeys;
  int _selected = 0;
  String? _savingId;
  String? _rowErrorId;
  String? _rowError;

  /// A muted inline explanation under one row. Only the decision layer's
  /// read-only `model` row uses it: Enter restates the core's reason instead of
  /// opening a control that cannot work.
  String? _noticeId;
  String? _notice;
  bool _refreshingMcp = false;
  String? _mcpFailure;

  /// The keybind row waiting for its next chord, or null.
  String? _capturingId;

  /// True when `c` switched this page to the custom theme in this session.
  ///
  /// The stored `ui.theme` arrives through [widget.settings]; a page rendered
  /// without a shell (a widget test) does not get a new snapshot back, so this
  /// remembers the choice locally and lets a save repaint.
  bool _customApplied = false;

  @override
  void initState() {
    super.initState();
    _rebuildRows();
  }

  void _rebuildRows() {
    _groups = _buildGroups(
      widget.settings,
      mcpServers: widget.mcpServers,
      mcpPolicy: widget.mcpPolicy,
      policyEditable: widget.onSetMcpPolicy != null,
      decision: widget.decision,
      workPermissions: widget.workPermissions,
      keymap: widget.keymap,
      appVersion: widget.appVersion,
      update: widget.update,
      updateChecking: widget.updateChecking,
      updateError: widget.updateError,
      prompts: widget.prompts,
    );
    _rows = [for (final group in _groups) ...group.rows];
    _rowKeys = [for (var i = 0; i < _rows.length; i++) GlobalKey()];
  }

  @override
  void didUpdateWidget(covariant _SettingsBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    final settingsChanged = !identical(oldWidget.settings, widget.settings);
    final policyChanged = !identical(oldWidget.mcpPolicy, widget.mcpPolicy);
    final mcpChanged =
        !identical(oldWidget.mcpServers, widget.mcpServers) || policyChanged;
    final decisionChanged = !identical(oldWidget.decision, widget.decision);
    final workChanged = !identical(
      oldWidget.workPermissions,
      widget.workPermissions,
    );
    final keymapChanged = !identical(oldWidget.keymap, widget.keymap);
    final updateChanged =
        !identical(oldWidget.update, widget.update) ||
        oldWidget.updateChecking != widget.updateChecking ||
        oldWidget.updateError != widget.updateError ||
        oldWidget.appVersion != widget.appVersion;
    if (!settingsChanged &&
        !mcpChanged &&
        !keymapChanged &&
        !decisionChanged &&
        !workChanged &&
        !updateChanged) {
      return;
    }
    // A row can appear or disappear (a server, or a whole group). Keep the
    // cursor on the same row id when it still exists, so a refresh never
    // throws the selection to the top.
    final keepId = _rows.isEmpty ? null : _rows[_selected].id;
    _rebuildRows();
    final moved = keepId == null
        ? -1
        : _rows.indexWhere((row) => row.id == keepId);
    if (moved >= 0) {
      _selected = moved;
    } else if (_selected >= _rows.length) {
      _selected = _rows.isEmpty ? 0 : _rows.length - 1;
    }
    // A new snapshot means the core accepted a write; the old row error is
    // stale. A rejected write leaves the snapshot identical, so its message
    // stays visible. A refreshed MCP list does not touch that message, but a
    // new policy matrix does (a policy write changed it).
    if (settingsChanged || policyChanged || decisionChanged || workChanged) {
      _rowErrorId = null;
      _rowError = null;
    }
    if (decisionChanged) {
      _noticeId = null;
      _notice = null;
    }
    if (widget.mcpError == null) _mcpFailure = null;
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // A row waiting for a chord owns the keyboard until it has one: the chord is
    // data, not navigation, so `j` or `Enter` must not also move the cursor.
    if (_capturingId != null) {
      // A captured chord is data: Ctrl+Q, Alt+1 and friends are valid input
      // here, so the modifier guard comes after this branch.
      _capture(event);
      return KeyEventResult.handled;
    }
    // `Ctrl+C` on the theme row used to write `ui.theme = custom`; every bare
    // letter on this page writes configuration, so a modified chord must never
    // reach it. `Ctrl+S` is not bound here (session settings owns it).
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _select(_selected + 1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _select(_selected - 1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.home) {
      _select(0);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.end) {
      _select(_rows.length - 1);
      return KeyEventResult.handled;
    }
    final row = _rows.isEmpty ? null : _rows[_selected];
    // The updates row checks on Enter and copies the release link on `c`.
    if (row?.id == 'updates') {
      if (key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter ||
          key == LogicalKeyboardKey.space) {
        widget.onCheckUpdate?.call();
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyC) {
        final url = widget.update?.url;
        if (url == null || url.isEmpty) {
          setState(() {
            _noticeId = 'updates';
            _notice = 'no release link until a newer build is found';
          });
          return KeyEventResult.handled;
        }
        unawaited(Clipboard.setData(ClipboardData(text: url)));
        setState(() {
          _noticeId = 'updates';
          _notice = 'release link copied';
        });
        return KeyEventResult.handled;
      }
    }
    // The theme row is the one row with two extra local actions: `c` picks the
    // custom palette and applies it at once, `e` opens the twelve-token editor.
    // `Enter` still cycles the four built-ins, so the existing flow is intact.
    if (row?.id == 'theme') {
      if (key == LogicalKeyboardKey.keyC) {
        unawaited(_applyCustomTheme());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyE) {
        unawaited(_openCustomPalette());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyX) {
        unawaited(_exportThemeJson());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyI) {
        unawaited(_importThemeJson());
        return KeyEventResult.handled;
      }
    }
    final keybind = row?.keybind;
    final write = widget.onSetKeybind;
    if (keybind != null && write != null) {
      if (key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter) {
        setState(() {
          _capturingId = row!.id;
          _rowErrorId = null;
          _rowError = null;
        });
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.backspace ||
          key == LogicalKeyboardKey.delete) {
        if (event is! KeyDownEvent) return KeyEventResult.handled;
        unawaited(_writeKeybind(keybind, null));
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyR) {
        // A held key wrote the whole reset loop: one press, one decision.
        if (event is! KeyDownEvent) return KeyEventResult.handled;
        if (HardwareKeyboard.instance.isShiftPressed) {
          unawaited(_confirmResetAll());
        } else {
          unawaited(_writeKeybind(keybind, null));
        }
        return KeyEventResult.handled;
      }
    }
    if (row != null &&
        _isConnectRow(row) &&
        widget.onConnect != null &&
        key == LogicalKeyboardKey.enter) {
      _activate();
      return KeyEventResult.handled;
    }
    if (row?.policy != null && widget.onSetMcpPolicy != null) {
      if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space) {
        _activate();
        return KeyEventResult.handled;
      }
    }
    final decision = row?.decision;
    if (decision != null &&
        (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space)) {
      // The `model` row is not editable in any build: Enter restates the core's
      // reason instead of opening a picker the core would refuse.
      if (decision.kind == _DecisionKind.model) {
        _explainDecisionModel(row!);
        return KeyEventResult.handled;
      }
      final write = widget.onSetDecision;
      if (write == null) return KeyEventResult.ignored;
      unawaited(_toggleDecision(row!, decision, write));
      return KeyEventResult.handled;
    }
    final work = row?.work;
    if (work != null &&
        (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space)) {
      final write = widget.onSetWorkPermissions;
      if (write == null) return KeyEventResult.ignored;
      unawaited(_toggleWork(row!, work, write));
      return KeyEventResult.handled;
    }
    if (row?.promptId != null &&
        (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space)) {
      _activate();
      return KeyEventResult.handled;
    }
    final editable = widget.onSaveSettings != null && row?.edit != null;
    if (editable && key == LogicalKeyboardKey.enter) {
      _activate();
      return KeyEventResult.handled;
    }
    if (editable &&
        row!.edit!.kind == _EditKind.toggle &&
        key == LogicalKeyboardKey.space) {
      _activate();
      return KeyEventResult.handled;
    }
    // `r` reconnects the plugin servers only from the PLUGINS group (its server
    // and policy rows); elsewhere it used to spawn child processes with nothing
    // on screen about it.
    final pluginRow = row != null && row.id.startsWith('mcp-');
    if (key == LogicalKeyboardKey.keyR &&
        pluginRow &&
        widget.onRefreshMcp != null) {
      _refreshMcp();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  /// Consume one chord for the row waiting for it.
  ///
  /// `Esc` cancels without writing; `Backspace`/`Delete` clear the override back
  /// to the default; a bare modifier is ignored so Control-then-K is one chord.
  /// A chord the documented storage form cannot express (`Alt+…`, a function
  /// key) is reported inline and never sent: the core would refuse it anyway, and
  /// a pointless round trip is worse than telling the user the rule.
  void _capture(KeyEvent event) {
    final id = _capturingId;
    final row = id == null ? null : _rowById(id);
    final keybind = row?.keybind;
    if (row == null || keybind == null) {
      setState(() => _capturingId = null);
      return;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      setState(() => _capturingId = null);
      return;
    }
    if (key == LogicalKeyboardKey.backspace ||
        key == LogicalKeyboardKey.delete) {
      setState(() => _capturingId = null);
      unawaited(_writeKeybind(keybind, null));
      return;
    }
    final binding = captureBinding(event);
    if (binding == null) {
      if (Binding.isModifierKey(key)) return;
      setState(() {
        _capturingId = null;
        _rowErrorId = row.id;
        _rowError =
            'That key cannot be bound. Press a character, Escape, Enter, Tab, '
            'or Control with a character.';
      });
      return;
    }
    if (!binding.isStorable) {
      setState(() {
        _capturingId = null;
        _rowErrorId = row.id;
        _rowError =
            'Alt chords are not storable. Press a character, a named key or '
            'Control with a character.';
      });
      return;
    }
    setState(() => _capturingId = null);
    unawaited(_writeKeybind(keybind, binding.format()));
  }

  _SettingRow? _rowById(String id) {
    for (final row in _rows) {
      if (row.id == id) return row;
    }
    return null;
  }

  /// Write one binding, or clear it with a null [binding].
  Future<void> _writeKeybind(_KeybindCell cell, String? binding) async {
    final write = widget.onSetKeybind;
    if (write == null) return;
    if (_savingId != null) return;
    setState(() {
      _savingId = 'keybind-${cell.actionId}';
      _rowErrorId = null;
      _rowError = null;
    });
    try {
      await write(cell.actionId, binding, fixed: cell.fixed);
      if (!mounted) return;
      setState(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = 'keybind-${cell.actionId}';
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
    }
  }

  /// Reset every overridden row, one `keybinds.set` per row.
  ///
  /// A row already on its default is skipped: the core treats clearing it as a
  /// no-op success, and asking seventeen times for nothing is not the point of
  /// the key. The first refusal stops the loop so the message names the row that
  /// failed rather than hiding it behind the rest.
  /// Ask before clearing every stored override, naming the count.
  Future<void> _confirmResetAll() async {
    final count = _rows.where((row) => row.keybind?.custom ?? false).length;
    if (count == 0) return;
    final answer = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('reset all keybinds'),
        content: Text(
          count == 1
              ? 'Clear the one customised binding? The default comes back.'
              : 'Clear all $count customised bindings? The defaults come back.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('keybind-reset-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('keybind-reset-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Reset'),
          ),
        ],
      ),
    );
    if (answer == true) await _resetAllKeybinds();
  }

  Future<void> _resetAllKeybinds() async {
    if (widget.onSetKeybind == null || _savingId != null) return;
    final overrides = [
      for (final row in _rows)
        if (row.keybind != null && row.keybind!.custom) row.keybind!,
    ];
    for (final cell in overrides) {
      await _writeKeybind(cell, null);
      if (_rowErrorId != null) return;
      if (!mounted) return;
    }
  }

  Future<void> _refreshMcp() async {
    final refresh = widget.onRefreshMcp;
    if (refresh == null || _refreshingMcp) return;
    setState(() {
      _refreshingMcp = true;
      _mcpFailure = null;
    });
    try {
      await refresh();
    } on RpcException catch (error) {
      if (!mounted) return;
      _mcpFailure = error.message;
    } finally {
      if (mounted) setState(() => _refreshingMcp = false);
    }
  }

  void _activate() {
    if (_rows.isEmpty || _savingId != null) return;
    final row = _rows[_selected];
    if (row.promptId != null) {
      unawaited(_editPrompt(row));
      return;
    }
    // The theme row opens a picker: the built-ins are a visible choice, not a
    // value that changes each time Enter is pressed.
    if (row.id == 'theme' && widget.onSaveSettings != null) {
      unawaited(_openThemePicker());
      return;
    }
    if (_isConnectRow(row)) {
      widget.onConnect?.call();
      return;
    }
    if (row.policy != null && widget.onSetMcpPolicy != null) {
      _advancePolicy(row);
      return;
    }
    // The three row families below used to draw an enabled chevron and then
    // fall through to `edit == null`, so the button did nothing and the action
    // was keyboard-only. Each branch is the same call Enter makes.
    final keybind = row.keybind;
    if (keybind != null) {
      if (widget.onSetKeybind == null) return;
      setState(() {
        _capturingId = row.id;
        _rowErrorId = null;
        _rowError = null;
      });
      return;
    }
    final decision = row.decision;
    if (decision != null) {
      if (decision.kind == _DecisionKind.model) {
        _explainDecisionModel(row);
        return;
      }
      final write = widget.onSetDecision;
      if (write == null) return;
      unawaited(_toggleDecision(row, decision, write));
      return;
    }
    final work = row.work;
    if (work != null) {
      final write = widget.onSetWorkPermissions;
      if (write == null) return;
      unawaited(_toggleWork(row, work, write));
      return;
    }
    final edit = row.edit;
    final save = widget.onSaveSettings;
    if (edit == null || save == null) return;
    if (edit.kind == _EditKind.toggle) {
      _toggle(row, edit, save);
    } else {
      _openEditor(edit, save);
    }
  }

  /// Edit one prompt note, then write it through the core.
  ///
  /// The dialog is the same for every generator: a note is guidance, not a new
  /// shape, so there is no raw prompt to edit.
  Future<void> _editPrompt(_SettingRow row) async {
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
      builder: (_) => _PromptNoteDialog(prompt: item),
    );
    if (!mounted || text == null) return;
    setState(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
      _noticeId = null;
      _notice = null;
    });
    try {
      await write(promptId, text);
      if (!mounted) return;
      setState(() {
        _noticeId = row.id;
        _notice = text.trim().isEmpty
            ? '${row.label}: note cleared'
            : '${row.label}: note saved';
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
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
      setState(() {
        _noticeId = 'theme';
        _notice = 'already using ${paletteLabel(picked)}';
      });
      return;
    }
    setState(() {
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
      setState(() {
        _savingId = null;
        _customApplied = picked == 'custom';
        _noticeId = 'theme';
        _notice = 'theme: ${paletteLabel(picked)}';
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = 'theme';
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
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
    setState(() {
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
      setState(() {
        _savingId = null;
        _customApplied = true;
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = 'theme';
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
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
      setState(() {
        _noticeId = 'theme';
        _notice = 'this build cannot store a custom palette';
      });
      return;
    }
    final initial = widget.customThemeTokens ?? ThemeTokens.empty;
    final saved = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) =>
          _CustomPaletteDialog(initial: initial.values, onSave: write),
    );
    if (!mounted || saved == null) return;
    final customIsActive =
        _customApplied || widget.settings.theme.trim() == 'custom';
    if (customIsActive) {
      applyPalette('custom', tokens: saved);
    }
    setState(() {
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
    setState(() {
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
      setState(() {
        _noticeId = 'theme';
        _notice = 'this build cannot store a custom palette';
      });
      return;
    }
    final imported = await showDialog<_ImportedTheme>(
      context: context,
      builder: (_) => const _ThemeJsonDialog(),
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
      setState(() {
        _customApplied = base == 'custom';
        _noticeId = 'theme';
        _notice = imported.tokens.isEmpty
            ? 'theme imported · base ${paletteLabel(base)}'
            : 'theme imported · ${imported.tokens.length} overrides on '
                  '${paletteLabel(base)}';
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
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
  Future<void> _advancePolicy(_SettingRow row) async {
    final cell = row.policy;
    final write = widget.onSetMcpPolicy;
    if (cell == null || write == null) return;
    final next = _nextPolicyValue(cell.command, cell.value);
    setState(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
    });
    try {
      await write(cell.command, cell.server, next);
      if (!mounted) return;
      setState(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
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
    _SettingRow row,
    _DecisionCell cell,
    Future<void> Function({bool? enabled, String? model}) write,
  ) async {
    if (_savingId != null) return;
    setState(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
      _noticeId = null;
      _notice = null;
    });
    try {
      await write(enabled: !cell.enabled);
      if (!mounted) return;
      setState(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
    }
  }

  /// Flip the global Work opt-in through `work.permissions.set`.
  ///
  /// The row keeps the stored value until the core answers: there is no
  /// optimistic flip, so a refusal leaves the row where it was with the core's
  /// own sentence inline. The shell re-renders the two flags from the view the
  /// store projects after the write.
  Future<void> _toggleWork(
    _SettingRow row,
    _WorkCell cell,
    Future<void> Function({bool? allowWrite, bool? allowCommand}) write,
  ) async {
    if (_savingId != null) return;
    setState(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
    });
    try {
      await write(
        allowWrite: cell.kind == _WorkKind.write ? !cell.allowed : null,
        allowCommand: cell.kind == _WorkKind.command ? !cell.allowed : null,
      );
      if (!mounted) return;
      setState(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
    }
  }

  /// Restate why the local model is unavailable.
  ///
  /// This is deliberately not an editor: no local model runtime is bundled, so
  /// the core refuses a non-empty model and a picker here would be a dead end.
  void _explainDecisionModel(_SettingRow row) {
    final reason = row.decision?.reason ?? '';
    setState(() {
      _noticeId = row.id;
      _notice = reason.isEmpty
          ? 'no local model is bundled in this build'
          : reason;
    });
  }

  Future<void> _toggle(
    _SettingRow row,
    _SettingEdit edit,
    Future<void> Function(Map<String, dynamic> patch) save,
  ) async {
    final build = edit.togglePatch;
    if (build == null) return;
    setState(() {
      _savingId = row.id;
      _rowErrorId = null;
      _rowError = null;
    });
    try {
      await save(build());
      if (!mounted) return;
      setState(() => _savingId = null);
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _rowErrorId = row.id;
        _rowError = userMessage(failure);
      });
    } finally {
      if (mounted) setState(() => _savingId = null);
    }
  }

  Future<void> _openEditor(
    _SettingEdit edit,
    Future<void> Function(Map<String, dynamic> patch) save,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) =>
          _SettingEditorDialog(edit: edit, onSave: save),
    );
  }

  void _select(int index) {
    if (_rows.isEmpty) return;
    final next = index.clamp(0, _rows.length - 1).toInt();
    if (next == _selected) return;
    setState(() => _selected = next);
    final target = _rowKeys[next].currentContext;
    if (target != null) {
      Scrollable.ensureVisible(target, alignment: 0.5, duration: Duration.zero);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Scrollbar(
        controller: _scroll,
        child: SingleChildScrollView(
          controller: _scroll,
          padding: const EdgeInsets.fromLTRB(20, 2, 20, 24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 880),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ..._groupWidgets(),
                  // One footer for the page. The KEYBINDS group prints its own
                  // verbs under its last row (it needs them beside the list), so
                  // the page footer steps aside there instead of echoing it.
                  if (!_onKeybindRow)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
                      child: Text(
                        widget.onSaveSettings != null
                            ? 'Enter edit · Space toggle · Esc back'
                            : 'selection only · use connect to change the chat model',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 11,
                          height: 1.4,
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

  List<Widget> _groupWidgets() {
    final widgets = <Widget>[];
    var index = 0;
    for (final group in _groups) {
      widgets.add(_GroupHeader(title: group.title));
      for (final row in group.rows) {
        widgets.add(_buildRow(row, index));
        index += 1;
      }
      if (group.title == 'MODELS') {
        if (widget.settings.chatModel.trim().isEmpty) {
          widgets.add(const _ModelHint());
        }
        final connect = widget.onConnect;
        if (connect != null) {
          widgets.add(_ConnectModelAction(onPressed: connect));
        }
      }
      if (group.title == 'PLUGINS') {
        final failure = widget.mcpError ?? _mcpFailure;
        if (_refreshingMcp) widgets.add(const _PluginsRefreshing());
        if (failure != null && failure.isNotEmpty) {
          widgets.add(_PluginsFailure(message: failure));
        }
        if (widget.mcpServers.isEmpty) widgets.add(const _PluginsEmpty());
        widgets.add(const _PluginsNote());
      }
      if (group.title == 'KEYBINDS') {
        widgets.add(KeybindFooter(editable: widget.onSetKeybind != null));
      }
      if (group.title == 'DECISION LAYER') {
        final failure = widget.decisionError;
        if (widget.decisionLoading && widget.decision == null) {
          widgets.add(const _DecisionLoading());
        } else if (failure != null && failure.isNotEmpty) {
          widgets.add(_DecisionFailure(message: failure));
        }
        widgets.add(const _DecisionRulesNote());
      }
      if (group.title == 'WORK') {
        final failure = widget.workPermissionsError;
        if (widget.workPermissionsLoading && widget.workPermissions == null) {
          widgets.add(const _WorkLoading());
        } else if (failure != null && failure.isNotEmpty) {
          widgets.add(_WorkFailure(message: failure));
        }
        widgets.add(const _WorkNote());
      }
      widgets.add(const SizedBox(height: 10));
    }
    return widgets;
  }

  Widget _buildRow(_SettingRow row, int index) {
    final selected = index == _selected;
    final error = _rowErrorId == row.id ? _rowError : null;
    final notice = _noticeId == row.id ? _notice : null;
    return KeyedSubtree(
      key: _rowKeys[index],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MouseRegion(
            cursor: SystemMouseCursors.click,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => _select(index),
              child: Container(
                key: ValueKey('settings-row-${row.id}'),
                padding: const EdgeInsets.fromLTRB(9, 8, 12, 9),
                decoration: BoxDecoration(
                  color: selected ? LockedInColors.panel : Colors.transparent,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (selected)
                      Container(
                        key: const ValueKey('settings-selected'),
                        width: 3,
                        height: 15,
                        margin: const EdgeInsets.only(top: 2, right: 9),
                        decoration: BoxDecoration(
                          color: LockedInColors.primary,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      )
                    else
                      const SizedBox(width: 12),
                    Expanded(
                      child: widget.narrow ? _stackedRow(row) : _wideRow(row),
                    ),
                    // One fixed trailing column for every row: a row without a
                    // control used to reserve less, which pushed its value
                    // 11 px out of line with its neighbours.
                    SizedBox(
                      width: 40,
                      child: _rowHasControl(row)
                          ? IconButton(
                              key: ValueKey('settings-activate-${row.id}'),
                              tooltip: 'Enter',
                              onPressed: _canRun(row)
                                  ? () {
                                      _select(index);
                                      _activate();
                                    }
                                  : null,
                              icon: const Icon(Icons.chevron_right, size: 16),
                              visualDensity: VisualDensity.compact,
                              color: LockedInColors.muted,
                            )
                          : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (row.note != null && row.note!.isNotEmpty)
            Padding(
              key: ValueKey('settings-row-note-${row.id}'),
              padding: const EdgeInsets.fromLTRB(24, 0, 12, 7),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 13,
                    color: LockedInColors.error,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      row.note!,
                      style: TextStyle(
                        color: LockedInColors.error,
                        fontSize: 11,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (error != null && error.isNotEmpty)
            Padding(
              key: ValueKey('settings-row-error-${row.id}'),
              padding: const EdgeInsets.fromLTRB(24, 0, 12, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 13,
                    color: LockedInColors.error,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      error,
                      style: TextStyle(
                        color: LockedInColors.error,
                        fontSize: 11,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (notice != null && notice.isNotEmpty)
            Padding(
              key: ValueKey('settings-row-notice-${row.id}'),
              padding: const EdgeInsets.fromLTRB(24, 0, 12, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline,
                    size: 13,
                    color: LockedInColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      notice,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 11,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// True when [row] has something `Enter` can run, so it gets a button.
  /// The two rows the connect dialog answers: which model, and which providers.
  ///
  /// They are projections, not editable values, but they are the rows a user
  /// lands on when the badge says `no model connected`. `Enter` (and the
  /// chevron) opens the same dialog the button below them opens, so linking a
  /// model never needs a pointer.
  bool _isConnectRow(_SettingRow row) =>
      row.id == 'chat-model' || row.id == 'providers';

  bool _rowHasControl(_SettingRow row) =>
      _isConnectRow(row) ||
      row.edit != null ||
      row.policy != null ||
      row.decision != null ||
      row.work != null ||
      row.keybind != null;

  /// True when this build can actually run the row's control. A read-only page
  /// keeps the chevron but disables it, so the pointer never promises more than
  /// the keyboard can do.
  bool _canRun(_SettingRow row) {
    if (_isConnectRow(row)) return widget.onConnect != null;
    if (row.policy != null) return widget.onSetMcpPolicy != null;
    if (row.decision != null) return widget.onSetDecision != null;
    if (row.work != null) return widget.onSetWorkPermissions != null;
    if (row.keybind != null) return widget.onSetKeybind != null;
    return row.edit != null && widget.onSaveSettings != null;
  }

  Widget _wideRow(_SettingRow row) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(flex: 5, child: _rowLabel(row)),
        const SizedBox(width: 16),
        Flexible(flex: 4, child: _valueWidget(row, textAlign: TextAlign.right)),
      ],
    );
  }

  Widget _stackedRow(_SettingRow row) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [_rowLabel(row), const SizedBox(height: 4), _valueWidget(row)],
    );
  }

  Widget _valueWidget(_SettingRow row, {TextAlign? textAlign}) {
    if (_savingId == row.id) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: textAlign == TextAlign.right
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 6),
          Flexible(
            child: Text(
              'saving…',
              key: ValueKey('settings-row-saving'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 12,
                height: 1.5,
              ),
            ),
          ),
        ],
      );
    }
    if (row.keybind != null) return _keybindValue(row);
    return Text(
      row.value,
      textAlign: textAlign,
      maxLines: widget.narrow ? 3 : 2,
      overflow: TextOverflow.ellipsis,
      style: _valueStyle(row.value),
    );
  }

  Widget _keybindValue(_SettingRow row) {
    final cell = row.keybind!;
    return KeybindValue(
      binding: cell.binding,
      custom: cell.custom,
      capturing: _capturingId == row.id,
    );
  }

  Widget _rowLabel(_SettingRow row) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          row.label,
          style: TextStyle(color: LockedInColors.foreground, fontSize: 13),
        ),
        const SizedBox(height: 2),
        Text(
          row.hint,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 11,
            height: 1.4,
          ),
        ),
      ],
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
      child: Row(
        children: [
          Container(width: 3, height: 14, color: LockedInColors.primary),
          const SizedBox(width: 7),
          Text(
            title,
            style: TextStyle(
              color: LockedInColors.secondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.8,
            ),
          ),
        ],
      ),
    );
  }
}

class _StateMessage extends StatelessWidget {
  const _StateMessage({
    required this.icon,
    required this.title,
    required this.body,
    this.tone,
    this.action,
  });

  final IconData icon;
  final String title;
  final String body;
  final Color? tone;
  final VoidCallback? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 24, color: tone ?? LockedInColors.muted),
              const SizedBox(height: 10),
              Text(
                title,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(
                body,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
              if (action != null) ...[
                const SizedBox(height: 16),
                FilledButton(onPressed: action, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ModelHint extends StatelessWidget {
  const _ModelHint();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 4, 12, 0),
      child: Row(
        children: [
          Icon(Icons.link_off, size: 14, color: LockedInColors.warning),
          SizedBox(width: 6),
          Text(
            'not connected',
            key: ValueKey('settings-model-not-connected'),
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _ConnectModelAction extends StatelessWidget {
  const _ConnectModelAction({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 2),
      child: Align(
        alignment: Alignment.centerLeft,
        child: FilledButton.icon(
          key: const ValueKey('settings-connect-model'),
          onPressed: onPressed,
          icon: const Icon(Icons.link, size: 16),
          label: const Text('connect a model'),
          style: FilledButton.styleFrom(
            backgroundColor: LockedInColors.primary,
            foregroundColor: Theme.of(context).colorScheme.onPrimary,
            shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.all(Radius.circular(Radii.control)),
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: Space.md,
              vertical: Space.xs + 2,
            ),
            textStyle: LockedInType.label,
          ),
        ),
      ),
    );
  }
}

/// The one sentence the Plugins section must always carry: plugin output is an
/// external explanation, and it is still sent to the model.
class _PluginsNote extends StatelessWidget {
  const _PluginsNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
          SizedBox(width: 6),
          Expanded(
            child: Text(
              'Plugin output is external explanation and is still sent to the '
              'model.',
              key: ValueKey('settings-plugins-note'),
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

/// The one standing note under the `DECISION LAYER` group.
///
/// `enabled` records only whether the optional ranking layer may run; the cheap
/// rules are always on, and the layer never decides anything with a consequence.
class _DecisionRulesNote extends StatelessWidget {
  const _DecisionRulesNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'The rules are always on. The layer never decides a write, an '
              'archive, or which side of the school/skills wall a request '
              'belongs to.',
              key: const ValueKey('settings-decision-rules'),
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

/// `decision.get` is in flight and nothing has been read yet.
class _DecisionLoading extends StatelessWidget {
  const _DecisionLoading();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Text(
        'loading the decision layer…',
        key: const ValueKey('settings-decision-loading'),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 11,
          height: 1.4,
        ),
      ),
    );
  }
}

/// A failed decision-layer read. The last view, if any, stays on screen.
class _DecisionFailure extends StatelessWidget {
  const _DecisionFailure({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.warning_amber_outlined,
            size: 13,
            color: LockedInColors.warning,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'the decision layer could not load: $message',
              key: const ValueKey('settings-decision-error'),
              style: TextStyle(
                color: LockedInColors.warning,
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

/// The standing note under the `WORK` group.
///
/// The two flags are the **outer** gate only: an approval still needs its own
/// per-action confirmation, and the agent profile's flag must also be on. The
/// core enforces both, so the page never implies a toggle approves anything.
class _WorkNote extends StatelessWidget {
  const _WorkNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Every write and command still needs its own approval, and the '
              'project’s agent profile must allow it too. The core enforces '
              'both; there is no “remember this session”.',
              key: const ValueKey('settings-work-note'),
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

/// `work.permissions.get` is in flight and nothing has been read yet.
class _WorkLoading extends StatelessWidget {
  const _WorkLoading();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Text(
        'loading Work permissions…',
        key: const ValueKey('settings-work-loading'),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 11,
          height: 1.4,
        ),
      ),
    );
  }
}

/// A failed Work-permissions read. The last view, if any, stays on screen.
class _WorkFailure extends StatelessWidget {
  const _WorkFailure({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.warning_amber_outlined,
            size: 13,
            color: LockedInColors.warning,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Work permissions could not load: $message',
              key: const ValueKey('settings-work-error'),
              style: TextStyle(
                color: LockedInColors.warning,
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

/// No configured servers: say so, and name the only place one can be added.
class _PluginsEmpty extends StatelessWidget {
  const _PluginsEmpty();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Column(
        key: ValueKey('settings-mcp-empty'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'no MCP servers configured',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.4,
            ),
          ),
          Text(
            'add a server in config.toml',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 11,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// A failed read or reconnect. The server rows above stay visible.
class _PluginsFailure extends StatelessWidget {
  const _PluginsFailure({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.warning_amber_outlined,
            size: 13,
            color: LockedInColors.warning,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'plugins could not load: $message',
              key: const ValueKey('settings-mcp-error'),
              style: TextStyle(
                color: LockedInColors.warning,
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

class _PluginsRefreshing extends StatelessWidget {
  const _PluginsRefreshing();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Text(
        'refreshing plugins…',
        key: ValueKey('settings-mcp-refreshing'),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 11,
          height: 1.4,
        ),
      ),
    );
  }
}

/// Edits one scalar setting and commits it through the core.
///
/// Validation is local and happens before the callback: an out-of-range value
/// never reaches [onSave]. A core rejection keeps the dialog open with the
/// message inline, so the user can correct the value without retyping it.
class _SettingEditorDialog extends StatefulWidget {
  const _SettingEditorDialog({required this.edit, required this.onSave});

  final _SettingEdit edit;
  final Future<void> Function(Map<String, dynamic> patch) onSave;

  @override
  State<_SettingEditorDialog> createState() => _SettingEditorDialogState();
}

class _SettingEditorDialogState extends State<_SettingEditorDialog> {
  late final TextEditingController _controller;
  String? _validation;
  String? _failure;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.edit.initial);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) return;
    final build = widget.edit.valuePatch;
    if (build == null) return;
    final invalid = widget.edit.validate?.call(_controller.text);
    if (invalid != null) {
      setState(() {
        _validation = invalid;
        _failure = null;
      });
      return;
    }
    setState(() {
      _validation = null;
      _failure = null;
      _saving = true;
    });
    try {
      await widget.onSave(build(_controller.text));
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _failure = userMessage(failure));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final edit = widget.edit;
    return PopScope(
      canPop: !_saving,
      child: Focus(
        canRequestFocus: false,
        skipTraversal: true,
        onKeyEvent: (node, event) {
          if (event is KeyDownEvent &&
              (event.logicalKey == LogicalKeyboardKey.enter ||
                  event.logicalKey == LogicalKeyboardKey.numpadEnter)) {
            _submit();
            return KeyEventResult.handled;
          }
          return KeyEventResult.ignored;
        },
        child: AlertDialog(
          backgroundColor: LockedInColors.surface,
          title: Text('edit ${edit.label}'),
          content: SizedBox(
            width: 380,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    edit.help,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    key: const ValueKey('settings-edit-field'),
                    controller: _controller,
                    autofocus: true,
                    enabled: !_saving,
                    autocorrect: false,
                    enableSuggestions: false,
                    keyboardType: switch (edit.kind) {
                      _EditKind.text => TextInputType.text,
                      _EditKind.integer => TextInputType.number,
                      _EditKind.decimal =>
                        const TextInputType.numberWithOptions(decimal: true),
                      _EditKind.toggle => TextInputType.text,
                    },
                    decoration: InputDecoration(
                      labelText: edit.label,
                      errorText: _validation,
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                  if (_failure != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      key: const ValueKey('settings-edit-error'),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        border: Border.all(color: LockedInColors.error),
                        borderRadius: BorderRadius.circular(Radii.control),
                      ),
                      child: Text(
                        _failure!,
                        style: TextStyle(
                          color: LockedInColors.error,
                          fontSize: 12,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              key: const ValueKey('settings-edit-cancel'),
              onPressed: _saving ? null : () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const ValueKey('settings-edit-save'),
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Links one provider key, then picks a chat model from the returned list.
///
/// The key is sent to [onLinkProvider] once and is never stored here: linking
/// and the final model choice are two separate core calls, and the dialog only
/// closes after the second one succeeds.
class _ConnectModelDialog extends StatefulWidget {
  const _ConnectModelDialog({
    required this.settings,
    required this.providers,
    required this.providersError,
    required this.onLoadProviders,
    required this.onLinkProvider,
    required this.onSaveSettings,
  });

  final SettingsView settings;
  final List<ProviderRow> providers;
  final String? providersError;
  final Future<List<ProviderRow>> Function()? onLoadProviders;
  final Future<ProviderLink> Function(
    String providerId,
    String key,
    String? baseUrl,
  )
  onLinkProvider;
  final Future<void> Function(Map<String, dynamic> patch) onSaveSettings;

  @override
  State<_ConnectModelDialog> createState() => _ConnectModelDialogState();
}

class _ConnectModelDialogState extends State<_ConnectModelDialog> {
  final _keyController = TextEditingController();
  late final TextEditingController _baseUrlController;
  late List<ProviderRow> _providers;
  late String? _providerId;
  bool _loadingProviders = false;
  bool _linking = false;
  bool _saving = false;
  String? _error;
  ProviderLink? _link;
  String? _model;

  @override
  void initState() {
    super.initState();
    _providers = List<ProviderRow>.of(widget.providers);
    _providerId = _defaultProviderId();
    _baseUrlController = TextEditingController(text: widget.settings.baseUrl);
    _keyController.addListener(_onKeyChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadProviders());
  }

  @override
  void dispose() {
    _keyController.dispose();
    _baseUrlController.dispose();
    super.dispose();
  }

  void _onKeyChanged() {
    if (mounted) setState(() {});
  }

  String? _defaultProviderId() {
    final model = widget.settings.chatModel.trim();
    final slash = model.indexOf('/');
    if (slash > 0) {
      final prefix = model.substring(0, slash);
      for (final provider in _providers) {
        if (provider.id == prefix) return provider.id;
      }
    }
    return _providers.isEmpty ? null : _providers.first.id;
  }

  ProviderRow? get _provider {
    for (final provider in _providers) {
      if (provider.id == _providerId) return provider;
    }
    return null;
  }

  bool get _isCustomProvider => _providerId == 'custom';

  bool get _canLink =>
      !_linking &&
      _providerId != null &&
      (_isCustomProvider || _keyController.text.trim().isNotEmpty);

  bool get _canSave => !_saving && _link != null && _model != null;

  Future<void> _loadProviders() async {
    final load = widget.onLoadProviders;
    if (load == null) return;
    if (mounted) setState(() => _loadingProviders = true);
    try {
      final fresh = await load();
      if (!mounted) return;
      setState(() {
        _providers = fresh;
        if (_providerId == null ||
            !_providers.any((provider) => provider.id == _providerId)) {
          _providerId = _defaultProviderId();
        }
      });
    } on RpcException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loadingProviders = false);
    }
  }

  void _chooseProvider(String id) {
    if (id == _providerId) return;
    setState(() {
      _providerId = id;
      _link = null;
      _model = null;
      _error = null;
    });
  }

  Future<void> _submitLink() async {
    final providerId = _providerId;
    if (providerId == null || !_canLink) return;
    final key = _keyController.text.trim();
    final baseUrl = providerId == 'custom'
        ? _baseUrlController.text.trim()
        : null;
    setState(() {
      _linking = true;
      _error = null;
    });
    try {
      final link = await widget.onLinkProvider(providerId, key, baseUrl);
      if (!mounted) return;
      setState(() {
        _link = link;
        _model = link.models.isEmpty ? null : link.models.first;
      });
    } on RpcException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _linking = false);
    }
  }

  Future<void> _save() async {
    final link = _link;
    final model = _model;
    if (link == null || model == null || !_canSave) return;
    final providerId = link.providerId.trim().isEmpty
        ? (_providerId ?? '')
        : link.providerId;
    final custom = providerId == 'custom' || _isCustomProvider;
    final patch = <String, dynamic>{
      'models': <String, dynamic>{
        'chat': '$providerId/$model',
        if (custom) 'base_url': _baseUrlController.text.trim(),
      },
    };
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSaveSettings(patch);
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _error = userMessage(failure));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = _provider;
    return AlertDialog(
      backgroundColor: LockedInColors.surface,
      title: const Text('connect a model'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'The key is sent once to the core and stored in the OS '
                'keychain. It is never read back here.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 12,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 12),
              _providerList(),
              if (_loadingProviders) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 8),
                    Text(
                      'loading providers…',
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ],
              if (provider != null) ...[
                const SizedBox(height: 14),
                TextField(
                  key: const ValueKey('settings-provider-key'),
                  controller: _keyController,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    labelText: 'API key',
                    hintText: _isCustomProvider
                        ? 'optional for local endpoints'
                        : 'required',
                  ),
                  onSubmitted: (_) {
                    if (_canLink) _submitLink();
                  },
                ),
              ],
              if (_isCustomProvider) ...[
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('settings-provider-base-url'),
                  controller: _baseUrlController,
                  decoration: const InputDecoration(
                    labelText: 'base URL',
                    hintText: 'https://localhost:11434/v1',
                  ),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Container(
                  key: const ValueKey('settings-dialog-error'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(color: LockedInColors.error),
                    borderRadius: BorderRadius.circular(Radii.control),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
              if (_link != null) ...[
                const SizedBox(height: 16),
                Text(
                  'choose a chat model',
                  style: TextStyle(
                    color: LockedInColors.secondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 4),
                if (_link!.models.isEmpty)
                  Text(
                    'No models returned for this key.',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  )
                else
                  for (final model in _link!.models) _modelRow(model),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          key: const ValueKey('settings-connect-cancel'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        OutlinedButton(
          key: const ValueKey('settings-link'),
          onPressed: _canLink ? _submitLink : null,
          child: _linking
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(_link == null ? 'Link' : 'Link again'),
        ),
        FilledButton(
          key: const ValueKey('settings-use-model'),
          onPressed: _canSave ? _save : null,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Use this model'),
        ),
      ],
    );
  }

  Widget _providerList() {
    final error = widget.providersError;
    if (_providers.isEmpty) {
      return Text(
        error != null && error.isNotEmpty
            ? error
            : 'No providers configured. Add one to config.toml first.',
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 12,
          height: 1.4,
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (error != null && error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              error,
              style: TextStyle(
                color: LockedInColors.warning,
                fontSize: 11,
                height: 1.3,
              ),
            ),
          ),
        for (final provider in _providers) _providerRow(provider),
      ],
    );
  }

  Widget _providerRow(ProviderRow provider) {
    final selected = provider.id == _providerId;
    return InkWell(
      key: ValueKey('settings-provider-${provider.id}'),
      onTap: () => _chooseProvider(provider.id),
      borderRadius: BorderRadius.circular(Radii.control),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              size: 16,
              color: selected ? LockedInColors.primary : LockedInColors.muted,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    provider.label.isEmpty ? provider.id : provider.label,
                    style: TextStyle(
                      color: LockedInColors.foreground,
                      fontSize: 13,
                    ),
                  ),
                  if (provider.note.isNotEmpty)
                    Text(
                      provider.note,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 11,
                        height: 1.3,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
              decoration: BoxDecoration(
                border: Border.all(
                  color: provider.linked
                      ? LockedInColors.success
                      : LockedInColors.line,
                ),
                borderRadius: BorderRadius.circular(Radii.control),
              ),
              child: Text(
                provider.linked ? 'linked' : 'not linked',
                style: TextStyle(
                  color: provider.linked
                      ? LockedInColors.success
                      : LockedInColors.muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _modelRow(String model) {
    final selected = model == _model;
    return InkWell(
      key: ValueKey('settings-model-$model'),
      onTap: () => setState(() => _model = model),
      borderRadius: BorderRadius.circular(Radii.control),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 7),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              size: 16,
              color: selected ? LockedInColors.primary : LockedInColors.muted,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                model,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SettingRow {
  const _SettingRow({
    required this.id,
    required this.label,
    required this.value,
    required this.hint,
    this.edit,
    this.note,
    this.policy,
    this.keybind,
    this.decision,
    this.work,
    this.promptId,
  });

  final String id;
  final String label;
  final String value;
  final String hint;

  /// An inline message under the row, in the error tone. Used for a failed MCP
  /// server, whose message must not be truncated to fit a value column.
  final String? note;

  /// One editable policy cell. Non-null rows cycle their value on Enter or
  /// Space; null keeps the row read-only.
  final _PolicyCell? policy;

  /// One rebindable row. Non-null rows capture the next chord on Enter; null
  /// keeps the row a read-only projection.
  final _KeybindCell? keybind;

  /// One row of the `DECISION LAYER` group. Non-null rows own Enter and Space:
  /// the `enabled` row toggles, the `model` row restates the core's reason.
  final _DecisionCell? decision;

  /// One row of the `WORK` group. Non-null rows own Enter and Space and write
  /// the matching global opt-in; null keeps the row read-only.
  final _WorkCell? work;

  /// One row of the `PROMPTS` group: Enter edits the note, empty clears it.
  final String? promptId;

  /// Null keeps the row read-only. A value editor opens a dialog; a toggle
  /// patch is written on Enter or Space.
  final _SettingEdit? edit;
}

enum _DecisionKind { enabled, model }

/// One row of the `DECISION LAYER` group.
///
/// [enabled] is the stored toggle state ([kind] `enabled`); [reason] is the
/// core's own sentence explaining why no local model can run here ([kind]
/// `model`). The model row carries no writer: this build has no local model
/// runtime, so an editor would promise a control the core refuses.
class _DecisionCell {
  const _DecisionCell({
    required this.kind,
    this.enabled = false,
    this.reason = '',
  });

  final _DecisionKind kind;
  final bool enabled;
  final String reason;
}

/// One row of the `WORK` group: which global opt-in it writes, and the stored
/// value it renders.
class _WorkCell {
  const _WorkCell({required this.kind, required this.allowed});

  final _WorkKind kind;

  /// The stored flag. False means the core refuses that approval until the user
  /// turns it on here; it is never inferred from the agent profile.
  final bool allowed;
}

enum _WorkKind { write, command }

/// One row of the `KEYBINDS` group: the action and the binding in force.
class _KeybindCell {
  const _KeybindCell({
    required this.actionId,
    required this.binding,
    required this.custom,
    required this.fixed,
  });

  final String actionId;
  final Binding binding;

  /// True when a stored override is in force, so `r`/`R` have something to reset.
  final bool custom;

  /// True when the override belongs in `ui.fixed_keybinds`.
  final bool fixed;
}

/// One cell of the MCP policy matrix as the page renders it.
///
/// [value] is the stored cell (`on`, `explicit` or `off`) or empty when the core
/// stored none; an empty value prints `default` and is never invented.
class _PolicyCell {
  const _PolicyCell({
    required this.command,
    required this.server,
    required this.value,
  });

  final String command;
  final String server;
  final String value;
}

enum _EditKind { text, integer, decimal, toggle }

class _SettingEdit {
  const _SettingEdit({
    required this.kind,
    required this.label,
    required this.help,
    this.initial = '',
    this.validate,
    this.valuePatch,
    this.togglePatch,
  }) : assert(
         (kind == _EditKind.toggle) == (togglePatch != null),
         'a toggle needs a togglePatch and nothing else',
       );

  final _EditKind kind;
  final String label;
  final String help;
  final String initial;
  final String? Function(String input)? validate;
  final Map<String, dynamic> Function(String input)? valuePatch;
  final Map<String, dynamic> Function()? togglePatch;
}

class _SettingGroup {
  const _SettingGroup({required this.title, required this.rows});

  final String title;
  final List<_SettingRow> rows;
}

TextStyle _valueStyle(String value) {
  return TextStyle(
    color: value == 'not set'
        ? LockedInColors.muted
        : LockedInColors.foreground,
    fontSize: 13,
    height: 1.5,
  );
}

/// What the updates row prints, in the order the states become true.
String _updateRowValue(UpdateView? state, bool checking, String? error) {
  if (checking) return 'checking…';
  if (error != null) return 'check failed';
  if (state == null) return 'not checked';
  if (state.available) return 'v${state.version} available';
  if (state.currentBuild) return 'up to date';
  return state.message?.trim().isNotEmpty == true
      ? state.message!.trim()
      : 'not available';
}

List<_SettingGroup> _buildGroups(
  SettingsView settings, {
  List<McpServerView> mcpServers = const <McpServerView>[],
  PluginPolicy mcpPolicy = PluginPolicy.empty,
  bool policyEditable = false,
  DecisionView? decision,
  WorkPermissions? workPermissions,
  KeymapRegistry? keymap,
  String? appVersion,
  UpdateView? update,
  bool updateChecking = false,
  String? updateError,
  List<PromptNoteView> prompts = const <PromptNoteView>[],
}) {
  return [
    _SettingGroup(
      title: 'USER',
      rows: [
        _SettingRow(
          id: 'username',
          label: 'username',
          value: _text(settings.username),
          hint: 'shown in the chat greeting',
          edit: _SettingEdit(
            kind: _EditKind.text,
            label: 'username',
            help: 'shown in the chat greeting',
            initial: settings.username,
            valuePatch: (input) => {
              'ui': {'username': input.trim()},
            },
          ),
        ),
        _SettingRow(
          id: 'theme',
          label: 'theme',
          value: _text(settings.theme),
          hint: 'Enter pick · c custom · e edit · x export · i import',
          edit: _SettingEdit(
            kind: _EditKind.toggle,
            label: 'theme',
            help: 'Enter picks a theme from the catalogue; c picks custom',
            togglePatch: () => {
              'ui': {'theme': nextThemeId(settings.theme)},
            },
          ),
        ),
      ],
    ),
    _SettingGroup(
      title: 'MODELS',
      rows: [
        _SettingRow(
          id: 'chat-model',
          label: 'chat model',
          value: _text(settings.chatModel),
          hint: 'Enter connect · explicit choice, never auto-selected',
        ),
        _SettingRow(
          id: 'providers',
          label: 'providers',
          value: _providers(settings),
          hint: 'Enter link a key · keys live in the OS keychain',
        ),
        _SettingRow(
          id: 'base-url',
          label: 'base URL',
          value: _text(settings.baseUrl),
          hint: 'custom OpenAI-compatible endpoint',
          edit: _SettingEdit(
            kind: _EditKind.text,
            label: 'base URL',
            help: 'http(s) URL, or empty for the provider default',
            initial: settings.baseUrl,
            validate: _validateBaseUrl,
            valuePatch: (input) => {
              'models': {'base_url': input.trim()},
            },
          ),
        ),
        _SettingRow(
          id: 'max-tool-calls',
          label: 'max tool calls',
          value: _positive(settings.maxToolCalls),
          hint: 'per request ceiling',
          edit: _SettingEdit(
            kind: _EditKind.integer,
            label: 'max tool calls',
            help: 'whole number from 1 to 64',
            initial: settings.maxToolCalls > 0
                ? '${settings.maxToolCalls}'
                : '',
            validate: (input) =>
                _validateInt(input, min: 1, max: 64, label: 'max tool calls'),
            valuePatch: (input) => {
              'models': {'max_tool_calls': int.parse(input.trim())},
            },
          ),
        ),
        _SettingRow(
          id: 'max-tokens',
          label: 'max tokens per request',
          value: settings.maxTokensPerRequest <= 0
              ? 'not set'
              : _thousands(settings.maxTokensPerRequest),
          hint: 'output ceiling per request',
          edit: _SettingEdit(
            kind: _EditKind.integer,
            label: 'max tokens per request',
            help: 'whole number from 256 to ${_thousands(1000000)}',
            initial: settings.maxTokensPerRequest > 0
                ? '${settings.maxTokensPerRequest}'
                : '',
            validate: (input) => _validateInt(
              input,
              min: 256,
              max: 1000000,
              label: 'max tokens per request',
            ),
            valuePatch: (input) => {
              'models': {'max_tokens_per_request': int.parse(input.trim())},
            },
          ),
        ),
      ],
    ),
    _SettingGroup(
      title: 'USAGE',
      rows: [
        _SettingRow(
          id: 'budget',
          label: 'budget',
          value: _budget(settings.budgetUsd),
          hint: 'estimated spend, not a bill',
          edit: _SettingEdit(
            kind: _EditKind.decimal,
            label: 'budget',
            help: '0 or more; 0 means no limit',
            initial: _decimalInput(settings.budgetUsd),
            validate: _validateBudget,
            valuePatch: (input) => {
              'usage': {'budget': double.parse(input.trim())},
            },
          ),
        ),
        _SettingRow(
          id: 'period',
          label: 'period',
          value: _text(settings.period),
          hint: 'day or month',
          edit: _SettingEdit(
            kind: _EditKind.toggle,
            label: 'period',
            help: 'toggles between day and month',
            togglePatch: () => {
              'usage': {'period': settings.period == 'month' ? 'day' : 'month'},
            },
          ),
        ),
        _SettingRow(
          id: 'warn-at',
          label: 'warn at',
          value: '${(settings.warnAt * 100).round()}%',
          hint: 'budget warning threshold',
          edit: _SettingEdit(
            kind: _EditKind.decimal,
            label: 'warn at (%)',
            help: 'percent from 0 to 100',
            initial: '${(settings.warnAt * 100).round()}',
            validate: _validatePercent,
            valuePatch: (input) => {
              'usage': {'warn_at': double.parse(input.trim()) / 100},
            },
          ),
        ),
        _SettingRow(
          id: 'pause-at-limit',
          label: 'pause at limit',
          value: settings.pauseAtLimit ? 'yes' : 'no',
          hint: 'stop sending at the limit',
          edit: _SettingEdit(
            kind: _EditKind.toggle,
            label: 'pause at limit',
            help: 'toggles the budget pause',
            togglePatch: () => {
              'usage': {'pause_at_limit': !settings.pauseAtLimit},
            },
          ),
        ),
      ],
    ),
    _SettingGroup(
      title: 'STORAGE',
      rows: [
        _SettingRow(
          id: 'data-folder',
          label: 'data folder',
          value: _text(settings.dataDir),
          hint: 'app data stays outside the workspace',
        ),
        _SettingRow(
          id: 'archive-backend',
          label: 'archive backend',
          value: _text(settings.archiveBackend),
          hint: 'folder or private GitHub',
        ),
        _SettingRow(
          id: 'archive-folder',
          label: 'archive folder',
          value: _text(settings.archiveFolder),
          hint: 'local archive destination',
        ),
        _SettingRow(
          id: 'history-limit',
          label: 'history limit',
          value: settings.historyLimit <= 0
              ? 'off'
              : '${settings.historyLimit} messages',
          hint: 'messages kept in Chill',
          edit: _SettingEdit(
            kind: _EditKind.integer,
            label: 'history limit',
            help: 'whole number from 0 to 200; 0 turns history off',
            initial: '${settings.historyLimit}',
            validate: (input) =>
                _validateInt(input, min: 0, max: 200, label: 'history limit'),
            valuePatch: (input) => {
              'ui': {'chill_history_limit': int.parse(input.trim())},
            },
          ),
        ),
      ],
    ),
    _SettingGroup(
      title: 'PLUGINS',
      rows: [
        _SettingRow(
          id: 'mcp-servers',
          label: 'MCP servers',
          value: settings.pluginServers.isEmpty
              ? 'none'
              : settings.pluginServers.join(', '),
          hint: 'stdio servers, per-command policy',
        ),
        for (final server in mcpServers) _mcpServerRow(server),
        if (policyEditable && mcpServers.isNotEmpty)
          ..._policyCellRows(mcpServers, mcpPolicy)
        else
          for (final command in _policyCommands) _policyRow(command, mcpPolicy),
        _SettingRow(
          id: 'ui-plugins',
          label: 'UI plugins',
          value: _uiPlugins(settings),
          hint: 'loaded from the plugin folders',
        ),
      ],
    ),
    _SettingGroup(title: 'DECISION LAYER', rows: _decisionRows(decision)),
    _SettingGroup(title: 'WORK', rows: _workRows(workPermissions)),
    _SettingGroup(
      title: 'ABOUT',
      rows: [
        _SettingRow(
          id: 'app-version',
          label: 'version',
          value: appVersion?.trim().isNotEmpty == true
              ? appVersion!
              : 'not read',
          hint: 'the running build',
        ),
        _SettingRow(
          id: 'updates',
          label: 'updates',
          value: _updateRowValue(update, updateChecking, updateError),
          hint: 'Enter check · c copy link',
        ),
      ],
    ),
    _SettingGroup(
      title: 'PROMPTS',
      rows: prompts.isEmpty
          ? [
              _SettingRow(
                id: 'prompts-empty',
                label: 'prompt notes',
                value: 'no note',
                hint: 'guidance for one generator; shape and limits stay fixed',
              ),
            ]
          : [
              for (final prompt in prompts)
                _SettingRow(
                  id: 'prompt-${prompt.id}',
                  label: prompt.label,
                  value: prompt.custom ? 'custom' : 'no note',
                  hint: prompt.description,
                  promptId: prompt.id,
                ),
            ],
    ),
    _SettingGroup(
      title: 'KEYBINDS',
      rows: [
        // Generated from the one registry: the leader overlay, the shell's
        // dispatch and this editor read the same rows, so an override here is
        // the binding that runs.
        for (final entry in keybindSettingRows(keymap ?? KeymapRegistry()))
          _SettingRow(
            id: entry.id,
            label: entry.label,
            value: entry.binding.display,
            hint: entry.hint,
            keybind: _KeybindCell(
              actionId: entry.actionId,
              binding: entry.binding,
              custom: entry.custom,
              fixed: entry.fixed,
            ),
          ),
      ],
    ),
  ];
}

/// The value the `enabled` row prints before the core has answered.
const _decisionUnread = 'not read yet';

/// The rows of the `DECISION LAYER` group: one toggle and one explanation.
///
/// The `model` row is never editable. This build bundles no local model runtime,
/// so the core refuses a non-empty `decision_layer.model`; the row prints `not
/// shipped in this build` and the core's own reason instead of offering a picker
/// that could only fail. When a future build reports `rulesOnly: false` the
/// "not shipped" note is simply absent — no new control is invented for it.
List<_SettingRow> _decisionRows(DecisionView? view) {
  if (view == null) {
    return const [
      _SettingRow(
        id: 'decision-enabled',
        label: 'enabled',
        value: _decisionUnread,
        hint: 'read from the core when Settings opens',
        decision: _DecisionCell(kind: _DecisionKind.enabled),
      ),
    ];
  }
  final rulesOnly = view.rulesOnly;
  final reason = view.localModelReason.trim();
  return [
    _SettingRow(
      id: 'decision-enabled',
      label: 'enabled',
      value: view.enabled ? 'on' : 'off',
      hint: 'Enter or Space toggles · rules only',
      decision: _DecisionCell(
        kind: _DecisionKind.enabled,
        enabled: view.enabled,
      ),
    ),
    _SettingRow(
      id: 'decision-model',
      label: 'model',
      value: rulesOnly ? 'not shipped in this build' : _text(view.model),
      hint: rulesOnly
          ? (reason.isEmpty ? 'no local model runtime is bundled' : reason)
          : 'no local model editor in this build',
      decision: _DecisionCell(kind: _DecisionKind.model, reason: reason),
    ),
  ];
}

/// The rows of the `WORK` group: the two independent global opt-ins.
///
/// Both default to off in the core and are never inferred from a profile: a
/// row says `not read yet` until `work.permissions.get` answers. Turning one on
/// here does not approve anything; every write and command still needs its own
/// approval, and the agent profile must allow it too.
List<_SettingRow> _workRows(WorkPermissions? view) {
  String value(bool allowed) => allowed ? 'allowed' : 'switched off';
  return [
    _SettingRow(
      id: 'work-allow-write',
      label: 'allow writes',
      value: view == null ? 'not loaded yet' : value(view.allowWrite),
      hint: 'Enter or Space toggles · per-write approval is still required',
      work: _WorkCell(
        kind: _WorkKind.write,
        allowed: view?.allowWrite ?? false,
      ),
    ),
    _SettingRow(
      id: 'work-allow-command',
      label: 'allow commands',
      value: view == null ? 'not loaded yet' : value(view.allowCommand),
      hint: 'Enter or Space toggles · per-command approval is still required',
      work: _WorkCell(
        kind: _WorkKind.command,
        allowed: view?.allowCommand ?? false,
      ),
    ),
  ];
}

String? _validateInt(
  String input, {
  required int min,
  required int max,
  required String label,
}) {
  final value = int.tryParse(input.trim());
  if (value == null || value < min || value > max) {
    return 'Enter a whole number for $label from ${_thousands(min)} to '
        '${_thousands(max)}.';
  }
  return null;
}

String? _validateBaseUrl(String input) {
  final value = input.trim();
  if (value.isEmpty) return null;
  final uri = Uri.tryParse(value);
  if (uri == null ||
      (uri.scheme != 'http' && uri.scheme != 'https') ||
      uri.host.isEmpty) {
    return 'Enter an http:// or https:// URL, or leave it empty.';
  }
  return null;
}

String? _validateBudget(String input) {
  final value = double.tryParse(input.trim());
  if (value == null || !value.isFinite || value < 0) {
    return 'Enter 0 or more; 0 means no limit.';
  }
  return null;
}

String? _validatePercent(String input) {
  final value = double.tryParse(input.trim());
  if (value == null || !value.isFinite || value < 0 || value > 100) {
    return 'Enter a percent from 0 to 100.';
  }
  return null;
}

String _decimalInput(double value) {
  if (value <= 0) return '0';
  if (value == value.roundToDouble()) return '${value.round()}';
  return '$value';
}

String _text(String value) => value.trim().isEmpty ? 'not set' : value.trim();

/// The next built-in theme id, wrapping at the end.
///
/// A stored id outside the built-in set (an old `crimson`, or a custom palette)
/// cycles to the first built-in, so the row is always actionable.
String nextThemeId(String current) {
  final index = lockedInThemeIds.indexOf(current.trim());
  return lockedInThemeIds[(index + 1) % lockedInThemeIds.length];
}

String _positive(int value) => value <= 0 ? 'not set' : '$value';

String _budget(double value) =>
    value <= 0 ? 'no limit' : '\$${value.toStringAsFixed(2)}';

String _providers(SettingsView settings) =>
    settings.chatModel.trim().isEmpty && settings.baseUrl.trim().isEmpty
    ? 'not set'
    : 'configured';

String _uiPlugins(SettingsView settings) {
  final parts = <String>[
    if (settings.pluginDirs.isNotEmpty) '${settings.pluginDirs.length} loaded',
    if (settings.disabledPlugins.isNotEmpty)
      '${settings.disabledPlugins.length} disabled',
  ];
  return parts.isEmpty ? 'none' : parts.join(' · ');
}

/// Commands with a policy row, in the order the product documents them.
const _policyCommands = <String>[
  'chill',
  'lockin',
  'skill',
  'flashcards',
  'study-guide',
];

/// One configured MCP server, read-only.
///
/// The row shows name, transport, enabled flag, status and tool names; the
/// core never sends a command, argument, environment value or path, so none can
/// leak here. A failed connect keeps its message on a full-width line under the
/// row rather than in a clipped value column.
_SettingRow _mcpServerRow(McpServerView server) {
  return _SettingRow(
    id: 'mcp-server-${server.name}',
    label: server.name,
    value: _mcpServerState(server),
    hint: _mcpTools(server),
    note: server.failed ? 'failed: ${server.failure}' : null,
  );
}

String _mcpServerState(McpServerView server) {
  final transport = server.transport.trim().isEmpty
      ? 'stdio'
      : server.transport.trim();
  final status = server.failed
      ? 'failed'
      : (server.status.trim().isEmpty ? 'stopped' : server.status.trim());
  return '$transport · ${server.enabled ? 'enabled' : 'disabled'} · $status';
}

String _mcpTools(McpServerView server) {
  if (server.tools.isEmpty) return 'no tools';
  return server.tools
      .map((tool) => tool.write ? '${tool.name} (write)' : tool.name)
      .join(', ');
}

/// One row of the policy matrix: the stored cells for [command], or `default`
/// when the core stored none. The page never fills a missing cell in.
///
/// This is the read-only projection used when the shell has no
/// `mcp.policy.set` writer; the editable matrix renders [_policyCellRows].
_SettingRow _policyRow(String command, PluginPolicy policy) {
  final row = policy.rowFor(command);
  return _SettingRow(
    id: 'mcp-policy-$command',
    label: command,
    value: row.isEmpty
        ? 'default'
        : row.entries
              .map((entry) => '${entry.key}: ${entry.value}')
              .join(' · '),
    hint: '',
  );
}

/// The commands whose policy may never be `on`: they never call a plugin, and
/// the core refuses that cell rather than downgrading it.
const _noPluginCommands = <String>{'flashcards', 'study-guide'};

/// One editable row per configured server and command, in command order.
///
/// Only configured servers get a row: a stored cell for a server that is no
/// longer configured is not rendered, so the page never offers a write the core
/// would refuse. An absent cell prints `default` and stays absent until written.
List<_SettingRow> _policyCellRows(
  List<McpServerView> servers,
  PluginPolicy policy,
) {
  final rows = <_SettingRow>[];
  for (final command in _policyCommands) {
    final cells = policy.rowFor(command);
    for (final server in servers) {
      final value = cells[server.name] ?? '';
      rows.add(
        _SettingRow(
          id: 'mcp-policy-$command-${server.name}',
          label: '$command · ${server.name}',
          value: value.isEmpty ? 'default' : value,
          hint: 'Enter or Space cycles',
          policy: _PolicyCell(
            command: command,
            server: server.name,
            value: value,
          ),
        ),
      );
    }
  }
  return rows;
}

/// The next cell value in one press of Enter or Space.
///
/// Normal commands cycle `on → explicit → off → on`; the two commands that never
/// call a plugin skip `on`, so they cycle `explicit → off → explicit`. An absent
/// cell starts at the first allowed value, which is never `on` for those two.
String _nextPolicyValue(String command, String current) {
  final allowed = _noPluginCommands.contains(command)
      ? const <String>['explicit', 'off']
      : const <String>['on', 'explicit', 'off'];
  final index = allowed.indexOf(current);
  if (index < 0) return allowed.first;
  return allowed[(index + 1) % allowed.length];
}

String _thousands(int value) {
  final digits = value.abs().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 == 0) buffer.write(',');
    buffer.write(digits[index]);
  }
  return value < 0 ? '-$buffer' : buffer.toString();
}

/// The twelve-token custom palette editor (`docs/product.md` §12 Themes).
///
/// The dialog edits a **local copy**; only `s` writes it through
/// `theme.custom.set`, so abandoning the dialog stores nothing. A token with no
/// override prints crimson's hex and is the fallback that paints; the swatch and
/// the hex are always beside the token name, so colour is never the only signal.
/// A bad hex is refused here — the core would refuse it too — with the accepted
/// form, and nothing is sent.
///
/// Keys: `j/k` or arrows move, `Enter` edits the selected token's hex, `r`
/// resets that token to crimson, `R` resets all twelve, `s` saves, `Esc` cancels
/// the field and then the dialog.
class _CustomPaletteDialog extends StatefulWidget {
  const _CustomPaletteDialog({required this.initial, required this.onSave});

  final Map<String, String> initial;
  final Future<ThemeTokens> Function(Map<String, String> tokens) onSave;

  @override
  State<_CustomPaletteDialog> createState() => _CustomPaletteDialogState();
}

class _CustomPaletteDialogState extends State<_CustomPaletteDialog> {
  late final Map<String, String> _overrides = <String, String>{
    ...widget.initial,
  };
  final _hex = TextEditingController();
  final _scroll = ScrollController();
  int _selected = 0;
  bool _editing = false;
  bool _saving = false;
  String? _error;

  String get _token => customThemeTokenNames[_selected];

  @override
  void dispose() {
    _hex.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _move(int delta) {
    if (_editing) return;
    final next = (_selected + delta).clamp(0, customThemeTokenNames.length - 1);
    if (next == _selected) return;
    setState(() {
      _selected = next;
      _error = null;
    });
  }

  void _beginEdit() {
    setState(() {
      _editing = true;
      _error = null;
      _hex.text = customTokenHex(_token, _overrides);
      _hex.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _hex.text.length,
      );
    });
  }

  void _commitEdit() {
    final text = _hex.text.trim();
    if (!isHexColour(text)) {
      setState(() => _error = 'use #RRGGBB, for example #0D0F11');
      return;
    }
    final colour = parseHexColour(text)!;
    setState(() {
      _overrides[_token] = hexOfColour(colour);
      _editing = false;
      _error = null;
    });
  }

  void _resetOne() {
    if (_overrides.remove(_token) == null) return;
    setState(() => _error = null);
  }

  void _resetAll() {
    if (_overrides.isEmpty) return;
    setState(() {
      _overrides.clear();
      _error = null;
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = await widget.onSave({..._overrides});
      if (!mounted) return;
      Navigator.of(context).pop(saved.values);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _error = userMessage(failure));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (_editing) {
      // The field owns typing; `Esc` backs out to the list and Enter commits
      // through `onSubmitted` (or here, when the field does not consume it).
      if (key == LogicalKeyboardKey.escape) {
        setState(() {
          _editing = false;
          _error = null;
        });
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter) {
        _commitEdit();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.escape) {
      Navigator.of(context).maybePop();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      _beginEdit();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR) {
      if (HardwareKeyboard.instance.isShiftPressed) {
        _resetAll();
      } else {
        _resetOne();
      }
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS) {
      unawaited(_save());
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Dialog(
        backgroundColor: LockedInColors.surface,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 560),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Text(
                      'custom palette',
                      style: TextStyle(
                        color: LockedInColors.foreground,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '${_overrides.length} of '
                      '${customThemeTokenNames.length} set',
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                _PalettePreview(overrides: _overrides),
                const SizedBox(height: 8),
                Flexible(
                  child: Scrollbar(
                    controller: _scroll,
                    child: ListView.builder(
                      controller: _scroll,
                      shrinkWrap: true,
                      itemCount: customThemeTokenNames.length,
                      itemBuilder: (context, index) => _tokenRow(index),
                    ),
                  ),
                ),
                if (_editing) ...[
                  const SizedBox(height: 8),
                  TextField(
                    key: const ValueKey('custom-palette-hex-field'),
                    controller: _hex,
                    autofocus: true,
                    style: TextStyle(color: LockedInColors.foreground),
                    decoration: InputDecoration(
                      labelText: '$_token · #RRGGBB',
                      hintText: '#0D0F11',
                    ),
                    onSubmitted: (_) => _commitEdit(),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    _error!,
                    key: const ValueKey('custom-palette-error'),
                    style: TextStyle(color: LockedInColors.error, fontSize: 11),
                  ),
                ],
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'j/k move · Enter edit · r reset · R reset all · s save · '
                        'Esc back',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 11,
                          height: 1.4,
                        ),
                      ),
                    ),
                    TextButton(
                      key: const ValueKey('custom-palette-reset-all'),
                      onPressed: _resetAll,
                      child: const Text('reset all'),
                    ),
                    const SizedBox(width: 6),
                    OutlinedButton(
                      key: const ValueKey('custom-palette-cancel'),
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('cancel'),
                    ),
                    const SizedBox(width: 6),
                    FilledButton(
                      key: const ValueKey('custom-palette-save'),
                      onPressed: () => unawaited(_save()),
                      child: const Text('save'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _tokenRow(int index) {
    final name = customThemeTokenNames[index];
    final selected = index == _selected;
    final overridden = _overrides.containsKey(name);
    final swatch = parseHexColour(_overrides[name]) ?? crimsonToken(name);
    return GestureDetector(
      key: ValueKey('custom-token-$name'),
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() {
        _selected = index;
        _editing = false;
        _error = null;
      }),
      onDoubleTap: () {
        setState(() => _selected = index);
        _beginEdit();
      },
      child: Container(
        padding: const EdgeInsets.fromLTRB(4, 6, 6, 6),
        color: selected ? LockedInColors.panel : Colors.transparent,
        child: Row(
          children: [
            Container(
              width: 3,
              height: 14,
              color: selected ? LockedInColors.primary : Colors.transparent,
            ),
            const SizedBox(width: 8),
            Container(
              key: ValueKey('custom-swatch-$name'),
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                color: swatch,
                border: Border.all(color: LockedInColors.line),
                borderRadius: BorderRadius.circular(Radii.control),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                name,
                style: TextStyle(
                  color: selected
                      ? LockedInColors.foreground
                      : LockedInColors.secondary,
                  fontSize: 12,
                ),
              ),
            ),
            Text(
              customTokenHex(name, _overrides),
              key: ValueKey('custom-hex-$name'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 11,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 10),
            Text(
              overridden ? 'custom' : 'crimson',
              style: TextStyle(
                color: overridden
                    ? LockedInColors.accent
                    : LockedInColors.muted,
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The live preview: the effective background, foreground and primary.
///
/// Each swatch prints its token name and hex, so the strip is legible without
/// relying on the colour alone.
class _PalettePreview extends StatelessWidget {
  const _PalettePreview({required this.overrides});

  final Map<String, String> overrides;

  @override
  Widget build(BuildContext context) {
    Color token(String name) =>
        parseHexColour(overrides[name]) ??
        crimsonToken(name) ??
        LockedInColors.foreground;
    final background = token('background');
    final foreground = token('foreground');
    final primary = token('primary');
    return Container(
      key: const ValueKey('custom-palette-preview'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: background,
        border: Border.all(color: token('line')),
        borderRadius: BorderRadius.circular(Radii.control),
      ),
      child: Row(
        children: [
          Text(
            'Aa',
            style: TextStyle(
              color: foreground,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'live preview',
              style: TextStyle(color: foreground, fontSize: 11),
            ),
          ),
          _PreviewChip(token: 'primary', colour: primary),
          const SizedBox(width: 6),
          _PreviewChip(token: 'background', colour: background),
        ],
      ),
    );
  }
}

class _PreviewChip extends StatelessWidget {
  const _PreviewChip({required this.token, required this.colour});

  final String token;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          key: ValueKey('custom-preview-$token'),
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: colour,
            border: Border.all(color: LockedInColors.muted),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          token,
          style: TextStyle(color: LockedInColors.muted, fontSize: 10),
        ),
      ],
    );
  }
}

/// One validated theme document: the overrides and, optionally, a base palette.
class _ImportedTheme {
  const _ImportedTheme({required this.tokens, this.base});
  final Map<String, String> tokens;
  final String? base;
}

/// Paste-or-edit a theme JSON document, validate it, then close.
///
/// Validation happens in the dialog so a typo does not close the only place the
/// text exists. The clipboard is prefilled because that is how a theme arrives
/// from another machine or a note.
class _ThemeJsonDialog extends StatefulWidget {
  const _ThemeJsonDialog();

  @override
  State<_ThemeJsonDialog> createState() => _ThemeJsonDialogState();
}

class _ThemeJsonDialogState extends State<_ThemeJsonDialog> {
  final _input = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_prefill());
  }

  Future<void> _prefill() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (!mounted || _input.text.isNotEmpty) return;
    final text = data?.text?.trim() ?? '';
    if (text.startsWith('{')) {
      _input.text = text;
      setState(() {});
    }
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _import() {
    final result = parseThemeDocument(_input.text);
    if (result.error != null) {
      setState(() => _error = result.error);
      return;
    }
    Navigator.of(context)
        .pop(_ImportedTheme(tokens: result.tokens, base: result.base));
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: LockedInColors.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Import theme',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'Paste a theme document. Unknown tokens and non-hex values are '
                'refused before anything is stored.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 11,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const ValueKey('theme-json-input'),
                controller: _input,
                minLines: 8,
                maxLines: 14,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontFamily: 'JetBrainsMono',
                  fontSize: 12,
                ),
                decoration: const InputDecoration(
                  hintText: '{"base":"lockedin","tokens":{"panel":"#161A20"}}',
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 6),
                Text(
                  _error!,
                  key: const ValueKey('theme-json-error'),
                  style: TextStyle(color: LockedInColors.error, fontSize: 11),
                ),
              ],
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('cancel'),
                  ),
                  const SizedBox(width: 6),
                  FilledButton(
                    key: const ValueKey('theme-json-import'),
                    onPressed: _import,
                    child: const Text('import'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Edit one prompt note.
///
/// The note is appended below the generator's own contract. The dialog says that
/// plainly, so the user never expects it to replace the shape or the limits.
class _PromptNoteDialog extends StatefulWidget {
  const _PromptNoteDialog({required this.prompt});

  final PromptNoteView prompt;

  @override
  State<_PromptNoteDialog> createState() => _PromptNoteDialogState();
}

class _PromptNoteDialogState extends State<_PromptNoteDialog> {
  late final TextEditingController _note = TextEditingController(
    text: widget.prompt.note,
  );

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: LockedInColors.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Prompt note · ${widget.prompt.label}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                '${widget.prompt.description} The note is guidance. The reply '
                'shape, its length limits and the safety rules still apply.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 11,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const ValueKey('prompt-note-input'),
                controller: _note,
                minLines: 6,
                maxLines: 12,
                maxLength: 2000,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: 12.5,
                  height: 1.45,
                ),
                decoration: const InputDecoration(
                  hintText:
                      'e.g. prefer short sentences and one concrete example',
                ),
              ),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('cancel'),
                  ),
                  const SizedBox(width: 6),
                  FilledButton(
                    key: const ValueKey('prompt-note-save'),
                    onPressed: () => Navigator.of(context).pop(_note.text),
                    child: const Text('save'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
