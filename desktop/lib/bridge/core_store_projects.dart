part of 'core_store.dart';

/// Project registration, agent profiles and project instructions.
extension CoreStoreProjects on CoreStore {
  /// open, so a registration refusal never reaches [error].
  Future<WorkCreateResult> createProject({
    required String name,
    required String folder,
    required String mode,
  }) async {
    final json = await _connection.call(CoreMethod.workCreate, {
      'name': name,
      'folder': folder,
      'mode': mode,
    });
    final result = WorkCreateResult.fromJson(json);
    await refreshProjects();
    await openProject(result.id);
    return result;
  }

  /// Create or update one agent profile (`work.agent.save`).
  ///
  /// [agent] is the dialog's profile: an empty id creates a new one and a saved
  /// id updates it in place. The core writes only
  /// `work/projects/<id>/meta.json`; no file inside the project folder is read,
  /// written, moved or deleted.
  ///
  /// On success the project list is refreshed so the agent count follows, and
  /// the open project is re-read so the detail renders exactly what the core
  /// stored (a delete may have cleared the default, a save may have renamed a
  /// profile). On failure the [RpcException] is rethrown untouched, like
  /// [createProject]: the dialog shows the core's own sentence and stays open,
  /// so a refused save never reaches [error].
  Future<String> saveAgent(String projectId, AgentProfileView agent) async {
    final json = await _connection.call(CoreMethod.workAgentSave, {
      'projectId': projectId,
      'agent': agent.toSaveJson(),
    });
    final saved = json['id'];
    await _reloadProjectAfterAgentChange(projectId);
    return saved is String && saved.isNotEmpty ? saved : agent.id;
  }

  /// Replace a project's standing instructions (`work.instructions.save`).
  ///
  /// Only the project's metadata is written; nothing inside the registered
  /// folder is read or changed. The open project and list are re-read so the
  /// page renders what the core stored. Failure rethrows for the edit dialog's
  /// inline message and keeps the previous text.
  Future<void> saveProjectInstructions(
    String projectId,
    String instructions,
  ) async {
    await _connection.call(CoreMethod.workInstructionsSave, {
      'projectId': projectId,
      'instructions': instructions,
    });
    await _reloadProjectAfterAgentChange(projectId);
  }

  /// Delete one agent profile (`work.agent.delete`).
  ///
  /// Deleting the default leaves the project with no default; the re-read below
  /// reports that state instead of promoting a neighbour. Failure rethrows the
  /// [RpcException] for the page's inline message.
  Future<void> deleteAgent(String projectId, String agentId) async {
    await _connection.call(CoreMethod.workAgentDelete, {
      'projectId': projectId,
      'agentId': agentId,
    });
    await _reloadProjectAfterAgentChange(projectId);
  }

  /// Set the project default agent, or clear it with a null [agentId]
  /// (`work.defaultAgent`). Failure rethrows for the page's inline message.
  Future<void> setDefaultAgent(String projectId, String? agentId) async {
    final id = agentId?.trim() ?? '';
    await _connection.call(CoreMethod.workDefaultAgent, {
      'projectId': projectId,
      if (id.isNotEmpty) 'agentId': id,
    });
    await _reloadProjectAfterAgentChange(projectId);
  }

  /// Refresh the list and, when it is the open one, re-read the project.
  ///
  /// Both reads record their own failure in [error] and keep the previous
  /// projection, so a metadata write that succeeded is never reported as a
  /// failed write: only the follow-up read can fail here.
  Future<void> _reloadProjectAfterAgentChange(String projectId) async {
    await refreshProjects();
    if (activeProjectId == projectId) await openProject(projectId);
  }

  /// Export the Stats view as a document (`stats.export`).
  ///
  /// [range] and [scope] are the chips the page is showing, and [format] is
  /// `md` or `csv`. The core writes **no file**: it returns the whole document
  /// text plus the format it produced, so saving or copying is the shell's job
  /// and the workspace is left byte-identical. A refusal rethrows the
  /// [RpcException] untouched for the page's inline message and retry; the
}
