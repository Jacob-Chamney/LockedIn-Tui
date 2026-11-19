import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/features/sessions/flip_card.dart';
import 'package:material_ui/material_ui.dart';

/// The flip has two behaviours and both are load-bearing: a rotation when motion
/// is allowed, and an instant face swap when it is not. This file proves each,
/// and proves only one face is ever in the tree.
///
/// `MediaQuery` is set explicitly rather than relying on the harness default, so
/// each case states the motion policy it is testing.
Widget _harness({required bool showingBack, required bool animations}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(disableAnimations: !animations),
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Scaffold(
          body: Center(
            child: SizedBox(
              width: 400,
              child: FlipCard(
                showingBack: showingBack,
                front: const Text('FRONT FACE'),
                back: const Text('BACK FACE'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('the front is shown at rest', (tester) async {
    await tester.pumpWidget(_harness(showingBack: false, animations: true));
    await tester.pumpAndSettle();

    expect(find.text('FRONT FACE'), findsOneWidget);
    expect(find.text('BACK FACE'), findsNothing);
  });

  testWidgets('the card turns over with a rotation when motion is allowed', (
    tester,
  ) async {
    // Start on the front, then rebuild the same card on its back so the state
    // sees the change and animates.
    await tester.pumpWidget(_harness(showingBack: false, animations: true));
    await tester.pumpAndSettle();
    await tester.pumpWidget(_harness(showingBack: true, animations: true));
    await tester.pump(const Duration(milliseconds: 100));

    final rotated = tester.widgetList<Transform>(find.byType(Transform)).where((
      widget,
    ) {
      final matrix = widget.transform;
      // A Y rotation shows up as a non-zero off-diagonal entry.
      return matrix.storage[2].abs() > 0.001 || matrix.storage[8].abs() > 0.001;
    });
    expect(rotated, isNotEmpty, reason: 'mid-flip the card is rotated');
    // Exactly one face at a time, even mid-turn.
    expect(
      find.text('FRONT FACE').evaluate().length +
          find.text('BACK FACE').evaluate().length,
      1,
    );

    await tester.pumpAndSettle();
    expect(find.text('BACK FACE'), findsOneWidget);
    expect(find.text('FRONT FACE'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduced motion swaps the face without a turn', (tester) async {
    await tester.pumpWidget(_harness(showingBack: false, animations: false));
    await tester.pumpAndSettle();
    expect(find.text('FRONT FACE'), findsOneWidget);

    await tester.pumpWidget(_harness(showingBack: true, animations: false));
    await tester.pump();

    // Immediately the back: no intermediate frame, no rotation.
    expect(find.text('BACK FACE'), findsOneWidget);
    expect(find.text('FRONT FACE'), findsNothing);
    final rotated = tester
        .widgetList<Transform>(find.byType(Transform))
        .where((widget) => widget.transform.storage[2].abs() > 0.001);
    expect(rotated, isEmpty);
    expect(tester.takeException(), isNull);
  });
}
