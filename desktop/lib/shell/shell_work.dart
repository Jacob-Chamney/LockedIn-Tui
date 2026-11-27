part of 'shell.dart';

/// The Work page: the project board and the read-only change summary.
extension _ShellWork on _ShellState {
  Widget _work(CoreStore store) {
    final project = store.activeProject;
    if (project == null) {
      return WorkPage(
        projects: store.projects,
        loading:
            store.status == CoreStatus.connecting && store.projects.isEmpty,
        error: store.error,
        onRefresh: store.refreshProjects,
        onOpen: (row) {
          refresh(() {
            _workChatOpen = false;
            _workApprovalsOpen = false;
            _swarmOpen = false;
          });
          unawaited(_openProject(store, row.id));
        },
        onCreate:
            ({
              required String name,
              required String folder,
              required String mode,
            }) async {
              final created = await store.createProject(
                name: name,
                folder: folder,
                mode: mode,
              );
              final opened = store.activeProjectId;
              if (opened != null) unawaited(store.refreshWorkChanges(opened));
              return created;
            },
        onRemove: (id) async {
          await store.removeProject(id);
        },
      );
    }
    final projectId = store.activeProjectId;
    final chatId = store.activeWorkChatId;
    if (_workActivityOpen) {
      return ActivityPage(
        records: store.activityRecords,
        skipped: store.activitySkipped,
        empty: store.activityEmpty,
        loading: store.activityLoading,
        error: store.activityError,
        kind: store.activityKind,
        project: store.activityProject,
        onBack: () => refresh(() => _workActivityOpen = false),
        onRefresh: () => unawaited(
          store.refreshActivity(
            kind: store.activityKind,
            project: store.activityProject,
          ),
        ),
        onKind: (kind) => unawaited(
          store.refreshActivity(kind: kind, project: store.activityProject),
        ),
      );
    }
    if (_swarmOpen) {
      return SwarmPage(
        project: project,
        runs: store.swarmRuns,
        board: store.activeSwarm,
        loading: store.swarmLoading,
        error: store.swarmError,
        onBack: () => refresh(() => _swarmOpen = false),
        onRefresh: projectId == null
            ? null
            : () => unawaited(store.refreshSwarms(projectId)),
        onOpenRun: projectId == null
            ? null
            : (runId) => unawaited(store.openSwarm(projectId, runId)),
        onNewRun: projectId == null
            ? null
            : ({
                required String objective,
                required List<SwarmPlanEntry> plan,
                required int parallel,
              }) => store.runSwarm(
                projectId,
                objective: objective,
                plan: plan,
                parallel: parallel,
              ),
        onCancel: projectId == null
            ? null
            : (runId) => store.cancelSwarm(projectId, runId),
        onRemove: projectId == null
            ? null
            : (runId) => store.removeSwarm(projectId, runId),
        onRetry: projectId == null
            ? null
            : (runId, taskId) => store.retrySwarmTask(projectId, runId, taskId),
        onVerify: projectId == null
            ? null
            : (runId, taskId, verified) => store.verifySwarmTask(
                projectId,
                runId,
                taskId,
                verified: verified,
              ),
      );
    }
    if (_workApprovalsOpen) {
      return WorkApprovalsView(
        approvals: store.workApprovals,
        projectName: project.name,
        permissions: store.workPermissions,
        loading: store.approvalsLoading,
        error: store.approvalsError,
        onBack: () => refresh(() => _workApprovalsOpen = false),
        onDecideWrite: projectId == null
            ? null
            : (id, decision, {hunks}) =>
                  store.decideWrite(id, decision, hunks: hunks),
        onDecideCommand: projectId == null
            ? null
            : (id, decision) => store.decideCommand(id, decision),
        lastCommand: store.lastCommandOutcome,
        onDismissLastCommand: store.dismissCommandOutcome,
      );
    }
    if (_workChatOpen && chatId != null) {
      final projectDraftKey = projectId == null
          ? null
          : 'project:$projectId:$chatId';
      return WorkChatView(
        project: project,
        chatId: chatId,
        chat: store.workChat,
        loading: store.status == CoreStatus.connecting,
        error: store.workChatError ?? store.error,
        initialText: projectDraftKey == null
            ? null
            : _chatDrafts[projectDraftKey],
        onDraftChanged: projectDraftKey == null
            ? null
            : (text) => _chatDrafts[projectDraftKey] = text,
        onBack: () => refresh(() => _workChatOpen = false),
        onSend: projectId == null
            ? null
            : (text) async {
                final accepted = await store.sendWorkChat(
                  projectId,
                  chatId,
                  text,
                );
                if (accepted && projectDraftKey != null) {
                  _chatDrafts.remove(projectDraftKey);
                }
                return accepted;
              },
        sendError: store.workChatError,
        onCancel: projectId == null
            ? null
            : () => unawaited(store.cancelWorkChat(projectId, chatId)),
        onRetry: projectId == null
            ? null
            : () => unawaited(store.openWorkChat(projectId, chatId: chatId)),
        onModeChanged: (insert) {
          if (_insert != insert) refresh(() => _insert = insert);
        },
      );
    }
    return WorkDetailView(
      project: project,
      loading: store.status == CoreStatus.connecting,
      error: store.error,
      chatCount: store.projectChats.length,
      latestChatId: store.projectChats.isEmpty ? null : store.projectChats.last,
      changes: store.workChanges,
      changesLoading: store.workChangesLoading,
      changesError: store.workChangesError,
      approvals: store.workApprovals,
      approvalsLoading: store.approvalsLoading,
      approvalsError: store.approvalsError,
      onOpenApprovals: projectId == null
          ? null
          : () => refresh(() => _workApprovalsOpen = true),
      swarmRuns: store.swarmRuns,
      swarmLoading: store.swarmLoading,
      swarmError: store.swarmError,
      onOpenSwarm: projectId == null
          ? null
          : () => unawaited(_openSwarm(store, projectId)),
      activityCount: store.activityRecords.length,
      activityLoading: store.activityLoading,
      activityError: store.activityError,
      onOpenActivity: projectId == null
          ? null
          : () => unawaited(_openActivity(store, projectId)),
      onBack: () {
        refresh(() {
          _swarmOpen = false;
          _workActivityOpen = false;
        });
        store.closeProject();
        if (_workApprovalsOpen) refresh(() => _workApprovalsOpen = false);
      },
      onRetry: () {
        final id = store.activeProjectId;
        if (id != null) unawaited(store.openProject(id));
      },
      onOpenChat: projectId == null
          ? null
          : () => unawaited(_openWorkChat(store, projectId)),
      onRefreshChanges: projectId == null
          ? null
          : () => unawaited(store.refreshWorkChanges(projectId)),
      onSaveAgent: projectId == null
          ? null
          : (agent) => store.saveAgent(projectId, agent),
      onDeleteAgent: projectId == null
          ? null
          : (agentId) => store.deleteAgent(projectId, agentId),
      onSetDefaultAgent: projectId == null
          ? null
          : (agentId) => store.setDefaultAgent(projectId, agentId),
      onSaveInstructions: projectId == null
          ? null
          : (text) => store.saveProjectInstructions(projectId, text),
    );
  }

  /// Open a project, then read its working tree without blocking the detail.
  ///
  /// The detail paints as soon as `work.open` answers; `work.changes` is a
  /// second, page-local read that fills the CHANGES card when it lands. A failed
  /// open leaves the user where they were and the changes read is skipped.
}
