import 'package:flutter/services.dart';

/// The keyboard rules every feature page shares.
///
/// A page's `Focus.onKeyEvent` runs before the shell's root handler, and page
/// keys are bare letters (`k` known, `n` new, `a` archive). Without these two
/// guards a page reads a *modified* chord as the bare key — `Ctrl+K` marked a
/// review item known and wrote to disk instead of opening the palette — and a
/// page reads the letters of a search query as commands.

/// True while Ctrl, Alt or Meta is held.
///
/// A page returns [KeyEventResult.ignored] for every key while this is true,
/// unless it binds that exact chord itself (`session_settings.dart` saves on
/// `Ctrl+S`). The shell's registry owns the modified chords.
bool get modifierHeld {
  final keyboard = HardwareKeyboard.instance;
  return keyboard.isControlPressed ||
      keyboard.isAltPressed ||
      keyboard.isMetaPressed;
}
