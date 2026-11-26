import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/errors.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../shell/chrome.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../../theme/tokens.dart';
import '../chat/markdown.dart';
import '../chat/transcript_scroll.dart';
import '../shared/cards.dart';
import 'teaching_rows.dart';
import 'skill_widgets.dart';

part 'skill_cards.dart';

/// Returns the files the user chose, or an empty list when they cancelled.
typedef SkillSourcePicker = Future<List<String>> Function();

/// One goal's course index, then one chapter of it.
///
/// The shell owns the store: it opens the goal through `skill.open`, asks for a
/// chapter through `skill.chapter` and passes the result in. This page reads no
/// files and calls no core method, so a missing chapter is always the core's
/// answer and every state explains its own next step.
class SkillDetailView extends StatefulWidget {
  const SkillDetailView({
    super.key,
    required this.detail,
    this.loading = false,
    this.error,
    this.onBack,
    this.onRetry,
    this.onOpenChapter,
    this.chapterOpen = false,
    this.chapter,
    this.chapterLoading = false,
    this.chapterError,
    this.onCloseChapter,
    this.onRetryChapter,
    this.chats,
    this.onOpenChat,
    this.onNewChat,
    this.sources = const [],
    this.sourcesLoading = false,
    this.sourcesError,
    this.onAddSources,
    this.onRetrySources,
    this.pickFiles,
    this.onOpenStage,
    this.onBuildStage,
    this.teaching,
    this.teachingLoading = false,
    this.teachingError,
    this.teachingVerdict,
    this.onMeasure,
    this.onNextStep,
    this.onOpenStep,
    this.onCheck,
    this.sideMessages = const [],
    this.sideLoading = false,
    this.sideError,
    this.onSideOpen,
    this.onSideSend,
    this.onSideClear,
    this.research = const [],
    this.researchLoading = false,
    this.researchRunning = false,
    this.researchError,
    this.researchMarkdown,
    this.researchOpenId,
    this.onResearch,
    this.onOpenResearch,
    this.onCloseResearch,
    this.onPractise,
    this.onPracticeResult,
    this.onSaveStages,
  });

  /// The core's `skill.open` projection.
  final SkillDetail detail;

  /// True while the shell is opening or refreshing the goal.
  final bool loading;

  /// One readable failure from the shell, shown beside a retry. It never
  /// replaces a goal the shell already has.
  final String? error;

  /// `Esc` on the goal page returns to the list.
  final VoidCallback? onBack;
  final VoidCallback? onRetry;

  /// Ask the shell for a chapter body. [practical] selects the exercise instead
  /// of the lesson; null keeps the index read-only and hides the chapter action.
  final void Function(String chapterId, {bool practical})? onOpenChapter;

  /// True when the chapter reader is the visible layer.
  final bool chapterOpen;

  /// The chapter body the shell's `skill.chapter` returned.
  final SkillChapterBody? chapter;
  final bool chapterLoading;

  /// One readable chapter failure, shown inside the reader with a retry.
  final String? chapterError;
  final VoidCallback? onCloseChapter;
  final VoidCallback? onRetryChapter;

  /// The open goal's saved chats from `skill.chat.list`. Null falls back to the
  /// index's own list (`skill.open`), which is what a bare page test renders.
  final List<SkillChatRow>? chats;

  /// Open the goal chat (the newest one, or the goal's first). Null keeps the
  /// card read-only and hides the action.
  final VoidCallback? onOpenChat;

  /// Start a **new** chat for this goal. A goal keeps many transcripts, so
  /// opening always resumes the newest; this is the only way past `chat-1`.
  final VoidCallback? onNewChat;

  /// The open goal's gathered, citable sources (`skill.sources.list`).
  ///
  /// A skill source is a copy inside the goal folder, so a row carries no
  /// absolute original path; the card shows the name, the kind and the saved
  /// excerpt. Empty is a real state: the card teaches the add action.
  final List<SkillSourceRow> sources;

  /// True while the shell is reading the goal's sources.
  final bool sourcesLoading;

  /// One readable list failure from the shell, shown inside the card with a
  /// retry. It never replaces the rows the shell already has.
  final String? sourcesError;

  /// Gather the chosen paths through `skill.sources.add`. It throws an
  /// [RpcException] on failure; the page shows that message inline and keeps its
  /// rows. Null keeps the card read-only and hides the add action.
  final Future<SourceAddResult> Function(List<String> paths)? onAddSources;

  /// Re-read the goal's sources. The store refreshes on its own after an add, so
  /// this is the explicit retry beside a failed read.
  final VoidCallback? onRetrySources;

  /// Test seam: a scripted picker. Production leaves it null and the platform
  /// file dialog is used.
  final SkillSourcePicker? pickFiles;

  /// Open one curriculum stage's lesson reader. [stageId] is an id from
  /// [SkillDetail.stages]; null keeps the stage card read-only and hides the
  /// action. A stage with no lesson still opens: the reader's empty state offers
  /// the build.
  final void Function(String stageId)? onOpenStage;

  /// Build one curriculum stage's lesson as a draft (`skill.lesson.build`).
  /// Null keeps the stage card read-only and hides the build action.
  final void Function(String stageId)? onBuildStage;

  /// The teaching record from the core (`teach.state`), or null before a read.
  final TeachingState? teaching;

  /// True while a `teach.*` call is in flight.
  final bool teachingLoading;

  /// The last teaching failure; shown beside the measure card.
  final String? teachingError;

  /// The verdict card for the last answer.
  final TeachingCheckResult? teachingVerdict;

  /// Measure the learner and plan the route (`teach.measure`).
  final VoidCallback? onMeasure;

  /// Open the next step (`teach.step`).
  final VoidCallback? onNextStep;

  /// Open one named step, so a learner can choose between unlocked branches.
  final void Function(String stepId)? onOpenStep;

  /// Answer the open step (`teach.check`).
  ///
  /// The second and third values are the learner's optional reasoning and
  /// self-reported confidence (0 = not given). They travel with the answer so
  /// the marker sees *how* the learner thought, not only whether they landed.
  final void Function(String answer, String thinking, int confidence)? onCheck;

  /// The open step's side thread, newest last (`teach.side.snapshot`).
  final List<TeachingSideMessage> sideMessages;

  /// True while a side read or question is in flight.
  final bool sideLoading;

  /// The last side failure, shown inside the panel.
  final String? sideError;

  /// Load the open step's thread when the panel opens.
  final VoidCallback? onSideOpen;

  /// Ask one side question (`teach.side.send`).
  final void Function(String text)? onSideSend;

  /// Clear the step's thread (`teach.side.clear`).
  final VoidCallback? onSideClear;

  /// Saved research briefs for this goal.
  final List<ResearchItem> research;
  final bool researchLoading;
  final bool researchRunning;
  final String? researchError;
  final String? researchMarkdown;
  final String? researchOpenId;

  /// Start one brief: `(question, urls)`.
  final void Function(String question, List<String> urls)? onResearch;
  final void Function(String id)? onOpenResearch;
  final VoidCallback? onCloseResearch;

  /// Build a practice set (`teach.practice`).
  final VoidCallback? onPractise;

  /// Record one practice verdict: `(problemId, 'solved' | 'missed')`.
  final void Function(String problemId, String verdict)? onPracticeResult;

  /// Save the whole curriculum in order (`skill.stages.save`).
  ///
  /// [stages] is the complete list the editor holds, so a reorder, a rename, an
  /// add and a remove are all one request. [confirmed] is true only when the
  /// removal drops a `done` stage, whose finished progress the core would
  /// otherwise refuse to lose.
  ///
  /// The reply replaces the visible stages and a failure rethrows the
  /// [RpcException] for the card's inline message, leaving the previous order in
  /// place. Null keeps the card read-only and hides `e`.
  final Future<SkillStageSaveResult> Function(
    List<SkillStage> stages, {
    bool confirmed,
  })?
  onSaveStages;

  @override
  State<SkillDetailView> createState() => _SkillDetailViewState();
}

class _SkillDetailViewState extends State<SkillDetailView> {
  /// Rebuild the page from a card extracted out of this file.
  ///
  /// `setState` is protected, so a card that lives in the part file cannot call
  /// it directly; this is the one door it uses, and it is exactly `setState`.
  void refresh(VoidCallback fn) => setState(fn);

  /// The chapter reader's scroll position.
  final _chapterScroll = ScrollController();

  @override
  void initState() {
    super.initState();
    // Enter submits; Esc hands the keyboard back to the page. Without this a
    // focus in the answer field made the teaching loop's keys unreachable.
    _answerFocus.onKeyEvent = (node, event) {
      if (event is! KeyDownEvent) return KeyEventResult.ignored;
      if (event.logicalKey == LogicalKeyboardKey.escape) {
        _pageFocus.requestFocus();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    };
  }

  @override
  void dispose() {
    _chapterScroll.dispose();
    _sectionsScroll.dispose();
    _answer.dispose();
    _answerFocus.dispose();
    _pageFocus.dispose();
    _thinking.dispose();
    _sideInput.dispose();
    _researchQuestion.dispose();
    _researchSources.dispose();
    super.dispose();
  }

  static const _selectedChapterKey = ValueKey('skill-chapter-selected');
  static const _selectedStageKey = ValueKey('skill-stage-selected');

  final _chapterKeys = <String, GlobalKey>{};
  var _selectedChapter = 0;
  final _stageKeys = <String, GlobalKey>{};
  var _selectedStage = 0;

  /// One inline reason (a chapter without a practical, a failed read that the
  /// shell did not own). It never replaces the goal page.
  String? _notice;

  /// Which phase the rail marks as current (the one last navigated to).
  Phase _phase = Phase.teach;

  /// The context tab under the learning surface. Sources is the default: the
  /// material every lesson and check is built from. Goal metadata, chats and
  /// research sit behind the other tabs instead of stacking under the lesson.
  int _contextTab = 0;

  /// One key per phase section, so the rail can scroll to it and tests can
  /// assert where the navigation landed.
  final _planKey = GlobalKey(debugLabel: 'phase-plan');
  final _stagesKey = GlobalKey(debugLabel: 'phase-stages');
  final _teachKey = GlobalKey(debugLabel: 'phase-teach');
  final _practiceKey = GlobalKey(debugLabel: 'phase-practice');

  /// The course chapter list: content, not a phase anchor (a course's `teach`
  /// phase scrolls to the teaching loop).
  final _courseKey = GlobalKey(debugLabel: 'course-list');

  /// The scroll the four sections live in.
  final _sectionsScroll = ScrollController();

  /// Where the keyboard rests in NORMAL mode. `Esc` in a check field returns
  /// here, so the teaching keys are never dead behind a text field.
  final _pageFocus = FocusNode(debugLabel: 'skill-page');

  /// The answer to the open step's check.
  final _answer = TextEditingController();
  final _answerFocus = FocusNode(debugLabel: 'teach-answer');

  /// The learner's own reasoning, optional. Never judged as the answer.
  final _thinking = TextEditingController();

  /// Self-reported confidence, 1–5; 0 means "not given".
  int _confidence = 0;

  /// True while the side-question panel is open. It is a layer inside the step
  /// card, so the lesson stays visible and Esc returns to the step.
  bool _sideOpen = false;

  /// The side question being typed.
  final _sideInput = TextEditingController();

  /// The research question and its source URLs.
  final _researchQuestion = TextEditingController();
  final _researchSources = TextEditingController();
  String? _researchNotice;

  /// True while a file pick or a `skill.sources.add` is in flight.
  var _sourcesBusy = false;

  /// The outcome of the last add (`added N · skipped M`, `already gathered`).
  String? _sourcesNotice;

  /// The last pick or add failure, shown beside the sources card.
  String? _sourcesFailure;

  /// True while the curriculum stage list has the keyboard (the `e` mode).
  var _editingStages = false;

  /// True while a `skill.stages.save` is in flight. The list shows a progress
  /// line and every other edit key is ignored until the core answers.
  var _stagesBusy = false;

  /// The last stage-save refusal, shown inside the stages card. A page-local
  /// refusal never replaces the goal page.
  String? _stagesFailure;

  /// The stages the core last stored from this editor, or null to use the ones
  /// the shell opened the goal with. Only a successful reply sets it, so a
  /// refusal keeps the previous order exactly as it was.
  List<SkillStage>? _stageEdit;

  List<SkillChapter> get _chapters => widget.detail.chapters;

  List<SkillStage> get _stages => _stageEdit ?? widget.detail.stages;

  int get _selected =>
      _chapters.isEmpty ? -1 : _selectedChapter.clamp(0, _chapters.length - 1);

  SkillChapter? get _selectedRow {
    final index = _selected;
    return index < 0 ? null : _chapters[index];
  }

  int get _stageIndex =>
      _stages.isEmpty ? -1 : _selectedStage.clamp(0, _stages.length - 1);

  SkillStage? get _selectedStageRow {
    final index = _stageIndex;
    return index < 0 ? null : _stages[index];
  }

  @override
  void didUpdateWidget(SkillDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A side thread belongs to one step; moving on closes it.
    if (oldWidget.teaching?.current?.stepId !=
        widget.teaching?.current?.stepId) {
      _sideOpen = false;
      _sideInput.clear();
    }
    if (oldWidget.detail.id != widget.detail.id) {
      _selectedChapter = 0;
      _selectedStage = 0;
      _notice = null;
      _sourcesBusy = false;
      _sourcesNotice = null;
      _sourcesFailure = null;
      _editingStages = false;
      _stagesBusy = false;
      _stagesFailure = null;
      _stageEdit = null;
      return;
    }
    // The store's copy of the curriculum wins: a reopen, a review mark or a
    // fresh `skill.open` that changed the stages clears this page's echo.
    if (!_sameStages(oldWidget.detail.stages, widget.detail.stages)) {
      _stageEdit = null;
    }
  }

  /// True when two stage lists carry the same ids, titles, statuses and
  /// milestones in the same order.
  static bool _sameStages(List<SkillStage> left, List<SkillStage> right) {
    if (left.length != right.length) return false;
    for (var index = 0; index < left.length; index++) {
      final a = left[index];
      final b = right[index];
      if (a.id != b.id ||
          a.title != b.title ||
          a.status != b.status ||
          a.milestone != b.milestone) {
        return false;
      }
    }
    return true;
  }

  /// The default picker opens the platform file dialog and returns absolute
  /// paths only. A build with no dialog (a headless run, or a widget test that
  /// did not inject [SkillDetailView.pickFiles]) falls back to a typed path
  /// dialog, so the action is never dead and the shell still never reads a file.
  Future<List<String>> _defaultPickFiles() async {
    try {
      final files = await openFiles();
      return [
        for (final file in files)
          if (file.path.trim().isNotEmpty) file.path,
      ];
    } on MissingPluginException {
      if (!mounted) return const [];
      return _askForPaths();
    } on UnimplementedError {
      if (!mounted) return const [];
      return _askForPaths();
    }
  }

  Future<List<String>> _askForPaths() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('add a source file'),
        content: SizedBox(
          width: 480,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'This build has no native file dialog. Paste the absolute path '
                'of a file a lesson or chat may cite; the core copies it into '
                'this goal and the original is never moved.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('skill-sources-path-field'),
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: '/home/you/notes/intel-sdm.md',
                ),
                onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('skill-sources-path-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (text == null) return const [];
    return [
      for (final line in text.split('\n'))
        if (line.trim().isNotEmpty) line.trim(),
    ];
  }

  Future<void> _addSources() async {
    final onAdd = widget.onAddSources;
    if (onAdd == null || _sourcesBusy) return;
    final pick = widget.pickFiles ?? _defaultPickFiles;

    final List<String> paths;
    try {
      paths = await pick();
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _sourcesNotice = null;
        _sourcesFailure = userMessage(failure);
      });
      return;
    }
    if (paths.isEmpty || !mounted) return;

    setState(() {
      _sourcesBusy = true;
      _sourcesNotice = null;
      _sourcesFailure = null;
    });
    try {
      final result = await onAdd(paths);
      if (!mounted) return;
      setState(() {
        _sourcesBusy = false;
        _sourcesNotice = _sourceFeedback(result);
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _sourcesBusy = false;
        _sourcesFailure = userMessage(failure);
      });
    }
  }

  /// The core's counts are the answer: never a local guess at what was stored.
  String _sourceFeedback(SourceAddResult result) {
    if (result.added > 0) {
      return 'added ${result.added} · skipped ${result.skipped}';
    }
    if (result.skipped > 0) return 'already gathered';
    return 'nothing added';
  }

  GlobalKey _chapterKey(String id) => _chapterKeys.putIfAbsent(
    id,
    () => GlobalKey(debugLabel: 'skill-chapter-$id'),
  );

  GlobalKey _stageKey(String id) => _stageKeys.putIfAbsent(
    id,
    () => GlobalKey(debugLabel: 'skill-stage-$id'),
  );

  void _move(int delta) {
    if (_chapters.length < 2) return;
    final current = _selected;
    final next = (current + delta).clamp(0, _chapters.length - 1);
    if (next == current) return;
    setState(() {
      _selectedChapter = next;
      _notice = null;
    });
    final id = _chapters[next].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _chapterKeys[id]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  void _moveStage(int delta) {
    if (_stages.length < 2) return;
    final current = _stageIndex;
    final next = (current + delta).clamp(0, _stages.length - 1);
    if (next == current) return;
    setState(() {
      _selectedStage = next;
      _notice = null;
    });
    final id = _stages[next].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _stageKeys[id]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  /// Open the selected stage's lesson. A stage with no lesson opens the reader's
  /// empty state, which offers the build, so the key is never dead.
  void _openStage() {
    final open = widget.onOpenStage;
    final stage = _selectedStageRow;
    if (open == null || stage == null) return;
    setState(() => _notice = null);
    open(stage.id);
  }

  /// Build the selected stage's lesson as a draft.
  void _buildStage() {
    final build = widget.onBuildStage;
    final stage = _selectedStageRow;
    if (build == null || stage == null) return;
    setState(() => _notice = null);
    build(stage.id);
  }

  /// Enter the curriculum editor. Read-only when the store has no writer.
  void _enterStageEdit() {
    if (widget.onSaveStages == null) return;
    setState(() {
      _editingStages = true;
      _stagesFailure = null;
      _notice = null;
    });
  }

  /// Leave the curriculum editor. The stored curriculum stays on screen.
  void _leaveStageEdit() {
    if (!_editingStages) return;
    setState(() {
      _editingStages = false;
      _stagesFailure = null;
    });
  }

  /// Send the whole list in order and adopt the core's reply.
  ///
  /// Nothing is applied locally before the core answers, so a refusal keeps the
  /// previous order and shows the core's own sentence. [cursor] moves the
  /// selection to the stage the edit acted on.
  Future<void> _saveStages(
    List<SkillStage> next, {
    bool confirmed = false,
    int? cursor,
  }) async {
    final save = widget.onSaveStages;
    if (save == null || _stagesBusy) return;
    setState(() {
      _stagesBusy = true;
      _stagesFailure = null;
    });
    try {
      final result = await save(next, confirmed: confirmed);
      if (!mounted) return;
      setState(() {
        _stagesBusy = false;
        _stageEdit = result.stages;
        final last = result.stages.isEmpty ? 0 : result.stages.length - 1;
        _selectedStage = (cursor ?? _selectedStage).clamp(0, last);
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _stagesBusy = false;
        _stagesFailure = userMessage(failure);
      });
    }
  }

  /// Add one stage at the end with a small title/milestone prompt.
  Future<void> _addStage() async {
    if (widget.onSaveStages == null || _stagesBusy) return;
    final value = await _askStage(
      dialogTitle: 'add a stage',
      confirmLabel: 'Add',
      fieldKeyPrefix: 'skill-stage-add',
    );
    if (value == null || !mounted) return;
    final next = [
      ..._stages,
      SkillStage(
        // An empty id asks the core to assign one; the reply names it.
        id: '',
        title: value.title,
        status: 'pending',
        milestone: value.milestone,
      ),
    ];
    await _saveStages(next, cursor: next.length - 1);
  }

  /// Rename the selected stage, keeping its id and status.
  Future<void> _renameStage() async {
    final index = _stageIndex;
    if (widget.onSaveStages == null || _stagesBusy || index < 0) return;
    final stage = _stages[index];
    final value = await _askStage(
      dialogTitle: 'rename stage',
      confirmLabel: 'Rename',
      fieldKeyPrefix: 'skill-stage-rename',
      initialTitle: stage.title,
      initialMilestone: stage.milestone ?? '',
    );
    if (value == null || !mounted) return;
    final next = [..._stages];
    next[index] = SkillStage(
      id: stage.id,
      title: value.title,
      status: stage.status,
      milestone: value.milestone,
    );
    await _saveStages(next);
  }

  /// Remove the selected stage after a named confirmation.
  ///
  /// Removing a `done` stage loses its finished progress, so the confirmation
  /// says so and the save carries `confirmed: true`; the core refuses that
  /// removal otherwise.
  Future<void> _removeStage() async {
    final index = _stageIndex;
    if (widget.onSaveStages == null || _stagesBusy || index < 0) return;
    final stage = _stages[index];
    final confirmed = await confirmSkillStageRemove(
      context,
      title: stage.title.isEmpty ? 'untitled stage' : stage.title,
      done: stage.done,
    );
    if (!confirmed || !mounted) return;
    final next = [..._stages]..removeAt(index);
    await _saveStages(
      next,
      confirmed: stage.done,
      cursor: index >= next.length ? next.length - 1 : index,
    );
  }

  /// Move the selected stage one place up (-1) or down (1).
  Future<void> _moveStageOrder(int delta) async {
    final index = _stageIndex;
    if (widget.onSaveStages == null || _stagesBusy || index < 0) return;
    final target = index + delta;
    if (target < 0 || target >= _stages.length) return;
    final next = [..._stages];
    final moved = next.removeAt(index);
    next.insert(target, moved);
    await _saveStages(next, cursor: target);
  }

  /// The small title/milestone prompt the add and rename actions share.
  Future<({String title, String? milestone})?> _askStage({
    required String dialogTitle,
    required String confirmLabel,
    required String fieldKeyPrefix,
    String initialTitle = '',
    String initialMilestone = '',
  }) {
    return showDialog<({String title, String? milestone})>(
      context: context,
      builder: (dialogContext) => StagePromptDialog(
        dialogTitle: dialogTitle,
        confirmLabel: confirmLabel,
        fieldKeyPrefix: fieldKeyPrefix,
        initialTitle: initialTitle,
        initialMilestone: initialMilestone,
      ),
    );
  }

  void _openChapter({bool practical = false}) {
    final open = widget.onOpenChapter;
    final chapter = _selectedRow;
    if (open == null || chapter == null) return;
    if (practical && !chapter.hasPractical) {
      setState(() => _notice = 'this chapter has no practical');
      return;
    }
    setState(() => _notice = null);
    open(chapter.id, practical: practical);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;

    // The reader is one layer above the goal page: `Esc` closes it, and the
    // scroll keys move the text. Everything else is left to the shell, so the
    // leader and `?` keep working while a chapter is open.
    if (widget.chapterOpen) {
      if (key == LogicalKeyboardKey.escape) {
        if (widget.onCloseChapter == null) return KeyEventResult.ignored;
        widget.onCloseChapter!();
        return KeyEventResult.handled;
      }
      final scrolled = scrollKey(_chapterScroll, event);
      if (scrolled != null) return scrolled;
      return KeyEventResult.ignored;
    }

    // The curriculum editor is a mode of its own: it owns every unmodified key,
    // so `Esc` leaves the mode (not the goal), and `Enter`/`l` (open lesson) and
    // `b` (build) cannot fire while editing.
    if (_editingStages) {
      if (key == LogicalKeyboardKey.escape ||
          key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter) {
        if (event is KeyDownEvent) _leaveStageEdit();
        return KeyEventResult.handled;
      }
      if (HardwareKeyboard.instance.isControlPressed ||
          HardwareKeyboard.instance.isMetaPressed) {
        return KeyEventResult.ignored;
      }
      final shift = HardwareKeyboard.instance.isShiftPressed;
      if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
        if (shift) {
          if (event is KeyDownEvent) unawaited(_moveStageOrder(-1));
        } else {
          _moveStage(-1);
        }
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.arrowDown ||
          key == LogicalKeyboardKey.keyJ) {
        if (shift) {
          if (event is KeyDownEvent) unawaited(_moveStageOrder(1));
        } else {
          _moveStage(1);
        }
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyA && !_stagesBusy) {
        if (event is KeyDownEvent) unawaited(_addStage());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyR && !_stagesBusy) {
        if (event is KeyDownEvent) unawaited(_renameStage());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyD && !_stagesBusy) {
        if (event is KeyDownEvent) unawaited(_removeStage());
        return KeyEventResult.handled;
      }
      // Anything else (Space for the leader, `?`, `:`) belongs to the shell:
      // this mode owns its letters, not the whole keyboard.
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.escape) {
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    // The four phases are one press each, so the rail is reachable without a
    // pointer. They are bare digits, not leader chords: the rail is the page's
    // own map and this page has no other digit action.
    final phaseKey = switch (key) {
      LogicalKeyboardKey.digit1 || LogicalKeyboardKey.numpad1 => Phase.measure,
      LogicalKeyboardKey.digit2 || LogicalKeyboardKey.numpad2 => Phase.plan,
      LogicalKeyboardKey.digit3 || LogicalKeyboardKey.numpad3 => Phase.teach,
      LogicalKeyboardKey.digit4 || LogicalKeyboardKey.numpad4 => Phase.practice,
      _ => null,
    };
    if (phaseKey != null) {
      if (event is KeyDownEvent) _gotoPhase(phaseKey);
      return KeyEventResult.handled;
    }
    // The teaching loop's own keys. They exist only when the core has a
    // teaching record, so a course/stage goal keeps its old grammar.
    final teaching = widget.teaching;
    if (teaching != null) {
      final measured = teaching.measured;
      if (key == LogicalKeyboardKey.keyM &&
          !measured &&
          widget.onMeasure != null &&
          !widget.teachingLoading) {
        if (event is KeyDownEvent) widget.onMeasure!();
        return KeyEventResult.handled;
      }
      if (measured) {
        if (key == LogicalKeyboardKey.keyN &&
            widget.onNextStep != null &&
            !widget.teachingLoading) {
          if (event is KeyDownEvent) widget.onNextStep!();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.keyI && teaching.current != null) {
          if (event is KeyDownEvent) _answerFocus.requestFocus();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.keyS &&
            teaching.current != null &&
            widget.onSideSend != null) {
          if (event is KeyDownEvent) _toggleSide();
          return KeyEventResult.handled;
        }
        // Enter submits the check when the page (not a field) has the
        // keyboard. With no open step it still opens the selected
        // stage/chapter below, so the legacy path is untouched.
        if ((key == LogicalKeyboardKey.enter ||
                key == LogicalKeyboardKey.numpadEnter) &&
            teaching.current != null &&
            _answer.text.trim().isNotEmpty) {
          if (event is KeyDownEvent) _submitCheck();
          return KeyEventResult.handled;
        }
      }
    }
    // `e` edits the curriculum. It is separate from `a` (add sources), so the
    // sources action is not shadowed outside edit mode.
    if (key == LogicalKeyboardKey.keyE) {
      if (widget.onSaveStages == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) _enterStageEdit();
      return KeyEventResult.handled;
    }
    // `c` opens this goal's chat. A focused text field consumes the keystroke
    // before this page's Focus sees it, so typing `c` in a composer is safe.
    if (key == LogicalKeyboardKey.keyC) {
      if (widget.onOpenChat == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) widget.onOpenChat!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyN &&
        HardwareKeyboard.instance.isShiftPressed) {
      if (widget.onNewChat == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) widget.onNewChat!();
      return KeyEventResult.handled;
    }
    // `a` gathers files into this goal. It is separate from the chapter keys
    // (`Enter`, `p`, `j/k`) and from `c`, so no action is shadowed.
    if (key == LogicalKeyboardKey.keyA) {
      if (widget.onAddSources == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) _addSources();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      if (_stages.isNotEmpty) {
        _moveStage(1);
      } else {
        _move(1);
      }
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      if (_stages.isNotEmpty) {
        _moveStage(-1);
      } else {
        _move(-1);
      }
      return KeyEventResult.handled;
    }
    if (_stages.isNotEmpty) {
      // A curriculum goal selects a stage, not a chapter: the stage list is its
      // index and its rows are the only lesson entry point.
      if (key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter ||
          key == LogicalKeyboardKey.keyL) {
        if (widget.onOpenStage == null) return KeyEventResult.ignored;
        _openStage();
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyB) {
        if (widget.onBuildStage == null) return KeyEventResult.ignored;
        if (event is KeyDownEvent) _buildStage();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (widget.onOpenChapter == null) return KeyEventResult.ignored;
      _openChapter();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyP) {
      _openChapter(practical: true);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _pageFocus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: widget.chapterOpen ? _reader() : _goalPage(),
    );
  }

  Widget _goalPage() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _header(),
        if (widget.loading)
          LinearProgressIndicator(
            minHeight: 2,
            color: LockedInColors.primary,
            backgroundColor: LockedInColors.line,
          ),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _header() {
    final theme = Theme.of(context);
    final detail = widget.detail;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to skills',
            onPressed: widget.onBack,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  detail.name.isEmpty ? 'goal' : detail.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                // The goal, not the counts: in a teaching session the goal is
                // the north star, so it stays on screen through every phase. The
                // plan/chapter/chat counts live in the rail and the panes.
                Text(
                  detail.goal.trim().isEmpty ? _subtitle(detail) : detail.goal,
                  key: const ValueKey('skill-goal-line'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: LockedInType.micro.copyWith(
                    color: LockedInColors.secondary,
                    fontWeight: FontWeight.w400,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
          ),
          if (widget.onOpenChat != null) ...[
            const SizedBox(width: 8),
            IconButton(
              key: const ValueKey('skill-open-chat'),
              tooltip: 'Open chat (c)',
              onPressed: widget.onOpenChat,
              icon: const Icon(Icons.forum_outlined, size: 18),
            ),
          ],
          if (widget.onNewChat != null) ...[
            const SizedBox(width: 4),
            IconButton(
              key: const ValueKey('skill-new-chat'),
              tooltip: 'New chat (Shift+N)',
              onPressed: widget.onNewChat,
              icon: const Icon(Icons.add_comment_outlined, size: 18),
            ),
          ],
        ],
      ),
    );
  }

  Widget _body() {
    return LayoutBuilder(
      builder: (context, constraints) {
        // The rail needs 176 px and the page at least 420: below that it
        // becomes a numbered strip, still complete as a control.
        final compactRail = constraints.maxWidth < Breakpoints.column;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _phaseRail(compact: compactRail),
            const VRule(),
            Expanded(child: _sections()),
          ],
        );
      },
    );
  }

  /// Every section of the session, in one scroll.
  ///
  /// The phases are a *navigator*, not a filter: measure, plan, teach and
  /// practice are the four things a session has, and hiding three of them to
  /// show one took the stage list, the sources and the chats off screen — and
  /// with them every key that acts on them (`a`, `e`, `Enter`, `j`/`k`). One
  /// scroll with four anchored sections keeps every control mounted and makes
  /// the rail a jump-to-section map.
  Widget _sections() {
    return ListView(
      controller: _sectionsScroll,
      padding: const EdgeInsets.fromLTRB(
        Space.lg,
        Space.md,
        Space.lg,
        Space.xxl,
      ),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  ErrorBanner(message: widget.error!, onRetry: widget.onRetry),
                  const SizedBox(height: Space.sm),
                ],
                if (_notice != null) ...[
                  Notice(message: _notice!),
                  const SizedBox(height: Space.sm),
                ],
                if (_sourcesFailure != null) ...[
                  ErrorBanner(message: _sourcesFailure!),
                  const SizedBox(height: Space.sm),
                ],
                if (_sourcesNotice != null) ...[
                  SourceNotice(message: _sourcesNotice!),
                  const SizedBox(height: Space.sm),
                ],
                KeyedSubtree(
                  key: _sectionKey(Phase.teach),
                  child: _teachingCard(),
                ),
                const SizedBox(height: Space.md),
                // Practice is part of the harness, not context: it follows the
                // learning surface.
                KeyedSubtree(
                  key: _sectionKey(Phase.practice),
                  child: _practiceCard(),
                ),
                const SizedBox(height: Space.md),
                if (_chapters.isNotEmpty) ...[
                  KeyedSubtree(key: _courseKey, child: _courseCard()),
                  const SizedBox(height: Space.md),
                ],
                // A curriculum goal's stage list is its plan; it stays primary
                // until the teaching loop has a measured plan of its own.
                if ((_stages.isNotEmpty &&
                        !(widget.teaching?.measured ?? false)) ||
                    _editingStages) ...[
                  KeyedSubtree(key: _stagesKey, child: _stagesCard()),
                  const SizedBox(height: Space.md),
                ],
                _contextTabBar(),
                const SizedBox(height: Space.xs),
                Offstage(offstage: _contextTab != 0, child: _sourcesCard()),
                Offstage(offstage: _contextTab != 1, child: _chatsCard()),
                Offstage(offstage: _contextTab != 2, child: _researchCard()),
                Offstage(offstage: _contextTab != 3, child: _goalCard()),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The teaching loop: measure, the plan as a map, one step with its check.
  ///
  /// This is the harness (`desktop/docs/redesign.md` §2.1). The model's reply is
  /// structured — held, gaps, plan, one step, one verdict — so the card renders
  /// fields and never parses prose. One action per state: measure when there is
  /// no plan, open a step when none is open, answer when one is. Every state has
  /// its next key, so the loop never dead-ends.
  /// Open or close the side panel, loading the thread on the way in.
  void _toggleSide() {
    setState(() => _sideOpen = !_sideOpen);
    if (_sideOpen) widget.onSideOpen?.call();
  }

  /// Send the typed side question. The core writes the exchange only after the
  /// reply exists, so the panel keeps the question visible while it waits.
  void _sendSide() {
    final send = widget.onSideSend;
    if (send == null || widget.sideLoading) return;
    final text = _sideInput.text.trim();
    if (text.isEmpty) return;
    send(text);
    _sideInput.clear();
  }

  /// The side thread, inside the step card.
  ///
  /// It is one small conversation about this step, not a second lesson: the
  /// answers are short, they never enter the transcript, and closing the panel
  /// loses nothing.
  Widget _sidePanel() {
    return Container(
      key: const ValueKey('teach-side-panel'),
      padding: const EdgeInsets.fromLTRB(
        Space.sm,
        Space.xs,
        Space.sm,
        Space.sm,
      ),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border.all(color: LockedInColors.line, width: Stroke.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(child: SectionLabel('side question')),
              if (widget.sideMessages.isNotEmpty && widget.onSideClear != null)
                TextButton(
                  key: const ValueKey('teach-side-clear'),
                  onPressed: widget.sideLoading ? null : widget.onSideClear,
                  child: const Text('clear'),
                ),
              TextButton(
                key: const ValueKey('teach-side-close'),
                onPressed: () => setState(() => _sideOpen = false),
                child: const Text('close'),
              ),
            ],
          ),
          if (widget.sideError != null) ...[
            Text(
              widget.sideError!,
              key: const ValueKey('teach-side-error'),
              style: LockedInType.label.copyWith(color: LockedInColors.error),
            ),
            const SizedBox(height: Space.xxs),
          ],
          if (widget.sideMessages.isEmpty)
            Text(
              'Ask anything about this step. The answer stays here, not in the '
              'lesson.',
              key: const ValueKey('teach-side-empty'),
              style: LockedInType.proseSmall.copyWith(
                color: LockedInColors.muted,
              ),
            )
          else
            for (final (index, message) in widget.sideMessages.indexed) ...[
              const SizedBox(height: Space.xxs),
              Text(
                message.isUser ? 'you' : 'companion',
                key: ValueKey('teach-side-role-$index'),
                style: LockedInType.micro.copyWith(
                  color: message.isUser
                      ? LockedInColors.primary
                      : LockedInColors.muted,
                ),
              ),
              Text(
                message.text,
                key: ValueKey('teach-side-message-$index'),
                style: LockedInType.proseSmall.copyWith(
                  color: LockedInColors.foreground,
                ),
              ),
            ],
          const SizedBox(height: Space.xs),
          TextField(
            key: const ValueKey('teach-side-input'),
            controller: _sideInput,
            minLines: 1,
            maxLines: 3,
            onSubmitted: (_) => _sendSide(),
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.foreground,
            ),
            decoration: const InputDecoration(
              hintText: 'ask about this step — Enter to send',
            ),
          ),
          const SizedBox(height: Space.xs),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              key: const ValueKey('teach-side-send'),
              onPressed: widget.sideLoading || widget.onSideSend == null
                  ? null
                  : _sendSide,
              style: FilledButton.styleFrom(
                backgroundColor: LockedInColors.primary,
                foregroundColor: Theme.of(context).colorScheme.onPrimary,
              ),
              child: Text(widget.sideLoading ? 'thinking…' : 'ask'),
            ),
          ),
        ],
      ),
    );
  }

  /// Send one answer, its reasoning and the chosen confidence.
  void _submitCheck() {
    final onCheck = widget.onCheck;
    if (onCheck == null || widget.teachingLoading) return;
    final answer = _answer.text.trim();
    if (answer.isEmpty) return;
    onCheck(answer, _thinking.text.trim(), _confidence);
    _answer.clear();
    _thinking.clear();
    setState(() => _confidence = 0);
  }

  Widget _goalCard() {
    final prior = widget.detail.prior.trim();
    final plan = widget.detail.modelPlan ? 'model' : 'template';
    return SectionCard(
      label: 'GOAL',
      trailing: ValueChip('plan · $plan'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The goal itself is in the header, on every phase. Repeating it here
          // made the session say the same sentence twice within 100 px.
          Text(
            'Where this session starts, and what it was asked for.',
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.muted,
            ),
          ),
          const SizedBox(height: Space.xs),
          _labelled('starting point', prior.isEmpty ? 'not recorded' : prior),
          const SizedBox(height: 6),
          _labelled('created', _createdLabel(widget.detail.created)),
        ],
      ),
    );
  }

  Widget _labelled(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 110,
          child: Text(
            label,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              color: LockedInColors.foreground,
              fontSize: TypeScale.key,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }

  /// The context tabs: sources, chats, research, goal metadata.
  ///
  /// The learning surface is the page; everything a lesson is *built from* or
  /// *discussed in* is one click away instead of four cards below it.
  Widget _contextTabBar() {
    const tabs = <(String, String)>[
      ('sources', 'sources'),
      ('chats', 'chats'),
      ('research', 'research'),
      ('goal', 'goal'),
    ];
    return Container(
      key: const ValueKey('skill-context-tabs'),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          for (final (index, (id, label)) in tabs.indexed)
            InkWell(
              key: ValueKey('skill-context-tab-$id'),
              onTap: () => setState(() => _contextTab = index),
              child: Container(
                padding: const EdgeInsets.fromLTRB(10, 4, 10, 6),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: _contextTab == index
                          ? LockedInColors.primary
                          : Colors.transparent,
                      width: Stroke.focus,
                    ),
                  ),
                ),
                child: Text(
                  label,
                  style: LockedInType.label.copyWith(
                    color: _contextTab == index
                        ? LockedInColors.foreground
                        : LockedInColors.muted,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _sourcesCard() {
    final sources = widget.sources;
    final interactive = widget.onAddSources != null;
    return SectionCard(
      label: 'SOURCES',
      trailing: ValueChip(
        sources.length == 1 ? '1 source' : '${sources.length} sources',
        tone: sources.isEmpty ? LockedInColors.muted : LockedInColors.secondary,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Lessons and this goal’s chat may cite only the files gathered '
            'here. The core keeps one copy per source inside the goal folder.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          if (sources.isEmpty &&
              !widget.sourcesLoading &&
              widget.sourcesError == null)
            EmptyNote(
              tone: interactive ? LockedInColors.warning : LockedInColors.muted,
              title: 'no sources yet',
              body: 'add sources so lessons and chat can cite them',
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < sources.length; index++) ...[
                  if (index > 0)
                    Divider(
                      height: 1,
                      thickness: 1,
                      color: LockedInColors.line,
                    ),
                  _skillSourceRow(sources[index]),
                ],
              ],
            ),
          if (widget.sourcesError != null) ...[
            const SizedBox(height: 10),
            ErrorBanner(
              message: widget.sourcesError!,
              onRetry: widget.onRetrySources,
            ),
          ],
          if (widget.sourcesLoading) ...[
            const SizedBox(height: 10),
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          ],
          if (interactive) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                FilledButton.icon(
                  key: const ValueKey('skill-sources-add'),
                  onPressed: _sourcesBusy ? null : _addSources,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('add sources'),
                ),
                const SizedBox(width: 12),
                Text(
                  'a add sources',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// One gathered source: name, kind and the saved excerpt it can be cited by.
  ///
  /// The row never shows an original path: a skill source is the goal's own
  /// copy, and [SkillSourceRow.storedPath] is relative to that folder.
  Widget _skillSourceRow(SkillSourceRow source) {
    final excerpt = source.excerpt;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            skillSourceIcon(source.kind),
            size: 15,
            color: LockedInColors.muted,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        source.name.isEmpty ? 'unnamed source' : source.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.body,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ValueChip(source.kind.isEmpty ? 'file' : source.kind),
                  ],
                ),
                if (excerpt != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    excerpt,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                      height: 1.4,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The curriculum stages of a goal that has them. Each row is one stage with
  /// its status and milestone; the selected row is what `Enter`/`l` opens and
  /// `b` builds. `e` turns the list into an editor: the cursor moves with `j/k`,
  /// `a`/`r`/`d` add, rename and remove, and `J`/`K` (or shifted arrows) reorder.
  ///
  /// Every edit sends the whole list in order, so the core always stores one
  /// curriculum and the reply is what the card shows next.
  Widget _stagesCard() {
    final stages = _stages;
    final done = stages.where((stage) => stage.done).length;
    final interactive = widget.onOpenStage != null;
    final editable = widget.onSaveStages != null;
    final selected = _stageIndex;
    return SectionCard(
      label: 'CURRICULUM STAGES',
      trailing: ValueChip(
        _editingStages
            ? 'editing'
            : stages.isEmpty
            ? 'no stages'
            : '$done/${stages.length} stages',
        tone: _editingStages
            ? LockedInColors.primary
            : stages.isNotEmpty && done == stages.length
            ? LockedInColors.success
            : LockedInColors.muted,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'A lesson is built one stage at a time from this goal’s gathered '
            'sources. An unsourced claim is labelled as an agent explanation.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          if (stages.isEmpty)
            EmptyNote(
              tone: LockedInColors.warning,
              title: 'no stages yet',
              body: editable
                  ? 'a adds the first stage; every change saves the whole '
                        'curriculum.'
                  : 'This goal has no curriculum stages.',
            )
          else
            for (var index = 0; index < stages.length; index++)
              _stageRow(
                stages[index],
                index,
                selected: (_editingStages || interactive) && index == selected,
              ),
          if (_stagesFailure != null) ...[
            const SizedBox(height: 10),
            ErrorBanner(message: _stagesFailure!),
          ],
          if (_stagesBusy) ...[
            const SizedBox(height: 10),
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          ],
          // The pointer path for `b`: build the selected stage's lesson.
          if (!_editingStages &&
              interactive &&
              widget.onBuildStage != null &&
              _selectedStageRow != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                key: const ValueKey('skill-build-lesson'),
                onPressed: _stagesBusy ? null : _buildStage,
                icon: const Icon(Icons.auto_stories_outlined, size: 15),
                label: const Text('build lesson'),
              ),
            ),
          ],
          if (stages.isNotEmpty || _editingStages) ...[
            const SizedBox(height: 10),
            Text(
              _editingStages
                  ? [
                      'j/k move',
                      'a add',
                      'r rename',
                      'd remove',
                      if (stages.length > 1) 'J/K reorder',
                      'Enter done',
                      'Esc done',
                    ].join(' · ')
                  : [
                      if (interactive) 'j/k move',
                      if (interactive) 'Enter lesson',
                      if (interactive) 'l lesson',
                      if (widget.onBuildStage != null) 'b build',
                      if (editable) 'e edit stages',
                      'Esc back',
                    ].join(' · '),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _stageRow(SkillStage stage, int index, {required bool selected}) {
    final (tone, glyph) = switch (stage.status) {
      'done' => (LockedInColors.success, Icons.check_circle_outline),
      'active' => (LockedInColors.primary, Icons.play_circle_outline),
      _ => (LockedInColors.muted, Icons.radio_button_unchecked),
    };
    return Padding(
      key: _stageKey(stage.id),
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.layer),
        child: InkWell(
          key: ValueKey('skill-stage-${stage.id}'),
          borderRadius: BorderRadius.circular(Radii.layer),
          onTap: (widget.onOpenStage == null && !_editingStages)
              ? null
              : () {
                  setState(() {
                    _selectedStage = index;
                    _notice = null;
                  });
                  // A click on a stage is Enter: open its lesson. Editing the
                  // curriculum keeps click = select so rows can be reordered.
                  if (!_editingStages) _openStage();
                },
          child: Container(
            key: selected ? _selectedStageKey : null,
            padding: const EdgeInsets.fromLTRB(0, 8, 10, 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(
                color: selected
                    ? LockedInColors.primary.withValues(alpha: 0.5)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 3,
                  height: 22,
                  decoration: BoxDecoration(
                    color: selected
                        ? LockedInColors.primary
                        : Colors.transparent,
                    borderRadius: const BorderRadius.horizontal(
                      right: Radius.circular(Radii.control),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Icon(glyph, size: 16, color: tone),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stage.title.isEmpty ? 'untitled stage' : stage.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.body,
                          fontWeight: selected
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                      if (stage.milestone != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          stage.milestone!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.micro,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                ValueChip(
                  stage.status.isEmpty ? 'pending' : stage.status,
                  tone: tone,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _courseCard() {
    final chapters = _chapters;
    final done = chapters.where((chapter) => chapter.done).length;
    final interactive = widget.onOpenChapter != null;
    final selected = _selected;
    return SectionCard(
      label: 'COURSE',
      trailing: ValueChip(
        chapters.isEmpty ? 'no chapters' : '$done/${chapters.length} chapters',
        tone: chapters.isNotEmpty && done == chapters.length
            ? LockedInColors.success
            : LockedInColors.muted,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (chapters.isEmpty)
            EmptyNote(
              tone: LockedInColors.warning,
              title: 'no chapters yet',
              body:
                  'This course has no lesson files. Rebuild the goal from the '
                  'Goals list to generate a plan; nothing is generated here.',
            )
          else
            for (var index = 0; index < chapters.length; index++)
              _chapterRow(
                chapters[index],
                index,
                selected: interactive && index == selected,
              ),
          if (chapters.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              [
                if (interactive) 'j/k move',
                if (interactive) 'Enter lesson',
                if (interactive) 'p practical',
                if (widget.onOpenChat != null) 'c chat',
                'Esc back',
              ].join(' · '),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chapterRow(
    SkillChapter chapter,
    int index, {
    required bool selected,
  }) {
    final practical = chapter.hasPractical;
    return Padding(
      key: _chapterKey(chapter.id),
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.layer),
        child: InkWell(
          borderRadius: BorderRadius.circular(Radii.layer),
          onTap: widget.onOpenChapter == null
              ? null
              : () {
                  setState(() {
                    _selectedChapter = index;
                    _notice = null;
                  });
                  _openChapter();
                },
          child: Container(
            key: selected ? _selectedChapterKey : null,
            padding: const EdgeInsets.fromLTRB(0, 8, 10, 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(
                color: selected
                    ? LockedInColors.primary.withValues(alpha: 0.5)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 3,
                  height: 22,
                  decoration: BoxDecoration(
                    color: selected
                        ? LockedInColors.primary
                        : Colors.transparent,
                    borderRadius: const BorderRadius.horizontal(
                      right: Radius.circular(Radii.control),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  chapter.done
                      ? Icons.check_circle_outline
                      : Icons.radio_button_unchecked,
                  size: 16,
                  color: chapter.done
                      ? LockedInColors.success
                      : LockedInColors.muted,
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        chapter.title.isEmpty
                            ? 'untitled chapter'
                            : chapter.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.body,
                          fontWeight: selected
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                      if (chapter.guide.trim().isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          chapter.guide,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.micro,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (chapter.done) ...[
                  const SizedBox(width: 8),
                  ValueChip('done', tone: LockedInColors.success),
                ],
                if (practical) ...[
                  const SizedBox(width: 8),
                  const ValueChip('practical'),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _chatsCard() {
    final chats = widget.chats ?? widget.detail.chats;
    final canOpen = widget.onOpenChat != null;
    return SectionCard(
      label: 'CHATS',
      trailing: ValueChip(
        chats.length == 1 ? '1 chat' : '${chats.length} chats',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'A goal chat sees only this goal’s gathered sources. Facts come '
            'from them or are labelled as an agent explanation.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          if (chats.isEmpty)
            EmptyNote(
              tone: LockedInColors.muted,
              title: 'no chats yet',
              body: canOpen
                  ? 'c starts one grounded in this goal’s sources.'
                  : 'Saved transcripts in the goal folder are listed here.',
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < chats.length; index++) ...[
                  if (index > 0)
                    Divider(
                      height: 1,
                      thickness: 1,
                      color: LockedInColors.line,
                    ),
                  _chatRow(chats[index]),
                ],
              ],
            ),
          if (canOpen) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  FilledButton.icon(
                    key: const ValueKey('skill-open-chat-card'),
                    onPressed: widget.onOpenChat,
                    icon: const Icon(Icons.forum_outlined, size: 16),
                    label: Text(chats.isEmpty ? 'Start chat' : 'Open chat'),
                  ),
                  if (chats.isNotEmpty && widget.onNewChat != null) ...[
                    const SizedBox(width: 10),
                    OutlinedButton.icon(
                      key: const ValueKey('skill-new-chat-card'),
                      onPressed: widget.onNewChat,
                      icon: const Icon(Icons.add_comment_outlined, size: 16),
                      label: const Text('New chat · Shift+N'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chatRow(SkillChatRow chat) {
    final used = _usedLabel(chat.lastUsed);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Icon(Icons.forum_outlined, size: 15, color: LockedInColors.muted),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              chat.title.isEmpty ? chat.id : chat.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.body,
              ),
            ),
          ),
          if (used.isNotEmpty) ...[
            const SizedBox(width: 10),
            Text(
              used,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.micro,
              ),
            ),
          ],
          const SizedBox(width: 10),
          Text(
            chat.messages == 1 ? '1 message' : '${chat.messages} messages',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
            ),
          ),
        ],
      ),
    );
  }

  Widget _reader() {
    final theme = Theme.of(context);
    final chapter = widget.chapter;
    final practical = chapter?.practical ?? false;
    final title = chapter == null || chapter.chapterTitle.isEmpty
        ? 'chapter'
        : chapter.chapterTitle;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: LockedInColors.line)),
          ),
          child: Row(
            children: [
              IconButton(
                tooltip: 'Back to the goal',
                onPressed: widget.onCloseChapter,
                icon: const Icon(Icons.arrow_back, size: 18),
              ),
              const SizedBox(width: 2),
              Container(width: 3, height: 28, color: LockedInColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium,
                    ),
                    Text(
                      practical ? 'practical' : 'lesson',
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                      ),
                    ),
                  ],
                ),
              ),
              if (widget.chapterLoading)
                SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: LockedInColors.primary,
                  ),
                ),
            ],
          ),
        ),
        if (widget.chapterLoading)
          LinearProgressIndicator(
            minHeight: 2,
            color: LockedInColors.primary,
            backgroundColor: LockedInColors.line,
          ),
        Expanded(child: _readerBody()),
      ],
    );
  }

  Widget _readerBody() {
    if (widget.chapterLoading && widget.chapter == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: LockedInColors.primary,
              ),
            ),
            SizedBox(height: 14),
            Text(
              'loading chapter…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
        ),
      );
    }
    final error = widget.chapterError;
    if (error != null) {
      return _stateCard(
        icon: Icons.error_outline,
        tone: LockedInColors.error,
        title: 'could not read this chapter',
        body: error,
        actions: [
          if (widget.onRetryChapter != null)
            FilledButton(
              key: const ValueKey('skill-chapter-retry'),
              onPressed: widget.onRetryChapter,
              child: const Text('Retry'),
            ),
          if (widget.onCloseChapter != null)
            OutlinedButton(
              onPressed: widget.onCloseChapter,
              child: const Text('Back to the goal'),
            ),
        ],
      );
    }
    final text = widget.chapter?.text ?? '';
    if (text.trim().isEmpty) {
      return _stateCard(
        icon: Icons.info_outline,
        tone: LockedInColors.warning,
        title: 'this chapter is empty',
        body:
            'The core returned no text for this chapter. Nothing was written '
            'or repaired.',
        actions: [
          if (widget.onCloseChapter != null)
            OutlinedButton(
              onPressed: widget.onCloseChapter,
              child: const Text('Back to the goal'),
            ),
        ],
      );
    }
    return ListView(
      controller: _chapterScroll,
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ChatMarkdown(text: text),
                const SizedBox(height: 18),
                Text(
                  'Esc back',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _stateCard({
    required IconData icon,
    required Color tone,
    required String title,
    required String body,
    required List<Widget> actions,
  }) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            decoration: BoxDecoration(
              color: LockedInColors.surface,
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(color: LockedInColors.line),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 17, color: tone),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(title, style: theme.textTheme.titleMedium),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.body,
                    height: 1.5,
                  ),
                ),
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.end,
                    children: actions,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _subtitle(SkillDetail detail) {
  final plan = detail.modelPlan ? 'model' : 'template';
  final chapters = detail.chapters.length;
  final chats = detail.chats.length;
  return 'plan $plan · $chapters ${chapters == 1 ? 'chapter' : 'chapters'} '
      '· $chats ${chats == 1 ? 'chat' : 'chats'}';
}

String _createdLabel(String created) {
  if (created.isEmpty) return 'date unknown';
  final stamp = created.replaceFirst('T', ' ');
  final cut = stamp.length > 16 ? stamp.substring(0, 16) : stamp;
  return cut;
}

/// A chat's last-used instant as `YYYY-MM-DD HH:MM`, or empty when never used.
String _usedLabel(String lastUsed) {
  if (lastUsed.isEmpty) return '';
  final stamp = lastUsed.replaceFirst('T', ' ');
  return stamp.length > 16 ? stamp.substring(0, 16) : stamp;
}

/// The small stage prompt the add and rename actions share.
///
/// It owns its two text controllers, so the dialog's closing animation can
/// finish before they go away — disposing them in the caller raced that rebuild.
/// One row of the plan map: number (or a tick), title, and whether it is current.
///
/// The plan is a coarse map, not the lesson (`desktop/docs/redesign.md` §2.1):
/// one line per idea, so the whole route fits on screen beside the step.
/// One 1–5 confidence key. Selected is filled; the number is the label.
