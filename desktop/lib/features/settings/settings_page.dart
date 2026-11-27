import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';

import '../../bridge/core_client.dart';
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
import 'connect_model_dialog.dart';
import 'settings_widgets.dart';
import 'setting_editor.dart';
import 'settings_groups.dart';
import 'settings_models.dart';
import 'settings_dialogs.dart';
import 'theme_picker.dart';
import 'keybinds_section.dart';

part 'settings_page_actions.dart';
part 'settings_page_rows.dart';

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
      builder: (dialogContext) => ConnectModelDialog(
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
      return const StateMessage(
        icon: Icons.hourglass_empty,
        title: 'loading settings…',
        body: 'Reading the workspace configuration from the core.',
      );
    }
    final failure = error;
    if (failure != null && failure.isNotEmpty) {
      return StateMessage(
        icon: Icons.error_outline,
        tone: LockedInColors.error,
        title: 'Settings could not load',
        body: failure,
        action: onRefresh,
      );
    }
    final snapshot = settings;
    if (snapshot == null) {
      return StateMessage(
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
  /// Rebuild this page from a helper extracted out of this file.
  ///
  /// `setState` is protected, so a part-file extension cannot call it directly.
  void refresh(VoidCallback fn) => setState(fn);

  final _scroll = ScrollController();
  final _search = TextEditingController();
  final _searchFocus = FocusNode(debugLabel: 'settings-search');
  late List<SettingGroup> _allGroups;
  late List<SettingGroup> _groups;
  late List<SettingRow> _rows;
  late List<GlobalKey> _rowKeys;
  final _groupKeys = <String, GlobalKey>{};
  String _query = '';
  String? _activeGroup;
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

  /// True once `Space` was pressed while capturing: the next key joins the leader.
  bool _capturingLeader = false;

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
    _scroll.addListener(_syncActiveGroup);
    // The first group is active before any scroll; the post-frame callback only
    // confirms it once the rail and groups have a size.
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncActiveGroup());
  }

  /// Mark the group whose header has last passed the top of the scroll pane.
  ///
  /// The rail used to be ten jump chips with no current state: the user could
  /// not tell which section the page was showing. A group is active from the
  /// moment its header reaches the top until the next header replaces it.
  void _syncActiveGroup() {
    if (!mounted || _allGroups.isEmpty) return;
    String? active;
    for (final group in _allGroups) {
      final context = _groupKeys[group.title]?.currentContext;
      final box = context?.findRenderObject();
      if (box is! RenderBox || !box.hasSize) continue;
      final top = box.localToGlobal(Offset.zero).dy;
      if (top <= 170) active = group.title;
    }
    active ??= _allGroups.first.title;
    if (active != _activeGroup) setState(() => _activeGroup = active);
  }

  void _rebuildRows() {
    _groups = buildGroups(
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
    _allGroups = _groups;
    final query = _query.trim().toLowerCase();
    _groups = query.isEmpty
        ? _allGroups
        : [
            for (final group in _allGroups)
              if (group.rows
                  .where(
                    (row) =>
                        row.label.toLowerCase().contains(query) ||
                        row.hint.toLowerCase().contains(query) ||
                        row.id.toLowerCase().contains(query) ||
                        row.value.toLowerCase().contains(query),
                  )
                  .toList()
                  .isNotEmpty)
                SettingGroup(
                  title: group.title,
                  rows: group.rows
                      .where(
                        (row) =>
                            row.label.toLowerCase().contains(query) ||
                            row.hint.toLowerCase().contains(query) ||
                            row.id.toLowerCase().contains(query) ||
                            row.value.toLowerCase().contains(query),
                      )
                      .toList(),
                ),
          ];
    _rows = [for (final group in _groups) ...group.rows];
    _rowKeys = [for (var i = 0; i < _rows.length; i++) GlobalKey()];
    for (final group in _allGroups) {
      _groupKeys.putIfAbsent(group.title, () => GlobalKey());
    }
  }

  void _filter(String query) {
    setState(() {
      _query = query;
      _selected = 0;
    });
    _rebuildRows();
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
    _scroll.removeListener(_syncActiveGroup);
    _scroll.dispose();
    _search.dispose();
    _searchFocus.dispose();
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
    // A focused filter owns every bare key: typing `j` must not move the
    // cursor, and typing `a` must not rename anything.
    if (_searchFocus.hasFocus) {
      if (key == LogicalKeyboardKey.escape) {
        if (_query.isNotEmpty) {
          _search.clear();
          _filter('');
        } else {
          _searchFocus.unfocus();
        }
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter) {
        _searchFocus.unfocus();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.slash) {
      _searchFocus.requestFocus();
      return KeyEventResult.handled;
    }
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
          key == LogicalKeyboardKey.numpadEnter) {
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
          _capturingLeader = false;
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
      if (key == LogicalKeyboardKey.enter) {
        _activate();
        return KeyEventResult.handled;
      }
    }
    final decision = row?.decision;
    if (decision != null && key == LogicalKeyboardKey.enter) {
      // The `model` row is not editable in any build: Enter restates the core's
      // reason instead of opening a picker the core would refuse.
      if (decision.kind == DecisionKind.model) {
        _explainDecisionModel(row!);
        return KeyEventResult.handled;
      }
      final write = widget.onSetDecision;
      if (write == null) return KeyEventResult.ignored;
      unawaited(_toggleDecision(row!, decision, write));
      return KeyEventResult.handled;
    }
    final work = row?.work;
    if (work != null && key == LogicalKeyboardKey.enter) {
      final write = widget.onSetWorkPermissions;
      if (write == null) return KeyEventResult.ignored;
      unawaited(_toggleWork(row!, work, write));
      return KeyEventResult.handled;
    }
    if (row?.promptId != null && key == LogicalKeyboardKey.enter) {
      _activate();
      return KeyEventResult.handled;
    }
    final editable = widget.onSaveSettings != null && row?.edit != null;
    if (editable && key == LogicalKeyboardKey.enter) {
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
      setState(() {
        _capturingId = null;
        _capturingLeader = false;
      });
      return;
    }
    // `Space` starts a leader chord: a direct action can become `Space x` and a
    // leader action can move to another letter. With no registry-owned path
    // before, the editor could only ever produce direct chords.
    if (!_capturingLeader &&
        !keybind.binding.isLeader &&
        key == LogicalKeyboardKey.space &&
        !HardwareKeyboard.instance.isControlPressed &&
        !HardwareKeyboard.instance.isAltPressed) {
      setState(() => _capturingLeader = true);
      return;
    }
    if (key == LogicalKeyboardKey.backspace ||
        key == LogicalKeyboardKey.delete) {
      setState(() => _capturingId = null);
      unawaited(_writeKeybind(keybind, null));
      return;
    }
    final binding = captureBinding(event, leader: _capturingLeader);
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
    setState(() {
      _capturingId = null;
      _capturingLeader = false;
    });
    // The registry owns the decision: a duplicate is refused here, in words the
    // core uses too, before any write is sent. The core still re-checks it.
    final decision = widget.keymap.rebind(keybind.actionId, binding);
    if (!decision.accepted) {
      setState(() {
        _rowErrorId = row.id;
        _rowError = decision.message;
      });
      return;
    }
    unawaited(_writeKeybind(keybind, binding.format()));
  }

  SettingRow? _rowById(String id) {
    for (final row in _rows) {
      if (row.id == id) return row;
    }
    return null;
  }

  /// Write one binding, or clear it with a null [binding].
  Future<void> _writeKeybind(KeybindCell cell, String? binding) async {
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
      // A second activation while this row waits switches to the leader: the
      // row is already listening, so `Space` cannot both start a capture and be
      // the chord's first half without a second, discoverable door.
      setState(() {
        if (_capturingId == row.id) {
          _capturingLeader = !_capturingLeader;
        } else {
          _capturingId = row.id;
          _capturingLeader = false;
        }
        _rowErrorId = null;
        _rowError = null;
      });
      return;
    }
    final decision = row.decision;
    if (decision != null) {
      if (decision.kind == DecisionKind.model) {
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
    if (edit.kind == EditKind.toggle) {
      _toggle(row, edit, save);
    } else {
      _openEditor(edit, save);
    }
  }

  /// Edit one prompt note, then write it through the core.
  ///
  /// The dialog is the same for every generator: a note is guidance, not a new
  /// the core refuses a non-empty model and a picker here would be a dead end.
  void _explainDecisionModel(SettingRow row) {
    final reason = row.decision?.reason ?? '';
    setState(() {
      _noticeId = row.id;
      _notice = reason.isEmpty
          ? 'no local model is bundled in this build'
          : reason;
    });
  }

  Future<void> _toggle(
    SettingRow row,
    SettingEdit edit,
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
    SettingEdit edit,
    Future<void> Function(Map<String, dynamic> patch) save,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => SettingEditorDialog(edit: edit, onSave: save),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _filterBar(),
          _sectionRail(),
          Expanded(
            child: Scrollbar(
              controller: _scroll,
              child: SingleChildScrollView(
                key: const ValueKey('settings-scroll'),
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
                                  ? 'Enter edit · Space toggle · / filter · Esc back'
                                  : 'selection only · use connect to change the chat model',
                              style: TextStyle(
                                color: LockedInColors.muted,
                                fontSize: TypeScale.label,
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
          ),
        ],
      ),
    );
  }
}

/// What the updates row prints, in the order the states become true.
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
