part of 'shell.dart';

/// The read surfaces: knowledge, sessions and skills.
extension _ShellSurfaces on _ShellState {
  Widget _knowledge(CoreStore store) {
    final page = KnowledgePage(
      hits: store.knowledgeHits,
      groups: store.knowledgeGroups,
      loading: store.knowledgeLoading,
      error: store.knowledgeError,
      query: store.knowledgeQuery,
      scope: store.knowledgeScope,
      active: !store.knowledgeDocumentOpen,
      onSearch: store.searchKnowledge,
      // `s` and a chip change the projection: the store re-runs the search or
      // reloads the tree, and a `work` scope reads the tree with `all`.
      onScope: (scope) => unawaited(store.selectKnowledgeScope(scope)),
      // `r` repeats what is on screen: a search stays a search, and only the
      // tree is re-read when there is no query. Reloading the tree under a
      // result list left the key looking dead.
      onRefresh: () => unawaited(
        store.knowledgeQuery.trim().isEmpty
            ? store.loadKnowledgeTree()
            : store.searchKnowledge(store.knowledgeQuery),
      ),
      // `Enter` reads the row through the core and shows it in the layer above.
      onOpen: (id) => unawaited(store.readKnowledge(id)),
      graph: store.learningGraph ?? learningGraphEmpty,
      graphLoading: store.learningGraphLoading,
      graphError: store.learningGraphError,
      onLoadGraph: () => unawaited(store.readLearningGraph()),
      // Knowledge is a read-only snapshot over the vaults, not a layer: `Esc`
      // goes back to chat, the home surface, instead of inventing a parent.
      onBack: () => _select(Surface.chat),
    );
    return Stack(
      fit: StackFit.expand,
      children: [
        page,
        if (store.knowledgeDocumentOpen)
          Positioned.fill(
            child: KnowledgeReader(
              documentId: store.knowledgeDocumentId ?? '',
              document: store.knowledgeDocument,
              loading: store.knowledgeDocumentLoading,
              error: store.knowledgeDocumentError,
              // The hit list lives in the store: `[`/`]` walk it in place
              // instead of going back to the list.
              hitIds: store.knowledgeHitOrder,
              hitIndex: store.knowledgeHitIndex,
              onNavigate: (index) => unawaited(store.openKnowledgeHit(index)),
              onRetry: () => unawaited(store.retryKnowledgeDocument()),
              onBack: store.closeKnowledgeDocument,
            ),
          ),
      ],
    );
  }

  /// Sessions is three layers: the list, the New lock-in wizard, the open
  /// session's detail, then its chat. The shell owns which layer is visible; the
  /// pages own their own `Esc`.
  Widget _sessions(CoreStore store) {
    if (_wizardOpen) {
      return NewSessionWizard(
        onCreate: (input) {
          // Read on Review, applied when the created session is open: the
          // wizard's completion callback only carries the id.
          _wizardWantsSteps = input.steps;
          return store.createSession(
            name: input.name,
            prompt: input.prompt,
            files: input.files,
            instructionsFile: input.instructionsFile,
            steps: input.steps,
            requestId: input.requestId,
          );
        },
        onCancel: () => refresh(() => _wizardOpen = false),
        onCreated: (id) {
          final wantsSteps = _wizardWantsSteps;
          _wizardWantsSteps = true;
          refresh(() {
            _wizardOpen = false;
            _sessionSettingsOpen = false;
          });
          // Open the detail first, then build the steps if the user asked for
          // them. The generation is a provider run: it must not hold the create
          // result, and the detail's own pending state shows the work.
          _initialStep = null;
          unawaited(() async {
            await store.openSession(id);
            if (wantsSteps) await store.generateSteps(id);
          }());
        },
      );
    }

    final active = store.activeSession;
    if (active == null) {
      return SessionsPage(
        sessions: store.sessions,
        loading:
            store.status == CoreStatus.connecting && store.sessions.isEmpty,
        error: store.error,
        onRefresh: store.refreshSessions,
        onCreate: () => refresh(() {
          _wizardOpen = true;
          _sessionChatOpen = false;
          _sessionSettingsOpen = false;
        }),
        onOpen: (row) {
          // A new row always lands on its detail, never a stale chat layer, and
          // never on a step a review item asked for in another session.
          refresh(() {
            _sessionChatOpen = false;
            _sessionSettingsOpen = false;
            _initialStep = null;
          });
          unawaited(store.openSession(row.id));
        },
        onArchive: (id) async {
          final backend = await store.archiveSession(id);
          _sessionLayerGone(store);
          return backend;
        },
        onDelete: (id) async {
          await store.removeSession(id);
          _sessionLayerGone(store);
        },
        onExport: store.exportSession,
      );
    }

    final sessionId = store.activeSessionId;
    if (_sessionSettingsOpen) {
      return SessionSettingsView(
        detail: active,
        instructions: store.sessionInstructions,
        loading:
            store.instructionsLoading ||
            (store.sessionInstructions == null &&
                store.instructionsError == null &&
                store.status == CoreStatus.connecting),
        error: store.instructionsError,
        onSave: sessionId == null
            ? null
            : (text) => store.saveSessionInstructions(sessionId, text),
        onImport: sessionId == null
            ? null
            : (file) => store.importSessionInstructions(sessionId, file),
        onReextract: sessionId == null
            ? null
            : () => store.reextractSessionInstructions(sessionId),
        onRetry: sessionId == null
            ? null
            : () => store.loadSessionInstructions(sessionId),
        onBack: () => refresh(() => _sessionSettingsOpen = false),
      );
    }
    if (!_sessionChatOpen) {
      final outputKind = store.outputKind;
      if (outputKind != null) {
        return SessionOutputView(
          sessionName: active.name,
          kind: outputKind,
          markdown: store.outputMarkdown,
          cardsMarkdown: outputKind == 'flashcards'
              ? store.outputMarkdown
              : null,
          answers: store.outputAnswers,
          exists: store.outputExists,
          loading: store.outputLoading,
          error: store.outputError,
          onBuild: sessionId == null
              ? null
              : () => store.buildOutput(sessionId, outputKind),
          onReadAnswers: sessionId == null
              ? null
              : () => store.readOutput(sessionId, outputKind, part: 'answers'),
          onMarkSection: sessionId == null
              ? null
              : (index) => store.markGuideSection(sessionId, index),
          onMarkCard: sessionId == null
              ? null
              : (cardId, result) async {
                  await store.markReview('card:$sessionId:$cardId', result);
                  // The reply is the review queue, not the deck: re-read the
                  // deck so `M:`/`K:` come back from the core's own write.
                  await store.readOutput(sessionId, 'flashcards');
                },
          deckSchedule: store.deckSchedule,
          deckScheduleLoading: store.deckScheduleLoading,
          deckScheduleError: store.deckScheduleError,
          onGradeCard: sessionId == null
              ? null
              : (index, grade) => store.gradeDeckCard(sessionId, index, grade),
          onRetry: sessionId == null ? null : store.retryOutput,
          onBack: store.closeOutput,
        );
      }
      return SessionDetailView(
        detail: active,
        // Consumed once: a later open of the same session starts at step 0.
        initialStep: _stepToLandOn(),
        loading: store.status == CoreStatus.connecting,
        error: store.error,
        coverage: store.coverage,
        coverageLoading: store.coverageLoading,
        coverageError: store.coverageError,
        onRetryCoverage: sessionId == null
            ? null
            : () => unawaited(store.readCoverage(sessionId)),
        mistakes: store.mistakes,
        mistakesLoading: store.mistakesLoading,
        mistakesError: store.mistakesError,
        onRetryMistakes: sessionId == null
            ? null
            : () => unawaited(store.loadMistakes(sessionId)),
        onRecordMistake: sessionId == null
            ? null
            : (text, {step}) =>
                  store.recordMistake(sessionId, text, step: step),
        onPromoteMistake: sessionId == null
            ? null
            : (index, {correction}) => store.promoteMistake(
                sessionId,
                index,
                correction: correction,
              ),
        onCorrectMistake: sessionId == null
            ? null
            : (index, correction) =>
                  store.correctMistake(sessionId, index, correction),
        onBack: store.closeSession,
        onOpenChat: () => refresh(() => _sessionChatOpen = true),
        onOpenSettings: () => refresh(() {
          _sessionSettingsOpen = true;
          _sessionChatOpen = false;
        }),
        onOpenOutput: sessionId == null
            ? null
            : (kind) => store.readOutput(sessionId, kind),
        onToggleStep: sessionId == null
            ? null
            : (index) => store.toggleStep(sessionId, index),
        onGenerateSteps: sessionId == null
            ? null
            : () => store.generateSteps(sessionId),
        generatingSteps: store.generatingSteps,
        stepsError: store.stepsError,
        documentText: store.documentText,
        documentName: store.documentName,
        documentLoading: store.documentLoading,
        documentError: store.documentError,
        onGenerateDocument: sessionId == null
            ? null
            : (kind, {attempt}) =>
                  store.generateDocument(sessionId, kind, attempt: attempt),
        onRetryDocument: sessionId == null ? null : store.retryDocument,
        onCloseDocument: store.closeDocument,
        figures: store.figures,
        figureImages: store.figureImages,
        figuresLoading: store.figuresLoading,
        figureBusy: store.figureBusy,
        figureError: store.figureError,
        onExtractFigure: sessionId == null
            ? null
            : ({required page, x, y, width, height, caption = ''}) =>
                  store.extractFigure(
                    sessionId,
                    page: page,
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    caption: caption,
                  ),
        onLoadFigure: sessionId == null
            ? null
            : (figureId) => store.loadFigure(sessionId, figureId),
        onRemoveFigure: sessionId == null
            ? null
            : (figureId) => store.removeFigure(sessionId, figureId),
        onRetry: () {
          if (sessionId != null) unawaited(store.openSession(sessionId));
        },
      );
    }

    final sessionDraftKey = sessionId == null ? null : 'session:$sessionId';
    return SessionChatView(
      detail: active,
      chat: store.sessionChat,
      loading: false,
      error: store.sessionChatError ?? store.error,
      initialText: sessionDraftKey == null
          ? null
          : _chatDrafts[sessionDraftKey],
      onDraftChanged: sessionDraftKey == null
          ? null
          : (text) => _chatDrafts[sessionDraftKey] = text,
      onBack: () => refresh(() => _sessionChatOpen = false),
      onSend: (text) async {
        if (sessionId == null) return false;
        final accepted = await store.sendSessionChat(sessionId, text);
        if (accepted && sessionDraftKey != null) {
          _chatDrafts.remove(sessionDraftKey);
        }
        return accepted;
      },
      sendError: store.sessionChatError,
      onCancel: () {
        if (sessionId != null) unawaited(store.cancelSessionChat(sessionId));
      },
      onRetry: () {
        if (sessionId != null) unawaited(store.openSession(sessionId));
      },
      onModeChanged: (insert) {
        if (_insert != insert) refresh(() => _insert = insert);
      },
      context: store.sessionContext,
      contextLoading: store.sessionContextLoading,
      contextError: store.sessionContextError,
      onContextLoad: sessionId == null
          ? null
          : () => unawaited(store.readSessionContext(sessionId)),
      onCompact: sessionId == null
          ? null
          : () => unawaited(store.compactSessionChat(sessionId)),
      onUncompact: sessionId == null
          ? null
          : () => unawaited(store.uncompactSessionChat(sessionId)),
    );
  }

  /// After a confirmed archive or delete cleared the open session, collapse the
  /// chat layer with it.
  ///
  /// The manager is only visible when no session is open, so this normally does
  /// nothing; it exists so the shell never keeps a chat layer for a session the
  /// core has just archived or deleted.
  void _sessionLayerGone(CoreStore store) {
    if (!mounted) return;
    if (store.activeSessionId != null) return;
    if (!_sessionChatOpen && !_sessionSettingsOpen) return;
    refresh(() {
      _sessionChatOpen = false;
      _sessionSettingsOpen = false;
    });
  }

  /// Skills has four layers: the goal list, the New skill goal wizard over it,
  /// one goal's course index, and a chapter reader over that. The shell owns
  /// which layer is visible; `Esc` climbs one layer, so the reader returns to
  /// the goal, the wizard to the list and the goal to the list. Switching
  /// surfaces collapses the wizard and the reader but keeps the goal open,
  /// exactly like a lock-in session.
  Widget _skills(CoreStore store) {
    if (_goalWizardOpen) {
      return GoalWizard(
        onCreate: ({required goal, required prior}) =>
            store.createSkill(goal: goal, prior: prior),
        onCancel: () => refresh(() => _goalWizardOpen = false),
        onCreated: (_) {
          // `createSkill` already refreshed the rows and opened the new goal;
          // this callback only lands the shell on its detail. A create that
          // opened nothing leaves the list up with the core's own message,
          // never a second automatic open.
          refresh(() => _goalWizardOpen = false);
        },
      );
    }

    final skill = store.activeSkill;
    final skillId = store.activeSkillId;
    if (skill == null) {
      return SkillsPage(
        skills: store.skills,
        loading: store.status == CoreStatus.connecting && store.skills.isEmpty,
        error: store.error,
        onRefresh: store.refreshSkills,
        onCreate: () => refresh(() {
          _goalWizardOpen = true;
        }),
        onOpen: (row) {
          // A new goal always lands on its page, never a stale chat layer.
          refresh(() => _skillChatOpen = false);
          unawaited(_openSkill(store, row.id));
        },
        onArchive: store.archiveSkill,
        onDelete: store.removeSkill,
        onExport: store.exportSkill,
      );
    }

    final chatId = store.activeSkillChatId;
    if (_skillChatOpen && chatId != null) {
      final goalDraftKey = skillId == null ? null : 'goal:$skillId:$chatId';
      return SkillChatView(
        skill: skill,
        chatId: chatId,
        chat: store.skillChat,
        loading: store.status == CoreStatus.connecting,
        error: store.skillChatError ?? store.error,
        initialText: goalDraftKey == null ? null : _chatDrafts[goalDraftKey],
        onDraftChanged: goalDraftKey == null
            ? null
            : (text) => _chatDrafts[goalDraftKey] = text,
        onBack: () => refresh(() => _skillChatOpen = false),
        onSend: skillId == null
            ? null
            : (text) async {
                final accepted = await store.sendSkillChat(
                  skillId,
                  chatId,
                  text,
                );
                if (accepted && goalDraftKey != null) {
                  _chatDrafts.remove(goalDraftKey);
                }
                return accepted;
              },
        sendError: store.skillChatError,
        onCancel: skillId == null
            ? null
            : () => unawaited(store.cancelSkillChat(skillId, chatId)),
        onRetry: skillId == null
            ? null
            : () => unawaited(store.openSkillChat(skillId, chatId: chatId)),
        onModeChanged: (insert) {
          if (_insert != insert) refresh(() => _insert = insert);
        },
        contextPane: skillId == null
            ? null
            : LearningPane(
                teaching: store.teaching,
                onMeasure: () => unawaited(store.measureTeaching(skillId)),
                onOpenGoal: () => refresh(() => _skillChatOpen = false),
                onOpenStep: (stepId) {
                  refresh(() => _skillChatOpen = false);
                  unawaited(store.teachNextStep(skillId, stepId: stepId));
                },
              ),
      );
    }

    final stageId = store.activeSkillStageId;
    if (store.skillLessonOpen && stageId != null) {
      final stage = store.activeSkillStage;
      return SkillLessonView(
        stageId: stageId,
        stageTitle: stage?.title ?? 'staged lesson',
        stageStatus: stage?.status ?? '',
        goalName: skill.name,
        markdown: store.skillLessonMarkdown,
        exists: store.skillLessonExists,
        status: store.skillLessonStatus,
        citations: store.skillLessonCitations,
        loading: store.skillLessonLoading,
        error: store.skillLessonError,
        onBack: store.closeSkillLesson,
        needsConfirm: store.skillLessonNeedsConfirm,
        onBuild: skillId == null
            ? null
            : () => unawaited(store.buildSkillLesson(skillId, stageId)),
        onRebuild: skillId == null
            ? null
            : () => unawaited(_rebuildLesson(store, skillId, stageId)),
        onReplace: skillId == null
            ? null
            : () => unawaited(_replaceLesson(store, skillId, stageId)),
        onRetry: skillId == null ? null : store.retrySkillLesson,
      );
    }

    return SkillDetailView(
      detail: skill,
      loading: store.status == CoreStatus.connecting,
      error: store.error,
      teaching: store.teaching,
      teachingLoading: store.teachingLoading,
      teachingError: store.teachingError,
      teachingVerdict: store.teachingVerdict,
      onMeasure: skillId == null
          ? null
          : () => unawaited(store.measureTeaching(skillId)),
      onNextStep: skillId == null
          ? null
          : () => unawaited(store.teachNextStep(skillId)),
      onOpenStep: skillId == null
          ? null
          : (stepId) => unawaited(store.teachNextStep(skillId, stepId: stepId)),
      onCheck: skillId == null
          ? null
          : (answer, thinking, confidence) => unawaited(
              store.checkTeaching(
                skillId,
                answer,
                thinking: thinking,
                confidence: confidence,
              ),
            ),
      sideMessages: store.teachingSide,
      sideLoading: store.teachingSideLoading,
      sideError: store.teachingSideError,
      onSideOpen: skillId == null
          ? null
          : () {
              final stepId = store.teaching?.current?.stepId;
              if (stepId != null) {
                unawaited(store.openTeachingSide(skillId, stepId));
              }
            },
      onSideSend: skillId == null
          ? null
          : (text) {
              final stepId = store.teaching?.current?.stepId;
              if (stepId != null) {
                unawaited(store.askTeachingSide(skillId, stepId, text));
              }
            },
      onSideClear: skillId == null
          ? null
          : () {
              final stepId = store.teaching?.current?.stepId;
              if (stepId != null) {
                unawaited(store.clearTeachingSide(skillId, stepId));
              }
            },
      research: store.research,
      researchLoading: store.researchLoading,
      researchRunning: store.researchRunning,
      researchError: store.researchError,
      researchMarkdown: store.researchMarkdown,
      researchOpenId: store.researchOpenId,
      onResearch: skillId == null
          ? null
          : (question, urls) =>
                unawaited(store.startResearch(skillId, question, urls)),
      onOpenResearch: skillId == null
          ? null
          : (id) => unawaited(store.openResearch(skillId, id)),
      onCloseResearch: store.closeResearch,
      onPractise: skillId == null
          ? null
          : () => unawaited(store.practiseTeaching(skillId)),
      onPracticeResult: skillId == null
          ? null
          : (problemId, verdict) =>
                unawaited(store.answerPractice(skillId, problemId, verdict)),
      chapterOpen: store.skillChapterOpen,
      chapter: store.activeSkillChapter,
      chapterLoading: store.skillChapterLoading,
      chapterError: store.skillChapterError,
      chats: store.skillChats,
      onBack: store.closeSkill,
      onRetry: () {
        if (skillId != null) unawaited(store.openSkill(skillId));
      },
      onOpenChapter: skillId == null
          ? null
          : (chapterId, {practical = false}) => unawaited(
              store.openSkillChapter(skillId, chapterId, practical: practical),
            ),
      onCloseChapter: store.closeChapter,
      onRetryChapter: store.retrySkillChapter,
      onOpenStage: skillId == null
          ? null
          : (target) => unawaited(store.openSkillLesson(skillId, target)),
      onBuildStage: skillId == null
          ? null
          : (target) => unawaited(store.buildSkillLesson(skillId, target)),
      onOpenChat: skillId == null
          ? null
          : () => unawaited(_openSkillChat(store, skillId)),
      onNewChat: skillId == null
          ? null
          : () => unawaited(_newSkillChat(store, skillId)),
      sources: store.skillSources,
      sourcesLoading: store.skillSourcesLoading,
      sourcesError: store.skillSourcesError,
      onAddSources: skillId == null
          ? null
          : (paths) => store.addSkillSources(skillId, paths),
      onRetrySources: skillId == null
          ? null
          : () => unawaited(store.refreshSkillSources(skillId)),
      onSaveStages: skillId == null
          ? null
          : (stages, {confirmed = false}) =>
                store.saveSkillStages(skillId, stages, confirmed: confirmed),
    );
  }

  /// Start a new transcript for the goal, then open it. A goal keeps many chats,
  /// so this is the only path that gets past the newest one.
  Future<void> _newSkillChat(CoreStore store, String goalId) async {
    final created = await store.createSkillChat(goalId);
    if (!mounted || !created) return;
    // A lesson reader is another layer of the same goal; collapse it so the new
    // chat is what the user sees.
    store.closeSkillLesson();
    refresh(() => _skillChatOpen = true);
  }

  /// Open the goal chat from the page: resume the chat the user last had open,
  /// or let the core pick the newest one. The goal page stays on screen until
  /// the core answers, so a refusal shows its message instead of an empty chat.
  Future<void> _openSkillChat(CoreStore store, String goalId) async {
    final opened = await store.openSkillChat(
      goalId,
      chatId: store.activeSkillChatId,
    );
    if (!mounted || !opened) return;
    refresh(() {
      _skillChatOpen = true;
      // The chat layer reports its own mode; never inherit a stale INSERT.
      _insert = false;
    });
  }

  /// Work is three layers: the registered projects, the open project's detail,
  /// then one of its chats. The shell owns which layer is visible; `Esc` climbs
  /// one layer, so the chat returns to the detail and the detail closes the
  /// project. Switching surfaces collapses the chat but keeps the project open,
  /// exactly like a lock-in session.
}
