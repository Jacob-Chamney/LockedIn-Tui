part of 'core_store.dart';

extension CoreStoreWork on CoreStore {
  /// Re-read the registered Work projects.
  ///
  /// Failure is recorded once in [error] and the previous [projects] list stays
  /// on screen: a broken read never invents an empty list, so the page can say
  /// "the list could not be refreshed" instead of "no projects yet".
  Future<void> refreshProjects() async {
    try {
      final json = await _connection.call(CoreMethod.workList);
      projects = CoreStore._projectRows(json);
      projectsLoaded = true;
      error = null;
      notifyListeners();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the agent templates a picker can offer (`work.templates.list`).
  ///
  /// [projectId] is the open project, so the built-ins and that project's own
  /// templates are read together; a null or blank id reads the built-ins only.
  /// The call is a read: the core opens `work/templates/` for reading and writes
  /// nothing, so this is safe to repeat.
  ///
  /// Returns the rows it read, and keeps the previous list when the read fails:
  /// a broken read is recorded once in [workTemplatesError], never turned into
  /// "no templates". A failure is not thrown, because the picker shows the
  /// sentence beside the rows it already has.
  Future<List<AgentTemplateRow>> refreshWorkTemplates(String? projectId) async {
    final id = projectId?.trim() ?? '';
    // The flags are set without an early notify: a caller can start this from
    // build-adjacent code (the agent dialog's `didChangeDependencies`), where
    // notifying would mark the scope dirty mid-build. The finish below is the
    // one notification, and it carries both the rows and the cleared flag.
    final ticket = ++_workTemplatesTicket;
    workTemplatesLoading = true;
    workTemplatesError = null;
    try {
      final json = await _connection.call(CoreMethod.workTemplatesList, {
        if (id.isNotEmpty) 'projectId': id,
      });
      // The reply names templates for THIS project. Without the ticket a slow
      // answer for project A could populate project B's picker.
      if (ticket != _workTemplatesTicket) return workTemplates;
      final raw = json['templates'];
      workTemplates = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      AgentTemplateRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      return workTemplates;
    } catch (failure) {
      if (ticket != _workTemplatesTicket) return workTemplates;
      workTemplatesError = _messageOf(failure);
      return workTemplates;
    } finally {
      if (ticket == _workTemplatesTicket) {
        workTemplatesLoading = false;
        notifyListeners();
      }
    }
  }

  /// Open one Work project (`work.open`).
  ///
  /// Failure is reported once through [error], never thrown, and the previous
  /// [activeProject] survives: a project whose metadata cannot be read leaves
  /// the user on the project they already had. Nothing is mutated until the
  /// call succeeds.
  Future<void> openProject(String id) async {
    final ticket = ++_projectOpenTicket;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.workOpen, {'id': id});
    } catch (failure) {
      if (ticket != _projectOpenTicket) return;
      error = _messageOf(failure);
      notifyListeners();
      return;
    }
    // Closed, or another project chosen, while this one was being read.
    if (ticket != _projectOpenTicket) return;

    final raw = json['project'];
    final detail = WorkProjectDetail.fromJson(
      raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{},
    );
    final projectId = detail.id.isEmpty ? id : detail.id;
    if (activeProjectId != projectId) {
      // A different project: nothing read for the previous one may show under
      // this one's name while its own reads are in flight (or if they fail).
      _projectEpoch += 1;
      activeWorkChatId = null;
      projectChats = const [];
      workChanges = null;
      workChangesLoading = false;
      workChangesError = null;
      _clearApprovals();
      _clearSwarms();
      _clearActivity();
    }
    activeProject = detail;
    activeProjectId = projectId;
    error = null;
    notifyListeners();
    // Each read below is for the project captured above, never for whatever is
    // open when it runs: the user may close this project between two awaits.
    bool current() => ticket == _projectOpenTicket;
    // The chat ids belong to the project that just opened; a failure is kept
    // page-local in [error] and the detail still renders.
    await refreshProjectChats(projectId);
    if (!current()) return;
    // Pending approvals are process memory in the core, so they are read for
    // the project that just opened. A failure is page-local and the card still
    // renders the last rows the shell received.
    await refreshApprovals(projectId);
    if (!current()) return;
    // Swarm runs are process memory too; the detail's SWARM card shows the
    // count and the newest run without waiting for the board to open.
    await refreshSwarms(projectId);
    if (!current()) return;
    // The activity log is metadata about decisions already taken, so the
    // detail's ACTIVITY card can show its count before the log is opened. It is
    // a read: nothing is written and no decision is applied.
    await refreshActivity(project: projectId);
  }

  /// Return from a project detail to the Work list.
  ///
  /// The project's chat list and active chat go with it: they are properties of
  /// the open project, and reopening it reads them again.
  void closeProject() {
    // An open still in flight is abandoned even when nothing is open yet.
    _projectOpenTicket += 1;
    if (activeProject == null && activeProjectId == null) return;
    _projectEpoch += 1;
    activeProject = null;
    activeProjectId = null;
    activeWorkChatId = null;
    projectChats = const [];
    workChanges = null;
    workChangesLoading = false;
    workChangesError = null;
    _clearApprovals();
    _clearSwarms();
    _clearActivity();
    notifyListeners();
  }

  /// Read the open project's chat ids (`work.chat.list`).
  ///
  /// Failure is recorded once in [error] and the previous [projectChats] list
  /// stays: a broken read never invents "this project has no chats".
  Future<void> refreshProjectChats(String projectId) async {
    final epoch = _projectEpoch;
    try {
      final json = await _connection.call(CoreMethod.workChatList, {
        'projectId': projectId,
      });
      // The list belongs to one project: a reply that lands after the project
      // closed or changed would give the next one a chat count it does not have.
      if (epoch != _projectEpoch) return;
      final raw = json['chats'];
      projectChats = raw is List ? raw.whereType<String>().toList() : const [];
      notifyListeners();
    } catch (failure) {
      if (epoch != _projectEpoch) return;
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the open project's read-only Changes summary (`work.changes`).
  ///
  /// The core runs git itself with a fixed argv and `GIT_OPTIONAL_LOCKS=0`, so
  /// this is a read: nothing is staged, committed, checked out or written
  /// inside the project root. An answer with `available: false` is a success
  /// (the folder is gone, is not a repository, or git is not installed) and is
  /// projected as such, so the page prints the core's own sentence instead of
  /// an error.
  ///
  /// A failure is recorded once in [workChangesError] and the previous
  /// [workChanges] stays: a broken read never invents an empty working tree.
  /// The method never throws. An answer for a project that is no longer open is
  /// dropped, so a refresh finishing after [closeProject] cannot resurrect
  /// rows for a closed project.
  Future<void> refreshWorkChanges(String projectId) async {
    final id = projectId.trim();
    if (id.isEmpty) return;
    final epoch = _projectEpoch;
    workChangesLoading = true;
    workChangesError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workChanges, {
        'projectId': id,
      });
      // Dropped when the project closed or changed while git ran: the epoch
      // catches a close (nothing open any more), the id a direct switch.
      if (epoch != _projectEpoch) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      workChanges = ChangeSummary.fromJson(json['changes']);
    } catch (failure) {
      if (epoch != _projectEpoch) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      workChangesError = _messageOf(failure);
    } finally {
      // The flag is the current project's. A stale reply leaves it alone: the
      // close or the switch already reset it.
      if (epoch == _projectEpoch) workChangesLoading = false;
      notifyListeners();
    }
  }

  /// Read the open project's pending approvals (`work.approvals.list`).
  ///
  /// This is the **read-only** half of the approval surface: a proposal lives in
  /// the core's process memory only, so a view asks again after a tab switch and
  /// this method never applies, runs, writes or consumes anything.
  ///
  /// A failure is recorded once in [approvalsError] and the previous rows stay,
  /// so a broken read never invents "nothing is pending". An answer for a
  /// project that is no longer open is dropped, so a refresh finishing after
  /// [closeProject] cannot resurrect its rows.
  Future<void> refreshApprovals(String projectId) async {
    final id = projectId.trim();
    if (id.isEmpty) return;
    final ticket = ++_approvalsTicket;
    approvalsLoading = true;
    approvalsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workApprovalsList, {
        'projectId': id,
      });
      if (ticket != _approvalsTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      final approvals = WorkApprovals.fromJson(json, projectId: id);
      pendingWrites = approvals.writes;
      pendingCommands = approvals.commands;
    } catch (failure) {
      if (ticket != _approvalsTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      approvalsError = _messageOf(failure);
    } finally {
      if (ticket == _approvalsTicket) {
        approvalsLoading = false;
        notifyListeners();
      }
    }
  }

  /// Approve or reject one pending write (`work.write.decide`).
  ///
  /// [hunks] is only meaningful for `approve`: an omitted value means "all", and
  /// the page refuses an empty selection before calling. A rejection writes
  /// nothing. On success the row is dropped from [pendingWrites] immediately
  /// (the core emits `work.approval.resolved` too) and the open project's
  /// working tree is re-read, so the Changes card reports the write the user
  /// just approved. A refusal rethrows the [RpcException] untouched for the
  /// page's inline message, and the row stays because nothing changed.
  Future<void> decideWrite(
    String id,
    String decision, {
    List<int>? hunks,
  }) async {
    final proposalId = id.trim();
    if (proposalId.isEmpty) return;
    await _connection.call(CoreMethod.workWriteDecide, {
      'id': proposalId,
      'decision': decision,
      'hunks': ?hunks,
    });
    _dropWrite(proposalId);
    notifyListeners();
    final projectId = activeProjectId;
    if (projectId != null) await refreshWorkChanges(projectId);
  }

  /// Approve or deny one pending command (`work.command.decide`).
  ///
  /// A denial starts nothing. On success the row is dropped from
  /// [pendingCommands] and the open project's working tree is re-read, because a
  /// command may have changed files. A refusal rethrows for the page's inline
  /// message and the row stays.
  Future<void> decideCommand(String id, String decision) async {
    final proposalId = id.trim();
    if (proposalId.isEmpty) return;
    // A command may run for two minutes; the user can switch project meanwhile.
    // The outcome belongs to the project that proposed it, so a late answer for
    // a project that is no longer open is dropped rather than painted on the
    // next project's approvals view.
    final owner = activeProjectId;
    final json = await _connection.call(CoreMethod.workCommandDecide, {
      'id': proposalId,
      'decision': decision,
    });
    _dropCommand(proposalId);
    if (owner != null && activeProjectId != owner) {
      notifyListeners();
      return;
    }
    lastCommandOutcome = CommandOutcome.fromJson(json);
    notifyListeners();
    final projectId = activeProjectId;
    if (projectId != null) await refreshWorkChanges(projectId);
  }
}
