part of 'core_store.dart';

extension CoreStoreReview on CoreStore {
  /// Read the Stats summary for [range] and [scope], or for the selection the
  /// user last made when either is omitted. Throws on failure.
  Future<void> refreshStats({String? range, String? scope}) async {
    statsRange = range ?? statsRange;
    statsScope = scope ?? statsScope;
    final ticket = ++_statsTicket;
    final json = await _connection.call(CoreMethod.statsSummary, {
      'range': statsRange,
      'scope': statsScope,
    });
    // A slower reply for an earlier selection must not replace a newer one.
    if (ticket != _statsTicket) return;
    stats = StatsSummary.fromJson(json);
    notifyListeners();
  }

  /// Read the achievement inventory (`achievements.list`).
  ///
  /// This is the one read that can write: the core records the UTC day of each
  /// newly unlocked achievement in its **data directory** (never the
  /// workspace). The shell only renders the answer; it never infers an unlock,
  /// invents a date or writes a file. Dev builds unlock the whole catalogue on
  /// purpose, so an "all unlocked" list is the core's honest answer, not a bug.
  ///
  /// A failed read keeps the previous rows and records its reason in
  /// [achievementsError], so a broken refresh never blanks the surface.
  Future<void> refreshAchievements() async {
    final ticket = ++_achievementsTicket;
    achievementsLoading = true;
    achievementsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.achievementsList);
      if (ticket != _achievementsTicket) return;
      final raw = json['achievements'];
      achievements = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      AchievementRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      achievementsEarned = CoreStore._countOf(json['earned']);
      achievementsTotal = CoreStore._countOf(json['total']);
      final warning = json['warning'];
      achievementsWarning = warning is String && warning.trim().isNotEmpty
          ? warning
          : null;
    } catch (failure) {
      if (ticket != _achievementsTicket) return;
      achievementsError = _messageOf(failure);
    } finally {
      if (ticket == _achievementsTicket) {
        achievementsLoading = false;
        notifyListeners();
      }
    }
  }

  /// Read the Review queue (`review.queue`) for one side of the wall.
  ///
  /// The core reports what the workspace already records — unchecked steps,
  /// missed cards, unfinished skill stages and session memory — and the shell
  /// renders that snapshot. [side] is `all`, `school` or `skills`; an omitted or
  /// blank value keeps [reviewSide].
  ///
  /// Failure is recorded once in [reviewError] and the previous [review] stays
  /// on screen, so a broken read never invents an empty queue. The method never
  /// throws. An answer for a side the user has already left is dropped.
  Future<void> refreshReview({String? side}) async {
    final requested = side?.trim() ?? '';
    final target = requested.isEmpty ? reviewSide : requested;
    final ticket = ++_reviewTicket;
    reviewLoading = true;
    reviewError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.reviewQueue, {
        'side': target,
      });
      if (ticket != _reviewTicket) return;
      review = ReviewQueue.fromJson(json['queue']);
      reviewSide = target;
    } catch (failure) {
      if (ticket != _reviewTicket) return;
      reviewError = _messageOf(failure);
    } finally {
      if (ticket == _reviewTicket) {
        reviewLoading = false;
        notifyListeners();
      }
    }
  }

  /// Project the queue to another side of the wall and refetch it.
  Future<void> selectReviewSide(String side) => refreshReview(side: side);

  /// Record one Review verdict (`review.mark`) and replace the queue with the
  /// answer.
  ///
  /// [itemId] is the exact id from the current queue and [result] is `known` or
  /// `missed`. The core writes the workspace and returns the whole queue after
  /// the mark, so the shell replaces its snapshot instead of patching a count.
  /// [reviewMarkingId] is set while the request is in flight.
  ///
  /// The method **throws** on failure, leaving [review] untouched: the Review
  /// page shows the core's own message inline beside the rows, which is a page
  /// state rather than a failed read.
  Future<void> markReview(String itemId, String result) async {
    final id = itemId.trim();
    if (id.isEmpty) {
      throw ArgumentError.value(itemId, 'itemId', 'must not be blank');
    }
    if (result != 'known' && result != 'missed') {
      throw ArgumentError.value(result, 'result', 'must be known or missed');
    }
    _markingIds.add(id);
    final write = ++_reviewWriteTicket;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.reviewMark, {
        'itemId': id,
        'result': result,
      });
      // The reply carries this mark's queue. With two marks in flight the older
      // answer can arrive last and would repaint rows from before the newer
      // mark, so only the most recently issued write may replace the queue.
      if (write != _reviewWriteTicket) return;
      // A queue read that started before the mark would repaint the pre-mark
      // rows over this answer; it is abandoned, and its loading flag with it.
      _reviewTicket += 1;
      reviewLoading = false;
      if (reviewSide == 'all') {
        review = ReviewQueue.fromJson(json['queue']);
      } else {
        // `review.mark` answers with every side's queue. Under a `school` or
        // `skills` chip that would list the other side's items, so the
        // projection the user picked is read again instead.
        await refreshReview();
      }
    } finally {
      _markingIds.remove(id);
      notifyListeners();
    }
  }
}
