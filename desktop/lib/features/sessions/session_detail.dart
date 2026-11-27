import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/errors.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../shell/chrome.dart';
import '../shared/cards.dart';
import '../../theme/tokens.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../chat/document_search.dart';
import '../chat/markdown.dart';
import '../shared/format.dart';
import 'session_widgets.dart';

part 'session_detail_cards.dart';
part 'session_detail_widgets.dart';

/// One lock-in session, rendered from the shell's `session.open` projection.
///
/// The shell owns the store: it opens the session through the core and passes
/// the resulting [SessionDetail] in. This page reads no files and calls no core
/// method, so a null [detail] is always the shell's answer — and every missing
/// piece explains its own next step instead of painting a blank screen.
class SessionDetailView extends StatefulWidget {
  /// The page's own scroll view. Named so a test can drive it directly: the
  /// step list beside it is a second Scrollable.
  static const pageScrollKey = ValueKey('session-detail-scroll');

  const SessionDetailView({
    super.key,
    required this.detail,
    required this.loading,
    this.error,
    this.onBack,
    this.onOpenChat,
    this.onRetry,
    this.onToggleStep,
    this.onGenerateSteps,
    this.generatingSteps = false,
    this.stepsError,
    this.coverage,
    this.coverageLoading = false,
    this.coverageError,
    this.onRetryCoverage,
    this.documentText,
    this.documentName,
    this.documentLoading = false,
    this.documentError,
    this.onGenerateDocument,
    this.onRetryDocument,
    this.onCloseDocument,
    this.onOpenSettings,
    this.onOpenOutput,
    this.initialStep,
    this.figures = const [],
    this.figureImages = const {},
    this.figuresLoading = false,
    this.figureBusy = false,
    this.figureError,
    this.onExtractFigure,
    this.onLoadFigure,
    this.onRemoveFigure,
    this.mistakes = const [],
    this.mistakesLoading = false,
    this.mistakesError,
    this.onRetryMistakes,
    this.onRecordMistake,
    this.onPromoteMistake,
    this.onCorrectMistake,
  });

  /// The core's `session.open` projection, or null while it is unavailable.
  final SessionDetail? detail;

  /// The step the reader should land on, when the session was opened from a
  /// review item that names one. Null keeps the first step.
  final int? initialStep;

  /// Figures cropped from this session's own PDF sources.
  final List<SessionFigure> figures;

  /// Decoded PNG bytes by figure id, loaded on demand.
  final Map<String, Uint8List> figureImages;

  final bool figuresLoading;
  final bool figureBusy;

  /// The last figure failure, shown inside the card.
  final String? figureError;

  /// Crop one figure. Null keeps the card read-only.
  final Future<void> Function({
    required int page,
    int? x,
    int? y,
    int? width,
    int? height,
    String caption,
  })?
  onExtractFigure;

  /// Load one figure's bytes.
  final Future<void> Function(String figureId)? onLoadFigure;

  /// Remove one figure.
  final Future<void> Function(String figureId)? onRemoveFigure;

  /// The session's misconception ledger (`session.mistake.list`).
  ///
  /// These are the learner's own recorded mistakes — **process history, never
  /// sources**. A row with a [SessionMistake.note] has been promoted into a
  /// school knowledge note; the rest can be promoted from this card.
  final List<SessionMistake> mistakes;

  /// True while the ledger is being read for the open session.
  final bool mistakesLoading;

  /// The last ledger read failure, or null. Page-local: it never replaces
  /// [error] and never clears [mistakes].
  final String? mistakesError;

  /// Re-read the ledger after a failure.
  final VoidCallback? onRetryMistakes;

  /// Record one mistake. Null keeps the card read-only.
  final Future<void> Function(String text, {String? step})? onRecordMistake;

  /// Promote one entry into a labelled note. Null keeps the rows read-only.
  final Future<MistakePromotion> Function(int index, {String? correction})?
  onPromoteMistake;

  /// Write or replace a promoted note's corrected understanding. Null keeps a
  /// promoted row read-only.
  final Future<MistakeNote> Function(int index, String correction)?
  onCorrectMistake;

  /// True while the shell is opening or refreshing the session.
  final bool loading;

  /// One readable failure from the shell, shown beside a retry and a back
  /// action. It never replaces a detail the shell already has.
  final String? error;

  /// `Esc` and the back control return to the session list.
  final VoidCallback? onBack;

  /// The primary action: open this session's chat.
  final VoidCallback? onOpenChat;

  final VoidCallback? onRetry;

  /// Toggle one assignment step through the shell's `session.toggleStep`.
  ///
  /// The shell owns the write and re-renders the returned markdown through
  /// [detail]; this page only reports the ordinal. Null keeps the steps
  /// read-only, so the reader never pretends to save without a connection.
  final Future<void> Function(int index)? onToggleStep;

  /// Build or rebuild `assignment-steps.md` through the shell's
  /// `session.generateSteps`.
  ///
  /// Null keeps the steps read-only. The shell owns the provider run and the
  /// pending/error state; this page only asks for it, after confirming a
  /// regenerate when checked work would be compared. The answer arrives as a
  /// new [detail], never as a local rewrite.
  final Future<void> Function()? onGenerateSteps;

  /// True while the shell's generation is in flight: the action is disabled and
  /// the card says `building steps…`.
  final bool generatingSteps;

  /// One readable generation failure from the shell, shown inline beside a retry
  /// while the previous steps stay on screen.
  final String? stepsError;

  /// The open session's source coverage (`session.coverage`), or null before the
  /// shell has read it.
  ///
  /// Read-only and derived: it counts mentions of each copied source across the
  /// steps, chat, outputs and memory. A mention is a lexical fact, not proof that
  /// a claim came from that source, and the card says so.
  final CoverageReport? coverage;

  /// True while the shell's coverage read is in flight.
  final bool coverageLoading;

  /// The core's own one-line coverage refusal, shown with a retry while the
  /// previous report stays on screen.
  final String? coverageError;

  /// Ask again for the coverage report that last failed.
  ///
  /// Null keeps the card hidden when no report has been read either, so a shell
  /// that has not wired the read never paints a card claiming there are no
  /// sources.
  final VoidCallback? onRetryCoverage;

  /// The generated study document's Markdown (`session.document`), or null.
  ///
  /// The core writes the file and returns its own bytes; this page renders them
  /// and never reads the session folder. A generated document is **not** a
  /// source: it never appears in the source rows or source coverage.
  final String? documentText;

  /// The session-relative file for [documentText]: `contract.md`,
  /// `contradictions.md` or `check.md`.
  final String? documentName;

  /// True while the shell's study-document generation is in flight.
  final bool documentLoading;

  /// The core's own one-line study-document refusal, shown with a retry.
  final String? documentError;

  /// Generate one study document through the shell's `session.document`.
  ///
  /// [kind] is `contract`, `contradictions` or `check`; [attempt] is only sent
  /// for `check`. Null keeps the study tools read-only, so the page never
  /// advertises a key that cannot run.
  final Future<void> Function(String kind, {String? attempt})?
  onGenerateDocument;

  /// Ask again for the document that last failed, with the same kind/attempt.
  final Future<void> Function()? onRetryDocument;

  /// Collapse the reader back to the session detail.
  final VoidCallback? onCloseDocument;

  /// Open the session settings layer (prompt.md and the instructions file).
  ///
  /// Null keeps the action hidden, so a read-only detail never advertises a
  /// layer that cannot open. `s` is the keyboard route.
  final VoidCallback? onOpenSettings;

  /// Open one generated output through the shell's `session.output.read`.
  ///
  /// [kind] is `study-guide` or `flashcards`. The shell owns the reader layer,
  /// so a missing file opens the reader's build state rather than failing here.
  /// Null keeps the readers hidden, so a read-only detail never advertises an
  /// action that cannot run; `g` (guide) and `f` (flashcards) are the keyboard
  /// routes.
  final Future<void> Function(String kind)? onOpenOutput;

  @override
  State<SessionDetailView> createState() => _SessionDetailViewState();
}

class _SessionDetailViewState extends State<SessionDetailView> {
  /// Rebuild the page from a card extracted out of this file.
  ///
  /// `setState` is protected, so a part-file extension cannot call it directly.
  void refresh(VoidCallback fn) => setState(fn);

  final _stepKeys = <int, GlobalKey>{};

  /// The page's keyboard node. The document search hands it focus back when it
  /// closes, so the detail's own keys resume without a second click.
  final _focus = FocusNode(debugLabel: 'session-detail');

  /// The in-document search over the generated study document.
  final _search = DocumentSearchController();

  /// The last match scrolled to, so a keystroke that does not move the match
  /// does not move the reader.
  int _lastSearchStart = -1;

  /// Task-item ordinal under the cursor. It is an ordinal in the markdown, not
  /// a line number, because that is the index the core's toggle takes. It
  /// starts on [SessionDetailView.initialStep] when the shell named one.
  late var _selectedStep = widget.initialStep ?? 0;

  /// True between the request and its answer; a second toggle is ignored rather
  /// than queued, so one press never writes twice.
  var _toggling = false;

  /// One inline reason from a rejected toggle. It never replaces the steps:
  /// the previous markdown and selection stay exactly as they were.
  String? _toggleError;

  /// True between a generation request and its answer, so a held `R` or a
  /// double tap can never start two provider runs.
  var _requestingSteps = false;

  /// A generation failure thrown by the callback itself. The shell reports its
  /// own failure through [SessionDetailView.stepsError]; this is the fallback
  /// for a callback that throws instead.
  String? _localStepsError;

  String? get _stepsError => widget.stepsError ?? _localStepsError;

  /// The study-document reader's scroll position. Keyboard scrolling moves it;
  /// the document body itself is read-only.
  final _documentScroll = ScrollController();

  /// The page's own scroll position.
  ///
  /// The detail is one column: a long instructions card pushes the sources,
  /// memory and steps cards below the fold, so the page needs a keyboard scroll
  /// path (`Page Down`/`Page Up`, `Ctrl+D`/`Ctrl+U`, `Home`/`End`). Without it a
  /// long prompt would make those cards unreachable without a mouse.
  final _pageScroll = ScrollController();

  /// The attempt dialog's field. It lives with the page, so closing the dialog
  /// never disposes a controller the exit animation still reads.
  final _attemptController = TextEditingController();

  /// True while the attempt dialog is open, so the page's digit shortcuts do
  /// not fire while the learner is typing.
  var _attemptDialogOpen = false;

  /// True between a study-document request and its answer, so a held key never
  /// starts two provider runs.
  var _startingDocument = false;

  /// A study-document failure thrown by the callback itself. The shell reports
  /// its own failure through [SessionDetailView.documentError]; this is the
  /// fallback for a callback that throws instead.
  String? _localDocumentError;

  String? get _documentError => widget.documentError ?? _localDocumentError;

  /// True when the generated document (or its pending/error state) is the
  /// visible layer.
  bool get _readerVisible =>
      widget.documentLoading ||
      widget.documentText != null ||
      _documentError != null;

  /// The mistake form: the entry text and the step it was recorded against.
  final _mistakeText = TextEditingController();
  final _mistakeStep = TextEditingController();

  /// The promotion dialog's correction. It lives with the page for the same
  /// reason `_attemptController` does: the dialog's exit animation still reads
  /// it after the route is popped.
  final _correctionController = TextEditingController();

  /// True between a ledger write and its answer, so one press writes once.
  var _mistakeBusy = false;

  /// The last inline result of recording or promoting, never a modal.
  String? _mistakeNotice;

  /// The figure form: a page, an optional crop, and a caption.
  final _figurePage = TextEditingController(text: '1');
  final _figureCaption = TextEditingController();
  final _figureX = TextEditingController();
  final _figureY = TextEditingController();
  final _figureW = TextEditingController();
  final _figureH = TextEditingController();
  String? _figureNotice;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearchChanged);
  }

  @override
  void didUpdateWidget(covariant SessionDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _search.updateDocument(_searchDocument());
    // Closing the document also closes its search, so the bar never floats over
    // the detail's cards without a document under it.
    if (!_readerVisible && _search.open) _search.close();
  }

  @override
  void dispose() {
    _figurePage.dispose();
    _figureCaption.dispose();
    _figureX.dispose();
    _figureY.dispose();
    _figureW.dispose();
    _figureH.dispose();
    _search.removeListener(_onSearchChanged);
    _search.dispose();
    _focus.dispose();
    _documentScroll.dispose();
    _pageScroll.dispose();
    _attemptController.dispose();
    _mistakeText.dispose();
    _mistakeStep.dispose();
    _correctionController.dispose();
    super.dispose();
  }

  /// The study document the search scans, exactly as the reader renders it.
  String _searchDocument() => widget.documentText ?? '';

  void _openSearch() {
    _search.openWith(_searchDocument());
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _search.fieldFocus.requestFocus();
    });
  }

  void _closeSearch() {
    _search.close();
    setState(() {});
    _focus.requestFocus();
  }

  void _onSearchChanged() {
    final start = _search.current?.start ?? -1;
    if (start == _lastSearchStart) return;
    _lastSearchStart = start;
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _scrollToSearchMatch();
    });
  }

  /// Move the reader to the selected match by mapping its offset to a fraction
  /// of the reader's scroll extent. The count in the bar is the precise part.
  void _scrollToSearchMatch() {
    final fraction = _search.currentFraction;
    if (fraction == null || !_documentScroll.hasClients) return;
    final position = _documentScroll.position;
    final target = (fraction * position.maxScrollExtent)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (target == position.pixels) return;
    position.jumpTo(target);
  }

  /// The search keys inside the document reader. Returns null when the key
  /// belongs to the reader (scrolling, `Esc` back to the detail).
  KeyEventResult? _searchKey(LogicalKeyboardKey key) {
    if (!_search.open) {
      if (key == LogicalKeyboardKey.slash) {
        _openSearch();
        return KeyEventResult.handled;
      }
      return null;
    }
    if (key == LogicalKeyboardKey.escape) {
      _closeSearch();
      return KeyEventResult.handled;
    }
    if (_search.typing) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.slash) {
      _search.fieldFocus.requestFocus();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyN) {
      if (HardwareKeyboard.instance.isShiftPressed) {
        _search.previous();
      } else {
        _search.next();
      }
      return KeyEventResult.handled;
    }
    return null;
  }

  GlobalKey _stepKey(int index) =>
      _stepKeys.putIfAbsent(index, () => GlobalKey(debugLabel: 'step-$index'));

  List<StepRow> _stepRows(SessionDetail? detail) {
    final steps = detail?.steps;
    if (steps == null || !steps.exists || steps.markdown.trim().isEmpty) {
      return const [];
    }
    return parseSteps(steps.markdown);
  }

  int _taskCount(SessionDetail? detail) =>
      _stepRows(detail).where((row) => row.index != null).length;

  void _moveStep(int delta) {
    final count = _taskCount(widget.detail);
    if (count == 0) return;
    final current = _selectedStep.clamp(0, count - 1);
    final next = (current + delta).clamp(0, count - 1);
    if (next == current) return;
    setState(() => _selectedStep = next);
    // Keep the selected step on screen. Moving is explicit navigation, unlike
    // a toggle, so only this path scrolls.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final target = _stepKeys[next]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _toggleSelected() async {
    final count = _taskCount(widget.detail);
    if (count == 0) return;
    await _toggle(_selectedStep.clamp(0, count - 1));
  }

  /// Toggle one step by index: the keyboard path and the checkbox click share
  /// it, so a click can only ever write the step it is drawn on.
  Future<void> _toggle(int index) async {
    if (_toggling) return;
    final toggle = widget.onToggleStep;
    if (toggle == null) return;
    setState(() => _toggling = true);
    try {
      await toggle(index);
      if (!mounted) return;
      setState(() {
        _toggling = false;
        _toggleError = null;
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _toggling = false;
        _toggleError = userMessage(failure);
      });
    }
  }

  /// Ask the shell to build or rebuild the steps.
  ///
  /// A rebuild with checked work asks first: the merge compares by exact step
  /// text, so a checked step can survive or disappear. The shell owns the run
  /// and reports progress through [SessionDetailView.generatingSteps]; this
  /// page only prevents overlapping requests and shows a thrown failure.
  Future<void> _generateSteps() async {
    final generate = widget.onGenerateSteps;
    if (generate == null || widget.generatingSteps || _requestingSteps) return;
    final steps = widget.detail?.steps;
    if (steps != null && steps.exists && steps.done > 0) {
      final confirmed = await _confirmRegenerate();
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _requestingSteps = true;
      _localStepsError = null;
    });
    try {
      await generate();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _localStepsError = userMessage(failure));
    } finally {
      if (mounted) setState(() => _requestingSteps = false);
    }
  }

  /// The one confirmation a rebuild with checked work needs. It names the merge
  /// rule instead of a generic "are you sure", and `Cancel` changes nothing.
  Future<bool> _confirmRegenerate() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('regenerate steps?'),
        content: const Text(
          'Checked work is merged by step text: a checked step stays checked '
          'only when the new plan contains the same text. A checked step whose '
          'text is gone is dropped.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('steps-regenerate-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('steps-regenerate-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Regenerate'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  /// Start one study document. `contract` and `contradictions` run immediately;
  /// `check` asks for the attempt first and sends it with the request.
  Future<void> _startDocument(String kind) async {
    final generate = widget.onGenerateDocument;
    if (generate == null || widget.documentLoading || _startingDocument) return;
    String? attempt;
    if (kind == 'check') {
      attempt = await _askAttempt();
      if (attempt == null || !mounted) return;
    }
    setState(() {
      _startingDocument = true;
      _localDocumentError = null;
    });
    try {
      await generate(kind, attempt: attempt);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _localDocumentError = userMessage(failure));
    } finally {
      if (mounted) setState(() => _startingDocument = false);
    }
  }

  /// The one small dialog `3 check an attempt` needs.
  ///
  /// The attempt is required and sent to the core inside the request, so an
  /// empty value can never produce an empty review. `Cancel` returns null and
  /// changes nothing.
  Future<String?> _askAttempt() async {
    if (_attemptDialogOpen) return null;
    _attemptDialogOpen = true;
    final controller = _attemptController;
    controller.text = '';
    var canSend = false;
    try {
      return await showDialog<String>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('check an attempt'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Paste or type the attempt to review. It is checked against '
                  'this session\'s sources, and the result is saved as a '
                  'generated session document — not a source.',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.key,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('study-attempt-field'),
                  controller: controller,
                  autofocus: true,
                  minLines: 2,
                  maxLines: 5,
                  onChanged: (value) {
                    final ready = value.trim().isNotEmpty;
                    if (ready != canSend) setDialogState(() => canSend = ready);
                  },
                  onSubmitted: (value) {
                    final attempt = value.trim();
                    if (attempt.isEmpty) return;
                    Navigator.of(dialogContext).pop(attempt);
                  },
                  decoration: const InputDecoration(
                    hintText: 'what you would hand in…',
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                key: const ValueKey('study-attempt-cancel'),
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Cancel'),
              ),
              FilledButton(
                key: const ValueKey('study-attempt-generate'),
                onPressed: canSend
                    ? () =>
                          Navigator.of(dialogContext)
                              .pop(controller.text.trim())
                    : null,
                child: const Text('Check'),
              ),
            ],
          ),
        ),
      );
    } finally {
      _attemptDialogOpen = false;
    }
  }

  /// Ask the shell to run the failed document request again.
  Future<void> _retryDocument() async {
    final retry = widget.onRetryDocument;
    if (retry == null || widget.documentLoading) return;
    setState(() => _localDocumentError = null);
    try {
      await retry();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _localDocumentError = userMessage(failure));
    }
  }

  /// Scroll the reader. The delta is in logical pixels; a page is roughly half
  /// the viewport and `j`/`k` a line height.
  void _scrollDocument(double delta) {
    if (!_documentScroll.hasClients) return;
    final position = _documentScroll.position;
    final next = (position.pixels + delta)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (next == position.pixels) return;
    position.jumpTo(next);
  }

  /// Scroll the page body by [delta] logical pixels, clamped to its extent.
  void _scrollPage(double delta) {
    if (!_pageScroll.hasClients) return;
    final position = _pageScroll.position;
    final next = (position.pixels + delta)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (next == position.pixels) return;
    position.jumpTo(next);
  }

  /// Ask the shell to open one generated output. The reader is a layer of the
  /// session, so the detail stays open behind it and a missing file opens the
  /// reader's build state instead of failing here.
  void _openOutput(String kind) {
    final open = widget.onOpenOutput;
    if (open == null) return;
    unawaited(open(kind));
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them. This
    // page's own pair is `Ctrl+U` / `Ctrl+D` for a page of scroll.
    final control = HardwareKeyboard.instance.isControlPressed;
    final ownChord =
        control &&
        (key == LogicalKeyboardKey.keyU || key == LogicalKeyboardKey.keyD);
    if (modifierHeld && !ownChord) return KeyEventResult.ignored;
    if (_readerVisible) {
      // `/` opens the in-document search; while its field is focused bare keys
      // are text, so the reader's scrolling and Esc resume after Enter.
      final search = _searchKey(key);
      if (search != null) return search;
      if (_search.open && _search.typing) return KeyEventResult.ignored;
      if (key == LogicalKeyboardKey.escape) {
        if (widget.onCloseDocument == null) return KeyEventResult.ignored;
        widget.onCloseDocument!();
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.arrowDown ||
          key == LogicalKeyboardKey.keyJ) {
        _scrollDocument(40);
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
        _scrollDocument(-40);
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.pageDown ||
          key == LogicalKeyboardKey.keyD) {
        _scrollDocument(320);
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.pageUp || key == LogicalKeyboardKey.keyU) {
        _scrollDocument(-320);
        return KeyEventResult.handled;
      }
      // A key the reader does not use is left to the shell: the leader, `?`,
      // `:` and `Esc` must keep working while a document is on screen. Only the
      // detail's own layer keys (`Enter`, `c`, the study digits) must not fire
      // behind it, and they are not shell actions, so ignoring them is enough.
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.escape) {
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    // Page scrolling. A long prompt is the normal case, and the cards below it
    // must stay reachable from the keyboard alone.
    if (key == LogicalKeyboardKey.pageDown ||
        (control && key == LogicalKeyboardKey.keyD)) {
      _scrollPage(320);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.pageUp ||
        (control && key == LogicalKeyboardKey.keyU)) {
      _scrollPage(-320);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.home) {
      _scrollPage(-double.infinity);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.end) {
      _scrollPage(double.infinity);
      return KeyEventResult.handled;
    }
    // `1`/`2`/`3` are the study tools' keyboard routes. They are digits, so
    // they never collide with the steps' j/k/arrows/Space or the chat's `c`.
    final documentKind = widget.onGenerateDocument == null || _attemptDialogOpen
        ? null
        : switch (key) {
            LogicalKeyboardKey.digit1 ||
            LogicalKeyboardKey.numpad1 => 'contract',
            LogicalKeyboardKey.digit2 ||
            LogicalKeyboardKey.numpad2 => 'contradictions',
            LogicalKeyboardKey.digit3 || LogicalKeyboardKey.numpad3 => 'check',
            _ => null,
          };
    if (documentKind != null) {
      if (event is KeyDownEvent) unawaited(_startDocument(documentKind));
      return KeyEventResult.handled;
    }
    // `s` is the settings layer's keyboard route. It is a letter, so it never
    // collides with the steps' j/k/arrows/Space, the chat's `c` or the study
    // digits.
    if (key == LogicalKeyboardKey.keyS &&
        widget.onOpenSettings != null &&
        widget.detail != null) {
      widget.onOpenSettings!();
      return KeyEventResult.handled;
    }
    // `g` and `f` open the two generated outputs. They are letters, so they
    // never collide with the steps' j/k/arrows/Space or the chat's `c`; only
    // the initial press may open a reader.
    final outputKind = widget.onOpenOutput == null || widget.detail == null
        ? null
        : switch (key) {
            LogicalKeyboardKey.keyG => 'study-guide',
            LogicalKeyboardKey.keyF => 'flashcards',
            _ => null,
          };
    if (outputKind != null) {
      if (event is KeyDownEvent) _openOutput(outputKind);
      return KeyEventResult.handled;
    }
    if ((key == LogicalKeyboardKey.enter ||
            key == LogicalKeyboardKey.numpadEnter ||
            key == LogicalKeyboardKey.keyC) &&
        widget.detail != null &&
        widget.onOpenChat != null) {
      widget.onOpenChat!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _moveStep(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _moveStep(-1);
      return KeyEventResult.handled;
    }
    // `R` builds the steps when the file is missing and rebuilds them when it
    // exists; a held key repeats, so only the initial press may ask.
    if (key == LogicalKeyboardKey.keyR &&
        widget.onGenerateSteps != null &&
        widget.detail != null) {
      if (event is KeyDownEvent) unawaited(_generateSteps());
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.space || key == LogicalKeyboardKey.keyX) {
      // A held key repeats: only the initial press may write.
      if (event is KeyDownEvent) _toggleSelected();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _focus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(),
          if (widget.loading && widget.detail != null)
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          if (_readerVisible && _search.open)
            DocumentSearchBar(
              controller: _search,
              onClose: _closeSearch,
              onSubmit: _focus.requestFocus,
            ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _header() {
    // Measured on the pane, not the window: the rail is 64–208 px of the
    // window, so `MediaQuery` said "roomy" while the header had 200 px less.
    return LayoutBuilder(
      builder: (context, constraints) => _headerAt(constraints.maxWidth),
    );
  }

  Widget _headerAt(double width) {
    final theme = Theme.of(context);
    final detail = widget.detail;
    final compact = width < Breakpoints.hint;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to sessions',
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
                  detail == null || detail.name.isEmpty
                      ? 'session'
                      : detail.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                if (detail != null)
                  Text(
                    _subtitle(detail),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                    ),
                  ),
              ],
            ),
          ),
          if (detail?.archived ?? false) ...[
            const SizedBox(width: 10),
            const ArchivedBadge(),
          ],
          if (detail != null && widget.onOpenSettings != null) ...[
            const SizedBox(width: 8),
            if (compact)
              IconButton(
                key: const ValueKey('session-settings-open'),
                tooltip: 'Edit instructions',
                onPressed: widget.onOpenSettings,
                icon: const Icon(Icons.tune, size: 18),
              )
            else
              OutlinedButton.icon(
                key: const ValueKey('session-settings-open'),
                onPressed: widget.onOpenSettings,
                icon: const Icon(Icons.tune, size: 16),
                label: const Text('Edit instructions'),
              ),
          ],
          if (detail != null) ...[
            const SizedBox(width: 12),
            FilledButton.icon(
              onPressed: widget.onOpenChat,
              icon: const Icon(Icons.forum_outlined, size: 16),
              label: const Text('Open chat'),
            ),
          ],
        ],
      ),
    );
  }

  String _subtitle(SessionDetail detail) {
    final sources = detail.sources.length;
    final label = sources == 1 ? 'source' : 'sources';
    return '${createdLabel(detail.created)} · $sources $label';
  }

  Widget _body() {
    final detail = widget.detail;
    if (detail == null) {
      if (widget.loading) {
        return const SessionLoading(label: 'loading session…');
      }
      final error = widget.error;
      if (error != null) {
        return _stateCard(
          icon: Icons.error_outline,
          tone: LockedInColors.error,
          title: 'could not open this session',
          body: error,
          actions: [
            if (widget.onRetry != null)
              FilledButton(
                onPressed: widget.onRetry,
                child: const Text('Retry'),
              ),
            if (widget.onBack != null)
              OutlinedButton(
                onPressed: widget.onBack,
                child: const Text('Back to sessions'),
              ),
          ],
        );
      }
      return _stateCard(
        icon: Icons.info_outline,
        tone: LockedInColors.warning,
        title: 'session unavailable',
        body:
            'The core returned no session for this id. Go back and pick one '
            'from the list.',
        actions: [
          if (widget.onBack != null)
            OutlinedButton(
              onPressed: widget.onBack,
              child: const Text('Back to sessions'),
            ),
        ],
      );
    }

    if (_readerVisible) return _documentReader();

    // A lock-in session is a **focus surface**, not a lecture
    // (`desktop/docs/redesign.md` §4a): the step you are on is the loudest
    // thing on screen, the ordered list sits beside it, and the files, memory
    // and coverage are demoted to context underneath. The user can already do
    // the work; the page's only job is to keep the next action obvious.
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= Breakpoints.columns;
        final centre = _centrePane(detail, includeSteps: !wide);
        if (!wide) return centre;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 328,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  Space.md,
                  Space.md,
                  Space.sm,
                  Space.xl,
                ),
                child: _stepsPane(detail),
              ),
            ),
            const VRule(),
            Expanded(child: centre),
          ],
        );
      },
    );
  }

  /// The centre: the current step, then everything that is context.
  ///
  /// `includeSteps` is true on a narrow window, where the step list has no
  /// column of its own and follows the current step instead.
  Widget _centrePane(SessionDetail detail, {required bool includeSteps}) {
    return ListView(
      key: SessionDetailView.pageScrollKey,
      controller: _pageScroll,
      padding: const EdgeInsets.fromLTRB(
        Space.lg,
        Space.md,
        Space.lg,
        Space.xxl,
      ),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  _errorBanner(widget.error!),
                  const SizedBox(height: Space.sm),
                ],
                _currentStepHero(detail),
                if (includeSteps) ...[
                  const SizedBox(height: Space.md),
                  _stepsPane(detail),
                ],
                const SizedBox(height: Space.lg),
                _promptCard(detail),
                const SizedBox(height: Space.md),
                _sourcesCard(detail),
                if (widget.onExtractFigure != null ||
                    widget.figures.isNotEmpty) ...[
                  const SizedBox(height: Space.md),
                  _figuresCard(),
                ],
                const SizedBox(height: Space.md),
                _memoryCard(detail),
                const SizedBox(height: Space.md),
                _mistakesCard(),
                if (_coverageWired) ...[
                  const SizedBox(height: Space.md),
                  _coverageCard(),
                ],
                const SizedBox(height: Space.md),
                _studyToolsCard(),
                const SizedBox(height: Space.lg),
                const Rule(),
                const SizedBox(height: Space.xs),
                Text(
                  _stepsHint(
                    interactive: widget.onToggleStep != null,
                    canGenerate: widget.onGenerateSteps != null,
                    canSettings: widget.onOpenSettings != null,
                    canOutputs: widget.onOpenOutput != null,
                  ),
                  key: const ValueKey('session-keys'),
                  style: LockedInType.micro.copyWith(
                    color: LockedInColors.muted,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The one step in front: its text, where it sits, and how far the session is.
  ///
  /// Nothing else on the page is this large. That is the whole design of a
  /// focus surface — the work is the only thing competing for attention.
  Widget _currentStepHero(SessionDetail detail) {
    final steps = detail.steps;
    final ready = steps.exists && steps.markdown.trim().isNotEmpty;
    final rows = ready ? parseSteps(steps.markdown) : const <StepRow>[];
    final tasks = [
      for (final row in rows)
        if (row.index != null) row,
    ];
    if (!ready || tasks.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionLabel('current step'),
          const SizedBox(height: Space.xs),
          Text(
            ready ? 'this session has no steps yet' : 'steps not built yet',
            key: const ValueKey('session-hero-empty'),
            style: LockedInType.title.copyWith(color: LockedInColors.muted),
          ),
        ],
      );
    }

    final index = _selectedStep.clamp(0, tasks.length - 1);
    final row = tasks[index];
    final checked = row.checked ?? false;
    final done = steps.done;
    final total = steps.total;
    final fraction = total == 0 ? 0.0 : done / total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            // `SectionLabel` is itself a Row: a bare Row child would get
            // unbounded width.
            Expanded(
              child: SectionLabel('step ${index + 1} of ${tasks.length}'),
            ),
            ValueChip(
              checked ? 'done' : 'next',
              tone: checked ? LockedInColors.success : LockedInColors.primary,
            ),
          ],
        ),
        const SizedBox(height: Space.xs),
        // The step itself: display size, mono, wrapped at the reading measure.
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: Space.proseMeasure),
          child: Text(
            row.text,
            key: const ValueKey('session-hero-step'),
            style: LockedInType.display.copyWith(
              color: checked ? LockedInColors.muted : LockedInColors.foreground,
              fontSize: TypeScale.display,
              height: 1.35,
              decoration: checked ? TextDecoration.lineThrough : null,
            ),
          ),
        ),
        const SizedBox(height: Space.md),
        Meter(value: fraction),
        const SizedBox(height: Space.xs),
        Row(
          children: [
            Text(
              '$done of $total done',
              style: LockedInType.micro.copyWith(
                color: LockedInColors.muted,
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
              ),
            ),
            const Spacer(),
            // The page's key row at the foot already names every key; this is
            // the position, so the hero stays one line at 480 px.
            Text(
              'step ${index + 1} / ${tasks.length}',
              style: LockedInType.micro.copyWith(
                color: LockedInColors.muted,
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// The ordered list: the map beside the step, and the session's progress.
  Widget _stepsPane(SessionDetail detail) {
    final steps = detail.steps;
    final ready = steps.exists && steps.markdown.trim().isNotEmpty;
    final complete = steps.total > 0 && steps.done >= steps.total;
    final canGenerate = widget.onGenerateSteps != null;
    final generating = widget.generatingSteps || _requestingSteps;
    final rows = ready ? parseSteps(steps.markdown) : const <StepRow>[];
    final tasks = [
      for (final row in rows)
        if (row.index != null) row.index!,
    ];
    final selected = tasks.isEmpty
        ? null
        : _selectedStep.clamp(0, tasks.length - 1);
    final error = _stepsError;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(child: SectionLabel('steps')),
            Text(
              ready ? '${steps.done}/${steps.total} steps' : 'no steps',
              style: LockedInType.micro.copyWith(
                color: ready && complete
                    ? LockedInColors.success
                    : LockedInColors.muted,
                fontWeight: FontWeight.w600,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
        const SizedBox(height: Space.xs),
        if (ready)
          for (final row in rows)
            _stepRow(row, selected: row.index != null && row.index == selected)
        else
          SessionEmptyNote(
            tone: LockedInColors.warning,
            title: 'steps missing',
            body: canGenerate
                ? 'This session has no assignment-steps.md yet. Build it from '
                      'the session sources; the plan is generated once and saved '
                      'to the session.'
                : 'This session has no assignment-steps.md yet. Open the chat '
                      'and press R to build the steps.',
          ),
        if (canGenerate && !ready) ...[
          const SizedBox(height: Space.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              key: const ValueKey('steps-generate'),
              onPressed: generating ? null : () => unawaited(_generateSteps()),
              style: FilledButton.styleFrom(
                backgroundColor: LockedInColors.primary,
                foregroundColor: Theme.of(context).colorScheme.onPrimary,
              ),
              child: Text(generating ? 'building steps…' : 'build steps'),
            ),
          ),
        ],
        if (ready && canGenerate) ...[
          const SizedBox(height: Space.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: const ValueKey('steps-regenerate'),
              onPressed: generating ? null : () => unawaited(_generateSteps()),
              child: Text(generating ? 'rebuilding…' : 'rebuild steps'),
            ),
          ),
        ],
        if (_toggling) ...[
          const SizedBox(height: Space.xs),
          Text(
            'saving step…',
            style: LockedInType.micro.copyWith(color: LockedInColors.muted),
          ),
        ],
        if (_toggleError != null) ...[
          const SizedBox(height: Space.xs),
          _stepError(_toggleError!),
        ],
        if (error != null) ...[
          const SizedBox(height: Space.xs),
          _generationError(
            error,
            onRetry: generating ? null : () => unawaited(_generateSteps()),
          ),
        ],
      ],
    );
  }

  /// Figures cropped from the session's own PDF, with the form that adds one.
  ///
  /// The PDF is the session's copied source, never an arbitrary path; the core
  /// confines and renders it. The image bytes are loaded on demand so opening a
  Widget _studyButton({
    required String keyName,
    required IconData icon,
    required String label,
    required VoidCallback? onPressed,
  }) {
    return OutlinedButton.icon(
      key: ValueKey(keyName),
      onPressed: onPressed,
      icon: Icon(icon, size: 16),
      label: Text(label),
    );
  }

  /// The generated document reader: one layer over the detail, so `Esc` returns
  /// to the session and the chat/steps are untouched.
  Widget _documentReader() {
    final error = _documentError;
    final text = widget.documentText;
    final name = (widget.documentName ?? '').trim();
    return ListView(
      controller: _documentScroll,
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: _card(
              label: 'GENERATED SESSION DOCUMENT',
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (name.isNotEmpty) ...[
                    _countChip(name),
                    const SizedBox(width: 8),
                  ],
                  TextButton(
                    key: const ValueKey('study-document-close'),
                    onPressed: widget.onCloseDocument,
                    child: const Text('Close'),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (widget.documentLoading)
                    Row(
                      children: [
                        SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: LockedInColors.primary,
                          ),
                        ),
                        SizedBox(width: 10),
                        Text(
                          'generating…',
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.label,
                          ),
                        ),
                      ],
                    )
                  else if (error != null)
                    _documentFailure(error)
                  else
                    ChatMarkdown(text: text ?? ''),
                  const SizedBox(height: 14),
                  Text(
                    'This is a generated session document, not a source. It is '
                    'saved in the session and never counts towards source '
                    'coverage.',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// One readable generation refusal with the retry that makes it actionable.
  Widget _documentFailure(String message) {
    return Container(
      key: const ValueKey('study-document-error'),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 15, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'could not generate this document',
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: TypeScale.key,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message,
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: TypeScale.label,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: const ValueKey('study-document-retry'),
            onPressed: widget.onRetryDocument == null || widget.documentLoading
                ? null
                : () => unawaited(_retryDocument()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  /// The page's key row: only the actions the shell wired, so a read-only
}
