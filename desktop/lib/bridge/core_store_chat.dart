part of 'core_store.dart';

extension CoreStoreChat on CoreStore {
  Future<void> refreshChat() async {
    try {
      final json = await _connection.call(CoreMethod.chatSnapshot);
      if (_acceptChatSnapshot(CoreStore._chillChatKey, json['seq'])) {
        chat = ChatSnapshot.fromJson(json);
        chatError = null;
      }
      notifyListeners();
    } catch (failure) {
      // Every other read keeps the previous value on failure; this one used to
      // set `chat = null`, so a transient `chat.snapshot` failure after a model
      // change erased the conversation on screen and reported nothing.
      chatError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Send one Chill turn (`chat.send`).
  ///
  /// [images] are absolute paths the **user picked**, at most four. The core
  /// derives each media type from its extension and reads the bytes at send
  /// time; the shell never opens the file, and nothing is persisted — the
  /// transcript stays text only. The key is omitted when there is no image, so
  /// a text-only turn is byte-identical to the old request.
  Future<bool> sendChat(String text, {List<String> images = const []}) async {
    try {
      await _connection.call(CoreMethod.chatSend, {
        'text': text,
        if (images.isNotEmpty) 'images': images,
      });
      chatSendError = null;
      notifyListeners();
      return true;
    } catch (failure) {
      // Per-surface, not the global error: the chat shows it in its banner and
      // keeps the composer text, and no other page is told about it.
      chatSendError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  Future<void> cancelChat() async {
    try {
      await _connection.call(CoreMethod.chatCancel);
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }
}
