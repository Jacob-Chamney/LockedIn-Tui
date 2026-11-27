part of 'core_store.dart';

/// Session documents, the instruction pane and the source list.
extension CoreStoreDocuments on CoreStore {
  Future<void> generateDocument(
    String sessionId,
    String kind, {
    String? attempt,
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty || documentLoading) return;
    final ticket = ++_documentTicket;
    _documentKind = kind;
    _documentAttempt = attempt;
    documentLoading = true;
    documentError = null;
    documentText = null;
    documentName = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionDocument, {
        'id': id,
        'kind': kind,
        if (attempt != null && attempt.trim().isNotEmpty)
          'attempt': attempt.trim(),
      });
      if (ticket != _documentTicket) return;
      final result = SessionDocumentResult.fromJson(json);
      documentText = result.text;
      documentName = result.name;
    } catch (failure) {
      if (ticket != _documentTicket) return;
      documentError = _messageOf(failure);
    } finally {
      if (ticket == _documentTicket) {
        documentLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the document that last failed, with the same kind and
  /// attempt. A no-op when nothing has been requested.
  Future<void> retryDocument() async {
    final sessionId = activeSessionId;
    final kind = _documentKind;
    if (sessionId == null || kind == null) return;
    await generateDocument(sessionId, kind, attempt: _documentAttempt);
  }

  /// Collapse the document reader back to the session detail.
  ///
  /// The session, its steps and its chat stay exactly as they were; only the
  /// generated document on screen is released.
  void closeDocument() {
    if (!documentOpen && _documentKind == null) return;
    _clearDocument();
    notifyListeners();
  }

  /// Drop the reader and any in-flight answer for it.
  void _clearDocument() {
    _documentTicket += 1;
    documentText = null;
    documentName = null;
    documentLoading = false;
    documentError = null;
    _documentKind = null;
    _documentAttempt = null;
  }

  /// Read the open session's instructions (`session.instructions.get`).
  ///
  /// [sessionId] is a session folder name, never a path. This is a read: it
  /// writes nothing, and an empty `prompt.md` is a valid answer. A failure is
  /// recorded once in [instructionsError] and [sessionInstructions] is left
  /// alone, so the pane can show the last text with a retry instead of a blank
  /// form. The method never throws.
  Future<void> loadSessionInstructions(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_instructionsLoadTicket;
    // The write generation when the read began: a save, an import or a close
    // that lands first is newer than this read's answer.
    final generation = _instructionsTicket;
    bool stale() =>
        ticket != _instructionsLoadTicket || generation != _instructionsTicket;
    instructionsLoading = true;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionInstructionsGet, {
        'id': id,
      });
      if (stale()) return;
      sessionInstructions = SessionInstructions.fromJson(json);
    } catch (failure) {
      if (stale()) return;
      instructionsError = _messageOf(failure);
    } finally {
      if (ticket == _instructionsLoadTicket) {
        instructionsLoading = false;
        notifyListeners();
      }
    }
  }

  /// Replace the open session's `prompt.md` (`session.instructions.save`).
  ///
  /// [text] is written verbatim: an empty string is allowed and clears the
  /// prompt. On success the local prompt and [SessionDetail.prompt] follow the
  /// core's answer, so the detail and the settings pane cannot disagree. A
  /// failure is recorded once in [instructionsError], leaves the previous prompt
  /// in place, and returns false; the method never throws.
  Future<bool> saveSessionInstructions(String sessionId, String text) async {
    final id = sessionId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_instructionsTicket;
    instructionsLoading = false;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionInstructionsSave, {
        'id': id,
        'text': text,
      });
      if (ticket != _instructionsTicket) return false;
      final prompt = json['prompt'] is String ? json['prompt'] as String : text;
      _applyInstructions(id, prompt: prompt);
      notifyListeners();
      return true;
    } catch (failure) {
      if (ticket != _instructionsTicket) return false;
      instructionsError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Load a user-picked file as the instructions
  /// (`session.instructions.import`).
  ///
  /// [file] is the original the user chose, never a destination: the core copies
  /// it into this session's `sources/`, extracts its text into `prompt.md` and
  /// records the provenance in one transaction. [added] is false when the same
  /// bytes were already a source. A failure is recorded once in
  /// [instructionsError], leaves the previous prompt and provenance, and returns
  /// null; the method never throws.
  Future<InstructionsImportResult?> importSessionInstructions(
    String sessionId,
    String file,
  ) async {
    final id = sessionId.trim();
    final path = file.trim();
    if (id.isEmpty || path.isEmpty) return null;
    final ticket = ++_instructionsTicket;
    instructionsLoading = false;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(
        CoreMethod.sessionInstructionsImport,
        {'id': id, 'file': path},
      );
      if (ticket != _instructionsTicket) return null;
      final result = InstructionsImportResult.fromJson(json);
      _applyInstructions(
        id,
        prompt: result.prompt,
        source: result.instructions,
      );
      notifyListeners();
      return result;
    } catch (failure) {
      if (ticket != _instructionsTicket) return null;
      instructionsError = _messageOf(failure);
      notifyListeners();
      return null;
    }
  }

  /// Re-extract the copied instruction file into `prompt.md`
  /// (`session.instructions.reextract`).
  ///
  /// The copied original inside the session is the source of truth, so a later
  /// edit to the user's original cannot change the session; manual prompt edits
  /// are discarded. A failure — including a text-only session with no
  /// instruction file — is recorded once in [instructionsError] and returns
  /// false; the method never throws.
  Future<String?> reextractSessionInstructions(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return null;
    final ticket = ++_instructionsTicket;
    instructionsLoading = false;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(
        CoreMethod.sessionInstructionsReextract,
        {'id': id},
      );
      if (ticket != _instructionsTicket) return null;
      final prompt = json['prompt'] is String
          ? json['prompt'] as String
          : sessionInstructions?.prompt ?? '';
      final raw = json['instructions'];
      final source = raw is Map
          ? InstructionsSource.fromJson(Map<String, dynamic>.from(raw))
          : null;
      _applyInstructions(id, prompt: prompt, source: source);
      notifyListeners();
      return prompt;
    } catch (failure) {
      if (ticket != _instructionsTicket) return null;
      instructionsError = _messageOf(failure);
      notifyListeners();
      return null;
    }
  }

  /// Project a successful instruction write onto the open session only.
  ///
  /// A write for a session that is no longer open changes nothing here: the
  /// store keeps no instruction projection for a session it is not showing, and
  /// opening it later reads `prompt.md` again.
  void _applyInstructions(
    String sessionId, {
    required String prompt,
    InstructionsSource? source,
  }) {
    if (activeSessionId != sessionId) return;
    final current = activeSession;
    if (current != null) {
      activeSession = SessionDetail(
        id: current.id,
        // Memory is not part of this write; dropping it here hid the card until
        // the session was reopened.
        memory: current.memory,
        name: current.name,
        created: current.created,
        archived: current.archived,
        prompt: prompt,
        sources: current.sources,
        steps: current.steps,
      );
    }
    sessionInstructions = SessionInstructions(
      prompt: prompt,
      instructionsSource: source ?? sessionInstructions?.instructionsSource,
    );
    instructionsError = null;
  }

  /// Drop the instruction projection and any in-flight answer for it.
  void _clearInstructions() {
    _instructionsTicket += 1;
    sessionInstructions = null;
    instructionsLoading = false;
    instructionsError = null;
  }

  /// Copy user-picked files into one session and refresh its source rows.
  ///
  /// [paths] are files the user chose; the core copies them into the session,
  /// de-duplicates by hash and refuses anything from the skills side. The shell
  /// never reads, moves or writes a file.
  ///
  /// Failure rethrows the [RpcException] and leaves [activeSession] untouched,
  /// so the page can show the exact reason inline (the same pattern as
  /// [linkProvider]). A page-local copy failure is not a transport failure, so
  /// it does not raise [error]. Only the re-read after a successful copy is
  /// recorded in [error]: the files are already attached at that point.
  Future<SourceAddResult> addSources(
    String sessionId,
    List<String> paths,
  ) async {
    final json = await _connection.call(CoreMethod.sourceAdd, {
      'sessionId': sessionId,
      'paths': paths,
    });
    final result = SourceAddResult.fromJson(json);
    if (error != null) {
      error = null;
      notifyListeners();
    }
    try {
      await refreshSources(sessionId);
    } catch (failure) {
      // The copy succeeded; only the re-read failed. Keep the result usable and
      // let the shell surface that the list may be stale.
      error = _messageOf(failure);
      notifyListeners();
    }
    return result;
  }

  /// Re-read one session's `sources/` rows from `source.list`.
  ///
  /// When [sessionId] is the open session, [activeSession] is replaced with the
  /// same detail and the new rows. The chat snapshot is left alone: adding a
  /// source must not reload a transcript.
  Future<List<SessionSource>> refreshSources(String sessionId) async {
    final json = await _connection.call(CoreMethod.sourceList, {
      'sessionId': sessionId,
    });
    final raw = json['sources'];
    final rows = raw is List
        ? raw
              .whereType<Map>()
              .map(
                (row) => SessionSource.fromJson(Map<String, dynamic>.from(row)),
              )
              .toList()
        : const <SessionSource>[];
    final current = activeSession;
    if (current != null && activeSessionId == sessionId) {
      activeSession = SessionDetail(
        id: current.id,
        // Memory is not part of this write; dropping it here hid the card until
        // the session was reopened.
        memory: current.memory,
        name: current.name,
        created: current.created,
        archived: current.archived,
        prompt: current.prompt,
        sources: rows,
        steps: current.steps,
      );
      notifyListeners();
    }
    return rows;
  }

  /// Send one turn to a session's chat. Never touches the Chill transcript.
  ///
  /// Like [openSession], a failure is recorded in [error] rather than thrown:
}
