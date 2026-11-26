import '../../bridge/models.dart';
import '../../keymap/registry.dart';
import '../../theme/palette.dart';
import 'keybinds_section.dart';
import 'setting_editor.dart';
import 'settings_models.dart';

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

List<SettingGroup> buildGroups(
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
    SettingGroup(
      title: 'USER',
      rows: [
        SettingRow(
          id: 'username',
          label: 'username',
          value: _text(settings.username),
          hint: 'shown in the chat greeting',
          edit: SettingEdit(
            kind: EditKind.text,
            label: 'username',
            help: 'shown in the chat greeting',
            initial: settings.username,
            valuePatch: (input) => {
              'ui': {'username': input.trim()},
            },
          ),
        ),
        SettingRow(
          id: 'theme',
          label: 'theme',
          value: _text(settings.theme),
          hint: 'Enter pick · c custom · e edit · x export · i import',
          edit: SettingEdit(
            kind: EditKind.toggle,
            label: 'theme',
            help: 'Enter picks a theme from the catalogue; c picks custom',
            togglePatch: () => {
              'ui': {'theme': nextThemeId(settings.theme)},
            },
          ),
        ),
      ],
    ),
    SettingGroup(
      title: 'MODELS',
      rows: [
        SettingRow(
          id: 'chat-model',
          label: 'chat model',
          value: _text(settings.chatModel),
          hint: 'Enter connect · explicit choice, never auto-selected',
        ),
        SettingRow(
          id: 'providers',
          label: 'providers',
          value: _providers(settings),
          hint: 'Enter link a key · keys live in the OS keychain',
        ),
        SettingRow(
          id: 'base-url',
          label: 'base URL',
          value: _text(settings.baseUrl),
          hint: 'custom OpenAI-compatible endpoint',
          edit: SettingEdit(
            kind: EditKind.text,
            label: 'base URL',
            help: 'http(s) URL, or empty for the provider default',
            initial: settings.baseUrl,
            validate: _validateBaseUrl,
            valuePatch: (input) => {
              'models': {'base_url': input.trim()},
            },
          ),
        ),
        SettingRow(
          id: 'max-tool-calls',
          label: 'max tool calls',
          value: _positive(settings.maxToolCalls),
          hint: 'per request ceiling',
          edit: SettingEdit(
            kind: EditKind.integer,
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
        SettingRow(
          id: 'max-tokens',
          label: 'max tokens per request',
          value: settings.maxTokensPerRequest <= 0
              ? 'not set'
              : _thousands(settings.maxTokensPerRequest),
          hint: 'output ceiling per request',
          edit: SettingEdit(
            kind: EditKind.integer,
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
    SettingGroup(
      title: 'USAGE',
      rows: [
        SettingRow(
          id: 'budget',
          label: 'budget',
          value: _budget(settings.budgetUsd),
          hint: 'estimated spend, not a bill',
          edit: SettingEdit(
            kind: EditKind.decimal,
            label: 'budget',
            help: '0 or more; 0 means no limit',
            initial: _decimalInput(settings.budgetUsd),
            validate: _validateBudget,
            valuePatch: (input) => {
              'usage': {'budget': double.parse(input.trim())},
            },
          ),
        ),
        SettingRow(
          id: 'period',
          label: 'period',
          value: _text(settings.period),
          hint: 'day or month',
          edit: SettingEdit(
            kind: EditKind.toggle,
            label: 'period',
            help: 'toggles between day and month',
            togglePatch: () => {
              'usage': {'period': settings.period == 'month' ? 'day' : 'month'},
            },
          ),
        ),
        SettingRow(
          id: 'warn-at',
          label: 'warn at',
          value: '${(settings.warnAt * 100).round()}%',
          hint: 'budget warning threshold',
          edit: SettingEdit(
            kind: EditKind.decimal,
            label: 'warn at (%)',
            help: 'percent from 0 to 100',
            initial: '${(settings.warnAt * 100).round()}',
            validate: _validatePercent,
            valuePatch: (input) => {
              'usage': {'warn_at': double.parse(input.trim()) / 100},
            },
          ),
        ),
        SettingRow(
          id: 'pause-at-limit',
          label: 'pause at limit',
          value: settings.pauseAtLimit ? 'yes' : 'no',
          hint: 'stop sending at the limit',
          edit: SettingEdit(
            kind: EditKind.toggle,
            label: 'pause at limit',
            help: 'toggles the budget pause',
            togglePatch: () => {
              'usage': {'pause_at_limit': !settings.pauseAtLimit},
            },
          ),
        ),
      ],
    ),
    SettingGroup(
      title: 'STORAGE',
      rows: [
        SettingRow(
          id: 'data-folder',
          label: 'data folder',
          value: _text(settings.dataDir),
          hint: 'app data stays outside the workspace',
        ),
        SettingRow(
          id: 'archive-backend',
          label: 'archive backend',
          value: _text(settings.archiveBackend),
          hint: 'folder or private GitHub',
        ),
        SettingRow(
          id: 'archive-folder',
          label: 'archive folder',
          value: _text(settings.archiveFolder),
          hint: 'local archive destination',
        ),
        SettingRow(
          id: 'history-limit',
          label: 'history limit',
          value: settings.historyLimit <= 0
              ? 'off'
              : '${settings.historyLimit} messages',
          hint: 'messages kept in Chill',
          edit: SettingEdit(
            kind: EditKind.integer,
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
    SettingGroup(
      title: 'PLUGINS',
      rows: [
        SettingRow(
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
        SettingRow(
          id: 'ui-plugins',
          label: 'UI plugins',
          value: _uiPlugins(settings),
          hint: 'loaded from the plugin folders',
        ),
      ],
    ),
    SettingGroup(title: 'DECISION LAYER', rows: _decisionRows(decision)),
    SettingGroup(title: 'WORK', rows: _workRows(workPermissions)),
    SettingGroup(
      title: 'ABOUT',
      rows: [
        SettingRow(
          id: 'app-version',
          label: 'version',
          value: appVersion?.trim().isNotEmpty == true
              ? appVersion!
              : 'not read',
          hint: 'the running build',
        ),
        SettingRow(
          id: 'updates',
          label: 'updates',
          value: _updateRowValue(update, updateChecking, updateError),
          hint: 'Enter check · c copy link',
        ),
      ],
    ),
    SettingGroup(
      title: 'PROMPTS',
      rows: prompts.isEmpty
          ? [
              SettingRow(
                id: 'prompts-empty',
                label: 'prompt notes',
                value: 'no note',
                hint: 'guidance for one generator; shape and limits stay fixed',
              ),
            ]
          : [
              for (final prompt in prompts)
                SettingRow(
                  id: 'prompt-${prompt.id}',
                  label: prompt.label,
                  value: prompt.custom ? 'custom' : 'no note',
                  hint: prompt.description,
                  promptId: prompt.id,
                ),
            ],
    ),
    SettingGroup(
      title: 'KEYBINDS',
      rows: [
        // Generated from the one registry: the leader overlay, the shell's
        // dispatch and this editor read the same rows, so an override here is
        // the binding that runs.
        for (final entry in keybindSettingRows(keymap ?? KeymapRegistry()))
          SettingRow(
            id: entry.id,
            label: entry.label,
            value: entry.binding.display,
            hint: entry.hint,
            keybind: KeybindCell(
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
List<SettingRow> _decisionRows(DecisionView? view) {
  if (view == null) {
    return const [
      SettingRow(
        id: 'decision-enabled',
        label: 'enabled',
        value: _decisionUnread,
        hint: 'read from the core when Settings opens',
        decision: DecisionCell(kind: DecisionKind.enabled),
      ),
    ];
  }
  final rulesOnly = view.rulesOnly;
  final reason = view.localModelReason.trim();
  return [
    SettingRow(
      id: 'decision-enabled',
      label: 'enabled',
      value: view.enabled ? 'on' : 'off',
      hint: 'Enter or Space toggles · rules only',
      decision: DecisionCell(kind: DecisionKind.enabled, enabled: view.enabled),
    ),
    SettingRow(
      id: 'decision-model',
      label: 'model',
      value: rulesOnly ? 'not shipped in this build' : _text(view.model),
      hint: rulesOnly
          ? (reason.isEmpty ? 'no local model runtime is bundled' : reason)
          : 'no local model editor in this build',
      decision: DecisionCell(kind: DecisionKind.model, reason: reason),
    ),
  ];
}

/// The rows of the `WORK` group: the two independent global opt-ins.
///
/// Both default to off in the core and are never inferred from a profile: a
/// row says `not read yet` until `work.permissions.get` answers. Turning one on
/// here does not approve anything; every write and command still needs its own
/// approval, and the agent profile must allow it too.
List<SettingRow> _workRows(WorkPermissions? view) {
  String value(bool allowed) => allowed ? 'allowed' : 'switched off';
  return [
    SettingRow(
      id: 'work-allow-write',
      label: 'allow writes',
      value: view == null ? 'not loaded yet' : value(view.allowWrite),
      hint: 'Enter or Space toggles · per-write approval is still required',
      work: WorkCell(kind: WorkKind.write, allowed: view?.allowWrite ?? false),
    ),
    SettingRow(
      id: 'work-allow-command',
      label: 'allow commands',
      value: view == null ? 'not loaded yet' : value(view.allowCommand),
      hint: 'Enter or Space toggles · per-command approval is still required',
      work: WorkCell(
        kind: WorkKind.command,
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
SettingRow _mcpServerRow(McpServerView server) {
  return SettingRow(
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
SettingRow _policyRow(String command, PluginPolicy policy) {
  final row = policy.rowFor(command);
  return SettingRow(
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
List<SettingRow> _policyCellRows(
  List<McpServerView> servers,
  PluginPolicy policy,
) {
  final rows = <SettingRow>[];
  for (final command in _policyCommands) {
    final cells = policy.rowFor(command);
    for (final server in servers) {
      final value = cells[server.name] ?? '';
      rows.add(
        SettingRow(
          id: 'mcp-policy-$command-${server.name}',
          label: '$command · ${server.name}',
          value: value.isEmpty ? 'default' : value,
          hint: 'Enter or Space cycles',
          policy: PolicyCell(
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
String nextPolicyValue(String command, String current) {
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
