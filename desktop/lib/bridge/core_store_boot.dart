part of 'core_store.dart';

/// Boot and the whole-workspace refreshes: start, reload, settings save.
extension CoreStoreBoot on CoreStore {
  Future<void> start({
    String? executable,
    List<String>? arguments,
    String? workingDirectory,
  }) async {
    if (_starting) return;
    _starting = true;
    status = CoreStatus.connecting;
    error = null;
    notifyListeners();
    _subscription ??= _connection.events.listen(_handleEvent);
    final launch = executable == null && arguments == null
        ? resolveSidecar()
        : SidecarLaunch(
            executable: executable ?? 'bun',
            arguments: arguments ?? const ['run', '../src/server/main.ts'],
            workingDirectory: workingDirectory,
          );
    // One connection for the whole start: `_connection` is a field a retry can
    // replace, and initialising a different object from the one just started
    // fails with "core is not running".
    final connection = _connection;
    try {
      await connection.start(
        executable: launch.executable,
        arguments: launch.arguments,
        workingDirectory: launch.workingDirectory ?? workingDirectory,
        environment: launch.environment,
      );
      await connection.initialize();
      status = CoreStatus.online;
      await refreshAll();
      await refreshChat();
    } catch (failure) {
      status = CoreStatus.failed;
      error = _messageOf(failure);
      notifyListeners();
    } finally {
      _starting = false;
    }
  }

  Future<void> refreshAll() async {
    // The lists the sidebar counts are loaded at startup, not on first open:
    // a count that reads `0` until the user visits the surface is worse than no
    // count. Only the three library listings belong here: they are folder
    // reads the shell already needs. The review queue is not (it scores every
    // session's coverage), the archive is not (its GitHub backend would make a
    // network call on the first frame), and the achievements snapshot is not
    // (reading it records award dates, a write that belongs to opening the
    // layer). Those counts appear once their surface has been opened.
    await Future.wait([
      refreshWorkspace(),
      refreshSessions(),
      refreshSkills(),
      refreshProjects(),
      refreshStats(),
      refreshSettings(),
      refreshKeybinds(),
    ]);
  }

  Future<void> refreshWorkspace() async {
    final json = await _connection.call(CoreMethod.workspaceInfo);
    workspace = WorkspaceInfo.fromJson(json);
    notifyListeners();
  }

  Future<void> refreshSessions() async {
    try {
      final json = await _connection.call(CoreMethod.sessionList);
      final raw = json['sessions'];
      sessions = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) => SessionRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      sessionsLoaded = true;
      error = null;
    } catch (failure) {
      // A throw here used to become an unhandled future: the manager kept its
      // stale rows with no banner and no way to know the read failed.
      error = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Persist one settings patch and project the result. The core writes the
  /// file and applies it to the live service before returning.
  Future<void> saveSettings(Map<String, dynamic> patch) async {
    final json = await _connection.call(CoreMethod.settingsPatch, {
      'patch': patch,
    });
    settings = SettingsView.fromJson(json);
    // A model change drops every core chat controller, so the next snapshot
    // starts a fresh per-stream counter. Forget the old maxima or the new
    // stream's first frames would look stale.
    _chatSeqs.clear();
    notifyListeners();
    await refreshWorkspace();
    await refreshChat();
    notifyListeners();
  }

  /// the streamed `session.chat.state` events remain authoritative.
}
