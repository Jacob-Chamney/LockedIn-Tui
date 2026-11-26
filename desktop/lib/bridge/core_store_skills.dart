part of 'core_store.dart';

extension CoreStoreSkills on CoreStore {
  Future<void> refreshSkills() async {
    try {
      final json = await _connection.call(CoreMethod.skillList);
      final raw = json['skills'];
      skills = raw is List
          ? raw
                .whereType<Map>()
                .map((row) => SkillRow.fromJson(Map<String, dynamic>.from(row)))
                .toList()
          : const [];
      skillsLoaded = true;
      // A successful read answers the question a previous failure was about.
      // Without this one refused `skill.open` stayed on screen as the list's
      // error until the app restarted.
      error = null;
      notifyListeners();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Open one goal (`skill.open`).
  ///
  /// Failure is reported once through [error], never thrown, and the previous
  /// [activeSkill] survives: a goal whose `meta.json` cannot be read leaves the
  /// user on the goal they already had. Nothing is mutated until the call
  /// succeeds. A reader open on a previous goal is closed with it.
  Future<void> openSkill(String id) async {
    final ticket = ++_skillOpenTicket;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.skillOpen, {'id': id});
    } catch (failure) {
      if (ticket != _skillOpenTicket) return;
      error = _messageOf(failure);
      notifyListeners();
      return;
    }
    // Closed, or another goal chosen, while this one was being read.
    if (ticket != _skillOpenTicket) return;

    final raw = json['skill'];
    final detail = SkillDetail.fromJson(
      raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{},
    );
    final goalId = detail.id.isEmpty ? id : detail.id;
    activeSkill = detail;
    activeSkillId = goalId;
    error = null;
    _clearChapter();
    // A staged lesson belongs to the goal that opened it.
    _clearSkillLesson();
    // A chat belongs to the goal that opened it; the new goal starts on its
    // page with no chat selected.
    activeSkillChatId = null;
    skillChats = const [];
    _clearSkillSources();
    research = const [];
    researchOpenId = null;
    researchMarkdown = null;
    researchError = null;
    unawaited(readResearch(goalId));
    notifyListeners();
    // The saved-chat list is a property of the open goal, so it is read here.
    // A failure is recorded in [error] and the page still renders.
    // Both reads are for the goal captured above; the user may close it
    // between the two awaits, and `activeSkillId!` would then throw.
    await refreshSkillChats(goalId);
    if (ticket != _skillOpenTicket) return;
    // The gathered sources are the goal's citable material, so the detail reads
    // them when it opens. A failure is page-local in [skillSourcesError] and
    // never stops the goal page from rendering.
    await refreshSkillSources(goalId);
  }

  /// Create one goal through `skill.create`, then open it.
  ///
  /// [goal] is what the learner wants to learn and [prior] is optional context;
  /// both are the wizard's values. The core owns the id, the goal folder and the
  /// curriculum, and makes **no provider call**: the plan is the built-in
  /// configured model when available, otherwise the built-in template.
  /// charged here.
  ///
  /// On success the goal rows are refreshed (`skill.list`) and the new course is
  /// opened (`skill.open`), so the shell lands on its index. On failure the
  /// [RpcException] is rethrown untouched, like [createSession]: the wizard
  /// shows the core's own message and stays on Review, so a create refusal is
  /// never mistaken for a transport failure and never reaches [error].
  Future<SkillCreateResult> createSkill({
    required String goal,
    String prior = '',
  }) async {
    final json = await _connection.call(CoreMethod.skillCreate, {
      'goal': goal,
      if (prior.trim().isNotEmpty) 'prior': prior.trim(),
    });
    final result = SkillCreateResult.fromJson(json);
    await refreshSkills();
    await openSkill(result.id);
    return result;
  }

  /// Read one chapter body (`skill.chapter`), the lesson or the practical.
  ///
  /// [chapterId] is an id from the open goal's index, never a path. The reader
  /// opens while the call is in flight and stays open on failure so one message
  /// with a retry is visible; a success replaces [activeSkillChapter] with the
  /// core's own Markdown. This method never throws.
  Future<void> openSkillChapter(
    String id,
    String chapterId, {
    bool practical = false,
  }) async {
    final goalId = id.trim();
    final target = chapterId.trim();
    if (goalId.isEmpty || target.isEmpty) return;
    final ticket = ++_skillChapterTicket;
    activeSkillChapterId = target;
    activeSkillChapterPractical = practical;
    skillChapterLoading = true;
    skillChapterError = null;
    activeSkillChapter = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillChapter, {
        'id': goalId,
        'chapterId': target,
        'practical': practical,
      });
      // The reader was closed, or another chapter (or its other half) was
      // asked for, while this body was being read. Whichever reply lands last
      // must not win.
      if (ticket != _skillChapterTicket) return;
      activeSkillChapter = SkillChapterBody.fromJson(json);
    } catch (failure) {
      if (ticket != _skillChapterTicket) return;
      skillChapterError = _messageOf(failure);
    } finally {
      if (ticket == _skillChapterTicket) {
        skillChapterLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the chapter that last failed, with the same practical flag.
  Future<void> retrySkillChapter() async {
    final goalId = activeSkillId;
    final chapterId = activeSkillChapterId;
    if (goalId == null || chapterId == null) return;
    await openSkillChapter(
      goalId,
      chapterId,
      practical: activeSkillChapterPractical,
    );
  }

  /// Collapse the chapter reader back to the goal page.
  ///
  /// The goal and its index stay open, so reopening a chapter is one key away.
  void closeChapter() {
    if (!skillChapterOpen && activeSkillChapterId == null) return;
    _clearChapter();
    notifyListeners();
  }

  /// Open one curriculum stage's lesson (`skill.lesson.read`).
  ///
  /// [goalId] and [stageId] come from the open goal's `skill.open` index, never
  /// from a path. A stage with no lesson is a **success**: [skillLessonExists]
  /// is false and the reader shows its empty state with a build action. A
  /// failure is recorded once in [skillLessonError] and never thrown, so the
  /// reader stays open with the core's own message and one retry.
  Future<void> openSkillLesson(String goalId, String stageId) async {
    final goal = goalId.trim();
    final stage = stageId.trim();
    if (goal.isEmpty || stage.isEmpty) return;
    final ticket = ++_skillLessonTicket;
    activeSkillStageId = stage;
    _skillLessonRetryBuild = false;
    skillLessonLoading = true;
    skillLessonError = null;
    skillLessonMarkdown = '';
    skillLessonExists = false;
    skillLessonCitations = const [];
    skillLessonStatus = '';
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillLessonRead, {
        'goalId': goal,
        'stageId': stage,
      });
      if (ticket != _skillLessonTicket) return;
      final result = SkillLessonResult.read(json);
      skillLessonMarkdown = result.markdown;
      skillLessonExists = result.exists;
      skillLessonStatus = result.status;
      skillLessonCitations = result.citations;
    } catch (failure) {
      if (ticket != _skillLessonTicket) return;
      skillLessonError = _messageOf(failure);
      skillLessonNeedsConfirm = CoreStore._isConfirmFailure(failure);
    } finally {
      if (ticket == _skillLessonTicket) {
        skillLessonLoading = false;
        notifyListeners();
      }
    }
  }

  /// Build one stage's lesson (`skill.lesson.build`).
  ///
  /// This is one model call and is never retried automatically. On success the
  /// reader replaces its copy from the reply, so the Markdown on screen and the
  /// file on disk agree. A refusal — including the core's `confirm` shape when
  /// the lesson is already `ready` — is recorded once in [skillLessonError] with
  /// the core's own sentence and the previous lesson stays visible: the shell
  /// asks the user before a second attempt, never the store.
  /// Build one stage's lesson.
  ///
  /// [confirmed] is only true after the user agreed to replace an existing
  /// `ready` lesson; without it the core refuses with `kind: "confirm"` and the
  /// file is untouched.
  Future<void> buildSkillLesson(
    String goalId,
    String stageId, {
    bool includeSolution = false,
    bool confirmed = false,
  }) async {
    final goal = goalId.trim();
    final stage = stageId.trim();
    if (goal.isEmpty || stage.isEmpty) return;
    final ticket = ++_skillLessonTicket;
    activeSkillStageId = stage;
    _skillLessonRetryBuild = true;
    skillLessonLoading = true;
    skillLessonError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillLessonBuild, {
        'goalId': goal,
        'stageId': stage,
        if (includeSolution) 'includeSolution': true,
        if (confirmed) 'confirmed': true,
      });
      if (ticket != _skillLessonTicket) return;
      final result = SkillLessonResult.build(json);
      skillLessonNeedsConfirm = false;
      skillLessonMarkdown = result.markdown;
      skillLessonExists = result.exists;
      skillLessonStatus = result.status;
      skillLessonCitations = result.citations;
    } catch (failure) {
      if (ticket != _skillLessonTicket) return;
      skillLessonError = _messageOf(failure);
      // A `confirm` refusal is a decision, not a failure: the view asks by name
      // instead of offering a Retry that would be refused again.
      skillLessonNeedsConfirm = CoreStore._isConfirmFailure(failure);
    } finally {
      if (ticket == _skillLessonTicket) {
        skillLessonLoading = false;
        notifyListeners();
      }
    }
  }

  /// Repeat the lesson request that failed: a build after `b`, a read otherwise.
  Future<void> retrySkillLesson() async {
    final goalId = activeSkillId;
    final stageId = activeSkillStageId;
    if (goalId == null || stageId == null) return;
    // A retry is the user repeating a request they have already seen refused.
    // Without `confirmed` a `ready` lesson refuses identically every time, which
    // is what made this button dead.
    if (_skillLessonRetryBuild) {
      await buildSkillLesson(
        goalId,
        stageId,
        confirmed: skillLessonNeedsConfirm,
      );
    } else {
      await openSkillLesson(goalId, stageId);
    }
  }

  /// Collapse the lesson reader back to the goal page.
  ///
  /// The goal and its stage index stay open, so reopening a lesson is one key
  /// away.
  void closeSkillLesson() {
    if (!skillLessonOpen) return;
    _clearSkillLesson();
    notifyListeners();
  }

  void _clearSkillLesson() {
    _skillLessonTicket += 1;
    activeSkillStageId = null;
    skillLessonMarkdown = '';
    skillLessonExists = false;
    skillLessonCitations = const [];
    skillLessonStatus = '';
    skillLessonLoading = false;
    skillLessonError = null;
    skillLessonNeedsConfirm = false;
    _skillLessonRetryBuild = false;
  }

  /// Leave the Skills surface for the goal list.
  ///
  /// The goal, its chapter reader and its chat go with it; reopening the goal
  /// reads its index and chats again. The cached rows in [skills] stay so the
  /// list does not flash.
  void closeSkill() {
    // An open still in flight is abandoned even when nothing is open yet.
    _skillOpenTicket += 1;
    // The clears run before this check: an early return used to leave
    // `skillLessonOpen` set forever once the goal itself was gone (after a
    // reconnect, say), and no later call could close the layer.
    final hadGoal = activeSkill != null || activeSkillId != null;
    _clearSkillLesson();
    _clearSkillSources();
    _clearChapter();
    teaching = null;
    teachingError = null;
    teachingLoading = false;
    teachingVerdict = null;
    _teachingTicket += 1;
    skillChats = const [];
    if (!hadGoal) {
      notifyListeners();
      return;
    }
    activeSkill = null;
    activeSkillId = null;
    activeSkillChatId = null;
    notifyListeners();
  }

  /// Save one goal's whole curriculum, in order (`skill.stages.save`).
  ///
  /// [stages] is the complete list the editor holds: the core assigns an id to
  /// a stage whose [SkillStage.id] is empty, keeps every existing status by id
  /// and stores the order it was given. [confirmed] is only true for removing a
  /// `done` stage, whose finished progress the core refuses to drop otherwise.
  ///
  /// The reply is the stored list, so the open goal's stages are replaced from
  /// it and listeners repaint from the core's answer, never from a local guess.
  /// A refusal rethrows the [RpcException] untouched and leaves [activeSkill]
  /// and the previous order alone, so the page shows the core's own sentence
  /// inline. Nothing is written on the shell's side.
  Future<SkillStageSaveResult> saveSkillStages(
    String goalId,
    List<SkillStage> stages, {
    bool confirmed = false,
  }) async {
    final json = await _connection.call(CoreMethod.skillStagesSave, {
      'goalId': goalId,
      // A new stage must **omit** `id`: the core treats a present id as "this
      // stage already exists" and refuses a blank one, so sending `id: ""`
      // made adding the first stage impossible.
      'stages': [
        for (final stage in stages)
          {
            if (stage.id.isNotEmpty) 'id': stage.id,
            'title': stage.title,
            if (stage.milestone != null && stage.milestone!.isNotEmpty)
              'milestone': stage.milestone,
          },
      ],
      if (confirmed) 'confirmed': true,
    });
    // A reply without `stages` would blank the curriculum, so the request's own
    // order is kept in that case rather than inventing an empty goal.
    final result = json['stages'] is List
        ? SkillStageSaveResult.fromJson(json)
        : SkillStageSaveResult(stages: stages);
    final current = activeSkill;
    if (current != null && activeSkillId == goalId) {
      activeSkill = SkillDetail(
        id: current.id,
        name: current.name,
        goal: current.goal,
        prior: current.prior,
        created: current.created,
        plan: current.plan,
        chapters: current.chapters,
        chats: current.chats,
        stages: result.stages,
      );
      notifyListeners();
    }
    return result;
  }

  /// Archive one goal (`skill.archive`), moving its folder to the configured
  /// archive.
  ///
  /// The destination is configuration, never a parameter, so the core refuses
  /// with one actionable sentence when no backend is usable. A refusal rethrows
  /// the [RpcException] untouched and leaves the row in place. On success the
  /// row is dropped, an open goal with the same id is closed with its chapter,
  /// lesson, source and chat projections, and the list is re-read. The reply is
  /// the backend that took the folder, or null when the core did not name one.
  Future<String?> archiveSkill(String id) async {
    final json = await _connection.call(CoreMethod.skillArchive, {
      'goalId': id,
    });
    final outcome = SkillActionOutcome.fromJson(json);
    await _afterSkillGone(id);
    return outcome.backend;
  }

  /// Delete one goal's folder (`skill.remove`).
  ///
  /// The shell has already asked; this executes the confirmed delete. The goal
  /// folder and its lessons go; no archived copy of the same id is touched, so
  /// an archive still restores later. A refusal rethrows the [RpcException] for
  /// the page's inline message and leaves the row and open goal in place.
  Future<void> removeSkill(String id) async {
    await _connection.call(CoreMethod.skillRemove, {'goalId': id});
    await _afterSkillGone(id);
  }

  /// Export one goal as a zip (`skill.export`).
  ///
  /// There is no destination parameter: the core writes the zip itself and
  /// returns that path, so the shell cannot point an export at a folder the core
  /// does not own. The live goal is untouched, so a second export is safe. A
  /// refusal rethrows the [RpcException] for the page's inline message; the reply
  /// is the zip path, or null when the core did not name one. The list is
  /// re-read so any change the core made is visible.
  Future<String?> exportSkill(String id) async {
    final json = await _connection.call(CoreMethod.skillExport, {'goalId': id});
    final outcome = SkillActionOutcome.fromJson(json);
    await refreshSkills();
    return outcome.path;
  }

  /// Apply one confirmed archive/delete to the shell's projection.
  ///
  /// The core confirmed the folder moved or was deleted, so the row is no longer
  /// live. Dropping it before the re-read keeps the list honest even if the read
  /// fails, and closing the matching open goal releases the chapter, lesson,
  /// source and chat projections instead of leaving a detail for a folder that
  /// is gone.
  Future<void> _afterSkillGone(String id) async {
    skills = skills.where((row) => row.id != id).toList();
    if (activeSkillId == id || activeSkill?.id == id) closeSkill();
    notifyListeners();
    await refreshSkills();
  }

  /// Read the open goal's saved chats (`skill.chat.list`).
  ///
  /// Failure is recorded once in [error] and the previous [skillChats] list
  /// stays: a broken read never invents "this goal has no chats".
  Future<void> refreshSkillChats(String goalId) async {
    try {
      final json = await _connection.call(CoreMethod.skillChatList, {
        'goalId': goalId,
      });
      if (activeSkillId != null && activeSkillId != goalId) return;
      final raw = json['chats'];
      skillChats = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      SkillChatRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      notifyListeners();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the open goal's gathered sources (`skill.sources.list`).
  ///
  /// [goalId] is a goal folder name, never a path. The rows are copies inside
  /// that goal's `sources/`, so this is the only material a goal chat may cite;
  /// the shell renders them read-only and never joins [SkillSourceRow.storedPath]
  /// against a path of its own.
  ///
  /// A failure is recorded once in [skillSourcesError] and the previous rows
  /// stay: a broken read never invents "this goal has no sources". The method
  /// never throws, so the page shows the core's own message with a Retry. An
  /// answer for a goal the user has already left is dropped, and a newer request
  /// supersedes an older one.
  Future<void> refreshSkillSources(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return;
    final ticket = ++_skillSourcesTicket;
    skillSourcesLoading = true;
    skillSourcesError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillSourcesList, {
        'goalId': id,
      });
      if (ticket != _skillSourcesTicket) return;
      if (activeSkillId != null && activeSkillId != id) return;
      final raw = json['sources'];
      skillSources = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      SkillSourceRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
    } catch (failure) {
      if (ticket != _skillSourcesTicket) return;
      if (activeSkillId != null && activeSkillId != id) return;
      skillSourcesError = _messageOf(failure);
    } finally {
      if (ticket == _skillSourcesTicket) {
        skillSourcesLoading = false;
        notifyListeners();
      }
    }
  }

  /// Gather user-picked files into one goal (`skill.sources.add`).
  ///
  /// [paths] are files the **user picked**, never destinations: the core copies
  /// each into the goal's `sources/`, extracts its text, saves an excerpt and
  /// records it in `meta.json` in one service call, so the shell cannot name a
  /// write target. Identical bytes are stored once, so a repeat add counts in
  /// [SourceAddResult.skipped] and adds no row. The originals are never moved or
  /// deleted.
  ///
  /// Failure rethrows the [RpcException] untouched and leaves [skillSources]
  /// alone, so the page shows the core's own sentence inline (the same pattern
  /// as [addSources]). On success the list is re-read, so a copy is never
  /// reported as added while the rows still lack it.
  Future<SourceAddResult> addSkillSources(
    String goalId,
    List<String> paths,
  ) async {
    final json = await _connection.call(CoreMethod.skillSourcesAdd, {
      'goalId': goalId,
      'files': paths,
    });
    final result = SourceAddResult.fromJson(json);
    // The add succeeded, so an older list failure no longer describes the state.
    skillSourcesError = null;
    await refreshSkillSources(goalId);
    return result;
  }

  /// Drop the goal-source projection and any in-flight answer for it.
  void _clearSkillSources() {
    _skillSourcesTicket += 1;
    skillSources = const [];
    skillSourcesLoading = false;
    skillSourcesError = null;
  }

  /// Open one goal chat (`skill.chat.open`).
  ///
  /// An omitted [chatId] resumes the newest chat, or starts the goal's first one
  /// — the core decides. On success the snapshot is cached under
  /// `<goalId>:<chatId>` and that chat becomes [activeSkillChatId]. Failure is
  /// reported once through [error], never thrown, and the previous chat and its
  /// snapshot survive, so a refusal cannot blank a transcript. Returns whether
  /// the chat is open.
}
