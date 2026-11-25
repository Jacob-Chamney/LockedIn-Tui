import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/deck.dart';
import 'package:lockedin_desktop/effects/effect.dart';
import 'package:lockedin_desktop/features/sessions/session_outputs.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

const _sessionName = 'Physics — Unit 4';

/// Two cards: the first is fresh, the second is already missed. It exercises
/// the normal deck and the missed-only filter in one fixture.
const _deck =
    '# Flashcards — Physics\n\n'
    '## Card 1\n\n'
    'Q: What does the learning rate control?\n'
    'A: The step size of each update.\n'
    'M: no\n'
    'K: no\n\n'
    '### Choices\n'
    '- [x] The step size of each update.\n'
    '- [ ] The number of layers.\n'
    '- [ ] The batch size.\n'
    '- [ ] The learning schedule.\n\n'
    '## Card 2\n\n'
    'Q: What is a stack frame?\n'
    'A: The memory a call reserves.\n'
    'M: yes\n'
    'K: no\n';

String _deckWith({bool card1Known = false}) =>
    '# Flashcards — Physics\n\n'
    '## Card 1\n\n'
    'Q: What does the learning rate control?\n'
    'A: The step size of each update.\n'
    'M: no\n'
    'K: ${card1Known ? 'yes' : 'no'}\n\n'
    '## Card 2\n\n'
    'Q: What is a stack frame?\n'
    'A: The memory a call reserves.\n'
    'M: yes\n'
    'K: no\n';

String _oneCard({bool missed = false, bool known = false}) =>
    '# Flashcards — Physics\n\n'
    '## Card 1\n\n'
    'Q: What does the learning rate control?\n'
    'A: The step size of each update.\n'
    'M: ${missed ? 'yes' : 'no'}\n'
    'K: ${known ? 'yes' : 'no'}\n';

/// Two four-choice cards, so `Enter` has a next card to advance to and the
/// answered state can be proved to reset. The first card can be marked by the
/// host, exactly like the core re-reading the deck after a mark.
String _choiceDeck({bool card1Missed = false, bool card1Known = false}) =>
    '# Flashcards — Physics\n\n'
    '## Card 1\n\n'
    'Q: Which quantity is conserved?\n'
    'A: Energy.\n'
    'M: ${card1Missed ? 'yes' : 'no'}\n'
    'K: ${card1Known ? 'yes' : 'no'}\n\n'
    '### Choices\n'
    '- [x] Energy.\n'
    '- [ ] Momentum.\n'
    '- [ ] Mass.\n'
    '- [ ] Charge.\n\n'
    '## Card 2\n\n'
    'Q: What does the learning rate control?\n'
    'A: The step size of each update.\n'
    'M: no\n'
    'K: no\n\n'
    '### Choices\n'
    '- [x] The step size of each update.\n'
    '- [ ] The number of layers.\n'
    '- [ ] The batch size.\n'
    '- [ ] The learning schedule.\n';

/// A single four-choice card, for the completion state after `k`.
String _oneChoiceCard({bool known = false}) =>
    '# Flashcards — Physics\n\n'
    '## Card 1\n\n'
    'Q: Which quantity is conserved?\n'
    'A: Energy.\n'
    'M: no\n'
    'K: ${known ? 'yes' : 'no'}\n\n'
    '### Choices\n'
    '- [x] Energy.\n'
    '- [ ] Momentum.\n'
    '- [ ] Mass.\n'
    '- [ ] Charge.\n';

/// A two-choice card: fewer than four choices keeps the flip-only behaviour.
String _twoChoiceDeck() =>
    '# Flashcards — Physics\n\n'
    '## Card 1\n\n'
    'Q: Which quantity is conserved?\n'
    'A: Energy.\n'
    'M: no\n'
    'K: no\n\n'
    '### Choices\n'
    '- [x] Energy.\n'
    '- [ ] Momentum.\n';

Future<EffectController> pumpDeck(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  // The real app mounts this above the shell; a deck pumped on its own needs
  // the same scope or a correct answer has nowhere to celebrate.
  final effects = EffectController();
  addTearDown(effects.dispose);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: EffectScope(
        controller: effects,
        child: EffectHost(
          controller: effects,
          child: Scaffold(body: child),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return effects;
}

SessionOutputView deckView({
  Key? key,
  String? markdown = _deck,
  String? cardsMarkdown,
  bool exists = true,
  bool loading = false,
  Future<void> Function(String cardId, String result)? onMarkCard,
  Future<void> Function()? onBuild,
  DeckSchedule? deckSchedule,
  bool deckScheduleLoading = false,
  String? deckScheduleError,
  Future<void> Function(int index, String grade)? onGradeCard,
  VoidCallback? onBack,
}) {
  return SessionOutputView(
    key: key ?? UniqueKey(),
    sessionName: _sessionName,
    kind: 'flashcards',
    markdown: markdown,
    cardsMarkdown: cardsMarkdown,
    answers: null,
    exists: exists,
    loading: loading,
    error: null,
    onMarkCard: onMarkCard,
    onBuild: onBuild,
    deckSchedule: deckSchedule,
    deckScheduleLoading: deckScheduleLoading,
    deckScheduleError: deckScheduleError,
    onGradeCard: onGradeCard,
    onBack: onBack,
  );
}

Future<void> pressShiftM(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pumpAndSettle();
}

/// The answer mark on the numbered row [number] (1–4).
Text _choiceMark(WidgetTester tester, int number) =>
    tester.widget<Text>(find.byKey(ValueKey('deck-choice-$number-mark')));

void main() {
  group('parseFlashcards', () {
    test('reads cards, choices and M/K state', () {
      final deck = parseFlashcards(_deck);

      expect(deck.title, 'Flashcards — Physics');
      expect(deck.cards, hasLength(2));

      final first = deck.cards.first;
      expect(first.id, 'card-1');
      expect(first.question, 'What does the learning rate control?');
      expect(first.answer, 'The step size of each update.');
      expect(first.missed, isFalse);
      expect(first.known, isFalse);
      expect(first.choices, hasLength(4));
      expect(first.choices.first.text, 'The step size of each update.');
      expect(first.choices.first.correct, isTrue);
      expect(first.choices[1].correct, isFalse);

      final second = deck.cards[1];
      expect(second.id, 'card-2');
      expect(second.question, 'What is a stack frame?');
      expect(second.missed, isTrue);
      expect(second.known, isFalse);
      expect(second.choices, isEmpty);

      expect(deck.knownCount, 0);
      expect(deck.missedCount, 1);
    });

    test('tolerates missing sections and missing headings', () {
      final bare = parseFlashcards('Q: A question?\nA: An answer.\n');
      expect(bare.cards, hasLength(1));
      expect(bare.cards.single.id, 'card-1');
      expect(bare.cards.single.question, 'A question?');
      expect(bare.cards.single.answer, 'An answer.');
      expect(bare.cards.single.missed, isFalse);
      expect(bare.cards.single.known, isFalse);
      expect(bare.cards.single.choices, isEmpty);

      // No headings and no blank line: a second Q starts the next card.
      final split = parseFlashcards('Q: One?\nA: 1.\nQ: Two?\nA: 2.\n');
      expect(split.cards.map((card) => card.id), ['card-1', 'card-2']);
      expect(split.cards.map((card) => card.question), ['One?', 'Two?']);

      // Headings with no question or answer do not become blank cards.
      final empty = parseFlashcards('## Card 1\n\n## Card 2\n');
      expect(empty.cards, isEmpty);
      expect(empty.isEmpty, isTrue);

      expect(parseFlashcards('').cards, isEmpty);
    });

    test('M/K are case-insensitive and a known card is never missed', () {
      final deck = parseFlashcards(
        '## Card 1\n\nQ: Q?\nA: A.\nM: YES\nK: Yes\n',
      );
      expect(deck.cards.single.missed, isTrue);
      expect(deck.cards.single.known, isTrue);
      expect(deck.knownCount, 1);
      // A known card cannot also count as missed, so the two counts never
      // exceed the deck.
      expect(deck.missedCount, 0);
    });
  });

  group('DeckViewState', () {
    test('flip, next and previous move the cursor', () {
      final state = DeckViewState(deck: parseFlashcards(_deck));

      expect(state.current!.id, 'card-1');
      expect(state.showAnswer, isFalse);

      state.flip();
      expect(state.showAnswer, isTrue);

      state.next();
      expect(state.current!.id, 'card-2');
      expect(state.showAnswer, isFalse);

      // The last card is the end of the deck, not a wrap-around.
      state.next();
      expect(state.current!.id, 'card-2');

      state.previous();
      expect(state.current!.id, 'card-1');
      state.previous();
      expect(state.current!.id, 'card-1');
    });

    test('a known card leaves the normal deck', () {
      final state = DeckViewState(
        deck: parseFlashcards(_deckWith(card1Known: true)),
      );
      expect(state.length, 1);
      expect(state.total, 2);
      expect(state.current!.id, 'card-2');
      expect(state.knownCount, 1);
    });

    test(
      'missed-only filters, shuffle keeps a permutation, reset restores',
      () {
        final state = DeckViewState(deck: parseFlashcards(_deck));

        state.setMissedOnly(true);
        expect(state.length, 1);
        expect(state.current!.id, 'card-2');

        state.setMissedOnly(false);
        expect(state.length, 2);

        state.next();
        state.flip();
        state.shuffle(Random(7));
        expect(state.index, 0);
        expect(state.showAnswer, isFalse);
        expect(state.visibleIndexes.toSet(), {0, 1});

        state.setMissedOnly(true);
        state.flip();
        state.reset();
        expect(state.missedOnly, isFalse);
        expect(state.index, 0);
        expect(state.showAnswer, isFalse);
        expect(state.visibleIndexes, [0, 1]);
      },
    );

    test('update keeps the cursor on the same card when it survives', () {
      final state = DeckViewState(deck: parseFlashcards(_deck));
      state.next();
      expect(state.current!.id, 'card-2');

      state.update(parseFlashcards(_deck));
      expect(state.current!.id, 'card-2');

      state.update(parseFlashcards(_deckWith(card1Known: true)));
      expect(state.current!.id, 'card-2');
    });

    test('an empty deck has no current card and ignores deck actions', () {
      final state = DeckViewState(deck: parseFlashcards(''));
      expect(state.isEmpty, isTrue);
      expect(state.current, isNull);
      state
        ..flip()
        ..next()
        ..previous()
        ..shuffle(Random(1))
        ..reset();
      expect(state.isEmpty, isTrue);
      expect(state.current, isNull);
      expect(state.showAnswer, isFalse);
    });

    test('answer records one choice per card and ignores a second press', () {
      final state = DeckViewState(deck: parseFlashcards(_choiceDeck()));

      expect(state.isChoiceCard, isTrue);
      expect(state.answered, isFalse);
      expect(state.answer(1), isTrue);
      expect(state.answered, isTrue);
      expect(state.answerIndex, 1);
      // One answer per card: a second press changes nothing.
      expect(state.answer(2), isFalse);
      expect(state.answerIndex, 1);

      // Moving resets the answered state, and the next card can be answered.
      state.next();
      expect(state.answered, isFalse);
      expect(state.answer(0), isTrue);
      state.previous();
      expect(state.answered, isFalse);

      state.answer(0);
      state.shuffle(Random(3));
      expect(state.answered, isFalse);
      state.answer(0);
      state.reset();
      expect(state.answered, isFalse);
    });

    test('answer ignores a plain card and an out-of-range choice', () {
      final plain = DeckViewState(deck: parseFlashcards(_oneCard()));
      expect(plain.isChoiceCard, isFalse);
      expect(plain.answer(0), isFalse);
      expect(plain.answered, isFalse);

      final choice = DeckViewState(deck: parseFlashcards(_twoChoiceDeck()));
      expect(choice.isChoiceCard, isFalse);
      expect(choice.answer(0), isFalse);

      final four = DeckViewState(deck: parseFlashcards(_choiceDeck()));
      expect(four.answer(4), isFalse);
      expect(four.answer(-1), isFalse);
      expect(four.answered, isFalse);
    });

    test(
      'update keeps an answer on the same card and clears it on a new one',
      () {
        final state = DeckViewState(deck: parseFlashcards(_choiceDeck()));
        state.answer(1);
        expect(state.answerIndex, 1);

        // The mark re-read keeps the same card and its answer marks.
        state.update(parseFlashcards(_choiceDeck(card1Missed: true)));
        expect(state.current!.id, 'card-1');
        expect(state.answered, isTrue);
        expect(state.answerIndex, 1);

        // A card that leaves the deck takes the answer with it.
        state.update(parseFlashcards(_choiceDeck(card1Known: true)));
        expect(state.current!.id, 'card-2');
        expect(state.answered, isFalse);
      },
    );
  });

  group('the deck reader', () {
    testWidgets('shows one question, a plain card flips with Tab, h/l move', (
      tester,
    ) async {
      await pumpDeck(tester, deckView(onMarkCard: (_, _) async {}));

      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(find.byKey(const ValueKey('deck-choice-1')), findsOneWidget);
      expect(find.text('card 1 / 2'), findsOneWidget);

      // Card 2 has no choices, so Tab reveals its answer (`Space` is the
      // leader, as in the terminal app).
      await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
      await tester.pumpAndSettle();
      expect(find.text('What is a stack frame?'), findsOneWidget);
      expect(find.text('The memory a call reserves.'), findsNothing);
      expect(find.text('card 2 / 2'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('deck-answer')), findsOneWidget);
      expect(find.text('The memory a call reserves.'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyH);
      await tester.pumpAndSettle();
      expect(find.text('What does the learning rate control?'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pumpAndSettle();
      expect(find.text('What is a stack frame?'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
      await tester.pumpAndSettle();
      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('m marks the card missed with its deck id and it stays', (
      tester,
    ) async {
      final calls = <String>[];
      var markdown = _oneCard();

      await pumpDeck(
        tester,
        StatefulBuilder(
          builder: (context, setState) => deckView(
            key: const ValueKey('deck-view'),
            markdown: markdown,
            cardsMarkdown: markdown,
            onMarkCard: (cardId, result) async {
              calls.add('$cardId:$result');
              setState(() => markdown = _oneCard(missed: true));
            },
          ),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
      await tester.pumpAndSettle();

      expect(calls, ['card-1:missed']);
      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(find.text('missed'), findsOneWidget);
      expect(find.text('0 known · 1 missed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('k marks the card known and it leaves the deck', (
      tester,
    ) async {
      final calls = <String>[];
      var markdown = _oneCard();

      await pumpDeck(
        tester,
        StatefulBuilder(
          builder: (context, setState) => deckView(
            key: const ValueKey('deck-view'),
            markdown: markdown,
            cardsMarkdown: markdown,
            onMarkCard: (cardId, result) async {
              calls.add('$cardId:$result');
              setState(() => markdown = _oneCard(known: true));
            },
          ),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
      await tester.pumpAndSettle();

      expect(calls, ['card-1:known']);
      expect(find.text('all cards known'), findsOneWidget);
      expect(find.text('1 known · 0 missed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('marking a flipped card known shows the next one closed', (
      tester,
    ) async {
      // Two cards: flipping card 1 and marking it known hands the deck to
      // card 2, which must arrive face-down with its choices hidden. The flip
      // used to stay on, so the answer of the next card was already showing.
      String deck = _choiceDeck();
      await pumpDeck(
        tester,
        StatefulBuilder(
          builder: (context, setState) => deckView(
            key: const ValueKey('deck-view'),
            markdown: deck,
            cardsMarkdown: deck,
            onMarkCard: (_, _) async {
              setState(() => deck = _choiceDeck(card1Known: true));
            },
          ),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();
      // The button names the other face, so its label is the flip state.
      expect(find.text('show question'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
      await tester.pumpAndSettle();

      expect(find.text('Which quantity is conserved?'), findsNothing);
      expect(find.text('What does the learning rate control?'), findsOneWidget);
      // Face-down again: the next card's answer is not on screen yet.
      expect(find.text('flip'), findsOneWidget);
      expect(find.text('show question'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('M filters to missed cards and back', (tester) async {
      await pumpDeck(tester, deckView(onMarkCard: (_, _) async {}));

      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(find.text('What is a stack frame?'), findsNothing);

      await pressShiftM(tester);

      expect(find.text('What does the learning rate control?'), findsNothing);
      expect(find.text('What is a stack frame?'), findsOneWidget);
      expect(find.text('missed only'), findsOneWidget);
      expect(find.text('card 1 / 1'), findsOneWidget);

      await pressShiftM(tester);

      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('s shuffles, r resets, d toggles the Markdown view', (
      tester,
    ) async {
      await pumpDeck(tester, deckView(onMarkCard: (_, _) async {}));

      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();
      expect(find.text('card 1 / 2'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pumpAndSettle();
      expect(find.text('card 1 / 2'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();
      expect(
        find.text('Markdown view. Press d to read one card at a time.'),
        findsOneWidget,
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('session-output-deck')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a mark failure keeps the card and says why', (tester) async {
      await pumpDeck(
        tester,
        deckView(
          markdown: _oneCard(),
          onMarkCard: (_, _) async => throw ArgumentError('deck write failed'),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
      await tester.pumpAndSettle();

      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(find.byKey(const ValueKey('deck-mark-error')), findsOneWidget);
      expect(find.textContaining('deck write failed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a deck with no cards shows the build empty state', (
      tester,
    ) async {
      var builds = 0;
      await pumpDeck(
        tester,
        deckView(
          markdown: '# Flashcards — Physics\n\n',
          onMarkCard: (_, _) async {},
          onBuild: () async => builds += 1,
        ),
      );

      expect(find.text('no flashcard deck yet'), findsOneWidget);
      expect(find.text('build flashcards'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('session-output-build')));
      await tester.pumpAndSettle();
      expect(builds, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the deck fits 800x600', (tester) async {
      await pumpDeck(
        tester,
        deckView(onMarkCard: (_, _) async {}),
        size: const Size(800, 600),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();

      expect(find.text('ANSWER'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a read-only deck keeps the Markdown view and no dead keys', (
      tester,
    ) async {
      await pumpDeck(tester, deckView());

      expect(find.text('FLASHCARDS'), findsOneWidget);
      // The deck is flippable and markable; the note names the keys.
      expect(
        find.textContaining('Tab flips a card', findRichText: true),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('session-output-mode')), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('the deck multiple choice', () {
    testWidgets('a due card shows its schedule and grades with a', (
      tester,
    ) async {
      int? gradedIndex;
      String? graded;
      await pumpDeck(
        tester,
        deckView(
          deckSchedule: const DeckSchedule(
            due: 2,
            total: 2,
            cards: [
              DeckCardSchedule(
                index: 0,
                question: 'What does a register hold?',
                due: true,
                dueAt: '2026-11-24T10:00:00.000Z',
                intervalDays: 0,
                ease: 2.5,
                reps: 0,
                lapses: 0,
              ),
              DeckCardSchedule(
                index: 1,
                question: 'What does a call save?',
                due: true,
                dueAt: '2026-11-24T10:00:00.000Z',
                intervalDays: 0,
                ease: 2.5,
                reps: 0,
                lapses: 0,
              ),
            ],
          ),
          onMarkCard: (_, _) async {},
          onGradeCard: (index, grade) async {
            gradedIndex = index;
            graded = grade;
          },
        ),
      );

      expect(find.text('due 2/2'), findsOneWidget);
      expect(find.textContaining('not reviewed yet'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();

      expect(gradedIndex, 0);
      expect(graded, 'again');
      expect(find.byKey(const ValueKey('deck-grade-good')), findsOneWidget);
    });

    testWidgets('a schedule failure is shown beside the deck', (tester) async {
      await pumpDeck(
        tester,
        deckView(
          deckSchedule: DeckSchedule.empty,
          deckScheduleError: 'the flashcard schedule cannot be read',
          onMarkCard: (_, _) async {},
          onGradeCard: (_, _) async {},
        ),
      );
      expect(find.byKey(const ValueKey('deck-schedule-error')), findsOneWidget);
    });

    testWidgets('a four-choice card shows numbered rows before a flip', (
      tester,
    ) async {
      await pumpDeck(
        tester,
        deckView(markdown: _choiceDeck(), onMarkCard: (_, _) async {}),
      );

      expect(find.text('Which quantity is conserved?'), findsOneWidget);
      for (final number in [1, 2, 3, 4]) {
        expect(find.byKey(ValueKey('deck-choice-$number')), findsOneWidget);
      }
      expect(find.text('Energy.'), findsOneWidget);
      expect(find.text('Momentum.'), findsOneWidget);
      expect(find.text('Charge.'), findsOneWidget);
      expect(find.text('1–4 answer · Enter next'), findsOneWidget);
      expect(find.byKey(const ValueKey('deck-hint-flip')), findsNothing);
      // Nothing is answered yet, so no row carries a mark.
      for (final number in [1, 2, 3, 4]) {
        expect(_choiceMark(tester, number).data, isEmpty);
      }
      expect(find.byKey(const ValueKey('deck-answer')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a correct answer rains confetti and turns the card over', (
      tester,
    ) async {
      final effects = await pumpDeck(
        tester,
        deckView(markdown: _choiceDeck(), onMarkCard: (_, _) async {}),
      );

      expect(find.byKey(const ValueKey('deck-answer')), findsNothing);
      await tester.sendKeyEvent(LogicalKeyboardKey.digit1);
      await tester.pump();
      // The burst starts on the answer, before the flip finishes.
      expect(find.byKey(const ValueKey('effect-confetti')), findsOneWidget);

      await tester.pumpAndSettle();
      // Flipped: the answer is on the back, and the card stays on screen.
      expect(find.byKey(const ValueKey('deck-answer')), findsOneWidget);
      expect(find.text('Energy.'), findsWidgets);
      expect(
        tester.widget<Text>(find.byKey(const ValueKey('deck-answer'))).data,
        'Energy.',
      );
      // And the burst is over.
      expect(find.byKey(const ValueKey('effect-confetti')), findsNothing);
      expect(effects.generation, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a click answers a choice, exactly like 1–4', (tester) async {
      await pumpDeck(
        tester,
        deckView(markdown: _choiceDeck(), onMarkCard: (_, _) async {}),
      );

      await tester.tap(find.byKey(const ValueKey('deck-choice-1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('deck-answer')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const ValueKey('deck-answer'))).data,
        'Energy.',
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a second click does not answer again', (tester) async {
      final marks = <String>[];
      await pumpDeck(
        tester,
        deckView(
          markdown: _choiceDeck(),
          onMarkCard: (cardId, result) async => marks.add('$cardId:$result'),
        ),
      );

      // The wrong row records one miss; clicking it again after the flip must
      // not record a second one (the rows are inert once answered).
      await tester.tap(find.byKey(const ValueKey('deck-choice-2')));
      await tester.pumpAndSettle();
      expect(marks, hasLength(1));

      await tester.tap(
        find.byKey(const ValueKey('deck-choice-2')),
        warnIfMissed: false,
      );
      await tester.pumpAndSettle();
      expect(marks, hasLength(1));
      expect(tester.takeException(), isNull);
    });

    testWidgets('a wrong answer neither celebrates nor flips', (tester) async {
      final effects = await pumpDeck(
        tester,
        deckView(markdown: _choiceDeck(), onMarkCard: (_, _) async {}),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('effect-confetti')), findsNothing);
      expect(effects.generation, 0);
      expect(find.byKey(const ValueKey('deck-answer')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a wrong answer marks once with × and shows ✓ on the answer', (
      tester,
    ) async {
      final calls = <String>[];
      var markdown = _choiceDeck();

      await pumpDeck(
        tester,
        StatefulBuilder(
          builder: (context, setState) => deckView(
            key: const ValueKey('deck-view'),
            markdown: markdown,
            cardsMarkdown: markdown,
            onMarkCard: (cardId, result) async {
              calls.add('$cardId:$result');
              setState(() => markdown = _choiceDeck(card1Missed: true));
            },
          ),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
      await tester.pumpAndSettle();

      expect(calls, ['card-1:missed']);
      expect(_choiceMark(tester, 2).data, '×');
      expect(_choiceMark(tester, 2).style?.color, LockedInColors.error);
      expect(_choiceMark(tester, 1).data, '✓');
      expect(_choiceMark(tester, 1).style?.color, LockedInColors.success);
      // The second card's alternatives are untouched.
      expect(_choiceMark(tester, 3).data, isEmpty);

      // One answer per card: a further press is ignored and marks nothing.
      await tester.sendKeyEvent(LogicalKeyboardKey.digit3);
      await tester.pumpAndSettle();
      expect(calls, ['card-1:missed']);
      expect(_choiceMark(tester, 3).data, isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a correct answer shows ✓ and writes no mark', (tester) async {
      final calls = <String>[];
      await pumpDeck(
        tester,
        deckView(
          markdown: _choiceDeck(),
          onMarkCard: (cardId, result) async => calls.add('$cardId:$result'),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.digit1);
      await tester.pumpAndSettle();

      expect(calls, isEmpty);
      expect(_choiceMark(tester, 1).data, '✓');
      expect(_choiceMark(tester, 1).style?.color, LockedInColors.success);
      expect(_choiceMark(tester, 2).data, isEmpty);

      // Answered: the next press cannot turn a correct pick into a mark.
      await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      expect(_choiceMark(tester, 2).data, isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Enter advances to the next card and resets the answer', (
      tester,
    ) async {
      final calls = <String>[];
      var markdown = _choiceDeck();

      await pumpDeck(
        tester,
        StatefulBuilder(
          builder: (context, setState) => deckView(
            key: const ValueKey('deck-view'),
            markdown: markdown,
            cardsMarkdown: markdown,
            onMarkCard: (cardId, result) async {
              calls.add('$cardId:$result');
              setState(() => markdown = _choiceDeck(card1Missed: true));
            },
          ),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
      await tester.pumpAndSettle();
      expect(calls, ['card-1:missed']);
      expect(_choiceMark(tester, 2).data, '×');

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(find.text('card 2 / 2'), findsOneWidget);
      for (final number in [1, 2, 3, 4]) {
        expect(_choiceMark(tester, number).data, isEmpty);
      }

      // The fresh card is answerable: a correct pick is new, marks its row and
      // writes nothing.
      await tester.sendKeyEvent(LogicalKeyboardKey.digit1);
      await tester.pumpAndSettle();
      expect(calls, ['card-1:missed']);
      expect(_choiceMark(tester, 1).data, '✓');
      expect(tester.takeException(), isNull);
    });

    testWidgets('a two-choice card keeps flip-only behaviour', (tester) async {
      await pumpDeck(
        tester,
        deckView(markdown: _twoChoiceDeck(), onMarkCard: (_, _) async {}),
      );

      expect(find.byKey(const ValueKey('deck-choice-1')), findsNothing);
      expect(find.text('1–4 answer · Enter next'), findsNothing);
      expect(find.byKey(const ValueKey('deck-hint-flip')), findsOneWidget);
      expect(find.text('Energy.'), findsNothing);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('deck-answer')), findsOneWidget);
      expect(find.byKey(const ValueKey('deck-choice-1')), findsOneWidget);
      expect(find.byKey(const ValueKey('deck-choice-2')), findsOneWidget);
      expect(_choiceMark(tester, 1).data, '✓');
      expect(_choiceMark(tester, 2).data, isEmpty);

      // A digit never answers a card with fewer than four choices.
      await tester.sendKeyEvent(LogicalKeyboardKey.digit1);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('the completion state still appears once the deck is done', (
      tester,
    ) async {
      final calls = <String>[];
      var markdown = _oneChoiceCard();

      await pumpDeck(
        tester,
        StatefulBuilder(
          builder: (context, setState) => deckView(
            key: const ValueKey('deck-view'),
            markdown: markdown,
            cardsMarkdown: markdown,
            onMarkCard: (cardId, result) async {
              calls.add('$cardId:$result');
              setState(() => markdown = _oneChoiceCard(known: true));
            },
          ),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
      await tester.pumpAndSettle();

      expect(calls, ['card-1:known']);
      expect(find.text('all cards known'), findsOneWidget);
      expect(find.text('1 known · 0 missed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the choice deck fits 800x600', (tester) async {
      await pumpDeck(
        tester,
        deckView(markdown: _choiceDeck(), onMarkCard: (_, _) async {}),
        size: const Size(800, 600),
      );

      expect(find.text('Charge.'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('the shell wiring', () {
    testWidgets('k sends the session-prefixed card id through review.mark', (
      tester,
    ) async {
      final core = FakeCore();
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await tester.pumpWidget(LockedInApp(store: store));
      await tester.pumpAndSettle();
      await store.openSession(FakeCore.sessionId);
      await tester.pumpAndSettle();
      await openSurface(tester, 2);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyF);
      await tester.pumpAndSettle();
      expect(find.text('FLASHCARDS'), findsWidgets);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
      await tester.pumpAndSettle();

      expect(core.reviewMarks, [
        {'itemId': 'card:${FakeCore.sessionId}:card-1', 'result': 'known'},
      ]);
      // The shell re-reads the deck after the mark, so the core's own write is
      // what the reader shows: the one card is known and has left the deck.
      expect(
        core.calls.where((call) => call == 'session.output.read').length,
        2,
      );
      expect(find.text('all cards known'), findsOneWidget);
      expect(find.text('1 known · 0 missed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
