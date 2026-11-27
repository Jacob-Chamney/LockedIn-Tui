part of 'core_store.dart';

/// Pending approvals and the Work activity log.
extension CoreStoreActivity on CoreStore {
  /// The open project's pending approvals, as one value for the page.
  WorkApprovals get workApprovals =>
      WorkApprovals(writes: pendingWrites, commands: pendingCommands);

  /// How many proposals the open project is waiting on.
  int get pendingApprovalCount => pendingWrites.length + pendingCommands.length;

  /// Leave the approval layer. The pending rows belong to the open project, so
  /// this is only the read projection being cleared.
  void closeApprovals() {
    if (pendingWrites.isEmpty &&
        pendingCommands.isEmpty &&
        !approvalsLoading &&
        approvalsError == null) {
      return;
    }
    _clearApprovals();
    notifyListeners();
  }

  /// Dismiss the last command's result (the approvals view's `x`).
  void dismissCommandOutcome() {
    if (lastCommandOutcome == null) return;
    lastCommandOutcome = null;
    notifyListeners();
  }

  void _clearApprovals() {
    _approvalsTicket += 1;
    pendingWrites = const [];
    pendingCommands = const [];
    lastCommandOutcome = null;
    approvalsLoading = false;
    approvalsError = null;
  }

  void _dropWrite(String id) {
    if (!pendingWrites.any((write) => write.id == id)) return;
    pendingWrites = [
      for (final write in pendingWrites)
        if (write.id != id) write,
    ];
  }

  void _dropCommand(String id) {
    if (!pendingCommands.any((command) => command.id == id)) return;
    pendingCommands = [
      for (final command in pendingCommands)
        if (command.id != id) command,
    ];
  }

  /// Open one project chat (`work.chat.open`).
  ///
  /// An omitted [chatId] resumes the newest chat, or starts the project's first
  /// one — the core decides. On success the snapshot is cached under
  /// `<projectId>:<chatId>` and that chat becomes [activeWorkChatId]. Failure is
  /// reported once through [error], never thrown, and the previous chat and its
  /// snapshot survive, so a typo cannot blank a transcript. Returns whether the
  /// chat is open.
  Future<void> refreshActivity({String? kind, String? project}) async {
    final filterKind = kind?.trim();
    final filterProject = project?.trim();
    final queryChanged =
        filterKind != activityKind || filterProject != activityProject;
    activityKind = filterKind;
    activityProject = filterProject;
    final ticket = ++_activityTicket;
    if (queryChanged) {
      activityRecords = const [];
      activitySkipped = 0;
      activityEmpty = true;
    }
    activityLoading = true;
    activityError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.activityList, {
        if (filterKind != null && filterKind.isNotEmpty) 'kind': filterKind,
        if (filterProject != null && filterProject.isNotEmpty)
          'project': filterProject,
      });
      if (ticket != _activityTicket) return;
      final result = ActivityListResult.fromJson(json);
      activityRecords = result.records;
      activitySkipped = result.skipped;
      activityEmpty = result.empty;
    } catch (failure) {
      if (ticket != _activityTicket) return;
      activityError = _messageOf(failure);
    } finally {
      if (ticket == _activityTicket) {
        activityLoading = false;
        notifyListeners();
      }
    }
  }

  /// Forget the visible activity log and any read in flight.
  ///
  /// The log itself lives in the core's data directory and is untouched; this
  /// only drops the projection when the project closes.
  void _clearActivity() {
    _activityTicket += 1;
    activityRecords = const [];
    activitySkipped = 0;
    activityEmpty = true;
    activityLoading = false;
    activityError = null;
    activityKind = null;
    activityProject = null;
  }
}
