/// One image attached to the Chill composer before a send.
///
/// The shell carries only the path the user picked: it never opens, reads,
/// resizes, copies or persists the file. The core derives the media type from
/// the extension and reads the bytes at send time, and `chat.jsonl` plus the
/// local Chill history stay text only (`desktop/docs/protocol.md`, `chat.send`
/// images). A chip is therefore shell-local UI state, safe to lose.
class ChatAttachment {
  const ChatAttachment({required this.path});

  /// The absolute path the user picked. Never a destination: the core only
  /// reads it.
  final String path;

  /// The last path segment, for the chip. Falls back to the path itself so a
  /// chip is never blank.
  String get name {
    final trimmed = path.trim();
    if (trimmed.isEmpty) return path;
    final base = trimmed.split(RegExp(r'[/\\]')).last;
    return base.isEmpty ? trimmed : base;
  }
}

/// The most images one Chill turn may carry (`docs/product.md` §3.1).
///
/// A fifth attach is refused locally with a message, never silently dropped;
/// the core enforces the same limit.
const maxChatImages = 4;
