part of 'core_store.dart';

/// The event switch: every core notification this shell listens for.
extension CoreStoreEvents on CoreStore {
  void _handleEvent(Map<String, dynamic> event) {
    final method = event['method'];
    final params = event['params'];
    if (method == 'research.updated' && params is Map) {
      final goalId = params['goalId'];
      final researchId = params['id'];
      final status = params['status'];
      if (goalId is String && goalId == activeSkillId) {
        if (status == 'done' || status == 'failed' || status == 'cancelled') {
          researchRunning = false;
        }
        if (status == 'failed') {
          researchError = params['message'] is String
              ? params['message'] as String
              : 'the research brief failed';
        }
        if (status == 'done') {
          researchError = null;
          unawaited(readResearch(goalId));
          if (researchId is String && researchId == researchOpenId) {
            unawaited(openResearch(goalId, researchId));
          }
        }
        notifyListeners();
      }
      return;
    }
    if (method == 'session.chat.state' && params is Map) {
      final snapshot = Map<String, dynamic>.from(params);
      final sessionId = snapshot.remove('sessionId');
      if (sessionId is String &&
          sessionId.isNotEmpty &&
          _acceptChatEvent('session:$sessionId', snapshot['seq'])) {
        final state = ChatSnapshot.fromJson(snapshot);
        _sessionChats[sessionId] = state;
        // Only a new turn clears the last failure. The core flushes its final
        // coalesced snapshot up to 33 ms *after* an error event, and clearing
        // on every snapshot erased the message almost as soon as it appeared.
        if (state.streaming) _sessionChatErrors.remove(sessionId);
        notifyListeners();
      }
      return;
    }
    if (method == 'session.chat.error' && params is Map) {
      final sessionId = params['sessionId'];
      final message = params['message'];
      if (sessionId is String && sessionId.isNotEmpty) {
        _sessionChatErrors[sessionId] = message is String && message.isNotEmpty
            ? message
            : 'session chat failed';
        notifyListeners();
      }
      return;
    }
    if (method == 'session.chat.done' && params is Map) {
      // The final `session.chat.state` carries the transcript; `done` only makes
      // a stale error disappear for the next turn.
      final sessionId = params['sessionId'];
      if (sessionId is String && _sessionChatErrors.remove(sessionId) != null) {
        notifyListeners();
      }
      return;
    }
    if (method == 'mcp.permission' && params is Map) {
      // One prompt on screen at a time, oldest first; later ones wait their
      // turn. A request without an id can never be answered, so it is dropped
      // rather than shown with a dead button, and a repeat of an id already
      // waiting is the same prompt.
      final request = PluginPermissionRequest.fromJson(
        Map<String, dynamic>.from(params),
      );
      if (request.requestId.isEmpty) return;
      if (_permissionQueue.any(
        (entry) => entry.$1.requestId == request.requestId,
      )) {
        return;
      }
      final first = _permissionQueue.isEmpty;
      _permissionQueue.add((request, _now()));
      _permissionTimers[request.requestId]?.cancel();
      _permissionTimers[request.requestId] = Timer(
        permissionTimeout,
        () => _expirePermission(request.requestId),
      );
      // A new prompt at the head clears the last answer's failure; one that
      // only joins the queue must not wipe the message under the open prompt.
      if (first) pluginPermissionError = null;
      notifyListeners();
      return;
    }
    if (method == 'work.write.proposal' && params is Map) {
      final proposal = WorkWriteProposal.fromJson(
        Map<String, dynamic>.from(params),
      );
      if (proposal.id.isEmpty) return;
      // Scoped to the open project, which means there must BE one: the list is
      // documented as the open project's, and `closeProject` returns early when
      // nothing is open, so a proposal accepted into an empty store could never
      // be cleared.
      final open = activeProjectId;
      if (open == null || proposal.projectId != open) return;
      pendingWrites = [
        for (final write in pendingWrites)
          if (write.id != proposal.id) write,
        proposal,
      ];
      notifyListeners();
      return;
    }
    if (method == 'work.command.proposal' && params is Map) {
      final proposal = WorkCommandProposal.fromJson(
        Map<String, dynamic>.from(params),
      );
      if (proposal.id.isEmpty) return;
      // Same rule as a write proposal: the list is the open project's.
      final open = activeProjectId;
      if (open == null || proposal.projectId != open) return;
      pendingCommands = [
        for (final command in pendingCommands)
          if (command.id != proposal.id) command,
        proposal,
      ];
      notifyListeners();
      return;
    }
    if (method == 'work.approval.resolved' && params is Map) {
      final id = params['id'];
      if (id is! String || id.isEmpty) return;
      final kind = params['kind'];
      if (kind == 'write' || kind == null) _dropWrite(id);
      if (kind == 'command' || kind == null) _dropCommand(id);
      notifyListeners();
      return;
    }
    if (method == 'work.swarm.updated' && params is Map) {
      // A run change is a read-only board; it can only ever replace the rows
      // for that run, never the project, a chat or a pending proposal.
      final projectId = params['projectId'];
      if (projectId is! String || projectId.isEmpty) return;
      final open = activeProjectId;
      if (open != null && open != projectId) return;
      final board = SwarmBoardView.fromJson(params['board']);
      if (board.runId.isEmpty) return;
      _applySwarmBoard(board);
      notifyListeners();
      return;
    }
    if (method == 'work.chat.state' && params is Map) {
      final snapshot = Map<String, dynamic>.from(params);
      final projectId = snapshot.remove('projectId');
      final chatId = snapshot.remove('chatId');
      if (projectId is String &&
          projectId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty &&
          _acceptChatEvent(
            'work:${CoreStore._workChatKey(projectId, chatId)}',
            snapshot['seq'],
          )) {
        final key = CoreStore._workChatKey(projectId, chatId);
        final state = ChatSnapshot.fromJson(snapshot);
        _workChats[key] = state;
        // See `session.chat.state`: only a new turn clears the last failure.
        if (state.streaming) _workChatErrors.remove(key);
        notifyListeners();
      }
      return;
    }
    if (method == 'work.chat.error' && params is Map) {
      final projectId = params['projectId'];
      final chatId = params['chatId'];
      final message = params['message'];
      if (projectId is String &&
          projectId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty) {
        _workChatErrors[CoreStore._workChatKey(
          projectId,
          chatId,
        )] = message is String && message.isNotEmpty
            ? message
            : 'project chat failed';
        notifyListeners();
      }
      return;
    }
    if (method == 'work.chat.done' && params is Map) {
      // The final `work.chat.state` carries the transcript; `done` only makes a
      // stale error disappear for the next turn.
      final projectId = params['projectId'];
      final chatId = params['chatId'];
      if (projectId is String && chatId is String) {
        if (_workChatErrors.remove(CoreStore._workChatKey(projectId, chatId)) !=
            null) {
          notifyListeners();
        }
      }
      return;
    }
    if (method == 'skill.chat.state' && params is Map) {
      final snapshot = Map<String, dynamic>.from(params);
      final goalId = snapshot.remove('goalId');
      final chatId = snapshot.remove('chatId');
      if (goalId is String &&
          goalId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty &&
          _acceptChatEvent(
            'skill:${CoreStore._skillChatKey(goalId, chatId)}',
            snapshot['seq'],
          )) {
        final key = CoreStore._skillChatKey(goalId, chatId);
        final state = ChatSnapshot.fromJson(snapshot);
        _skillChats[key] = state;
        // See `session.chat.state`: only a new turn clears the last failure.
        if (state.streaming) _skillChatErrors.remove(key);
        notifyListeners();
      }
      return;
    }
    if (method == 'skill.chat.error' && params is Map) {
      final goalId = params['goalId'];
      final chatId = params['chatId'];
      final message = params['message'];
      if (goalId is String &&
          goalId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty) {
        _skillChatErrors[CoreStore._skillChatKey(
          goalId,
          chatId,
        )] = message is String && message.isNotEmpty
            ? message
            : 'goal chat failed';
        notifyListeners();
      }
      return;
    }
    if (method == 'skill.chat.done' && params is Map) {
      // The final `skill.chat.state` carries the transcript; `done` only makes a
      // stale error disappear for the next turn.
      final goalId = params['goalId'];
      final chatId = params['chatId'];
      if (goalId is String && chatId is String) {
        if (_skillChatErrors.remove(CoreStore._skillChatKey(goalId, chatId)) !=
            null) {
          notifyListeners();
        }
      }
      return;
    }
    // Chill events only ever replace the Chill transcript; a session transcript
    // lives in its own map, so `chat.state` cannot clobber it.
    if (method == 'chat.state' && params is Map) {
      if (!_acceptChatEvent(CoreStore._chillChatKey, params['seq'])) return;
      chat = ChatSnapshot.fromJson(Map<String, dynamic>.from(params));
      notifyListeners();
      return;
    }
    if (method == 'chat.error' &&
        params is Map &&
        params['message'] is String) {
      error = params['message'] as String;
      notifyListeners();
      return;
    }
    if (method == 'core.exit') {
      status = CoreStatus.failed;
      error = 'core stopped';
      // The waiting call belongs to the dead process and fails closed; there is
      // nothing left to answer, so the prompt is dropped rather than left with
      // buttons that cannot work.
      _permissionQueue.clear();
      for (final timer in _permissionTimers.values) {
        timer.cancel();
      }
      _permissionTimers.clear();
      _expiredPermissions.clear();
      pluginPermissionError = null;
      notifyListeners();
    }
  }
}
