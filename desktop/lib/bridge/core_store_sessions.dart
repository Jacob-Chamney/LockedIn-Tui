part of 'core_store.dart';

extension CoreStoreSessions on CoreStore {
  /// Open a lock-in session and load its transcript.
  ///
  /// Failure is reported once through [error], never thrown: the caller (a
  /// session list, the shell) shows the banner and keeps the user where they
  /// are. Nothing is mutated until `session.open` succeeds, so a missing or
  /// broken session leaves the previous [activeSession] in place. A failed
  /// `session.chat.snapshot` still opens the session: the detail is usable and
  /// the cached transcript (if any) stays on screen.
  Future<void> openSession(String id) async {
    final ticket = ++_sessionOpenTicket;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.sessionOpen, {'id': id});
    } catch (failure) {
      if (ticket != _sessionOpenTicket) return;
      error = _messageOf(failure);
      notifyListeners();
      return;
    }
    // The user closed the detail or opened another session while this one was
    // being read: its reply must not reopen or replace what they chose.
    if (ticket != _sessionOpenTicket) return;

    final raw = json['session'];
    final detail = SessionDetail.fromJson(
      raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{},
    );
    final sessionId = detail.id.isEmpty ? id : detail.id;
    activeSession = detail;
    activeSessionId = sessionId;
    error = null;
    // A page-local generation failure belongs to the session it happened in.
    stepsError = null;
    _clearDocument();
    _clearInstructions();
    _clearOutput();
    _clearCoverage();
    _clearMistakes();
    _sessionChatErrors.remove(sessionId);

    try {
      final snapshot = await _connection.call(CoreMethod.sessionChatSnapshot, {
        'id': sessionId,
      });
      // The transcript is keyed by session, so it is kept whichever session
      // is open now.
      if (_acceptChatSnapshot('session:$sessionId', snapshot['seq'])) {
        _sessionChats[sessionId] = ChatSnapshot.fromJson(snapshot);
      }
    } catch (failure) {
      if (ticket == _sessionOpenTicket) error = _messageOf(failure);
    }
    if (ticket != _sessionOpenTicket) return;
    // The instruction text is the settings pane's read: a failure is page-local
    // and never stops the detail from opening.
    await loadSessionInstructions(sessionId);
    // Source coverage is a read of the session that just opened. A failure is
    // page-local in [coverageError]: the detail still renders and the card
    // offers a retry.
    await readCoverage(sessionId);
    // The mistake ledger is page-local too: a failure leaves the detail usable
    // and the card shows one message with a retry.
    await loadMistakes(sessionId);
    notifyListeners();
  }

  /// Read one session's source coverage (`session.coverage`).
  ///
  /// [sessionId] is a session folder name, never a path. The report is derived
  /// from the session's own copied sources and its steps, chat, outputs and
  /// memory, so this is a read: it writes nothing, calls no model and contacts no
  /// network. An empty source list is a valid empty report, not an error.
  ///
  /// A failure is recorded once in [coverageError] and the previous [coverage]
  /// stays, so the card shows the core's own message with a retry instead of an
  /// invented empty report. The method never throws. An answer for a session the
  /// user has already left is dropped by the ticket and id guards.
  Future<void> readCoverage(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_coverageTicket;
    coverageLoading = true;
    coverageError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionCoverage, {
        'id': id,
      });
      if (ticket != _coverageTicket) return;
      if (activeSessionId != null && activeSessionId != id) return;
      coverage = CoverageReport.fromJson(json['coverage']);
    } catch (failure) {
      if (ticket != _coverageTicket) return;
      if (activeSessionId != null && activeSessionId != id) return;
      coverageError = _messageOf(failure);
    } finally {
      if (ticket == _coverageTicket) {
        coverageLoading = false;
        notifyListeners();
      }
    }
  }

  /// Drop the coverage projection and any in-flight answer for it.
  void _clearCoverage() {
    _coverageTicket += 1;
    coverage = null;
    coverageLoading = false;
    coverageError = null;
  }

  /// Drop the mistake ledger and any in-flight answer for it.
  void _clearMistakes() {
    _mistakesTicket += 1;
    mistakes = const [];
    mistakesLoading = false;
    mistakesError = null;
  }

  static List<SessionMistake> _mistakeRows(Object? entries) {
    if (entries is! List) return const [];
    return [
      for (final entry in entries)
        if (entry is Map)
          SessionMistake.fromJson(Map<String, dynamic>.from(entry)),
    ];
  }

  /// Read the open session's misconception ledger (`session.mistake.list`).
  ///
  /// Read-only: it writes nothing, calls no model and contacts no network. A
  /// failure is recorded once in [mistakesError] and the previous rows stay, so
  /// the card shows the core's own message with a retry rather than an invented
  /// empty ledger. An answer for a session the user has already left is dropped.
  Future<void> loadMistakes(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_mistakesTicket;
    mistakesLoading = true;
    mistakesError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionMistakeList, {
        'id': id,
      });
      if (ticket != _mistakesTicket) return;
      if (activeSessionId != null && activeSessionId != id) return;
      mistakes = _mistakeRows(json['entries']);
    } catch (failure) {
      if (ticket != _mistakesTicket) return;
      mistakesError = _messageOf(failure);
    } finally {
      if (ticket == _mistakesTicket) {
        mistakesLoading = false;
        notifyListeners();
      }
    }
  }

  /// Record one mistake (`session.mistake.record`).
  ///
  /// [text] is normalised to one line and bounded by the core; an over-long or
  /// blank entry is a refusal and the inline message is the caller's to show.
  /// Nothing is written when the call fails, and the reply replaces the rows.
  Future<void> recordMistake(
    String sessionId,
    String text, {
    String? step,
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final json = await _connection.call(CoreMethod.sessionMistakeRecord, {
      'id': id,
      'text': text,
      if (step != null && step.trim().isNotEmpty) 'step': step.trim(),
    });
    if (activeSessionId != null && activeSessionId != id) return;
    mistakes = _mistakeRows(json['entries']);
    mistakesError = null;
    notifyListeners();
  }

  /// Write (or replace) a promoted mistake's corrected understanding
  /// (`session.mistake.correct`).
  ///
  /// Promotion is not one-way: a note promoted before the learner knew the
  /// answer can be completed later. The reply is the updated note, and the
  /// ledger is re-read so the row shows `corrected`.
  Future<MistakeNote> correctMistake(
    String sessionId,
    int index,
    String correction,
  ) async {
    final id = sessionId.trim();
    final json = await _connection.call(CoreMethod.sessionMistakeCorrect, {
      'id': id,
      'index': index,
      'correction': correction,
    });
    final note = MistakeNote.fromJson(json['note']);
    await loadMistakes(id);
    return note;
  }

  /// Promote one ledger entry into a labelled school note
  /// (`session.mistake.promote`).
  ///
  /// [correction] is the learner's own right answer; when it is omitted the
  /// note stays `status: open` and says the correction is not written yet.
  /// Promoting an entry twice returns the existing note with [MistakePromotion.already]
  /// set, so a double click cannot create a duplicate. The ledger is re-read
  /// afterwards, because the promotion marks the entry.
  Future<MistakePromotion> promoteMistake(
    String sessionId,
    int index, {
    String? correction,
    String? title,
  }) async {
    final id = sessionId.trim();
    final json = await _connection.call(CoreMethod.sessionMistakePromote, {
      'id': id,
      'index': index,
      if (correction != null && correction.trim().isNotEmpty)
        'correction': correction.trim(),
      if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
    });
    final promotion = MistakePromotion.fromJson(json);
    await loadMistakes(id);
    return promotion;
  }

  /// Create one lock-in session through `session.create`.
  ///
  /// [name], [prompt], [files] and [instructionsFile] are the wizard's values:
  /// the paths are files the **user picked**, never destinations, and the core
  /// copies them and extracts the instructions file itself. Nothing is written
  /// when the call fails.
  ///
  /// On success the new session is opened (`session.open`, so the shell lands on
  /// its detail) and the result is returned. On failure the [RpcException] is
  /// rethrown untouched, exactly like [linkProvider]: the wizard shows the
  /// core's own message and stays on its Review step, so a create refusal is
  /// never mistaken for a transport failure and never reaches [error].
  Future<SessionCreateResult> createSession({
    required String name,
    String prompt = '',
    List<String> files = const [],
    String? instructionsFile,
    bool steps = true,
    String requestId = '',
  }) async {
    final json = await _connection.call(CoreMethod.sessionCreate, {
      'name': name,
      if (requestId.trim().isNotEmpty) 'requestId': requestId.trim(),
      if (prompt.trim().isNotEmpty) 'prompt': prompt,
      if (files.isNotEmpty) 'files': files,
      if (instructionsFile != null && instructionsFile.trim().isNotEmpty)
        'instructionsFile': instructionsFile,
      'steps': steps,
    });
    final result = SessionCreateResult.fromJson(json);
    await openSession(result.id);
    return result;
  }

  /// Archive one session (`session.archive`), moving its live folder aside.
  ///
  /// The destination is configuration, never a parameter: Settings decides
  /// whether a folder or a GitHub repo receives the session, and the core
  /// refuses with one actionable sentence when no backend is usable. A refusal
  /// rethrows the [RpcException] untouched, so the manager shows the core's own
  /// message inline and no row disappears.
  ///
  /// On success the session is no longer live (`session.list` reports the open
  /// side only), so the row is dropped from [sessions], an open session with the
  /// same id is closed with its cached transcript, and the list is re-read. The
  /// reply is the backend that took the folder (`folder` or `github`), or null
  /// when the core did not name one.
  Future<String?> archiveSession(String id) async {
    final json = await _connection.call(CoreMethod.sessionArchive, {'id': id});
    final backend = json['backend'];
    await _afterSessionGone(id);
    return backend is String && backend.isNotEmpty ? backend : null;
  }

  /// Delete one session's live folder (`session.remove`).
  ///
  /// The shell has already asked; this executes the confirmed delete. Only the
  /// live folder goes: no note, no Work project and no archived copy of the same
  /// id is touched, so an archive still restores later. A refusal rethrows the
  /// [RpcException] for the page's inline message and leaves the row in place.
  Future<void> removeSession(String id) async {
    await _connection.call(CoreMethod.sessionRemove, {'id': id});
    await _afterSessionGone(id);
  }

  /// Export one session as a zip (`session.export`).
  ///
  /// There is no destination parameter: the core writes
  /// `<workspace>/exports/session-<id>.zip` itself and returns that path, so the
  /// shell cannot point an export at a folder the core does not own. The live
  /// session is untouched, so a second export is safe. A refusal rethrows the
  /// [RpcException] for the page's inline message; the reply is the zip path, or
  /// null when the core did not name one.
  Future<String?> exportSession(String id) async {
    final json = await _connection.call(CoreMethod.sessionExport, {'id': id});
    final path = json['path'];
    await _refreshSessionsQuietly();
    return path is String && path.isNotEmpty ? path : null;
  }

  /// Apply one confirmed archive/delete to the shell's projection.
  ///
  /// The core confirmed the folder moved or was deleted, so the row is no longer
  /// live. Dropping it before the re-read keeps the list honest even if the read
  /// fails, and closing the matching open session releases its cached transcript
  /// instead of leaving a detail for a folder that is gone.
  Future<void> _afterSessionGone(String id) async {
    sessions = sessions.where((row) => row.id != id).toList();
    if (activeSessionId == id) {
      activeSession = null;
      activeSessionId = null;
      stepsError = null;
      _clearDocument();
      _clearInstructions();
      _clearOutput();
      _clearCoverage();
      _sessionChats.remove(id);
      _sessionChatErrors.remove(id);
    }
    notifyListeners();
    await _refreshSessionsQuietly();
  }

  /// Re-read the session list after a confirmed action without dressing a failed
  /// read up as a failed action: the core already did the work, so the read
  /// failure goes to [error] and the next refresh (surface entry, `r`) corrects
  /// the rows.
  Future<void> _refreshSessionsQuietly() async {
    try {
      await refreshSessions();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Toggle one assignment step: the steps reader's only write.
  ///
  /// [index] is the task-item ordinal in `assignment-steps.md`; the core
  /// rewrites exactly one bracket character and the progress line and returns
  /// the whole new document. When this is the open session its [activeSession]
  /// steps are replaced with that document and its counts, and listeners are
  /// notified so the reader repaints from the core's answer — never from a
  /// local guess and never from a re-read.
  ///
  /// Failure rethrows the [RpcException] untouched, like [addSources]: a
  /// rejected toggle is a page-local action, so the reader shows one inline
  /// message and keeps the previous markdown instead of raising [error] for the
  /// whole shell.
  Future<StepToggleResult> toggleStep(String sessionId, int index) async {
    final json = await _connection.call(CoreMethod.sessionToggleStep, {
      'id': sessionId,
      'index': index,
    });
    final result = StepToggleResult.fromJson(json);
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
        sources: current.sources,
        steps: SessionSteps(
          done: result.done,
          total: result.total,
          exists: result.markdown.trim().isNotEmpty,
          markdown: result.markdown,
        ),
      );
      notifyListeners();
    }
    return result;
  }

  /// Build or rebuild one session's `assignment-steps.md`.
  ///
  /// `session.generateSteps` is a provider run: the core reads the session's own
  /// sources, asks for a plan, merges checked work by exact step text and writes
  /// the file atomically. The reply is the new document plus `kept`/`lost`; it
  /// carries no counts, so the panel's badge is counted from those bytes (the
  /// same document the core wrote) with the core's markdown still authoritative.
  ///
  /// Only the open session is updated. When [sessionId] is not the
  /// [activeSessionId] the answer is ignored: the store keeps no cached step
  /// rows for a session it is not showing, and opening it later re-reads the
  /// file through `session.open`.
  ///
  /// A failure is recorded once in [stepsError] and the previous steps stay
  /// exactly as they were. The method never throws, so the detail page can show
  /// the message inline with a retry (the same contract as [linkProvider]).
  Future<void> generateSteps(String sessionId) async {
    // One build at a time: it is a paid provider run, and a second request for
    // the same session must never be sent twice. The slot used to be global, so
    // pressing `R` on session B while A was building returned before setting a
    // pending state or an error — the key looked dead. A different session is
    // now told why it cannot start instead of being ignored.
    if (_generatingStepsFor != null) {
      if (_generatingStepsFor == sessionId) return;
      if (activeSessionId == sessionId) {
        stepsError =
            'another session is building its steps; try again when it '
            'finishes';
        notifyListeners();
      }
      return;
    }
    _generatingStepsFor = sessionId;
    stepsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionGenerateSteps, {
        'id': sessionId,
      });
      final result = StepGenerateResult.fromJson(json);
      final current = activeSession;
      if (current != null && activeSessionId == sessionId) {
        final total = CoreStore._countTaskItems(result.markdown);
        final done = CoreStore._countCheckedItems(result.markdown);
        activeSession = SessionDetail(
          id: current.id,
          // Memory is not part of this write; dropping it here hid the card until
          // the session was reopened.
          memory: current.memory,
          name: current.name,
          created: current.created,
          archived: current.archived,
          prompt: current.prompt,
          sources: current.sources,
          steps: SessionSteps(
            done: done,
            total: total,
            exists: result.markdown.trim().isNotEmpty,
            markdown: result.markdown,
          ),
        );
      }
    } catch (failure) {
      // The failure is shown on the session it belongs to. If the user has
      // moved on, the reader would print it under the wrong session.
      if (activeSessionId == sessionId) stepsError = _messageOf(failure);
    } finally {
      _generatingStepsFor = null;
      notifyListeners();
    }
  }

  /// Generate one session study document (`session.document`).
  ///
  /// [kind] is exactly `contract` (the assignment's done-when checklist),
  /// `contradictions` (a report of conflicting sources) or `check` (a review of
  /// one learner attempt). [attempt] is only meaningful for `check`; a blank
  /// value is treated as absent.
  ///
  /// This is a provider run, so the store shows a pending state and a second
  /// request while one is in flight is ignored rather than queued. A success
  /// stores the document's own Markdown and file name; a failure is recorded
  /// once in [documentError] and never thrown, so the detail page can show the
  /// core's own sentence with a retry. Neither path adds a source row or a chat
  /// turn: the core writes the file and the shell only renders it.
}
