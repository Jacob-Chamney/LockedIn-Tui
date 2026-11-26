part of 'core_store.dart';

extension CoreStoreTeaching on CoreStore {
  /// Read the teaching record for [goalId].
  Future<void> readTeaching(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return;
    final ticket = ++_teachingTicket;
    try {
      final json = await _connection.call(CoreMethod.teachState, {
        'goalId': id,
      });
      if (ticket != _teachingTicket) return;
      final record = json['record'];
      teaching = record is Map
          ? TeachingState.fromJson(Map<String, dynamic>.from(record))
          : null;
      teachingError = null;
    } catch (failure) {
      if (ticket != _teachingTicket) return;
      teachingError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Measure the learner and plan the route (`teach.measure`).
  ///
  /// One model call, no retry: a refusal is the core's own sentence and leaves
  /// any previous record exactly as it was.
  Future<bool> measureTeaching(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    teachingVerdict = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachMeasure, {
        'goalId': id,
      });
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Open the next step, a chosen branch, or a new wording of the open one
  /// (`teach.step`).
  Future<bool> teachNextStep(
    String goalId, {
    bool again = false,
    String? stepId,
  }) async {
    final id = goalId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    teachingVerdict = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachStep, {
        'goalId': id,
        if (again) 'again': true,
        if (stepId != null && stepId.trim().isNotEmpty) 'stepId': stepId.trim(),
      });
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Build a practice set from what the lesson has established.
  ///
  /// One model call, no retry. Refused until a step has passed its check: a
  /// session cannot practise what it never landed.
  Future<bool> practiseTeaching(String goalId) async {
    return _teachingCall(goalId, 'teach.practice', {});
  }

  /// Record one practice verdict (`solved` or `missed`).
  Future<bool> answerPractice(
    String goalId,
    String problemId,
    String verdict,
  ) async {
    return _teachingCall(goalId, 'teach.practice.result', {
      'problemId': problemId,
      'verdict': verdict,
    });
  }

  /// The shared body of every `teach.*` write: busy flag, ticket, one refusal.
  Future<bool> _teachingCall(
    String goalId,
    String method,
    Map<String, dynamic> extra,
  ) async {
    final id = goalId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    notifyListeners();
    try {
      final json = await _connection.call(method, {'goalId': id, ...extra});
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Answer the open step's check (`teach.check`).
  ///
  /// A `correct` verdict passes the step and clears it in the core's record, so
  /// the next [teachNextStep] moves on; anything else keeps the step open for a
  /// repair.
  Future<bool> checkTeaching(
    String goalId,
    String answer, {
    String thinking = '',
    int? confidence,
  }) async {
    final id = goalId.trim();
    if (id.isEmpty || answer.trim().isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachCheck, {
        'goalId': id,
        'answer': answer,
        if (thinking.trim().isNotEmpty) 'thinking': thinking.trim(),
        'confidence': ?confidence,
      });
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      teachingVerdict = TeachingCheckResult.fromJson(json);
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Read one step's side thread (`teach.side.snapshot`).
  ///
  /// Read-only. A missing thread is `[]`, not an error.
  Future<void> openTeachingSide(String goalId, String stepId) async {
    final id = goalId.trim();
    if (id.isEmpty || stepId.isEmpty) return;
    final ticket = ++_teachingTicket;
    teachingSideLoading = true;
    teachingSideError = null;
    // A different step's thread must not flash while this one loads.
    teachingSide = const [];
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachSideSnapshot, {
        'goalId': id,
        'stepId': stepId,
      });
      if (ticket != _teachingTicket) return;
      teachingSide = _sideMessages(json['messages']);
    } catch (failure) {
      if (ticket != _teachingTicket) return;
      teachingSideError = _messageOf(failure);
    } finally {
      if (ticket == _teachingTicket) {
        teachingSideLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask one side question (`teach.side.send`).
  ///
  /// One model call, no retry. The exchange is written by the core only after a
  /// reply exists, so a failure leaves the thread unchanged.
  Future<bool> askTeachingSide(
    String goalId,
    String stepId,
    String text,
  ) async {
    final id = goalId.trim();
    final question = text.trim();
    if (id.isEmpty || stepId.isEmpty || question.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingSideLoading = true;
    teachingSideError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachSideSend, {
        'goalId': id,
        'stepId': stepId,
        'text': question,
      });
      if (ticket != _teachingTicket) return false;
      teachingSide = _sideMessages(json['messages']);
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingSideError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingSideLoading = false;
        notifyListeners();
      }
    }
  }

  /// Clear one step's side thread (`teach.side.clear`).
  Future<void> clearTeachingSide(String goalId, String stepId) async {
    final id = goalId.trim();
    if (id.isEmpty || stepId.isEmpty) return;
    final ticket = ++_teachingTicket;
    teachingSideLoading = true;
    teachingSideError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachSideClear, {
        'goalId': id,
        'stepId': stepId,
      });
      if (ticket != _teachingTicket) return;
      teachingSide = _sideMessages(json['messages']);
    } catch (failure) {
      if (ticket != _teachingTicket) return;
      teachingSideError = _messageOf(failure);
    } finally {
      if (ticket == _teachingTicket) {
        teachingSideLoading = false;
        notifyListeners();
      }
    }
  }

  static List<TeachingSideMessage> _sideMessages(Object? value) => value is List
      ? value
            .whereType<Map>()
            .map(
              (row) =>
                  TeachingSideMessage.fromJson(Map<String, dynamic>.from(row)),
            )
            .where((message) => message.text.isNotEmpty)
            .toList(growable: false)
      : const [];
}
