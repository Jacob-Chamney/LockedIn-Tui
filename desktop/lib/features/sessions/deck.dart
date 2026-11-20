import 'dart:math';

// The private initialising fields cannot be named parameters in Dart, so the
// constructor assigns them; that is the lint's own suggestion, not a fix.
// ignore_for_file: prefer_initializing_formals

/// One flashcard and its saved review state.
///
/// The deck Markdown is the truth (`docs/data-model.md` §7.2): [missed] and
/// [known] mirror the `M:`/`K:` lines, and the card [id] is the `card-N` the
/// core's `review.mark` takes.
class Flashcard {
  const Flashcard({
    required this.id,
    required this.question,
    required this.answer,
    required this.missed,
    required this.known,
    required this.choices,
  });

  /// `card-1`, `card-2`, … — the ordinal in the deck, not the heading text.
  final String id;
  final String question;
  final String answer;
  final bool missed;
  final bool known;
  final List<FlashcardChoice> choices;

  bool get hasChoices => choices.isNotEmpty;

  /// True when the card is a multiple-choice card: exactly four choices, the
  /// shape the reader answers with `1`–`4` (`docs/product.md` §5.3). Fewer
  /// choices keep the plain flip behaviour.
  bool get isChoiceCard => choices.length == 4;
}

/// One multiple-choice row from a card's `### Choices` section.
class FlashcardChoice {
  const FlashcardChoice({required this.text, required this.correct});

  final String text;
  final bool correct;
}

/// A parsed `flashcards.md`.
class FlashcardDeck {
  const FlashcardDeck({required this.title, required this.cards});

  static const empty = FlashcardDeck(title: '', cards: <Flashcard>[]);

  final String title;
  final List<Flashcard> cards;

  bool get isEmpty => cards.isEmpty;

  int get knownCount => cards.where((card) => card.known).length;

  /// A known card is not missed, so a stale `M: yes` cannot double-count.
  int get missedCount =>
      cards.where((card) => card.missed && !card.known).length;
}

/// Parse a `flashcards.md` document (`docs/data-model.md` §7.2).
///
/// The format is one `## Card N` block per card with `Q:`, `A:`, `M:` and `K:`
/// lines and an optional `### Choices` list. Every section is tolerated as
/// missing: a deck with only questions, only answers, or no headings at all
/// still parses, so the reader never fails to open a file the core accepted.
FlashcardDeck parseFlashcards(String markdown) {
  final cards = <Flashcard>[];
  final title = StringBuffer();
  String? question;
  String? answer;
  var missed = false;
  var known = false;
  final choices = <FlashcardChoice>[];
  var inChoices = false;

  void flush() {
    final q = (question ?? '').trim();
    final a = (answer ?? '').trim();
    if (q.isNotEmpty || a.isNotEmpty) {
      cards.add(
        Flashcard(
          id: 'card-${cards.length + 1}',
          question: q,
          answer: a,
          missed: missed,
          known: known,
          choices: List<FlashcardChoice>.unmodifiable(choices),
        ),
      );
    }
    question = null;
    answer = null;
    missed = false;
    known = false;
    choices.clear();
    inChoices = false;
  }

  for (final raw in markdown.split('\n')) {
    final line = raw.trimRight();
    final trimmed = line.trim();
    if (RegExp(r'^##\s+Card\b', caseSensitive: false).hasMatch(trimmed)) {
      flush();
      continue;
    }
    if (title.isEmpty && trimmed.startsWith('# ')) {
      title.write(trimmed.substring(2).trim());
      continue;
    }
    if (trimmed.toLowerCase() == '### choices') {
      inChoices = true;
      continue;
    }
    final choice = RegExp(r'^[-*]\s+\[([ xX])\]\s+(.*)$').firstMatch(trimmed);
    if (inChoices && choice != null) {
      choices.add(
        FlashcardChoice(
          text: choice.group(2)!.trim(),
          correct: choice.group(1)!.toLowerCase() == 'x',
        ),
      );
      continue;
    }
    final q = RegExp(r'^Q:\s?(.*)$').firstMatch(line);
    if (q != null) {
      // A second question without a heading starts the next card, so a deck
      // that dropped its headings still splits into cards.
      if ((question ?? '').trim().isNotEmpty) flush();
      question = q.group(1)!.trim();
      continue;
    }
    final a = RegExp(r'^A:\s?(.*)$').firstMatch(line);
    if (a != null) {
      answer = a.group(1)!.trim();
      continue;
    }
    final m = RegExp(
      r'^M:\s*(yes|no)\s*$',
      caseSensitive: false,
    ).firstMatch(line);
    if (m != null) {
      missed = m.group(1)!.toLowerCase() == 'yes';
      continue;
    }
    final k = RegExp(
      r'^K:\s*(yes|no)\s*$',
      caseSensitive: false,
    ).firstMatch(line);
    if (k != null) {
      known = k.group(1)!.toLowerCase() == 'yes';
    }
  }
  flush();

  return FlashcardDeck(title: title.toString(), cards: cards);
}

/// The presentation state of one deck: order, cursor, reveal and filter.
///
/// This is pure Dart with no widgets, so the reader's behaviour is testable
/// without pumping a frame, and the widget only mirrors it with `setState`.
///
/// A **known** card leaves the normal deck and a **missed** card stays, which
/// is the product's rule (`docs/product.md` §5.3). The cursor is a position in
/// the visible list, so a card leaving never skips the next one.
class DeckViewState {
  DeckViewState({
    required FlashcardDeck deck,
    List<int>? order,
    int index = 0,
    bool showAnswer = false,
    bool missedOnly = false,
  }) : _deck = deck,
       _order = List<int>.from(
         order ?? List<int>.generate(deck.cards.length, (value) => value),
       ),
       _index = index,
       _showAnswer = showAnswer,
       _missedOnly = missedOnly {
    _clampIndex();
  }

  FlashcardDeck _deck;
  final List<int> _order;
  int _index;
  bool _showAnswer;
  bool _missedOnly;

  /// The 0-based choice the learner tapped on the current card, or null while
  /// the card is unanswered. One answer per card: a second `1`–`4` press is
  /// ignored until the cursor moves (`docs/product.md` §5.3).
  int? _answerIndex;

  static List<int> _identity(int length) =>
      List<int>.generate(length, (value) => value);

  FlashcardDeck get deck => _deck;

  int get total => _deck.cards.length;

  int get knownCount => _deck.knownCount;

  int get missedCount => _deck.missedCount;

  /// The card ordinals currently browsable, in the deck's order.
  List<int> get visibleIndexes => <int>[
    for (final card in _order)
      if (_isVisible(card)) card,
  ];

  bool _isVisible(int index) {
    if (index < 0 || index >= _deck.cards.length) return false;
    final card = _deck.cards[index];
    if (card.known) return false;
    if (_missedOnly) return card.missed;
    return true;
  }

  int get length => visibleIndexes.length;

  bool get isEmpty => length == 0;

  int get index => _index;

  bool get showAnswer => _showAnswer;

  bool get missedOnly => _missedOnly;

  /// The choice the learner picked on the current card, or null.
  int? get answerIndex => _answerIndex;

  /// True once the current card has an answer: further `1`–`4` presses are
  /// ignored, so one answer cannot mark the card twice.
  bool get answered => _answerIndex != null;

  /// The current card is a four-choice card the reader can answer.
  bool get isChoiceCard => current?.isChoiceCard ?? false;

  Flashcard? get current {
    final visible = visibleIndexes;
    if (visible.isEmpty) return null;
    final at = _index.clamp(0, visible.length - 1);
    return _deck.cards[visible[at]];
  }

  /// Record [choiceIndex] as the answer for the current four-choice card.
  ///
  /// Returns true only for a new answer; a second press on the same card, a
  /// non-choice card and an out-of-range index all return false and change
  /// nothing. The caller decides what a wrong answer means (one `missed`
  /// mark) because the mark is a core write, not deck state.
  bool answer(int choiceIndex) {
    final card = current;
    if (card == null || !card.isChoiceCard) return false;
    if (_answerIndex != null) return false;
    if (choiceIndex < 0 || choiceIndex >= card.choices.length) return false;
    _answerIndex = choiceIndex;
    return true;
  }

  void _clampIndex() {
    final max = length - 1;
    if (max < 0) {
      _index = 0;
      return;
    }
    if (_index < 0) _index = 0;
    if (_index > max) _index = max;
  }

  void flip() {
    if (current == null) return;
    _showAnswer = !_showAnswer;
  }

  void next() {
    final max = length - 1;
    if (max < 0) return;
    if (_index < max) _index += 1;
    _showAnswer = false;
    _answerIndex = null;
  }

  void previous() {
    if (_index > 0) _index -= 1;
    _showAnswer = false;
    _answerIndex = null;
  }

  void setMissedOnly(bool value) {
    if (_missedOnly == value) return;
    _missedOnly = value;
    _index = 0;
    _showAnswer = false;
    _answerIndex = null;
    _clampIndex();
  }

  void toggleMissedOnly() => setMissedOnly(!_missedOnly);

  void shuffle([Random? random]) {
    _order.shuffle(random ?? Random());
    _index = 0;
    _showAnswer = false;
    _answerIndex = null;
  }

  void reset() {
    _order
      ..clear()
      ..addAll(_identity(_deck.cards.length));
    _index = 0;
    _showAnswer = false;
    _missedOnly = false;
    _answerIndex = null;
  }

  /// Apply a freshly read deck after a mark, keeping the cursor on the same
  /// card when that card is still visible.
  void update(FlashcardDeck next) {
    final currentId = current?.id;
    final sameLength = next.cards.length == _order.length;
    final missing = !sameLength || _order.any((at) => at >= next.cards.length);
    _deck = next;
    if (missing) {
      _order
        ..clear()
        ..addAll(_identity(next.cards.length));
    }
    if (currentId != null) {
      final at = visibleIndexes.indexWhere(
        (value) => next.cards[value].id == currentId,
      );
      if (at >= 0) _index = at;
    }
    _clampIndex();
    if (isEmpty) _showAnswer = false;
    // An answered card keeps its marks across the mark-triggered re-read; a
    // different card (or no choice card at all) starts unanswered.
    final card = current;
    final keptAnswer =
        card != null && card.id == currentId && card.isChoiceCard;
    if (!keptAnswer) {
      _answerIndex = null;
    } else if (_answerIndex != null && _answerIndex! >= card.choices.length) {
      _answerIndex = null;
    }
    // A card that left the deck (marked known, or filtered out) hands the deck
    // to its neighbour: the flip belongs to the card, not the position. Without
    // this the next card arrived already showing its answer.
    if (currentId != null && card?.id != currentId) _showAnswer = false;
  }
}
