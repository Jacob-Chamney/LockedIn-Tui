import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

/// One scrolling rule for every transcript and reader in the app.
///
/// The four chats used to disagree: Chill never followed a growing reply, and
/// the other three dragged the reader to the bottom on every streamed batch,
/// even while they were reading something further up. None could be scrolled
/// from the keyboard at all.
///
/// `docs/design.md` §4.3: follow a streaming reply only while the reader is at
/// the bottom, and scroll with `j`/`k` (a line), `d`/`u` (half a page) and
/// `g`/`G` (the ends).

/// True when [controller] is at the end, or close enough that the reader is
/// plainly following the conversation rather than reading back.
bool nearBottom(ScrollController controller, {double slack = 56}) {
  if (!controller.hasClients) return true;
  final position = controller.position;
  if (!position.hasContentDimensions) return true;
  return position.maxScrollExtent - position.pixels <= slack;
}

/// Scroll to the end after the next layout.
void scrollToEnd(ScrollController controller, {bool animate = true}) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!controller.hasClients) return;
    final end = controller.position.maxScrollExtent;
    if (animate) {
      controller.animateTo(
        end,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    } else {
      controller.jumpTo(end);
    }
  });
}

/// Handle one NORMAL-mode scrolling key for [controller].
///
/// Returns null when [event] is not a scrolling key, so the caller's own keys
/// run next. A chord with Ctrl, Alt or Meta is never a scrolling key: those
/// belong to the shell (`Ctrl+K`) or the platform.
KeyEventResult? scrollKey(ScrollController controller, KeyEvent event) {
  if (event is! KeyDownEvent && event is! KeyRepeatEvent) return null;
  final keyboard = HardwareKeyboard.instance;
  if (keyboard.isControlPressed ||
      keyboard.isAltPressed ||
      keyboard.isMetaPressed) {
    return null;
  }
  if (!controller.hasClients) return null;
  final position = controller.position;
  if (!position.hasContentDimensions) return null;
  final key = event.logicalKey;
  final page = position.viewportDimension;
  final shift = keyboard.isShiftPressed;

  double? target;
  if (key == LogicalKeyboardKey.keyJ || key == LogicalKeyboardKey.arrowDown) {
    target = position.pixels + 48;
  } else if (key == LogicalKeyboardKey.keyK ||
      key == LogicalKeyboardKey.arrowUp) {
    target = position.pixels - 48;
  } else if (key == LogicalKeyboardKey.keyD && !shift) {
    target = position.pixels + page / 2;
  } else if (key == LogicalKeyboardKey.keyU && !shift) {
    target = position.pixels - page / 2;
  } else if (key == LogicalKeyboardKey.pageDown) {
    target = position.pixels + page * 0.9;
  } else if (key == LogicalKeyboardKey.pageUp) {
    target = position.pixels - page * 0.9;
  } else if (key == LogicalKeyboardKey.home ||
      (key == LogicalKeyboardKey.keyG && !shift)) {
    target = position.minScrollExtent;
  } else if (key == LogicalKeyboardKey.end ||
      (key == LogicalKeyboardKey.keyG && shift)) {
    target = position.maxScrollExtent;
  }
  if (target == null) return null;
  controller.jumpTo(
    target.clamp(position.minScrollExtent, position.maxScrollExtent),
  );
  return KeyEventResult.handled;
}
