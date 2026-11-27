part of 'core_store.dart';

/// Goal-scoped skill chat: open, create, send, cancel and close.
extension CoreStoreSkillChat on CoreStore {
  /// list could not be refreshed instead of "no goals yet".
  Future<bool> openSkillChat(String goalId, {String? chatId}) async {
    // See [openWorkChat]: a reply for a goal that is no longer the open one is
    // cached, never activated.
    final owner = activeSkillId;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.skillChatOpen, {
        'goalId': goalId,
        if (chatId != null && chatId.trim().isNotEmpty) 'chatId': chatId.trim(),
      });
    } catch (failure) {
      if (activeSkillId != owner) return false;
      error = _messageOf(failure);
      notifyListeners();
      return false;
    }

    final rawChatId = json['chatId'];
    final resolved = rawChatId is String && rawChatId.isNotEmpty
        ? rawChatId
        : chatId ?? '';
    if (resolved.isEmpty) {
      if (activeSkillId != owner) return false;
      error = 'the core did not name the goal chat';
      notifyListeners();
      return false;
    }

    final raw = json['snapshot'];
    final rawSnapshot = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final skillKey = CoreStore._skillChatKey(goalId, resolved);
    if (_acceptChatSnapshot('skill:$skillKey', rawSnapshot['seq'])) {
      _skillChats[skillKey] = ChatSnapshot.fromJson(rawSnapshot);
    }
    _skillChatErrors.remove(CoreStore._skillChatKey(goalId, resolved));
    if (activeSkillId != owner) return false;
    activeSkillChatId = resolved;
    if (!skillChats.any((chat) => chat.id == resolved)) {
      skillChats = [
        ...skillChats,
        SkillChatRow(id: resolved, title: '', lastUsed: '', messages: 0),
      ];
    }
    error = null;
    notifyListeners();
    return true;
  }

  /// Start a **new** goal chat, always.
  ///
  /// `skill.chat.open` resumes the newest transcript and a goal chat has many,
  /// so without this a user could never get past `chat-1`. Refusals are kept on
  /// the shell-wide [error] like [openSkillChat]; the caller decides whether to
  /// open the chat layer.
  Future<bool> createSkillChat(String goalId) async {
    final owner = activeSkillId;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.skillChatCreate, {
        'goalId': goalId,
      });
    } catch (failure) {
      if (activeSkillId != owner) return false;
      error = _messageOf(failure);
      notifyListeners();
      return false;
    }

    final rawChatId = json['chatId'];
    if (rawChatId is! String || rawChatId.isEmpty) {
      if (activeSkillId != owner) return false;
      error = 'the core did not name the new goal chat';
      notifyListeners();
      return false;
    }

    final raw = json['snapshot'];
    final rawSnapshot = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final skillKey = CoreStore._skillChatKey(goalId, rawChatId);
    if (_acceptChatSnapshot('skill:$skillKey', rawSnapshot['seq'])) {
      _skillChats[skillKey] = ChatSnapshot.fromJson(rawSnapshot);
    }
    _skillChatErrors.remove(CoreStore._skillChatKey(goalId, rawChatId));
    if (activeSkillId != owner) return false;
    activeSkillChatId = rawChatId;
    if (!skillChats.any((chat) => chat.id == rawChatId)) {
      skillChats = [
        ...skillChats,
        SkillChatRow(id: rawChatId, title: '', lastUsed: '', messages: 0),
      ];
    }
    error = null;
    notifyListeners();
    return true;
  }

  /// Send one turn to a goal chat. Never touches Chill, a session or a project.
  ///
  /// The transcript grows only from the core's `skill.chat.state` events. A
  /// request failure is kept for that one chat in [skillChatErrorFor], so a goal
  /// chat refusal never looks like a shell-wide transport failure.
  Future<bool> sendSkillChat(String goalId, String chatId, String text) async {
    final key = CoreStore._skillChatKey(goalId, chatId);
    try {
      await _connection.call(CoreMethod.skillChatSend, {
        'goalId': goalId,
        'chatId': chatId,
        'text': text,
      });
      if (_skillChatErrors.remove(key) != null) notifyListeners();
      return true;
    } catch (failure) {
      _skillChatErrors[key] = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Stop a goal chat's in-flight turn. Nothing running is a no-op.
  Future<void> cancelSkillChat(String goalId, String chatId) async {
    try {
      await _connection.call(CoreMethod.skillChatCancel, {
        'goalId': goalId,
        'chatId': chatId,
      });
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Collapse from the goal chat back to the goal page.
  ///
  /// The transcript and the chat id stay in the store, so reopening the chat
  /// paints the previous conversation and does not reset it.
  void closeSkillChat() {
    if (activeSkillChatId == null) return;
    activeSkillChatId = null;
    notifyListeners();
  }

  void _clearChapter() {
    // Closing the reader abandons a body still being read.
    _skillChapterTicket += 1;
    activeSkillChapter = null;
    activeSkillChapterId = null;
    activeSkillChapterPractical = false;
    skillChapterLoading = false;
    skillChapterError = null;
  }

  /// Register one folder as a Work project (`work.create`).
  ///
  /// [folder] is the path the **user typed or picked**; the core resolves it,
  /// creates the leaf when it does not exist and writes only
  /// `work/projects/<id>/meta.json`. The folder itself is never moved or
  /// deleted.
  ///
  /// On success the list is refreshed and the new project opened, so the shell
  /// lands on its detail. On failure the [RpcException] is rethrown untouched,
  /// like [linkProvider]: the dialog shows the core's own message and stays
}
