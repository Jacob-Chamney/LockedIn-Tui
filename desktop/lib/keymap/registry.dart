import 'package:flutter/services.dart';

import 'binding.dart';

/// Where a row sits in the which-key overlay.
enum ActionGroup { context, global, system }

/// The group titles the overlay renders, in order.
const actionGroupTitles = <ActionGroup, String>{
  ActionGroup.context: 'CONTEXT',
  ActionGroup.global: 'GLOBAL',
  ActionGroup.system: 'SYSTEM',
};

/// The stable ids of the ten surface switches, in `Surface.values` order.
///
/// The shell maps each id back to its `Surface` and the sidebar/palette keep
/// their labels and icons from that enum, so this list is the *key* table and
/// `Surface` is the *destination* table: neither repeats the other's job.
/// Settings is deliberately last, so it keeps the tenth slot.
const surfaceActionIds = <String>[
  'chat',
  'sessions',
  'skills',
  'sources',
  'stats',
  'work',
  'review',
  'archive',
  'knowledge',
  'settings',
];

/// The default `Alt` key for a surface at [index] in [surfaceActionIds].
///
/// The first nine surfaces take `Alt+1…9` by index; the tenth takes `Alt+0`, so
/// adding a surface never costs another one its shortcut. A surface beyond the
/// tenth has no free digit and falls back to its index, which the registry's
/// duplicate/chord validation reports rather than silently pretending.
String surfaceDefaultKey(int index) {
  if (index < 9) return '${index + 1}';
  if (index == 9) return '0';
  return '${index + 1}';
}

/// One action the shell can run, with its default binding.
///
/// [fixed] selects the stored table: `true` is `ui.fixed_keybinds` (the mode and
/// navigation keys), `false` is `ui.keybinds` (leader and direct chords). The
/// split exists because the core stores them separately; the registry merges
/// both into one ordered table.
class ActionSpec {
  const ActionSpec({
    required this.id,
    required this.label,
    required this.hint,
    required this.group,
    required this.defaultBinding,
    this.fixed = false,
  });

  /// Stable id, used by `keybinds.set`, the palette and tests.
  final String id;
  final String label;
  final String hint;
  final ActionGroup group;
  final Binding defaultBinding;
  final bool fixed;
}

/// One action plus the binding in force (default or stored override).
class KeymapRow {
  const KeymapRow({
    required this.spec,
    required this.binding,
    required this.custom,
  });

  final ActionSpec spec;
  final Binding binding;

  /// True when a stored override is in force; false when this is the default.
  final bool custom;

  String get id => spec.id;
  String get label => spec.label;
  String get hint => spec.hint;
  ActionGroup get group => spec.group;
  bool get fixed => spec.fixed;
}

/// Two rows that claim the same chord, across both stored tables.
class KeymapConflict {
  const KeymapConflict({
    required this.actionId,
    required this.otherId,
    required this.binding,
  });

  /// The action that would lose the binding.
  final String actionId;

  /// The action that already holds it.
  final String otherId;
  final Binding binding;

  /// The core's own copy (`docs/.../protocol.md` §Keybinds): `Space x is
  /// already bound to work-swarms.`
  String get message => '${binding.display} is already bound to $otherId.';
}

/// The one key table.
///
/// Defaults, the leader overlay rows, the Settings editor rows, the status-bar
/// hints and the shell's dispatch all come from here. A stored override from
/// `ui.keybinds` / `ui.fixed_keybinds` replaces exactly one row; no screen keeps
/// a second list of keys.
class KeymapRegistry {
  factory KeymapRegistry({
    List<ActionSpec>? catalogue,
    Map<String, String> keybinds = const {},
    Map<String, String> fixedKeybinds = const {},
  }) {
    final actions = List<ActionSpec>.unmodifiable(
      catalogue ?? defaultActionCatalogue(),
    );
    return KeymapRegistry._(actions, _merge(actions, keybinds, fixedKeybinds));
  }

  const KeymapRegistry._(this.actions, this.rows);

  /// The catalogue in catalogue order (surfaces first, then global, then system).
  final List<ActionSpec> actions;

  /// Every action with its effective binding, in catalogue order.
  final List<KeymapRow> rows;

  /// The stored override for a row, if its table holds a usable one.
  ///
  /// An empty string is a cleared override (`docs/.../protocol.md` §Keybinds),
  /// and an unparsable value is ignored rather than crashing the shell: the
  /// default applies. The spec's own table wins; a binding that was moved into
  /// the other table still works, matching the core's "keeps its place" rule.
  static List<KeymapRow> _merge(
    List<ActionSpec> catalogue,
    Map<String, String> keybinds,
    Map<String, String> fixedKeybinds,
  ) {
    return [
      for (final spec in catalogue)
        _rowFrom(spec, _stored(spec, keybinds, fixedKeybinds)),
    ];
  }

  /// The stored override in the spec's own table, else the other one.
  static String? _stored(
    ActionSpec spec,
    Map<String, String> keybinds,
    Map<String, String> fixedKeybinds,
  ) {
    final own = spec.fixed ? fixedKeybinds : keybinds;
    final other = spec.fixed ? keybinds : fixedKeybinds;
    return own[spec.id] ?? other[spec.id];
  }

  static KeymapRow _rowFrom(ActionSpec spec, String? stored) {
    if (stored != null && stored.trim().isNotEmpty) {
      final parsed = Binding.tryParse(stored);
      if (parsed != null) {
        return KeymapRow(spec: spec, binding: parsed, custom: true);
      }
    }
    return KeymapRow(spec: spec, binding: spec.defaultBinding, custom: false);
  }

  KeymapRow? rowFor(String actionId) {
    for (final row in rows) {
      if (row.id == actionId) return row;
    }
    return null;
  }

  /// The binding a surface switch currently uses, or null when the id is gone.
  KeymapRow? surfaceRow(String surfaceName) => rowFor('surface.$surfaceName');

  /// The rows the leader overlay lists: every runnable action, grouped.
  ///
  /// The leader prefix itself is not a row (it is how the overlay opens) and
  /// `close` is excluded because `Esc` cancels the overlay — listing "Esc close"
  /// would promise a key the overlay spends on dismissing itself.
  List<KeymapRow> leaderRows() => [
    for (final row in rows)
      if (row.id != 'leader' && row.id != 'close') row,
  ];

  /// The rows the Settings editor lists: the whole table, in catalogue order.
  List<KeymapRow> editorRows() => List<KeymapRow>.unmodifiable(rows);

  /// The leader rows of one group, in catalogue order.
  List<KeymapRow> leaderRowsFor(ActionGroup group) => [
    for (final row in leaderRows())
      if (row.group == group) row,
  ];

  /// Every duplicate chord across both tables, naming the action that already
  /// holds it. Empty is the healthy state; the core refuses the same collision.
  List<KeymapConflict> get conflicts {
    final seen = <String, KeymapRow>{};
    final found = <KeymapConflict>[];
    for (final row in rows) {
      final key = row.binding.format();
      final first = seen[key];
      if (first == null) {
        seen[key] = row;
        continue;
      }
      found.add(
        KeymapConflict(
          actionId: row.id,
          otherId: first.id,
          binding: row.binding,
        ),
      );
    }
    return found;
  }

  /// The duplicate a proposed binding would create for [actionId], or null.
  KeymapConflict? conflictFor(String actionId, Binding binding) {
    for (final row in rows) {
      if (row.id == actionId) continue;
      if (row.binding.format() == binding.format()) {
        return KeymapConflict(
          actionId: actionId,
          otherId: row.id,
          binding: binding,
        );
      }
    }
    return null;
  }

  /// The action a key event runs, or null. Leader chords (`space+e`) are not
  /// resolved here: they are the overlay's second key.
  KeymapRow? resolve(KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return null;
    final keyboard = HardwareKeyboard.instance;
    return resolveChord(
      logical: event.logicalKey,
      character: event.character,
      control: keyboard.isControlPressed,
      alt: keyboard.isAltPressed,
    );
  }

  /// [resolve] without the keyboard singleton, so a unit test can prove the
  /// table without a widget binding.
  KeymapRow? resolveChord({
    required LogicalKeyboardKey logical,
    String? character,
    bool control = false,
    bool alt = false,
  }) {
    for (final row in rows) {
      final binding = row.binding;
      if (binding.isLeader) continue;
      if (binding.control != control || binding.alt != alt) continue;
      if (Binding.keyToken(logical, character) == binding.key) return row;
    }
    return null;
  }

  /// The row the leader overlay's second key runs, or null.
  KeymapRow? resolveLeaderKey(KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return null;
    final keyboard = HardwareKeyboard.instance;
    if (keyboard.isControlPressed || keyboard.isAltPressed) return null;
    final token = Binding.keyToken(event.logicalKey, event.character);
    if (token == null) return null;
    for (final row in leaderRows()) {
      if (row.binding.isLeader && row.binding.key == token) return row;
    }
    return null;
  }
}

/// The built-in catalogue: the ten surfaces, then the shell verbs.
///
/// A default is a real, working chord, never a placeholder. Surface defaults are
/// `Alt+1…9` then `Alt+0` (derived from [surfaceActionIds] order, so a new
/// surface gets its slot without a second list); every other default is a
/// documented storable form.
List<ActionSpec> defaultActionCatalogue() => [
  for (var index = 0; index < surfaceActionIds.length; index++)
    ActionSpec(
      id: 'surface.${surfaceActionIds[index]}',
      label: surfaceActionIds[index],
      hint: _surfaceHints[surfaceActionIds[index]] ?? 'open the surface',
      group: ActionGroup.context,
      defaultBinding: Binding.direct(surfaceDefaultKey(index), alt: true),
    ),
  const ActionSpec(
    id: 'palette',
    label: 'palette',
    hint: 'run a command',
    group: ActionGroup.global,
    defaultBinding: Binding.direct('k', control: true),
  ),
  const ActionSpec(
    id: 'commands',
    label: 'commands',
    hint: 'run a command by name',
    group: ActionGroup.global,
    defaultBinding: Binding.direct(':'),
  ),
  const ActionSpec(
    id: 'refresh',
    label: 'refresh',
    hint: 'reload the workspace',
    group: ActionGroup.global,
    defaultBinding: Binding.leader('r'),
  ),
  const ActionSpec(
    id: 'retry',
    label: 'retry',
    hint: 'reconnect the core',
    group: ActionGroup.global,
    defaultBinding: Binding.leader('t'),
  ),
  const ActionSpec(
    id: 'leader',
    label: 'leader',
    hint: 'show every binding',
    group: ActionGroup.system,
    defaultBinding: Binding.direct('space'),
    fixed: true,
  ),
  const ActionSpec(
    id: 'help',
    label: 'help',
    hint: 'show every binding',
    group: ActionGroup.system,
    defaultBinding: Binding.direct('?'),
  ),
  const ActionSpec(
    id: 'close',
    label: 'close',
    hint: 'close the current layer',
    group: ActionGroup.system,
    defaultBinding: Binding.direct('escape'),
    fixed: true,
  ),
];

const _surfaceHints = <String, String>{
  'chat': 'the Chill chat',
  'sessions': 'lock-in sessions',
  'skills': 'skill goals',
  'sources': 'the open session sources',
  'stats': 'usage and cost',
  'work': 'registered projects',
  'review': 'the review queue',
  'archive': 'archived items',
  'knowledge': 'notes, memory and sources',
  'settings': 'configuration',
};

/// The Achievements layer's action.
///
/// Achievements is a layer of Stats, not a surface: it has no sidebar row and no
/// `Alt+digit` slot, so it is not in [surfaceActionIds]. Its chord still lives
/// here, in the one key table, so the leader overlay, the Settings editor and
/// the shell all read the same binding and the palette row is a name for the
/// same action rather than a second implementation.
const achievementsAction = ActionSpec(
  id: 'achievements',
  label: 'achievements',
  hint: 'what you have unlocked',
  group: ActionGroup.global,
  defaultBinding: Binding.leader('a'),
);

/// The catalogue the shell builds: every surface/default action plus the layers
/// that are not surfaces.
///
/// [defaultActionCatalogue] stays the surface-and-shell baseline (its length is
/// asserted by the keymap tests); this adds the non-surface layers on top, so a
/// layer never has to invent a key of its own.
List<ActionSpec> shellActionCatalogue() => [
  ...defaultActionCatalogue(),
  achievementsAction,
];
