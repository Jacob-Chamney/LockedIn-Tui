part of 'core_store.dart';

/// Session outputs, the prompt catalogue, the learning graph and research.
extension CoreStoreOutputs on CoreStore {
  /// Read one already-built output (`session.output.read`).
  ///
  /// [kind] is `study-guide` or `flashcards`; [part] is `answers` for the study
  /// guide's answers document, and null for the kind's primary document (the
  /// guide or the deck). This is the reader's read half: it never generates and
  /// writes nothing.
  ///
  /// A missing file is a **success** with `exists: false`, not an error, so the
  /// reader opens on its build state. A genuine failure is recorded once in
  /// [outputError] and the previous document stays on screen; the method never
  /// throws. An answer for a reader the user has already closed or replaced is
  /// dropped by the ticket guard.
  /// Mark one study-guide section reviewed (`session.output.mark`).
  ///
  /// The core rewrites one bracket and the progress line and returns the whole
  /// document, so the reader replaces what it renders and never re-reads the
  /// file. A refusal leaves the previous document and records one message.
  Future<bool> markGuideSection(String sessionId, int index) async {
    final id = sessionId.trim();
    if (id.isEmpty) return false;
    try {
      final json = await _connection.call(CoreMethod.sessionOutputMark, {
        'id': id,
        'index': index,
      });
      // The mark is written either way. If the reader has since moved to the
      // deck or to another session, its Markdown must not be replaced by the
      // guide's.
      if (activeSessionId != id || outputKind != 'study-guide') return true;
      final markdown = json['markdown'];
      if (markdown is! String) {
        outputError = 'the core did not return the study guide';
        notifyListeners();
        return false;
      }
      outputMarkdown = markdown;
      outputError = null;
      notifyListeners();
      return true;
    } catch (failure) {
      if (activeSessionId != id || outputKind != 'study-guide') return false;
      outputError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  Future<void> readOutput(String sessionId, String kind, {String? part}) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_outputTicket;
    _outputPart = part;
    _outputWasBuild = false;
    outputKind = kind;
    outputLoading = true;
    outputError = null;
    if (part == null) {
      // A fresh primary read starts from the empty state; the answers part is
      // not shown until it is read for this document.
      outputMarkdown = null;
      outputExists = false;
      outputAnswers = null;
      if (kind != 'flashcards') deckSchedule = null;
    }
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionOutputRead, {
        'id': id,
        'kind': kind,
        'part': ?part,
      });
      if (ticket != _outputTicket) return;
      final result = SessionOutputRead.fromJson(json);
      if (part == null) {
        outputMarkdown = result.markdown;
        outputExists = result.exists;
        if (kind == 'flashcards') unawaited(readDeckSchedule(id));
      } else {
        // `exists: false` on the answers part is still the reader's empty state;
        // an empty string lets the view say so without a second flag.
        outputAnswers = result.exists ? result.markdown : '';
      }
    } catch (failure) {
      if (ticket != _outputTicket) return;
      outputError = _messageOf(failure);
    } finally {
      if (ticket == _outputTicket) {
        outputLoading = false;
        notifyListeners();
      }
    }
  }

  /// Build one session output (`session.output.build`).
  ///
  /// This is one model call and is never retried automatically: a rebuild
  /// replaces the generated document, so the view asks for confirmation first.
  /// On success the returned Markdown is the document on screen and the answers
  /// part is reset to "not read yet"; the shell never re-reads or re-parses a
  /// file the core just wrote. A failure is recorded once in [outputError] and
  /// the previous document stays exactly as it was. The method never throws.
  /// Read the prompt catalogue (`prompts.list`).
  Future<void> refreshPrompts() async {
    try {
      final json = await _connection.call(CoreMethod.promptsList);
      final rows = json['items'];
      prompts = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      PromptNoteView.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      promptsError = null;
    } catch (failure) {
      promptsError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Set or clear one prompt note (`prompts.set`). Empty text clears it.
  Future<void> setPrompt(String id, String text) async {
    try {
      final json = await _connection.call(CoreMethod.promptsSet, {
        'id': id,
        'text': text,
      });
      final rows = json['items'];
      prompts = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      PromptNoteView.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      promptsError = null;
    } catch (failure) {
      promptsError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Derive the learning graph (`knowledge.graph`).
  ///
  /// Read-only and derived; a broken folder comes back as a diagnostic in the
  /// graph, not as a failed request.
  Future<void> readLearningGraph() async {
    if (learningGraphLoading) return;
    learningGraphLoading = true;
    learningGraphError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.knowledgeGraph);
      final graph = json['graph'];
      learningGraph = graph is Map
          ? LearningGraph.fromJson(Map<String, dynamic>.from(graph))
          : learningGraphEmpty;
    } catch (failure) {
      learningGraphError = _messageOf(failure);
    } finally {
      learningGraphLoading = false;
      notifyListeners();
    }
  }

  /// Read the open goal's saved briefs (`research.list`).
  Future<void> readResearch(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return;
    final ticket = ++_researchTicket;
    researchLoading = true;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.researchList, {
        'goalId': id,
      });
      if (ticket != _researchTicket) return;
      final rows = json['items'];
      research = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      ResearchItem.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      researchError = null;
    } catch (failure) {
      if (ticket != _researchTicket) return;
      researchError = _messageOf(failure);
    } finally {
      if (ticket == _researchTicket) {
        researchLoading = false;
        notifyListeners();
      }
    }
  }

  /// Start one background brief (`research.start`).
  ///
  /// The reply is only an acknowledgement; `research.updated` carries the
  /// result. A refusal is shown in the card and nothing is left running.
  Future<bool> startResearch(
    String goalId,
    String question,
    List<String> urls,
  ) async {
    final id = goalId.trim();
    final text = question.trim();
    if (id.isEmpty || text.isEmpty || urls.isEmpty) return false;
    researchRunning = true;
    researchError = null;
    notifyListeners();
    try {
      await _connection.call(CoreMethod.researchStart, {
        'goalId': id,
        'question': text,
        'urls': urls,
      });
      return true;
    } catch (failure) {
      researchRunning = false;
      researchError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Open one saved brief (`research.read`).
  Future<void> openResearch(String goalId, String researchId) async {
    final id = goalId.trim();
    if (id.isEmpty || researchId.isEmpty) return;
    try {
      final json = await _connection.call(CoreMethod.researchRead, {
        'goalId': id,
        'id': researchId,
      });
      researchMarkdown = json['markdown'] is String
          ? json['markdown'] as String
          : '';
      researchOpenId = researchId;
      researchError = null;
    } catch (failure) {
      researchError = _messageOf(failure);
    }
    notifyListeners();
  }

  void closeResearch() {
    researchMarkdown = null;
    researchOpenId = null;
    notifyListeners();
  }

  Future<void> buildOutput(String sessionId, String kind) async {
    final id = sessionId.trim();
    if (id.isEmpty || outputLoading) return;
    final ticket = ++_outputTicket;
    _outputPart = null;
    _outputWasBuild = true;
    outputKind = kind;
    outputLoading = true;
    outputError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionOutputBuild, {
        'id': id,
        'kind': kind,
      });
      if (ticket != _outputTicket) return;
      final result = SessionOutputResult.fromJson(json);
      outputKind = kind;
      outputMarkdown = result.markdown;
      outputAnswers = null;
      outputExists = true;
    } catch (failure) {
      if (ticket != _outputTicket) return;
      outputError = _messageOf(failure);
    } finally {
      if (ticket == _outputTicket) {
        outputLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the output request that last failed, with the same kind and
  /// part (or the same build). A no-op when no reader is open.
  Future<void> retryOutput() async {
    final sessionId = activeSessionId;
    final kind = outputKind;
    if (sessionId == null || kind == null) return;
    if (_outputWasBuild) {
      await buildOutput(sessionId, kind);
      return;
    }
    await readOutput(sessionId, kind, part: _outputPart);
  }

  /// Collapse the output reader back to the session detail.
  ///
  /// The session, its steps and its chat stay exactly as they were; only the
  /// generated output on screen is released.
  void closeOutput() {
    if (outputKind == null && !outputLoading && outputError == null) return;
    _clearOutput();
    notifyListeners();
  }

  /// Drop the output reader and any in-flight answer for it.
  void _clearOutput() {
    _outputTicket += 1;
    outputKind = null;
    outputMarkdown = null;
    outputAnswers = null;
    outputExists = false;
    outputLoading = false;
    outputError = null;
    _outputPart = null;
    _outputWasBuild = false;
  }
}
