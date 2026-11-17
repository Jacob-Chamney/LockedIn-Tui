import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../keymap/binding.dart';
import '../../keymap/registry.dart';
import '../../theme/palette.dart';

/// One rebindable row of the Settings `KEYBINDS` group.
///
/// The rows are generated from [KeymapRegistry.editorRows], so the editor, the
/// leader overlay and the shell's dispatch share one table. Nothing here keeps a
/// second key list: a row names its action id and the binding currently in force.
class KeybindSettingRow {
  const KeybindSettingRow({
    required this.id,
    required this.actionId,
    required this.label,
    required this.hint,
    required this.binding,
    required this.custom,
    required this.fixed,
  });

  /// Row id for the settings list (`keybind-<action>`).
  final String id;

  /// The stable action id sent to `keybinds.set`.
  final String actionId;
  final String label;
  final String hint;
  final Binding binding;

  /// True when a stored override is in force rather than the default.
  final bool custom;

  /// True when the override lives in `ui.fixed_keybinds`.
  final bool fixed;
}

/// The Settings editor rows, in catalogue order.
List<KeybindSettingRow> keybindSettingRows(KeymapRegistry registry) => [
  for (final row in registry.editorRows())
    KeybindSettingRow(
      id: 'keybind-${row.id}',
      actionId: row.id,
      label: row.label,
      hint: row.hint,
      binding: row.binding,
      custom: row.custom,
      fixed: row.fixed,
    ),
];

/// The chord the next key event names, or null when it names none.
///
/// A bare modifier is not a chord: the editor ignores those presses while it
/// waits, so Control, then K, captures `ctrl+k` rather than an unbindable
/// "control".
Binding? captureBinding(KeyEvent event) {
  if (event is! KeyDownEvent && event is! KeyRepeatEvent) return null;
  if (Binding.isModifierKey(event.logicalKey)) return null;
  final keyboard = HardwareKeyboard.instance;
  return Binding.fromKey(
    logical: event.logicalKey,
    character: event.character,
    control: keyboard.isControlPressed,
    alt: keyboard.isAltPressed,
  );
}

/// The footer line under the `KEYBINDS` group.
String keybindFooter(bool editable) => editable
    ? 'Enter rebind · Backspace clear · r reset · R reset all'
    : 'selection only · no keybind writer in this build';

/// The value cell of one keybind row: the chord, and whether it is an override.
class KeybindValue extends StatelessWidget {
  const KeybindValue({
    super.key,
    required this.binding,
    required this.custom,
    this.capturing = false,
  });

  final Binding binding;
  final bool custom;

  /// True while the row waits for the next chord.
  final bool capturing;

  @override
  Widget build(BuildContext context) {
    if (capturing) {
      return Text(
        'press a key…',
        key: const ValueKey('keybind-capturing'),
        style: TextStyle(
          color: LockedInColors.warning,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (custom) ...[
          Icon(Icons.edit_outlined, size: 11, color: LockedInColors.muted),
          const SizedBox(width: 5),
        ],
        Flexible(
          child: Text(
            binding.display,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.right,
            style: TextStyle(
              color: custom ? LockedInColors.foreground : LockedInColors.muted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

/// The explanatory line under the `KEYBINDS` group.
class KeybindFooter extends StatelessWidget {
  const KeybindFooter({super.key, required this.editable});

  final bool editable;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 12, 6),
      child: Text(
        keybindFooter(editable),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 11,
          height: 1.4,
        ),
      ),
    );
  }
}
