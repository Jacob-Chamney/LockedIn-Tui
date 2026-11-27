part of 'core_store.dart';

extension CoreStoreSettings on CoreStore {
  /// Read the configuration. A failure is recorded once in [settingsError] and
  /// the previous snapshot stays; a success clears it, so the page's Retry
  /// works.
  Future<void> refreshSettings() async {
    try {
      final json = await _connection.call(CoreMethod.settingsGet);
      settings = SettingsView.fromJson(json);
      settingsError = null;
      notifyListeners();
    } catch (failure) {
      settingsError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the running version and repository (`update.info`).
  ///
  /// Cheap and offline; quiet on failure, because a build with no update
  /// surface still runs.
  Future<void> refreshUpdateInfo() async {
    try {
      final json = await _connection.call(CoreMethod.updateInfo);
      appVersion = json['current'] is String ? json['current'] as String : null;
      updateRepo = json['repo'] is String ? json['repo'] as String : null;
      notifyListeners();
    } catch (_) {
      // A missing update surface is not a session error.
    }
  }

  /// Ask the release feed for a newer build (`update.check`).
  ///
  /// One explicit request, no retry, no automatic download. The previous result
  /// stays visible until the new one arrives or the check fails.
  Future<void> checkForUpdates() async {
    if (updateChecking) return;
    updateChecking = true;
    updateError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.updateCheck);
      updateState = UpdateView.fromJson(json);
      appVersion ??= updateState?.current;
    } catch (failure) {
      updateError = _messageOf(failure);
    } finally {
      updateChecking = false;
      notifyListeners();
    }
  }

  /// Read the two stored keybind tables (`keybinds.get`).
  ///
  /// This is a startup projection alongside the workspace and settings, but it
  /// is deliberately quiet: a build (or a fake) with no keybind storage still
  /// runs, and the shell's defaults apply. The maps are only ever replaced by a
  /// core answer, so the shell cannot store a binding it invented.
  Future<void> refreshKeybinds() async {
    try {
      final json = await _connection.call(CoreMethod.keybindsGet);
      final maps = KeybindMaps.fromJson(json);
      keybinds = maps.keybinds;
      fixedKeybinds = maps.fixedKeybinds;
      notifyListeners();
    } catch (_) {
      // No keybind storage in this build: keep the defaults the shell already
      // renders rather than failing the whole boot.
    }
  }

  /// Read the custom palette overrides (`theme.custom.get`).
  ///
  /// A quiet projection like [refreshKeybinds]: a build (or a fake) with no
  /// palette storage still runs, and the shell's crimson defaults apply. A
  /// failed read keeps the previous tokens rather than falling back to "no
  /// custom palette", so a transient error cannot repaint the app.
  Future<void> refreshCustomTheme() async {
    try {
      final json = await _connection.call(CoreMethod.themeCustomGet);
      customThemeTokens = ThemeTokens.fromJson(json['tokens']);
      notifyListeners();
    } catch (_) {
      // Keep the tokens the shell already had.
    }
  }

  /// Replace the custom palette overrides (`theme.custom.set`).
  ///
  /// The map is a replacement: a token absent from [tokens] is cleared, and an
  /// empty map clears the palette. The core validates names and `#RRGGBB`; the
  /// reply is the stored map, so the shell replaces its snapshot from this one
  /// message. A refusal throws its [RpcException] unchanged and leaves the
  /// previous tokens in place, so the editor can show the core's own sentence.
  Future<ThemeTokens> setCustomTheme(Map<String, String> tokens) async {
    final json = await _connection.call(CoreMethod.themeCustomSet, {
      'tokens': <String, dynamic>{...tokens},
    });
    customThemeTokens = ThemeTokens.fromJson(json['tokens']);
    notifyListeners();
    return customThemeTokens;
  }

  /// Write one binding (`keybinds.set`) and replace both tables with the core's
  /// answer.
  ///
  /// [binding] is the documented string form; `null` clears the override back to
  /// the shell's default (the core stores a cleared entry, and the registry
  /// reads it as "use the default"). [fixed] selects `ui.fixed_keybinds` for the
  /// mode and navigation keys.
  ///
  /// The reply is the whole stored pair, so the shell replaces its snapshot from
  /// this one message instead of patching what it asked for. A refusal — a
  /// duplicate, an unknown form — rethrows the [RpcException] untouched, leaves
  /// both maps exactly as they were and writes nothing; the Settings editor
  /// shows the core's own sentence inline and keeps the old binding.
  Future<void> setKeybind(
    String action,
    String? binding, {
    bool fixed = false,
  }) async {
    final id = action.trim();
    if (id.isEmpty) {
      throw ArgumentError.value(action, 'action', 'must not be blank');
    }
    final text = binding?.trim();
    final json = await _connection.call(CoreMethod.keybindsSet, {
      'action': id,
      // Omitted means "clear": the core documents `null` and an absent
      // `binding` as the same request, and an explicit empty string as a
      // malformed one.
      'binding': ?text,
      'fixed': fixed,
    });
    final maps = KeybindMaps.fromJson(json);
    keybinds = maps.keybinds;
    fixedKeybinds = maps.fixedKeybinds;
    notifyListeners();
  }

  /// Fetch the provider catalogue. Called when Settings opens, not at startup:
  /// reading keychain presence should not delay the first frame.
  Future<List<ProviderRow>> refreshProviders() async {
    try {
      final json = await _connection.call(CoreMethod.providerList);
      final raw = json['providers'];
      providers = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) => ProviderRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      _providersError = null;
      notifyListeners();
    } catch (failure) {
      _providersError = _messageOf(failure);
      notifyListeners();
    }
    return providers;
  }

  /// Read the configured MCP servers and the stored policy matrix.
  ///
  /// Called when Settings opens, never from [refreshAll]: the list itself starts
  /// no process, but the page is the only surface that needs it. A failure is
  /// recorded once in [mcpError] and the previous rows stay: a broken read never
  /// invents an empty list.
  Future<void> refreshMcp() async {
    try {
      final json = await _connection.call(CoreMethod.mcpList);
      mcpServers = _mcpRows(json);
      mcpPolicy = PluginPolicy.fromJson(json['policy']);
      mcpError = null;
      notifyListeners();
    } catch (failure) {
      mcpError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Write one cell of the MCP policy matrix (`mcp.policy.set`).
  ///
  /// The core validates the command, server and value, refuses `on` for
  /// `flashcards` and `study-guide`, and writes configuration only: this never
  /// starts, refreshes or calls a plugin server. On success the whole stored
  /// matrix is replaced with the core's answer; a refusal throws its
  /// [RpcException] unchanged so the settings page can keep it inline beside
  /// the row and let the user retry.
  Future<void> setMcpPolicy(String command, String server, String value) async {
    final json = await _connection.call(CoreMethod.mcpPolicySet, {
      'command': command,
      'server': server,
      'value': value,
    });
    mcpPolicy = PluginPolicy.fromJson(json['policy']);
    notifyListeners();
  }

  /// Read one server's stored definition (`mcp.server.get`).
  ///
  /// A failure is recorded in [mcpError] and returns null; the page keeps the
  /// list it has and shows the message.
  Future<McpServerDefinition?> readMcpServer(String name) async {
    try {
      final json = await _connection.call(CoreMethod.mcpServerGet, {
        'name': name.trim(),
      });
      return McpServerDefinition.fromJson(json);
    } catch (failure) {
      mcpError = _messageOf(failure);
      notifyListeners();
      return null;
    }
  }

  /// Add or update one stdio MCP server (`mcp.server.set`).  /// Add or update one stdio MCP server (`mcp.server.set`).
  ///
  /// The core validates the name, command and arguments, writes
  /// `[plugins.servers.<name>]`, restarts its plugin runtime and returns the
  /// refreshed rows plus the stored policy. A refusal is thrown unchanged so
  /// the Settings dialog can keep it inline and let the user correct the field.
  Future<void> saveMcpServer({
    required String name,
    required String command,
    List<String> args = const [],
    bool enabled = true,
  }) async {
    final json = await _connection.call(CoreMethod.mcpServerSet, {
      'name': name.trim(),
      'command': command.trim(),
      'args': args,
      'enabled': enabled,
    });
    mcpServers = _mcpRows(json);
    mcpPolicy = PluginPolicy.fromJson(json['policy']);
    mcpError = null;
    notifyListeners();
  }

  /// Remove one server's config table (`mcp.server.remove`).
  ///
  /// The server's policy cells are kept by the core, so re-adding the same name
  /// restores them. A refusal is thrown unchanged for the page's inline error.
  Future<void> removeMcpServer(String name) async {
    final json = await _connection.call(CoreMethod.mcpServerRemove, {
      'name': name.trim(),
    });
    mcpServers = _mcpRows(json);
    mcpPolicy = PluginPolicy.fromJson(json['policy']);
    mcpError = null;
    notifyListeners();
  }

  /// Read whether a GitHub archive token is stored (`status`).
  ///
  /// The token is never returned; only the boolean. A keychain failure is
  /// recorded in [githubTokenError] and leaves the previous value.
  Future<void> refreshGithubToken() async {
    githubTokenLoading = true;
    githubTokenError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.archiveGithubTokenStatus);
      githubTokenLinked = json['linked'] == true;
    } catch (failure) {
      githubTokenError = _messageOf(failure);
    } finally {
      githubTokenLoading = false;
      notifyListeners();
    }
  }

  /// Validate and store one GitHub token (`archive.github.token.link`).
  ///
  /// Returns the login on success; a refusal is thrown so the dialog can keep
  /// the field and show the core's sentence. The token never leaves this call.
  Future<String> linkGithubToken(String token) async {
    githubTokenLoading = true;
    githubTokenError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.archiveGithubTokenLink, {
        'token': token.trim(),
      });
      githubTokenLinked = true;
      return json['login'] is String ? json['login'] as String : '';
    } catch (failure) {
      githubTokenError = _messageOf(failure);
      rethrow;
    } finally {
      githubTokenLoading = false;
      notifyListeners();
    }
  }

  /// Remove the stored GitHub token (`archive.github.token.clear`).
  Future<void> clearGithubToken() async {
    githubTokenLoading = true;
    githubTokenError = null;
    notifyListeners();
    try {
      await _connection.call(CoreMethod.archiveGithubTokenClear);
      githubTokenLinked = false;
    } catch (failure) {
      githubTokenError = _messageOf(failure);
      rethrow;
    } finally {
      githubTokenLoading = false;
      notifyListeners();
    }
  }

  /// Read the decision layer's stored view (`decision.get`).  /// Read the decision layer's stored view (`decision.get`).  /// Read the decision layer's stored view (`decision.get`).
  ///
  /// This is a read: it writes no configuration, calls no model and starts no
  /// local runtime. The layer is off by default and rules-only in this build, so
  /// the answer says so and the Settings group never invents a local-model
  /// control. Loading is the shell's call when Settings opens (not [refreshAll]),
  /// because the page is the only surface that shows it.
  ///
  /// A failure is recorded once in [decisionError] and the previous [decision]
  /// stays, so a broken read shows the core's own message with a retry instead of
  /// a blank or a fabricated view. The method never throws.
  Future<void> refreshDecision() async {
    // Ticketed like every other read: Settings fires this on each entry, so two
    // opens could let an older reply land after a newer one and clear the flag
    // while the newer request was still running.
    final ticket = ++_decisionTicket;
    decisionLoading = true;
    decisionError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.decisionGet);
      if (ticket != _decisionTicket) return;
      decision = DecisionView.fromJson(json);
    } catch (failure) {
      if (ticket != _decisionTicket) return;
      decisionError = _messageOf(failure);
    } finally {
      if (ticket == _decisionTicket) {
        decisionLoading = false;
        notifyListeners();
      }
    }
  }

  /// Write the decision layer's stored values (`decision.set`).
  ///
  /// [enabled] toggles the optional layer; [model] is only ever empty in this
  /// build, because no local model runtime is bundled and the core refuses a
  /// non-empty name. The reply is the whole view after the write — the same
  /// shape `decision.get` returns — so the shell replaces [decision] from this
  /// one message instead of flipping a flag locally.
  ///
  /// A refusal rethrows the [RpcException] untouched and leaves [decision]
  /// exactly as it was; the Settings row shows the core's own sentence inline and
  /// keeps the old state. Nothing is retried here.
  Future<void> setDecision({bool? enabled, String? model}) async {
    final json = await _connection.call(CoreMethod.decisionSet, {
      'enabled': ?enabled,
      'model': ?model,
    });
    decision = DecisionView.fromJson(json);
    decisionError = null;
    notifyListeners();
  }

  /// Read the global Work opt-in (`work.permissions.get`).
  ///
  /// Both flags default to `false` in the core, so a workspace that never opened
  /// Settings → Work refuses every approval even with a write-capable profile.
  /// Loading is the shell's call when Settings opens (not [refreshAll]), because
  /// the page and the approvals view are the only surfaces that show it.
  ///
  /// A failure is recorded once in [workPermissionsError] and the previous view
  /// stays, so a broken read shows the core's own message with a retry rather
  /// than a fabricated "allowed". The method never throws.
  Future<void> refreshWorkPermissions() async {
    final ticket = ++_workPermissionsTicket;
    workPermissionsLoading = true;
    workPermissionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workPermissionsGet);
      if (ticket != _workPermissionsTicket) return;
      workPermissions = WorkPermissions.fromJson(json);
    } catch (failure) {
      if (ticket != _workPermissionsTicket) return;
      workPermissionsError = _messageOf(failure);
    } finally {
      if (ticket == _workPermissionsTicket) {
        workPermissionsLoading = false;
        notifyListeners();
      }
    }
  }

  /// Write the global Work opt-in (`work.permissions.set`).
  ///
  /// The reply is the whole view after the write, read back from `config.toml`,
  /// so the shell replaces [workPermissions] from this one message instead of
  /// flipping a flag locally. A refusal rethrows the [RpcException] untouched and
  /// leaves the previous view exactly as it was; the settings row shows the
  /// core's own sentence inline and keeps the old state. Nothing is retried here.
  ///
  /// Enabling a flag does not approve anything: the next decision still needs the
  /// per-action approval and the agent profile's own permission.
  Future<void> setWorkPermissions({
    bool? allowWrite,
    bool? allowCommand,
  }) async {
    final json = await _connection.call(CoreMethod.workPermissionsSet, {
      'allowWrite': ?allowWrite,
      'allowCommand': ?allowCommand,
    });
    workPermissions = WorkPermissions.fromJson(json);
    workPermissionsError = null;
    notifyListeners();
  }

  /// Answer one plugin write permission prompt (`mcp.confirm`).
  ///
  /// [allow] `true` runs that one tool call; `false` declines it and reports a
  /// typed tool result to the model, which is a normal result rather than a
  /// failed turn. The pending request is cleared only on success, so a refused
  /// answer keeps the prompt on screen with [pluginPermissionError] set to the
  /// core's own sentence. The [RpcException] is rethrown untouched for the modal
  /// to show inline; it is never retried here.
  Future<void> confirmPermission(String requestId, bool allow) async {
    final id = requestId.trim();
    if (id.isEmpty) {
      throw ArgumentError.value(requestId, 'requestId', 'must not be blank');
    }
    final index = _permissionQueue.indexWhere(
      (entry) => entry.$1.requestId == id,
    );
    // The same window the expiry timer uses: with the two out of step, a prompt
    // could be marked expired on screen and still send an `mcp.confirm`.
    final window = permissionTimeout;
    if (index >= 0 && _now().difference(_permissionQueue[index].$2) >= window) {
      // The core stopped waiting and denied this call. `mcp.confirm` would
      // answer `{ok: true}` for an id it no longer knows, and an Allow would
      // then look as if it had run the tool. Say what actually happened.
      final expired = _permissionQueue.removeAt(index).$1;
      pluginPermissionError = null;
      error =
          'the ${expired.server} · ${expired.tool} prompt expired after '
          '${window.inSeconds} s; the core denied it and nothing ran';
      notifyListeners();
      return;
    }
    try {
      await _connection.call(CoreMethod.mcpConfirm, {
        'requestId': id,
        'allow': allow,
      });
    } catch (failure) {
      pluginPermissionError = _messageOf(failure);
      notifyListeners();
      rethrow;
    }
    _permissionTimers.remove(id)?.cancel();
    _expiredPermissions.remove(id);
    _permissionQueue.removeWhere((entry) => entry.$1.requestId == id);
    pluginPermissionError = null;
    notifyListeners();
  }

  /// Reconnect the configured MCP servers (`mcp.refresh`).
  ///
  /// This is the only call that may spawn a stdio server, so it is explicit: the
  /// settings page's `r` key. Rows are replaced; the policy matrix is not part of
  /// the answer and stays as it was. A failure keeps the previous rows and
  /// records the reason in [mcpError].
  Future<void> refreshMcpServers() async {
    try {
      final json = await _connection.call(CoreMethod.mcpRefresh);
      mcpServers = _mcpRows(json);
      mcpError = null;
      notifyListeners();
    } catch (failure) {
      mcpError = _messageOf(failure);
      notifyListeners();
    }
  }

  static List<McpServerView> _mcpRows(Map<String, dynamic> json) {
    final raw = json['servers'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((row) => McpServerView.fromJson(Map<String, dynamic>.from(row)))
        .toList();
  }
}
