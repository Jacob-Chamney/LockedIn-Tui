import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

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

/// True while a text field owns the keyboard.
///
/// A page's `Focus` sits above every inline field on it, and Flutter lets a
/// printable key bubble from `EditableText` to that ancestor. Without this
/// guard, typing `1` in a session's figure form started a study document, and
/// typing `c` in a research question opened the chat. A page returns
/// [KeyEventResult.ignored] for a bare key while this is true, so the letter is
/// text; `Esc` is left to the field's own blur (the page handles it only to
/// hand focus back, never to leave the surface).
bool get textInputFocused {
  final context = FocusManager.instance.primaryFocus?.context;
  if (context == null) return false;
  return context.widget is EditableText ||
      context.findAncestorWidgetOfExactType<EditableText>() != null ||
      context.findAncestorStateOfType<EditableTextState>() != null;
}
