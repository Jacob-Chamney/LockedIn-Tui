part of 'core_store.dart';

/// Figures, the context meter and the flashcard schedule.
extension CoreStoreSessionExtras on CoreStore {
  /// Read the open session's figures (`session.figure.list`).
  Future<void> readFigures(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_figureTicket;
    figuresLoading = true;
    figureError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionFigureList, {
        'id': id,
      });
      if (ticket != _figureTicket) return;
      final rows = json['figures'];
      figures = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      SessionFigure.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
    } catch (failure) {
      if (ticket != _figureTicket) return;
      figureError = _messageOf(failure);
    } finally {
      if (ticket == _figureTicket) {
        figuresLoading = false;
        notifyListeners();
      }
    }
  }

  /// Crop one figure from the session's own PDF (`session.figure.extract`).
  Future<bool> extractFigure(
    String sessionId, {
    required int page,
    int? x,
    int? y,
    int? width,
    int? height,
    String caption = '',
    String note = '',
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty || page < 1) return false;
    figureBusy = true;
    figureError = null;
    notifyListeners();
    try {
      await _connection.call(CoreMethod.sessionFigureExtract, {
        'id': id,
        'page': page,
        'x': ?x,
        'y': ?y,
        'width': ?width,
        'height': ?height,
        if (caption.trim().isNotEmpty) 'caption': caption.trim(),
        if (note.trim().isNotEmpty) 'note': note.trim(),
      });
      await readFigures(id);
      return true;
    } catch (failure) {
      figureError = _messageOf(failure);
      return false;
    } finally {
      figureBusy = false;
      notifyListeners();
    }
  }

  /// Load one figure's PNG bytes (`session.figure.read`).
  Future<void> loadFigure(String sessionId, String figureId) async {
    final id = sessionId.trim();
    if (id.isEmpty || figureId.isEmpty) return;
    try {
      final json = await _connection.call(CoreMethod.sessionFigureRead, {
        'id': id,
        'figureId': figureId,
      });
      final base64 = json['base64'];
      if (base64 is String) {
        figureImages[figureId] = base64Decode(base64);
      }
      figureError = null;
    } catch (failure) {
      figureError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Change one figure's caption or note (`session.figure.annotate`).
  Future<void> annotateFigure(
    String sessionId,
    String figureId, {
    String? caption,
    String? note,
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty || figureId.isEmpty) return;
    try {
      await _connection.call(CoreMethod.sessionFigureAnnotate, {
        'id': id,
        'figureId': figureId,
        'caption': ?caption,
        'note': ?note,
      });
      await readFigures(id);
    } catch (failure) {
      figureError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Remove one figure (`session.figure.remove`).
  Future<void> removeFigure(String sessionId, String figureId) async {
    final id = sessionId.trim();
    if (id.isEmpty || figureId.isEmpty) return;
    try {
      await _connection.call(CoreMethod.sessionFigureRemove, {
        'id': id,
        'figureId': figureId,
      });
      figureImages.remove(figureId);
      await readFigures(id);
    } catch (failure) {
      figureError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read one session chat's context meter (`session.chat.context`).
  Future<void> readSessionContext(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_contextTicket;
    sessionContextLoading = true;
    sessionContextError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionChatContext, {
        'id': id,
      });
      if (ticket != _contextTicket) return;
      sessionContext = SessionContextView.fromJson(json);
    } catch (failure) {
      if (ticket != _contextTicket) return;
      sessionContextError = _messageOf(failure);
    } finally {
      if (ticket == _contextTicket) {
        sessionContextLoading = false;
        notifyListeners();
      }
    }
  }

  /// Compact the older part of a session chat (`session.chat.compact`).
  ///
  /// One explicit model call, no retry; the reply is the new meter.
  Future<void> compactSessionChat(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty || sessionContextLoading) return;
    final ticket = ++_contextTicket;
    sessionContextLoading = true;
    sessionContextError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionChatCompact, {
        'id': id,
      });
      if (ticket != _contextTicket) return;
      sessionContext = SessionContextView.fromJson(json);
    } catch (failure) {
      if (ticket != _contextTicket) return;
      sessionContextError = _messageOf(failure);
    } finally {
      if (ticket == _contextTicket) {
        sessionContextLoading = false;
        notifyListeners();
      }
    }
  }

  /// Drop the stored summary (`session.chat.uncompact`).
  Future<void> uncompactSessionChat(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty || sessionContextLoading) return;
    final ticket = ++_contextTicket;
    sessionContextLoading = true;
    sessionContextError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionChatUncompact, {
        'id': id,
      });
      if (ticket != _contextTicket) return;
      sessionContext = SessionContextView.fromJson(json);
    } catch (failure) {
      if (ticket != _contextTicket) return;
      sessionContextError = _messageOf(failure);
    } finally {
      if (ticket == _contextTicket) {
        sessionContextLoading = false;
        notifyListeners();
      }
    }
  }

  /// Read one session's flashcard schedule (`session.deck.state`).
  Future<void> readDeckSchedule(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_deckTicket;
    deckScheduleLoading = true;
    deckScheduleError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionDeckState, {
        'id': id,
      });
      if (ticket != _deckTicket) return;
      deckSchedule = DeckSchedule.fromJson(json);
    } catch (failure) {
      if (ticket != _deckTicket) return;
      deckScheduleError = _messageOf(failure);
    } finally {
      if (ticket == _deckTicket) {
        deckScheduleLoading = false;
        notifyListeners();
      }
    }
  }

  /// Grade one card (`session.deck.grade`).
  ///
  /// One write, atomic. The reply is the whole schedule, so the deck replaces
  /// its view rather than patching a card locally.
  Future<void> gradeDeckCard(String sessionId, int index, String grade) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_deckTicket;
    deckScheduleLoading = true;
    deckScheduleError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionDeckGrade, {
        'id': id,
        'index': index,
        'grade': grade,
      });
      if (ticket != _deckTicket) return;
      deckSchedule = DeckSchedule.fromJson(json);
    } catch (failure) {
      if (ticket != _deckTicket) return;
      deckScheduleError = _messageOf(failure);
    } finally {
      if (ticket == _deckTicket) {
        deckScheduleLoading = false;
        notifyListeners();
      }
    }
  }
}
