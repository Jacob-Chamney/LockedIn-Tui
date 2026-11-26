import 'package:material_ui/material_ui.dart';

import '../../keymap/binding.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'setting_editor.dart';

class SettingRow {
  const SettingRow({
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
  final PolicyCell? policy;

  /// One rebindable row. Non-null rows capture the next chord on Enter; null
  /// keeps the row a read-only projection.
  final KeybindCell? keybind;

  /// One row of the `DECISION LAYER` group. Non-null rows own Enter and Space:
  /// the `enabled` row toggles, the `model` row restates the core's reason.
  final DecisionCell? decision;

  /// One row of the `WORK` group. Non-null rows own Enter and Space and write
  /// the matching global opt-in; null keeps the row read-only.
  final WorkCell? work;

  /// One row of the `PROMPTS` group: Enter edits the note, empty clears it.
  final String? promptId;

  /// Null keeps the row read-only. A value editor opens a dialog; a toggle
  /// patch is written on Enter or Space.
  final SettingEdit? edit;
}

enum DecisionKind { enabled, model }

/// One row of the `DECISION LAYER` group.
///
/// [enabled] is the stored toggle state ([kind] `enabled`); [reason] is the
/// core's own sentence explaining why no local model can run here ([kind]
/// `model`). The model row carries no writer: this build has no local model
/// runtime, so an editor would promise a control the core refuses.
class DecisionCell {
  const DecisionCell({
    required this.kind,
    this.enabled = false,
    this.reason = '',
  });

  final DecisionKind kind;
  final bool enabled;
  final String reason;
}

/// One row of the `WORK` group: which global opt-in it writes, and the stored
/// value it renders.
class WorkCell {
  const WorkCell({required this.kind, required this.allowed});

  final WorkKind kind;

  /// The stored flag. False means the core refuses that approval until the user
  /// turns it on here; it is never inferred from the agent profile.
  final bool allowed;
}

enum WorkKind { write, command }

/// One row of the `KEYBINDS` group: the action and the binding in force.
class KeybindCell {
  const KeybindCell({
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
class PolicyCell {
  const PolicyCell({
    required this.command,
    required this.server,
    required this.value,
  });

  final String command;
  final String server;
  final String value;
}

class SettingGroup {
  const SettingGroup({required this.title, required this.rows});

  final String title;
  final List<SettingRow> rows;
}

TextStyle valueStyle(String value) {
  return TextStyle(
    color: value == 'not set'
        ? LockedInColors.muted
        : LockedInColors.foreground,
    fontSize: TypeScale.body,
    height: 1.5,
  );
}
