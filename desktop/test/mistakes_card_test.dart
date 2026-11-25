import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// The misconception ledger's card: it labels the rows as the learner's own
/// record, records an entry, and promotes one through a named dialog.
void main() {
  const detail = SessionDetail(
    id: '2026-11-01-1430-physics-unit-4',
    name: 'Physics — Unit 4',
    created: '2026-11-01T14:30:00Z',
    archived: false,
    prompt: 'Explain the problem set.',
    sources: [],
    steps: SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
  );

  const promoted = SessionMistake(
    index: 1,
    text: 'A derivative is a fraction.',
    note: MistakeNote(
      path: 'school/vault/knowledge/a-derivative-is-a-fraction.md',
      title: 'A derivative is a fraction.',
      created: '2026-11-01T10:00:00.000Z',
    ),
  );
  const open = SessionMistake(
    index: 0,
    text: 'Energy is conserved per object.',
    step: 'Derive the energy balance',
  );

  Future<void> pumpPage(WidgetTester tester, Widget child) async {
    tester.view.physicalSize = const Size(1100, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(body: child),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('labels the ledger as the learner\'s own record, not a source', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detail,
        loading: false,
        mistakes: const [open, promoted],
        onPromoteMistake: (index, {correction}) async => const MistakePromotion(
          note: MistakeNote(path: 'x', title: 'x', created: ''),
          already: false,
        ),
      ),
    );

    expect(find.byKey(const ValueKey('session-mistakes-card')), findsOneWidget);
    expect(find.text('your record · not a source'), findsOneWidget);
    expect(
      find.textContaining('Energy is conserved per object.'),
      findsOneWidget,
    );
    expect(
      find.textContaining('step: Derive the energy balance'),
      findsOneWidget,
    );
    // A promoted row says where it went and offers no second promotion.
    expect(find.byKey(const ValueKey('mistake-promoted-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('mistake-promote-1')), findsNothing);
    expect(find.byKey(const ValueKey('mistake-promote-0')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty ledger teaches the next action', (tester) async {
    await pumpPage(tester, SessionDetailView(detail: detail, loading: false));
    expect(
      find.byKey(const ValueKey('session-mistakes-empty')),
      findsOneWidget,
    );
    expect(
      find.text('no mistakes recorded yet · add one below'),
      findsOneWidget,
    );
  });

  testWidgets('Add records the text and the optional step', (tester) async {
    String? recorded;
    String? recordedStep;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detail,
        loading: false,
        onRecordMistake: (text, {step}) async {
          recorded = text;
          recordedStep = step;
        },
      ),
    );

    await tester.enterText(
      find.byKey(const ValueKey('mistake-text-field')),
      'Energy is conserved per object.',
    );
    await tester.enterText(
      find.byKey(const ValueKey('mistake-step-field')),
      'Derive the energy balance',
    );
    await tester.tap(find.byKey(const ValueKey('mistake-record-button')));
    await tester.pumpAndSettle();

    expect(recorded, 'Energy is conserved per object.');
    expect(recordedStep, 'Derive the energy balance');
    expect(find.text('recorded'), findsOneWidget);
    // The form is cleared only after the write succeeded.
    final field = tester.widget<TextField>(
      find.byKey(const ValueKey('mistake-text-field')),
    );
    expect(field.controller?.text, '');
    expect(tester.takeException(), isNull);
  });

  testWidgets('a refused write keeps the text and shows the core message', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detail,
        loading: false,
        onRecordMistake: (text, {step}) async {
          throw RpcException(-32000, 'a mistake is at most 500 characters', {
            'kind': 'mistake',
            'message': 'a mistake is at most 500 characters',
          });
        },
      ),
    );

    await tester.enterText(
      find.byKey(const ValueKey('mistake-text-field')),
      'too long',
    );
    await tester.tap(find.byKey(const ValueKey('mistake-record-button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('mistake-notice')), findsOneWidget);
    expect(find.textContaining('at most 500 characters'), findsOneWidget);
    final field = tester.widget<TextField>(
      find.byKey(const ValueKey('mistake-text-field')),
    );
    expect(field.controller?.text, 'too long');
    expect(tester.takeException(), isNull);
  });

  testWidgets('promote asks for the correction and reports where it went', (
    tester,
  ) async {
    int? promotedIndex;
    String? capturedCorrection;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detail,
        loading: false,
        mistakes: const [open],
        onPromoteMistake: (index, {correction}) async {
          promotedIndex = index;
          capturedCorrection = correction;
          return const MistakePromotion(
            note: MistakeNote(
              path: 'school/vault/knowledge/energy-is-conserved.md',
              title: 'Energy is conserved per object.',
              created: '2026-11-01T10:00:00.000Z',
            ),
            already: false,
          );
        },
      ),
    );

    await tester.tap(find.byKey(const ValueKey('mistake-promote-0')));
    await tester.pumpAndSettle();
    expect(find.text('promote mistake 1'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('mistake-correction-0')),
      'Energy is conserved for a closed system.',
    );
    await tester.tap(find.byKey(const ValueKey('mistake-promote-confirm-0')));
    await tester.pumpAndSettle();

    expect(promotedIndex, 0);
    expect(capturedCorrection, 'Energy is conserved for a closed system.');
    expect(
      find.textContaining('promoted to energy-is-conserved.md'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('cancelling the dialog promotes nothing', (tester) async {
    var calls = 0;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detail,
        loading: false,
        mistakes: const [open],
        onPromoteMistake: (index, {correction}) async {
          calls += 1;
          return const MistakePromotion(
            note: MistakeNote(path: 'x', title: 'x', created: ''),
            already: false,
          );
        },
      ),
    );

    await tester.tap(find.byKey(const ValueKey('mistake-promote-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('mistake-promote-cancel')));
    await tester.pumpAndSettle();

    expect(calls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a ledger read failure is one message with retry', (
    tester,
  ) async {
    var retries = 0;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detail,
        loading: false,
        mistakesError: 'the ledger could not be read',
        onRetryMistakes: () => retries += 1,
      ),
    );

    expect(
      find.byKey(const ValueKey('session-mistakes-error')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('session-mistakes-retry')));
    await tester.pumpAndSettle();
    expect(retries, 1);
  });
}
