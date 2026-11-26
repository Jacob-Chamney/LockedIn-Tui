part of 'core_store.dart';

extension CoreStoreWorkChat on CoreStore {
  Future<bool> openWorkChat(String projectId, {String? chatId}) async {
    // The project open when the user asked. If it closed or changed before the
    // reply, the transcript is still cached under its own key, but it must not
    // become the active chat of a project it does not belong to.
    final owner = activeProjectId;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.workChatOpen, {
        'projectId': projectId,
        if (chatId != null && chatId.trim().isNotEmpty) 'chatId': chatId.trim(),
      });
    } catch (failure) {
      if (activeProjectId != owner) return false;
      error = _messageOf(failure);
      notifyListeners();
      return false;
    }

    final rawChatId = json['chatId'];
    final resolved = rawChatId is String && rawChatId.isNotEmpty
        ? rawChatId
        : chatId ?? '';
    if (resolved.isEmpty) {
      if (activeProjectId != owner) return false;
      error = 'the core did not name the project chat';
      notifyListeners();
      return false;
    }

    final raw = json['snapshot'];
    final rawSnapshot = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final workKey = CoreStore._workChatKey(projectId, resolved);
    if (_acceptChatSnapshot('work:$workKey', rawSnapshot['seq'])) {
      _workChats[workKey] = ChatSnapshot.fromJson(rawSnapshot);
    }
    _workChatErrors.remove(CoreStore._workChatKey(projectId, resolved));
    if (activeProjectId != owner) return false;
    activeWorkChatId = resolved;
    if (!projectChats.contains(resolved)) {
      projectChats = [...projectChats, resolved];
    }
    error = null;
    notifyListeners();
    return true;
  }

  /// Send one turn to a project chat. Never touches Chill or a session chat.
  ///
  /// The transcript grows only from the core's `work.chat.state` events. A
  /// request failure is kept for that one chat in [workChatErrorFor], so a
  /// project chat refusal never looks like a shell-wide transport failure.
  Future<bool> sendWorkChat(
    String projectId,
    String chatId,
    String text,
  ) async {
    final key = CoreStore._workChatKey(projectId, chatId);
    try {
      await _connection.call(CoreMethod.workChatSend, {
        'projectId': projectId,
        'chatId': chatId,
        'text': text,
      });
      if (_workChatErrors.remove(key) != null) notifyListeners();
      return true;
    } catch (failure) {
      _workChatErrors[key] = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Stop a project chat's in-flight turn. Nothing running is a no-op.
  Future<void> cancelWorkChat(String projectId, String chatId) async {
    try {
      await _connection.call(CoreMethod.workChatCancel, {
        'projectId': projectId,
        'chatId': chatId,
      });
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Collapse from the chat back to the project detail.
  ///
  /// The transcript and the chat id stay in the store, so reopening the chat
  /// paints the previous conversation and does not reset it.
  void closeWorkChat() {
    if (activeWorkChatId == null) return;
    activeWorkChatId = null;
    notifyListeners();
  }

  /// Read the open project's swarm runs (`work.swarm.runs`).
  ///
  /// A board is process state in the core, so this is a read of the runs this
  /// process knows — `[]` is the documented empty answer, not an error. A
  /// failure is recorded once in [swarmError] and the previous [swarmRuns] stays
  /// on screen. An answer for a project that is no longer open is dropped.
  Future<void> refreshSwarms(String projectId) async {
    final id = projectId.trim();
    if (id.isEmpty) return;
    final ticket = ++_swarmTicket;
    swarmLoading = true;
    swarmError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workSwarmRuns, {
        'projectId': id,
      });
      if (ticket != _swarmTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      final raw = json['runs'];
      final runs = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      SwarmBoardView.fromJson(Map<String, dynamic>.from(row)),
                )
                .where((run) => run.runId.isNotEmpty)
                .toList()
          : <SwarmBoardView>[];
      swarmRuns = List.unmodifiable(runs);
      final activeId = activeSwarmId;
      if (activeId != null) {
        var found = false;
        for (final run in runs) {
          if (run.runId == activeId) {
            activeSwarm = run;
            found = true;
            break;
          }
        }
        // A run the new list does not know (a core that forgot its process
        // state, or one removed elsewhere) must not keep the board rendering.
        if (!found) {
          activeSwarm = null;
          activeSwarmId = null;
        }
      }
    } catch (failure) {
      if (ticket != _swarmTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      swarmError = _messageOf(failure);
    } finally {
      if (ticket == _swarmTicket) {
        swarmLoading = false;
        notifyListeners();
      }
    }
  }

  /// Open one swarm board (`work.swarm.board`). Returns whether it is open.
  ///
  /// Failure is recorded once in [swarmError], never thrown, and the previous
  /// board survives, so a typo cannot blank the page. The method never applies,
  /// runs or cancels anything.
  Future<bool> openSwarm(String projectId, String runId) async {
    final project = projectId.trim();
    final run = runId.trim();
    if (project.isEmpty || run.isEmpty) return false;
    final ticket = ++_swarmBoardTicket;
    swarmLoading = true;
    swarmError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workSwarmBoard, {
        'projectId': project,
        'runId': run,
      });
      if (ticket != _swarmBoardTicket) return false;
      final open = activeProjectId;
      if (open != null && open != project) return false;
      final board = SwarmBoardView.fromJson(json['board']);
      if (board.runId.isEmpty) {
        swarmError = 'the core did not name the swarm run';
        return false;
      }
      activeSwarm = board;
      activeSwarmId = board.runId;
      _applySwarmBoard(board);
      return true;
    } catch (failure) {
      if (ticket != _swarmBoardTicket) return false;
      final open = activeProjectId;
      if (open != null && open != project) return false;
      swarmError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _swarmBoardTicket) {
        swarmLoading = false;
        notifyListeners();
      }
    }
  }

  /// Start one swarm run (`work.swarm.run`) and open its board.
  ///
  /// The reply names the run while its workers are still going, so the board is
  /// live here and `work.swarm.updated` carries every later change. A refusal
  /// rethrows the [RpcException] untouched, like [createProject]: the run dialog
  /// shows the core's own sentence and stays open, and no run was started.
  Future<SwarmRunResult> runSwarm(
    String projectId, {
    required String objective,
    required List<SwarmPlanEntry> plan,
    int parallel = 1,
  }) async {
    final json = await _connection.call(CoreMethod.workSwarmRun, {
      'projectId': projectId.trim(),
      'objective': objective.trim(),
      'plan': [for (final entry in plan) entry.toJson()],
      'parallel': parallel,
    });
    final result = SwarmRunResult.fromJson(json);
    if (result.runId.isNotEmpty) {
      activeSwarm = result.board;
      activeSwarmId = result.runId;
      _applySwarmBoard(result.board);
      swarmError = null;
      notifyListeners();
    }
    return result;
  }

  /// Cancel one live run (`work.swarm.cancel`).
  ///
  /// Cooperative: running and pending tasks become `cancelled` and the core
  /// writes the report once the workers settle. A finished run is a no-op that
  /// returns its board. A refusal rethrows for the page's inline message.
  Future<void> cancelSwarm(String projectId, String runId) async {
    final json = await _connection.call(CoreMethod.workSwarmCancel, {
      'projectId': projectId.trim(),
      'runId': runId.trim(),
    });
    final board = SwarmBoardView.fromJson(json['board']);
    if (board.runId.isEmpty) return;
    _applySwarmBoard(board);
    if (activeSwarmId == board.runId) activeSwarm = board;
    notifyListeners();
  }

  /// Drop one run record (`work.swarm.remove`).
  ///
  /// This forgets the **process** record only: the Markdown report stays on
  /// disk, and no file inside the project root is read, written or deleted.
  /// When the removed run was the one on screen, the newest remaining run is
  /// selected, or the page falls back to its empty state.
  Future<void> removeSwarm(String projectId, String runId) async {
    final id = runId.trim();
    await _connection.call(CoreMethod.workSwarmRemove, {
      'projectId': projectId.trim(),
      'runId': id,
    });
    swarmRuns = [
      for (final run in swarmRuns)
        if (run.runId != id) run,
    ];
    if (activeSwarmId == id) {
      activeSwarm = swarmRuns.isEmpty ? null : swarmRuns.last;
      activeSwarmId = activeSwarm?.runId;
    }
    notifyListeners();
  }

  /// Retry one failed or blocked task (`work.swarm.retry`).
  ///
  /// The core starts a **new** single-agent read-only run and returns its id;
  /// `retryOf` on the new board names the original run and task. The original
  /// run, its board and its report are untouched. The new run becomes the open
  /// board, and a refusal rethrows for the page's inline message.
  Future<SwarmRunResult> retrySwarmTask(
    String projectId,
    String runId,
    String taskId,
  ) async {
    final json = await _connection.call(CoreMethod.workSwarmRetry, {
      'projectId': projectId.trim(),
      'runId': runId.trim(),
      'taskId': taskId.trim(),
    });
    final result = SwarmRunResult.fromJson(json);
    if (result.runId.isNotEmpty) {
      activeSwarm = result.board;
      activeSwarmId = result.runId;
      _applySwarmBoard(result.board);
      swarmError = null;
      notifyListeners();
    }
    return result;
  }

  /// Mark one completed swarm task verified (`work.swarm.verify`).
  ///
  /// Verification is a person's decision, not a worker's claim: it only applies
  /// to a `done` task. The core rewrites the run's report and records the
  /// decision in the activity log. A refusal rethrows for the page's message.
  Future<void> verifySwarmTask(
    String projectId,
    String runId,
    String taskId, {
    bool verified = true,
  }) async {
    final json = await _connection.call(CoreMethod.workSwarmVerify, {
      'projectId': projectId.trim(),
      'runId': runId.trim(),
      'taskId': taskId.trim(),
      'verified': verified,
    });
    final raw = json['board'];
    if (raw is Map) {
      final board = SwarmBoardView.fromJson(Map<String, dynamic>.from(raw));
      _applySwarmBoard(board);
      if (activeSwarmId == board.runId) activeSwarm = board;
      swarmError = null;
      notifyListeners();
    }
  }

  /// Replace or append one board in [swarmRuns], keeping the active board live.
  void _applySwarmBoard(SwarmBoardView board) {
    final runs = [...swarmRuns];
    final index = runs.indexWhere((run) => run.runId == board.runId);
    if (index >= 0) {
      runs[index] = board;
    } else {
      runs.add(board);
    }
    swarmRuns = List.unmodifiable(runs);
    if (activeSwarmId == board.runId) activeSwarm = board;
  }

  void _clearSwarms() {
    _swarmTicket += 1;
    _swarmBoardTicket += 1;
    swarmRuns = const [];
    activeSwarm = null;
    activeSwarmId = null;
    swarmLoading = false;
    swarmError = null;
  }

  /// Read the Work activity log (`activity.list`).
  ///
  /// This is a **read-only** metadata view: the log records write and command
  /// decisions and swarm lifecycle events, and never a file body, diff, prompt
  /// or command output. [kind] filters to one kind (`write-decision`,
  /// `command-decision` or `swarm`; null means every kind) and [project] filters
  /// to one project id (null means every project). The core filters, so the
  /// shell cannot re-derive a different answer.
  ///
  /// A changed query clears the visible rows before the request, because rows
  /// for a different project or kind would misreport the filter. A failure of
  /// the *same* query keeps the previous rows and records its reason once in
  /// [activityError]; the next request clears that reason. An answer for a query
  /// the user has left is dropped by the ticket, so a late reply cannot replace
  /// what is on screen.
}
