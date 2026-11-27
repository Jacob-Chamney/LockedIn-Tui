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

part 'skill_detail_actions.dart';
part 'skill_detail_page.dart';

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
  /// Rebuild the page from a helper extracted out of this file.
  ///
  /// `setState` is protected, so a part-file extension cannot call it directly.
  /// Rebuild the page from a helper extracted out of this file.
  ///
  /// `setState` is protected, so a part-file extension cannot call it directly;
  /// this is the one door it uses, and it is exactly `setState`.
  void refresh(VoidCallback fn) => setState(fn);

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _pageFocus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: widget.chapterOpen ? _reader() : _goalPage(),
    );
  }

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
