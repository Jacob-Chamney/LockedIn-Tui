import 'package:flutter/services.dart';

/// How a [Binding] is reached: the leader prefix, or a direct chord.
enum BindingKind { leader, direct }

/// One key chord in the documented string form (`desktop/docs/protocol.md`
/// §Keybinds).
///
/// The storable forms are exactly: `space+e` (leader), one printable character
/// (`?`, `:`, `/`, `i`, `0`), a named key (`escape`, `enter`, `tab`, `space`) and
/// `ctrl+<character>` (`ctrl+q`). [tryParse] accepts those and nothing else, and
/// [format] produces them again, so a stored override and a displayed row can
/// never disagree.
///
/// The shell's *default* bindings also use `alt+<digit>` for the surface
/// switcher. [Binding.direct] can build one, but [isStorable] is false: the core
/// refuses that form, so the shell never sends it. A surface keeps its `Alt+N`
/// until the user rebinds it, and `Backspace` in the keybind editor (which sends
/// `null`) is how the default comes back.
class Binding {
  const Binding.direct(this.key, {this.control = false, this.alt = false})
    : kind = BindingKind.direct;

  const Binding.leader(this.key)
    : kind = BindingKind.leader,
      control = false,
      alt = false;

  /// The normalised key token: `a`, `1`, `?`, `escape`, …
  final String key;

  final BindingKind kind;

  /// Ctrl is held. Only meaningful for a direct binding.
  final bool control;

  /// Alt is held. Only meaningful for a direct binding, and never storable.
  final bool alt;

  bool get isLeader => kind == BindingKind.leader;

  /// True when the core's documented form can express this chord.
  bool get isStorable => kind == BindingKind.leader || !alt;

  /// True when a modifier is part of the chord. A bare chord (a character, or
  /// `escape`/`space`) only fires in NORMAL mode; a modified one always does.
  bool get hasModifier => control || alt;

  /// True for a named key rather than a single character.
  bool get isNamedKey => _namedDisplay.containsKey(key);

  /// The stored form: `space+e`, `ctrl+q`, `escape`, `?`, `alt+1`.
  String format() {
    if (kind == BindingKind.leader) return 'space+$key';
    if (control) return 'ctrl+$key';
    if (alt) return 'alt+$key';
    return key;
  }

  /// The form a person reads: `Space E`, `Ctrl+Q`, `Esc`, `?`, `Alt+1`.
  String get display {
    if (kind == BindingKind.leader) return 'Space $key';
    if (control) return 'Ctrl+${key.toUpperCase()}';
    if (alt) return 'Alt+$key';
    return _namedDisplay[key] ?? key;
  }

  @override
  String toString() => format();

  @override
  bool operator ==(Object other) =>
      other is Binding &&
      other.kind == kind &&
      other.key == key &&
      other.control == control &&
      other.alt == alt;

  @override
  int get hashCode => Object.hash(kind, key, control, alt);

  /// The documented storage forms, or null when [raw] is anything else.
  ///
  /// Rejected on purpose: `f6`, `banana`, `ctrl+shift+k`, `space+`,
  /// `space+escape` and the empty string. `alt+<key>` is rejected too — the core
  /// does not accept it, so it is only ever a built-in default.
  static Binding? tryParse(String raw) {
    final text = raw.trim().toLowerCase();
    if (text.isEmpty) return null;
    if (text.startsWith('ctrl+')) {
      final rest = text.substring('ctrl+'.length);
      return _isCharacter(rest) ? Binding.direct(rest, control: true) : null;
    }
    if (text.startsWith('space+')) {
      final rest = text.substring('space+'.length);
      return _isCharacter(rest) ? Binding.leader(rest) : null;
    }
    if (_namedDisplay.containsKey(text)) return Binding.direct(text);
    return _isCharacter(text) ? Binding.direct(text) : null;
  }

  static Binding parse(String raw) {
    final binding = tryParse(raw);
    if (binding == null) {
      throw FormatException('unsupported key binding "$raw"', raw);
    }
    return binding;
  }

  /// The chord a key event names, or null when the event is not a chord (a bare
  /// modifier, a function key, a dead key).
  static Binding? fromKey({
    required LogicalKeyboardKey logical,
    String? character,
    bool control = false,
    bool alt = false,
  }) {
    final token = keyToken(logical, character);
    if (token == null) return null;
    if (alt) return Binding.direct(token, alt: true);
    if (control) {
      // The protocol's form is `ctrl+<character>`; `ctrl+escape` is not one.
      return _isCharacter(token) ? Binding.direct(token, control: true) : null;
    }
    return Binding.direct(token);
  }

  /// The normalised token for a key, independent of modifiers.
  ///
  /// A printable `character` wins, because `?` is Shift+Slash and the character
  /// is the binding a person means. Otherwise the key label names letters,
  /// digits and punctuation that a chord such as Ctrl+Q suppresses.
  static String? keyToken(LogicalKeyboardKey logical, String? character) {
    for (final entry in _namedKeys.entries) {
      if (entry.value == logical) return entry.key;
    }
    if (character != null && character.length == 1) {
      final lower = character.toLowerCase();
      if (_isCharacter(lower)) return lower;
    }
    final label = logical.keyLabel;
    if (label.length == 1) {
      final lower = label.toLowerCase();
      if (_isCharacter(lower)) return lower;
    }
    return null;
  }

  /// True for a bare modifier key, which a capture must ignore rather than bind.
  static bool isModifierKey(LogicalKeyboardKey logical) =>
      _modifierKeys.contains(logical);

  /// True when [text] is one printable character that is not a space.
  static bool _isCharacter(String text) {
    if (text.length != 1) return false;
    final code = text.codeUnitAt(0);
    return code > 0x20 && code < 0x7f;
  }

  static const _namedKeys = <String, LogicalKeyboardKey>{
    'escape': LogicalKeyboardKey.escape,
    'enter': LogicalKeyboardKey.enter,
    'tab': LogicalKeyboardKey.tab,
    'space': LogicalKeyboardKey.space,
  };

  static const _namedDisplay = <String, String>{
    'escape': 'Esc',
    'enter': 'Enter',
    'tab': 'Tab',
    'space': 'Space',
  };

  static final _modifierKeys = <LogicalKeyboardKey>{
    LogicalKeyboardKey.controlLeft,
    LogicalKeyboardKey.controlRight,
    LogicalKeyboardKey.shiftLeft,
    LogicalKeyboardKey.shiftRight,
    LogicalKeyboardKey.altLeft,
    LogicalKeyboardKey.altRight,
    LogicalKeyboardKey.metaLeft,
    LogicalKeyboardKey.metaRight,
  };
}
