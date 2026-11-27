part of 'session_outputs.dart';

extension _SessionOutputDeck on _SessionOutputViewState {
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
            fontSize: TypeScale.label,
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
        Wrap(
          spacing: 4,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton(
              key: const ValueKey('deck-shuffle'),
              onPressed: () => refresh(deck.shuffle),
              child: const Text('shuffle s'),
            ),
            TextButton(
              key: const ValueKey('deck-missed-only'),
              onPressed: () => refresh(deck.toggleMissedOnly),
              child: Text(deck.missedOnly ? 'show all M' : 'missed only M'),
            ),
            if (widget.onResetSchedule != null)
              TextButton(
                key: const ValueKey('deck-reset-schedule'),
                onPressed: widget.deckScheduleLoading
                    ? null
                    : () => unawaited(widget.onResetSchedule!()),
                child: const Text('reset schedule'),
              ),
            TextButton(
              key: const ValueKey('deck-reset'),
              onPressed: () => refresh(deck.reset),
              child: const Text('original order r'),
            ),
          ],
        ),
        const SizedBox(height: 8),
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
            if (widget.deckSchedule != null) ...[
              _deckChip(
                'due ${widget.deckSchedule!.due}/${widget.deckSchedule!.total}',
                widget.deckSchedule!.due > 0
                    ? LockedInColors.warning
                    : LockedInColors.success,
              ),
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
            fontSize: TypeScale.prose,
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
                  borderRadius: BorderRadius.circular(Radii.control),
                  onTap: () => refresh(deck.flip),
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
                            fontSize: TypeScale.label,
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
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
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
        // One footer per stage of the card. Before the answer, the only
        // useful verbs are turn it over and move; after it, grade what you
        // recalled. The old footer stacked three rows (grade, nav, deck tools)
        // plus a second key legend under them, fourteen controls on one card.
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            OutlinedButton(
              key: const ValueKey('deck-prev'),
              onPressed: deck.index > 0 ? () => refresh(deck.previous) : null,
              child: const Text('← prev'),
            ),
            FilledButton(
              key: const ValueKey('deck-flip'),
              onPressed: () => refresh(deck.flip),
              child: Text(revealed ? 'hide answer' : 'show answer'),
            ),
            OutlinedButton(
              key: const ValueKey('deck-next'),
              onPressed: deck.index < deck.length - 1
                  ? () => refresh(deck.next)
                  : null,
              child: const Text('next →'),
            ),
          ],
        ),
        if (revealed) ...[
          if (widget.onGradeCard != null && _scheduled(card) != null) ...[
            const SizedBox(height: 12),
            Text(
              _nextReviewLine(_scheduled(card)!),
              key: const ValueKey('deck-next-review'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final (grade, label) in const [
                  ('again', 'again a'),
                  ('hard', 'hard f'),
                  ('good', 'good g'),
                  ('easy', 'easy e'),
                ])
                  OutlinedButton(
                    key: ValueKey('deck-grade-$grade'),
                    onPressed: widget.deckScheduleLoading
                        ? null
                        : () => unawaited(_grade(grade)),
                    child: Text(label),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              TextButton(
                key: const ValueKey('deck-missed'),
                onPressed: _marking ? null : () => unawaited(_mark('missed')),
                child: const Text('missed m'),
              ),
              TextButton(
                key: const ValueKey('deck-known'),
                onPressed: _marking ? null : () => unawaited(_mark('known')),
                child: const Text('known k'),
              ),
            ],
          ),
        ],
        if (widget.deckScheduleError != null) ...[
          const SizedBox(height: 8),
          Text(
            widget.deckScheduleError!,
            key: const ValueKey('deck-schedule-error'),
            style: TextStyle(
              color: LockedInColors.error,
              fontSize: TypeScale.label,
            ),
          ),
        ],
        if (_marking) ...[
          const SizedBox(height: 10),
          Text(
            'marking…',
            key: const ValueKey('deck-marking'),
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
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
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'This is a generated output, not a source. It is built from this '
          'session\'s own material and never counts towards source coverage.',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
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
                fontSize: TypeScale.key,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          '${deck.knownCount} known · ${deck.missedCount} missed',
          key: const ValueKey('deck-counts'),
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (filtered)
              OutlinedButton(
                key: const ValueKey('deck-missed-only'),
                onPressed: () => refresh(() => deck.setMissedOnly(false)),
                child: const Text('show all cards'),
              ),
            OutlinedButton(
              key: const ValueKey('deck-reset'),
              onPressed: () => refresh(deck.reset),
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
            fontSize: TypeScale.label,
            height: 1.45,
          ),
        ),
      ],
    );
  }

  /// The revealed answer's body, shared by four-choice cards (where the choices
  /// are already on screen) and flip-only cards.
  /// The guide's sections, in file order: heading plus its `Reviewed` row.

  List<Widget> _answerBody(Flashcard card) {
    return [
      Divider(height: 1, thickness: 1, color: LockedInColors.line),
      const SizedBox(height: 10),
      Text(
        'ANSWER',
        style: TextStyle(
          color: LockedInColors.secondary,
          fontSize: TypeScale.micro,
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
          fontSize: TypeScale.proseSmall,
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
        borderRadius: BorderRadius.circular(Radii.control),
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
                  fontSize: TypeScale.body,
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
                  fontSize: TypeScale.body,
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
                style: TextStyle(
                  color: tone,
                  fontSize: TypeScale.key,
                  height: 1.45,
                ),
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
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: tone,
          fontSize: TypeScale.micro,
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
        borderRadius: BorderRadius.circular(Radii.layer),
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
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
