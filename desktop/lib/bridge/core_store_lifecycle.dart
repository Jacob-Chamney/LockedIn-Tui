part of 'core_store.dart';

/// Connection lifecycle: retry, the fresh-process reset and reconnect.
extension CoreStoreLifecycle on CoreStore {
  /// genuine retry needs a new process, not another request.
  Future<void> retry() async {
    // A retry replaces the connection, so it must not overlap a start or
    // another retry: the second would dispose the process the first is still
    // initialising and leave the shell `failed` beside an orphaned core.
    if (_starting || _retrying) return;
    final reconnect = reconnectFactory;
    if (reconnect == null) {
      await start();
      return;
    }
    _retrying = true;
    try {
      await _reconnect(reconnect);
    } finally {
      _retrying = false;
    }
  }

  /// Forget everything the dead process told us.
  ///
  /// A retry builds a new process, which may even boot a different workspace, so
  /// every projection has to go back to its constructor default. This used to be
  /// a hand-written list inside `_reconnect`, and it had drifted: `sessions` was
  /// kept while `skills` and `projects` were cleared, the `*Loaded` flags were
  /// never cleared so the sidebar printed a fabricated `0` for Skills and Work,
  /// and `settings`, `stats`, `achievements`, `decision`, `workPermissions`,
  /// the custom palette, the study document and the staged lesson all survived.
  ///
  /// The order matches the field declarations, so a new field has one obvious
  /// place to go. `_reconnectResetsEveryProjection` in `core_store_test.dart`
  /// loads every projection and then asserts each default, so leaving one out

  /// fails a test rather than shipping a stale screen.
  void _resetForNewProcess() {
    status = CoreStatus.offline;
    error = null;
    workspace = null;
    sessions = const [];
    sessionsLoaded = false;
    stats = null;
    statsRange = 'all';
    statsScope = 'all';
    // `app.dart` derives the theme id from `settings.theme`, so a stale view
    // would repaint the dead workspace's palette.
    settings = null;
    settingsError = null;
    chat = null;
    chatSendError = null;
    providers = const [];
    _providersError = null;
    // A new process reads `config.toml` again, so a binding cached from the dead
    // one is a promise the shell cannot keep.
    keybinds = const <String, String>{};
    fixedKeybinds = const <String, String>{};
    customThemeTokens = ThemeTokens.empty;
    mcpServers = const [];
    mcpPolicy = PluginPolicy.empty;
    mcpError = null;
    decision = null;
    decisionLoading = false;
    decisionError = null;
    _decisionTicket += 1;
    workPermissions = null;
    workPermissionsLoading = false;
    workPermissionsError = null;
    _workPermissionsTicket += 1;
    // A prompt belongs to the process that emitted it; a new process issues new
    // request ids and forgets the old ones, so a stale modal must not survive.
    _permissionQueue.clear();
    for (final timer in _permissionTimers.values) {
      timer.cancel();
    }
    _permissionTimers.clear();
    _expiredPermissions.clear();
    pluginPermissionError = null;
    review = null;
    reviewLoading = false;
    reviewError = null;
    reviewSide = 'all';
    _markingIds.clear();
    _reviewTicket += 1;
    _reviewWriteTicket += 1;
    archiveRows = const [];
    archiveLoading = false;
    archiveError = null;
    _archiveTicket += 1;
    achievements = const [];
    achievementsEarned = 0;
    achievementsTotal = 0;
    achievementsWarning = null;
    achievementsLoading = false;
    achievementsError = null;
    _achievementsTicket += 1;
    // The Knowledge tree is a workspace read, not process state, but a new
    // process may see a different workspace; the shell re-reads it on entry.
    knowledgeHits = const [];
    knowledgeGroups = const [];
    knowledgeLoading = false;
    knowledgeError = null;
    knowledgeQuery = '';
    knowledgeScope = 'all';
    knowledgeHitOrder = const [];
    knowledgeHitIndex = null;
    _knowledgeTicket += 1;
    _knowledgeTreeTicket += 1;
    _knowledgeSearching = false;
    _knowledgeTreeLoading = false;
    // A read body belongs to the process that produced it; a new process may
    // see a different workspace, so the reader is closed rather than kept open
    // on text the shell cannot vouch for.
    _clearKnowledgeDocument();
    // A new process owns new chat controllers; a snapshot cached from the dead
    // one would be a lie.
    activeSession = null;
    activeSessionId = null;
    _generatingStepsFor = null;
    stepsError = null;
    _clearInstructions();
    _clearOutput();
    _clearCoverage();
    _clearMistakes();
    _clearDocument();
    _sessionChats.clear();
    _sessionChatErrors.clear();
    _chatSeqs.clear();
    _sessionOpenTicket += 1;
    _projectOpenTicket += 1;
    _skillOpenTicket += 1;
    _projectEpoch += 1;
    projects = const [];
    projectsLoaded = false;
    activeProject = null;
    activeProjectId = null;
    projectChats = const [];
    activeWorkChatId = null;
    _workChats.clear();
    _workChatErrors.clear();
    workChanges = null;
    workChangesLoading = false;
    workChangesError = null;
    workTemplates = const [];
    workTemplatesLoading = false;
    workTemplatesError = null;
    _workTemplatesTicket += 1;
    lastCommandOutcome = null;
    _clearApprovals();
    _clearSwarms();
    _clearActivity();
    skills = const [];
    skillsLoaded = false;
    activeSkill = null;
    activeSkillId = null;
    activeSkillChatId = null;
    skillChats = const [];
    _skillChats.clear();
    _skillChatErrors.clear();
    _clearSkillSources();
    _clearChapter();
    _clearSkillLesson();

    // The teaching harness. Every one of these is a read of the dead process's
    // workspace; a stale plan or verdict must not survive a reconnect.
    teaching = null;
    teachingLoading = false;
    teachingError = null;
    teachingVerdict = null;
    teachingSide = const [];
    teachingSideLoading = false;
    teachingSideError = null;
    _teachingTicket += 1;

    // Background research briefs.
    research = const [];
    researchLoading = false;
    researchRunning = false;
    researchRunId = null;
    researchError = null;
    researchMarkdown = null;
    researchOpenId = null;
    _researchTicket += 1;

    // Session figures, the deck's schedule and the compaction meter.
    figures = const [];
    figuresLoading = false;
    figureBusy = false;
    figureError = null;
    _figureTicket += 1;
    deckSchedule = null;
    deckScheduleLoading = false;
    deckScheduleError = null;
    _deckTicket += 1;
    sessionContext = null;
    sessionContextLoading = false;
    sessionContextError = null;
    _contextTicket += 1;

    // Reference surfaces and update metadata. `appVersion` is the running
    // build, but it is read from the core, so a new process re-reads it.
    learningGraph = null;
    learningGraphLoading = false;
    learningGraphError = null;
    prompts = const [];
    promptsError = null;
    githubTokenLinked = null;
    githubTokenLoading = false;
    githubTokenError = null;
    appVersion = null;
    updateRepo = null;
    updateState = null;
    updateChecking = false;
    updateError = null;
    _instructionsLoadTicket += 1;
    _statsTicket += 1;
  }

  Future<void> _reconnect(CoreConnection Function() reconnect) async {
    await _subscription?.cancel();
    _subscription = null;
    await _connection.dispose();
    _connection = reconnect();
    _subscription = _connection.events.listen(_handleEvent);
    _resetForNewProcess();
    notifyListeners();
    await start();
  }
}
