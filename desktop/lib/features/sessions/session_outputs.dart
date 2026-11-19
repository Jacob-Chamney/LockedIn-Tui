import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/protocol.dart';
import '../../effects/effect.dart';
import '../../theme/palette.dart';
import '../chat/document_search.dart';
import '../chat/markdown.dart';
import 'deck.dart';
import 'flip_card.dart';

/// The session output reader: a study guide or a flashcard deck.
///
/// An output is a **generated output, not a source**: it is built from the
/// session's own material, saved inside the session folder and never counted as
/// a source or a citable fact. The reader is a layer above the session detail,
/// so `Esc` returns to the detail without leaving the session.
///
/// The shell owns every core call. The view only renders [markdown] and
/// [answers], asks for a build, an answers read or a card mark through the
/// callbacks, and tracks the presentation state the store does not need: whether
/// the answers panel is expanded, and the deck's cursor, reveal and filter.
///
/// A flashcard deck is interactive only when [onMarkCard] is wired, because a
/// mark writes the deck through the core. With no callback the reader shows the
/// deck as Markdown and says so, so it never advertises a dead key.
class SessionOutputView extends StatefulWidget {
  const SessionOutputView({
    super.key,
    required this.sessionName,
    required this.kind,
    required this.markdown,
    required this.answers,
    required this.exists,
    required this.loading,
    required this.error,
    this.cardsMarkdown,
    this.onBuild,
    this.onReadAnswers,
    this.onMarkCard,
    this.onRetry,
    this.onBack,
  });

  /// The open session's name, shown under the reader's header.
  final String sessionName;

  /// `study-guide` or `flashcards`.
  final String kind;

  /// The guide or deck the reader renders; null until the first answer.
  final String? markdown;

  /// The guide's answers document; null until the answers part is read, an
  /// empty string when the core answered that it does not exist yet.
  final String? answers;

  /// False is the documented empty state: the reader offers to build it.
  final bool exists;

  /// True while a read or build is in flight.
  final bool loading;

  /// One readable page-local failure, shown inline with a retry.
  final String? error;

  /// The deck document the interactive reader parses.
  ///
  /// It is the same `flashcards.md` as [markdown] for a deck, but kept separate
  /// because a mark re-reads the deck: the shell passes the fresh primary
  /// document here while the header still renders the last one. Null means the
  /// view keeps the deck it already parsed.
  final String? cardsMarkdown;

  /// Build or rebuild this output (`session.output.build`). Null keeps the
  /// reader read-only so it never advertises an action that cannot run.
  final Future<void> Function()? onBuild;

  /// Read the guide's answers part (`session.output.read` with `part: answers`).
  final Future<void> Function()? onReadAnswers;

  /// Record one card verdict through the shell's `review.mark`.
  ///
  /// [cardId] is the deck's own `card-N` and [result] is `known` or `missed`.
  /// Null keeps the deck read-only. The shell writes the deck and re-reads it,
  /// so the view never rewrites `M:`/`K:` itself.
  final Future<void> Function(String cardId, String result)? onMarkCard;

  /// Ask again for the request that failed.
  final Future<void> Function()? onRetry;

  /// Return to the session detail. `Esc` and the header's back control use it.
  final VoidCallback? onBack;

  @override
  State<SessionOutputView> createState() => _SessionOutputViewState();
}

class _SessionOutputViewState extends State<SessionOutputView> {
  final _scroll = ScrollController();

  /// The reader's keyboard node. The document search gives it focus back when
  /// it closes, so `j`/`k` and the deck keys work without a second click.
  final _focus = FocusNode(debugLabel: 'session-output');

  /// The in-document search over the guide or the deck Markdown.
  final _search = DocumentSearchController();

  /// The last match scrolled to, so a keystroke that does not move the match
  /// does not move the document.
  int _lastSearchStart = -1;

  /// Whether the guide's answers panel is expanded. This is presentation state:
  /// the answers text itself is cached by the store.
  var _showAnswers = false;

  /// True while the answers part is being read, so the panel says `reading…`
  /// instead of showing a blank body.
  var _answersLoading = false;

  /// The label for an in-flight build (`building…`), or null for a read.
  String? _pending;

  /// True when the last request was a build, so the inline error can say
  /// "could not build" rather than "could not open".
  var _lastWasBuild = false;

  /// The parsed deck and its cursor/reveal/filter, when the reader can mark.
  DeckViewState? _deck;

  /// The document [DeckViewState] was parsed from, so a rebuild is one parse and
  /// an unchanged document is not re-parsed on every frame.
  String? _deckSource;

  /// True when the reader is showing the deck's raw Markdown instead of one
  /// card at a time. `d` toggles it.
  var _showMarkdown = false;

  /// True between a mark request and the deck re-read.
  var _marking = false;

  /// One inline mark failure. The previous deck stays on screen.
  String? _markError;

  bool get _isDeck => widget.kind == 'flashcards';

  /// True when the deck is a deck rather than a document: the shell wired the
  /// mark callback, so `k`/`m` can write through the core.
  bool get _deckMode => _isDeck && widget.onMarkCard != null;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearchChanged);
    _syncDeck();
  }

  @override
  void didUpdateWidget(covariant SessionOutputView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncDeck();
    _search.updateDocument(_searchDocument());
  }

  /// Parse the deck document once per new answer and keep the previous cursor.
  void _syncDeck() {
    if (!_isDeck) return;
    final source = widget.cardsMarkdown ?? widget.markdown;
    if (source == null || source == _deckSource) return;
    final parsed = parseFlashcards(source);
    _deckSource = source;
    final deck = _deck;
    if (deck == null) {
      _deck = DeckViewState(deck: parsed);
    } else {
      deck.update(parsed);
    }
  }

  @override
  void dispose() {
    _search.removeListener(_onSearchChanged);
    _search.dispose();
    _scroll.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// The text the search scans. A deck searches its raw Markdown, which is the
  /// same document the reader parses; a guide searches its rendered document.
  String _searchDocument() {
    if (_isDeck) {
      return widget.cardsMarkdown ?? widget.markdown ?? '';
    }
    return widget.markdown ?? '';
  }

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
  /// of the scroll extent. The count in the bar is the precise part.
  void _scrollToSearchMatch() {
    final fraction = _search.currentFraction;
    if (fraction == null || !_scroll.hasClients) return;
    final position = _scroll.position;
    final target = (fraction * position.maxScrollExtent)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (target == position.pixels) return;
    position.jumpTo(target);
  }

  /// The search keys. Returns null when the key belongs to the reader.
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

  void _scrollBy(double delta) {
    if (!_scroll.hasClients) return;
    final position = _scroll.position;
    final next = (position.pixels + delta)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (next == position.pixels) return;
    position.jumpTo(next);
  }

  Future<void> _toggleAnswers() async {
    if (_showAnswers) {
      setState(() => _showAnswers = false);
      return;
    }
    setState(() {
      _showAnswers = true;
      _answersLoading = true;
    });
    try {
      await widget.onReadAnswers?.call();
    } catch (_) {
      // The store records its own failure in `outputError`; a throwing host is
      // not allowed to take the reader down.
    } finally {
      if (mounted) setState(() => _answersLoading = false);
    }
  }

  /// Build the output, asking first when a rebuild would replace a document.
  Future<void> _build({required bool confirm}) async {
    final build = widget.onBuild;
    if (build == null || widget.loading || _pending != null) return;
    if (confirm) {
      final confirmed = await _confirmRebuild();
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _pending = 'building…';
      _lastWasBuild = true;
    });
    try {
      await build();
    } catch (_) {
      // Page-local failure: the store already put its message in `outputError`.
    } finally {
      if (mounted) setState(() => _pending = null);
    }
  }

  /// The one confirmation a rebuild needs. It names what happens instead of a
  /// generic "are you sure", and `Cancel` changes nothing.
  Future<bool> _confirmRebuild() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_isDeck ? 'rebuild flashcards?' : 'rebuild study guide?'),
        content: const Text('a rebuild replaces the generated document'),
        actions: [
          TextButton(
            key: const ValueKey('session-output-rebuild-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('session-output-rebuild-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Rebuild'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  Future<void> _retry() async {
    final retry = widget.onRetry;
    if (retry == null || widget.loading) return;
    try {
      await retry();
    } catch (_) {
      // The store records its own failure; see [_build].
    }
  }

  /// Record one card verdict. The shell writes the deck and re-reads it, so this
  /// only reports the failure; a successful answer arrives as a new
  /// [SessionOutputView.cardsMarkdown] and is parsed by [_syncDeck].
  Future<void> _mark(String result) async {
    final mark = widget.onMarkCard;
    final card = _deck?.current;
    if (mark == null || card == null || _marking) return;
    setState(() {
      _marking = true;
      _markError = null;
    });
    try {
      await mark(card.id, result);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _markError = _markMessage(failure));
    } finally {
      if (mounted) setState(() => _marking = false);
    }
  }

  /// The 0-based choice for a `1`–`4` key, or null for any other key.
  static int? _choiceIndex(LogicalKeyboardKey key) {
    const keys = [
      LogicalKeyboardKey.digit1,
      LogicalKeyboardKey.digit2,
      LogicalKeyboardKey.digit3,
      LogicalKeyboardKey.digit4,
      LogicalKeyboardKey.numpad1,
      LogicalKeyboardKey.numpad2,
      LogicalKeyboardKey.numpad3,
      LogicalKeyboardKey.numpad4,
    ];
    final at = keys.indexOf(key);
    if (at < 0) return null;
    return at % 4;
  }

  /// Answer the current four-choice card with choice [index].
  ///
  /// One answer per card: the state records it before the mark is awaited, so a
  /// second press is ignored. A wrong pick asks the shell for one `missed` mark
  /// through the single [SessionOutputView.onMarkCard] callback; a correct pick
  /// writes nothing and only marks the row here. The reader never writes a file
  /// or calls the core itself.
  void _answerChoice(int index) {
    final deck = _deck;
    if (deck == null) return;
    final card = deck.current;
    if (card == null || !card.isChoiceCard) return;
    if (!deck.answer(index)) return;
    final correct = card.choices[index].correct;
    // A correct choice is the one moment the app can celebrate without
    // interrupting anything: it rains confetti and the card turns over to the
    // answer. A wrong one stays put and records the miss.
    if (correct) EffectScope.of(context)?.play('confetti');
    setState(() {
      if (correct && !deck.showAnswer) deck.flip();
    });
    if (!correct) unawaited(_mark('missed'));
  }

  /// The core's own sentence when it sent one, otherwise the exception's.
  String _markMessage(Object failure) {
    if (failure is RpcException) {
      final data = failure.data;
      if (data is Map && data['message'] is String) {
        final message = (data['message'] as String).trim();
        if (message.isNotEmpty) return message;
      }
      return failure.message;
    }
    return failure.toString();
  }

  /// The deck's keys. They are scoped to a deck with a live mark callback, so a
  /// study guide, a read-only deck and raw Markdown keep their old bindings.
  KeyEventResult? _deckKey(LogicalKeyboardKey key, KeyEvent event) {
    if (!_deckMode) return null;
    if (key == LogicalKeyboardKey.keyD) {
      setState(() => _showMarkdown = !_showMarkdown);
      return KeyEventResult.handled;
    }
    if (_showMarkdown) return null;
    final deck = _deck;
    final down = event is KeyDownEvent;
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      // Enter advances to the next card in the deck's order and resets the
      // answered state, so one answer cannot leak into the next card.
      if (down && deck != null) setState(deck.next);
      return KeyEventResult.handled;
    }
    final choice = _choiceIndex(key);
    if (choice != null && deck != null && deck.current?.isChoiceCard == true) {
      // Alt/Ctrl/Meta+digit belongs to the shell (surface switching), never to
      // a card answer.
      final modified =
          HardwareKeyboard.instance.isAltPressed ||
          HardwareKeyboard.instance.isControlPressed ||
          HardwareKeyboard.instance.isMetaPressed;
      if (modified) return null;
      if (down) _answerChoice(choice);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.tab) {
      if (down && deck != null) setState(deck.flip);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyH || key == LogicalKeyboardKey.arrowLeft) {
      if (deck != null) setState(deck.previous);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyL ||
        key == LogicalKeyboardKey.arrowRight) {
      if (deck != null) setState(deck.next);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyM) {
      if (HardwareKeyboard.instance.isShiftPressed) {
        if (down && deck != null) setState(deck.toggleMissedOnly);
      } else if (down) {
        unawaited(_mark('missed'));
      }
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyK) {
      if (down) unawaited(_mark('known'));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS) {
      if (down && deck != null) setState(deck.shuffle);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR) {
      // Shift+R keeps its old meaning: rebuild the generated deck.
      if (HardwareKeyboard.instance.isShiftPressed) return null;
      if (down && deck != null) setState(deck.reset);
      return KeyEventResult.handled;
    }
    return null;
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    // `/` opens the in-document search. While its field is focused bare keys
    // are text, so the deck keys resume only after Enter or Esc.
    final search = _searchKey(key);
    if (search != null) return search;
    if (_search.open && _search.typing) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.escape) {
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    final deckKey = _deckKey(key, event);
    if (deckKey != null) return deckKey;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _scrollBy(40);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _scrollBy(-40);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.pageDown || key == LogicalKeyboardKey.keyD) {
      _scrollBy(320);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.pageUp || key == LogicalKeyboardKey.keyU) {
      _scrollBy(-320);
      return KeyEventResult.handled;
    }
    // Only the initial press may start a read or a provider run.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    // The study guide's verbs are the terminal app's: Enter reveals or hides
    // the answer under the reader, `b` builds the guide. `a` and `R` stay as
    // aliases so a hand used to the desktop build is not punished.
    if (!_isDeck &&
        (key == LogicalKeyboardKey.enter ||
            key == LogicalKeyboardKey.numpadEnter ||
            key == LogicalKeyboardKey.keyA) &&
        widget.onReadAnswers != null &&
        widget.exists) {
      unawaited(_toggleAnswers());
      return KeyEventResult.handled;
    }
    if ((key == LogicalKeyboardKey.keyB || key == LogicalKeyboardKey.keyR) &&
        widget.onBuild != null) {
      unawaited(_build(confirm: widget.exists));
      return KeyEventResult.handled;
    }
    // Leave shell shortcuts (Alt+1…9, Ctrl+K) to their own handlers.
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
          if (widget.loading)
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          if (_search.open)
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
    final theme = Theme.of(context);
    final title = _isDeck ? 'FLASHCARDS' : 'STUDY GUIDE';
    final name = widget.sessionName.trim();
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('session-output-back'),
            tooltip: 'Back to session',
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
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: LockedInColors.primary,
                    letterSpacing: 1.2,
                  ),
                ),
                Text(
                  name.isEmpty ? 'session' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          _chip('generated · not a source'),
        ],
      ),
    );
  }

  Widget _body() {
    return ListView(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  _error(widget.error!),
                  const SizedBox(height: 12),
                ],
                _card(
                  label: _isDeck ? 'DECK' : 'GUIDE',
                  trailing: _trailing(),
                  child: _document(),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _trailing() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_deckMode)
          TextButton(
            key: const ValueKey('session-output-mode'),
            onPressed: () => setState(() => _showMarkdown = !_showMarkdown),
            child: Text(_showMarkdown ? 'deck' : 'markdown'),
          ),
        if (!_isDeck && widget.exists && widget.onReadAnswers != null)
          TextButton(
            key: const ValueKey('session-output-answers'),
            onPressed: () => unawaited(_toggleAnswers()),
            child: Text(_showAnswers ? 'hide answers' : 'answers'),
          ),
        if (widget.exists && widget.onBuild != null)
          TextButton(
            key: const ValueKey('session-output-rebuild'),
            onPressed: widget.loading || _pending != null
                ? null
                : () => unawaited(_build(confirm: true)),
            child: const Text('rebuild'),
          ),
        TextButton(
          key: const ValueKey('session-output-close'),
          onPressed: widget.onBack,
          child: const Text('Close'),
        ),
      ],
    );
  }

  Widget _document() {
    if (_deckMode) return _deckBody();
    final markdown = widget.markdown;
    if (widget.loading && markdown == null) return _loadingRow();
    if (!widget.exists) return _emptyState();
    if (markdown == null) return _loadingRow();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ChatMarkdown(text: markdown),
        if (!_isDeck && _showAnswers) ..._answersSection(),
        if (_isDeck) ...[
          const SizedBox(height: 14),
          Text(
            'Read-only deck. Flipping a card and marking it known or missed is '
            'a later packet; this view renders the deck exactly as it was '
            'built.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 11,
              height: 1.45,
            ),
          ),
        ],
        const SizedBox(height: 14),
        Text(
          'This is a generated output, not a source. It is built from this '
          'session\'s own material and never counts towards source coverage.',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 11,
            height: 1.45,
          ),
        ),
      ],
    );
  }

  /// The interactive deck: one card at a time, or the raw Markdown after `d`.
  Widget _deckBody() {
    final deck = _deck;
    if (deck == null) {
      return widget.loading ? _loadingRow() : _emptyState();
    }
    if (deck.total == 0) return _emptyState();
    if (_showMarkdown) {
      final markdown = widget.markdown ?? widget.cardsMarkdown ?? _deckSource;
      if (markdown == null || markdown.trim().isEmpty) {
        return widget.loading ? _loadingRow() : _emptyState();
      }
      return _deckMarkdown(markdown);
    }
    if (deck.isEmpty) return _deckDone(deck);
    return _deckCard(deck, deck.current!);
  }

  Widget _deckMarkdown(String markdown) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ChatMarkdown(text: markdown),
        const SizedBox(height: 14),
        Text(
          'Markdown view. Press d to read one card at a time.',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 11,
            height: 1.45,
          ),
        ),
      ],
    );
  }

  Widget _deckCard(DeckViewState deck, Flashcard card) {
    final revealed = deck.showAnswer;
    final choiceCard = card.isChoiceCard;
    return Column(
      key: const ValueKey('session-output-deck'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            _deckChip(
              'card ${deck.index + 1} / ${deck.length}',
              LockedInColors.primary,
            ),
            const Spacer(),
            if (deck.missedOnly) ...[
              _deckChip('missed only', LockedInColors.secondary),
              const SizedBox(width: 6),
            ],
            if (card.missed && !card.known) ...[
              _deckChip('missed', LockedInColors.warning),
              const SizedBox(width: 6),
            ],
            if (card.known) _deckChip('known', LockedInColors.success),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          card.question.isEmpty ? 'untitled card' : card.question,
          key: const ValueKey('deck-question'),
          style: TextStyle(
            color: LockedInColors.foreground,
            fontSize: 16,
            height: 1.45,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        // The question stays put; the panel under it turns over. That is the
        // card flip: the answer arrives on the back, and the multiple-choice
        // rows a learner answered are re-shown marked on that same back.
        FlipCard(
          showingBack: revealed,
          front: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // A four-choice card shows its rows immediately: `1`–`4` answers
              // it without a flip. Fewer than four choices keep the flip-only
              // behaviour and reveal the choices with the answer.
              if (choiceCard)
                for (var index = 0; index < card.choices.length; index++)
                  _deckChoice(deck, index, card.choices[index])
              else
                // The pointer path for the same action Space runs: a click on
                // the hint turns the card, so the flip is not keyboard-only.
                InkWell(
                  key: const ValueKey('deck-flip-surface'),
                  borderRadius: BorderRadius.circular(4),
                  onTap: () => setState(deck.flip),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        Icon(
                          Icons.flip_to_back,
                          size: 14,
                          color: LockedInColors.muted,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          'Tab flips the card',
                          key: const ValueKey('deck-hint-flip'),
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (choiceCard) ...[
                const SizedBox(height: 8),
                Text(
                  '1–4 answer · Enter next',
                  key: const ValueKey('deck-hint-choice'),
                  style: TextStyle(color: LockedInColors.muted, fontSize: 12),
                ),
              ],
            ],
          ),
          back: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ..._answerBody(card),
              if (card.hasChoices) ...[
                const SizedBox(height: 12),
                for (var index = 0; index < card.choices.length; index++)
                  _deckChoice(
                    deck,
                    index,
                    card.choices[index],
                    revealCorrect: true,
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton(
              key: const ValueKey('deck-prev'),
              onPressed: deck.index > 0 ? () => setState(deck.previous) : null,
              child: const Text('← prev'),
            ),
            FilledButton(
              key: const ValueKey('deck-flip'),
              onPressed: () => setState(deck.flip),
              child: Text(revealed ? 'show question' : 'flip'),
            ),
            OutlinedButton(
              key: const ValueKey('deck-next'),
              onPressed: deck.index < deck.length - 1
                  ? () => setState(deck.next)
                  : null,
              child: const Text('next →'),
            ),
            OutlinedButton(
              key: const ValueKey('deck-missed'),
              onPressed: _marking ? null : () => unawaited(_mark('missed')),
              child: const Text('m missed'),
            ),
            OutlinedButton(
              key: const ValueKey('deck-known'),
              onPressed: _marking ? null : () => unawaited(_mark('known')),
              child: const Text('k known'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton(
              key: const ValueKey('deck-shuffle'),
              onPressed: () => setState(deck.shuffle),
              child: const Text('s shuffle'),
            ),
            OutlinedButton(
              key: const ValueKey('deck-reset'),
              onPressed: () => setState(deck.reset),
              child: const Text('r reset'),
            ),
            OutlinedButton(
              key: const ValueKey('deck-missed-only'),
              onPressed: () => setState(deck.toggleMissedOnly),
              child: Text(
                deck.missedOnly ? 'M show all cards' : 'M missed only',
              ),
            ),
          ],
        ),
        if (_marking) ...[
          const SizedBox(height: 10),
          Text(
            'marking…',
            key: ValueKey('deck-marking'),
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ],
        if (_markError != null) ...[
          const SizedBox(height: 10),
          _markFailure(_markError!),
        ],
        const SizedBox(height: 12),
        Text(
          '${deck.knownCount} known · ${deck.missedCount} missed',
          key: const ValueKey('deck-counts'),
          style: TextStyle(color: LockedInColors.muted, fontSize: 11),
        ),
        const SizedBox(height: 6),
        Text(
          choiceCard
              ? '1–4 answer · Enter next · h/l move · k known · m missed · '
                    's shuffle · r reset · M missed only · d markdown'
              : 'Tab flip · h/l move · k known · m missed · s shuffle · '
                    'r reset · M missed only · d markdown',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 11,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'This is a generated output, not a source. It is built from this '
          'session\'s own material and never counts towards source coverage.',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 11,
            height: 1.45,
          ),
        ),
      ],
    );
  }

  /// The deck with nothing left to browse: every card is known, or the missed
  /// filter matched none. It names which of the two it is and offers the way
  /// back, so it is never an empty screen.
  Widget _deckDone(DeckViewState deck) {
    final filtered = deck.missedOnly;
    return Column(
      key: const ValueKey('deck-empty'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              filtered ? Icons.filter_alt_outlined : Icons.check_circle_outline,
              size: 15,
              color: filtered
                  ? LockedInColors.secondary
                  : LockedInColors.success,
            ),
            const SizedBox(width: 6),
            Text(
              filtered ? 'no missed cards right now' : 'all cards known',
              style: TextStyle(
                color: filtered
                    ? LockedInColors.secondary
                    : LockedInColors.success,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          '${deck.knownCount} known · ${deck.missedCount} missed',
          key: const ValueKey('deck-counts'),
          style: TextStyle(color: LockedInColors.muted, fontSize: 11),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (filtered)
              OutlinedButton(
                key: const ValueKey('deck-missed-only'),
                onPressed: () => setState(() => deck.setMissedOnly(false)),
                child: const Text('show all cards'),
              ),
            OutlinedButton(
              key: const ValueKey('deck-reset'),
              onPressed: () => setState(deck.reset),
              child: const Text('r reset'),
            ),
          ],
        ),
        if (_markError != null) ...[
          const SizedBox(height: 10),
          _markFailure(_markError!),
        ],
        const SizedBox(height: 12),
        Text(
          'A known card leaves the deck; a missed card stays until it is marked '
          'known or the deck is rebuilt.',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 11,
            height: 1.45,
          ),
        ),
      ],
    );
  }

  /// The revealed answer's body, shared by four-choice cards (where the choices
  /// are already on screen) and flip-only cards.
  List<Widget> _answerBody(Flashcard card) {
    return [
      Divider(height: 1, thickness: 1, color: LockedInColors.line),
      const SizedBox(height: 10),
      Text(
        'ANSWER',
        style: TextStyle(
          color: LockedInColors.secondary,
          fontSize: 10,
          letterSpacing: 1.4,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 6),
      Text(
        card.answer.isEmpty ? 'no answer recorded' : card.answer,
        key: const ValueKey('deck-answer'),
        style: TextStyle(
          color: LockedInColors.foreground,
          fontSize: 13.5,
          height: 1.5,
        ),
      ),
    ];
  }

  /// One multiple-choice row: its `1`–`4` number, the answer mark and the text.
  ///
  /// Before an answer every row is neutral. After one, a wrong pick is the error
  /// tone with `×` and the correct row is the success tone with `✓`. A flip-only
  /// card passes [revealCorrect] so its legacy flip still shows the correct row.
  Widget _deckChoice(
    DeckViewState deck,
    int index,
    FlashcardChoice choice, {
    bool revealCorrect = false,
  }) {
    final picked = deck.answerIndex == index;
    final wrong = deck.answered && picked && !choice.correct;
    final showCorrect = choice.correct && (revealCorrect || deck.answered);
    final mark = wrong
        ? '×'
        : showCorrect
        ? '✓'
        : '';
    final tone = wrong
        ? LockedInColors.error
        : showCorrect
        ? LockedInColors.success
        : LockedInColors.foreground;
    final number = '${index + 1}';
    final answerable = !deck.answered && !revealCorrect;
    // The pointer is an accelerator for `1`–`4`, never a second path: the row
    // is tappable while the card is unanswered and inert afterwards, exactly
    // like the keys.
    return Padding(
      key: ValueKey('deck-choice-$number'),
      padding: const EdgeInsets.only(bottom: 4),
      child: InkWell(
        borderRadius: BorderRadius.circular(4),
        onTap: answerable ? () => _answerChoice(index) : null,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 18,
              child: Text(
                number,
                key: ValueKey('deck-choice-$number-number'),
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ),
            SizedBox(
              width: 18,
              child: Text(
                mark,
                key: ValueKey('deck-choice-$number-mark'),
                style: TextStyle(
                  color: tone,
                  fontSize: 13,
                  height: 1.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                choice.text,
                key: ValueKey('deck-choice-$number-text'),
                style: TextStyle(color: tone, fontSize: 12.5, height: 1.45),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _deckChip(String text, Color tone) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: tone,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _markFailure(String message) {
    return Container(
      key: const ValueKey('deck-mark-error'),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 15, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.error,
                fontSize: 12,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _answersSection() {
    final answers = widget.answers;
    return [
      const SizedBox(height: 16),
      Divider(height: 1, thickness: 1, color: LockedInColors.line),
      const SizedBox(height: 10),
      Text(
        'ANSWERS',
        style: TextStyle(
          color: LockedInColors.secondary,
          fontSize: 10,
          letterSpacing: 1.4,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 8),
      if (answers != null && answers.trim().isNotEmpty)
        ChatMarkdown(text: answers)
      else if (_answersLoading)
        Text(
          'reading…',
          style: TextStyle(color: LockedInColors.muted, fontSize: 11),
        )
      else if (answers != null)
        Text(
          'no answers document yet — rebuild the guide to create one',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 12,
            height: 1.45,
          ),
        )
      else
        Text(
          'the answers part is not loaded yet',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 12,
            height: 1.45,
          ),
        ),
    ];
  }

  Widget _emptyState() {
    final busy = widget.loading || _pending != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.info_outline, size: 14, color: LockedInColors.warning),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                _isDeck ? 'no flashcard deck yet' : 'no study guide yet',
                style: TextStyle(
                  color: LockedInColors.warning,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          _isDeck
              ? 'A deck is built from this session\'s own sources and saved as '
                    'a generated output. It is never counted as a source.'
              : 'A study guide is built from this session\'s own sources, with '
                    'a matching answers document, and saved as a generated '
                    'output. It is never counted as a source.',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 12,
            height: 1.45,
          ),
        ),
        if (widget.onBuild != null) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              key: const ValueKey('session-output-build'),
              onPressed: busy ? null : () => unawaited(_build(confirm: false)),
              icon: busy
                  ? const Icon(Icons.hourglass_top, size: 16)
                  : const Icon(Icons.auto_awesome_outlined, size: 16),
              label: Text(
                busy
                    ? 'building…'
                    : _isDeck
                    ? 'build flashcards'
                    : 'build study guide',
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _loadingRow() {
    return Row(
      children: [
        SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: LockedInColors.primary,
          ),
        ),
        const SizedBox(width: 10),
        Text(
          _pending ?? 'reading…',
          style: TextStyle(color: LockedInColors.muted, fontSize: 12),
        ),
      ],
    );
  }

  /// One readable failure with the retry that makes it actionable. The previous
  /// document, when there is one, stays above it.
  Widget _error(String message) {
    return Container(
      key: const ValueKey('session-output-error'),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(6),
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
                    _lastWasBuild
                        ? 'could not build this output'
                        : 'could not open this output',
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message,
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: 12,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: const ValueKey('session-output-retry'),
            onPressed: widget.onRetry == null || widget.loading
                ? null
                : () => unawaited(_retry()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _card({
    required String label,
    required Widget child,
    Widget? trailing,
  }) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: LockedInColors.secondary,
                  letterSpacing: 1.4,
                ),
              ),
              const Spacer(),
              ?trailing,
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }

  Widget _chip(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
