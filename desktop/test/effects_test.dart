import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/effects/effect.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  group('the confetti effect is a pure function of time', () {
    final effect = Effect.confetti(count: 60, seed: 11);
    const size = Size(800, 600);

    test('every particle starts at the origin', () {
      final positions = effect.positionsAt(0, size);
      expect(positions, hasLength(60));
      final origin = effect.originFor(size);
      // Delayed particles are still at the pin at t=0.
      for (final position in positions) {
        expect(position, origin);
      }
    });

    test('the same seed makes the same burst', () {
      final a = Effect.confetti(count: 40, seed: 3);
      final b = Effect.confetti(count: 40, seed: 3);
      expect(a.positionsAt(0.5, size), b.positionsAt(0.5, size));
      final c = Effect.confetti(count: 40, seed: 4);
      expect(a.positionsAt(0.5, size), isNot(c.positionsAt(0.5, size)));
    });

    test('the burst spreads out and is over by the end', () {
      final atStart = effect.boundsAt(0, size);
      final mid = effect.boundsAt(0.4, size);
      expect(mid.width, greaterThan(atStart.width + 20));
      expect(effect.isSpentAt(0.4, size), isFalse);
      expect(effect.isSpentAt(1, size), isTrue);
      // Nothing escapes the pane by half a flake's width while it is visible.
      for (final t in [0.0, 0.1, 0.25, 0.5, 0.7]) {
        final bounds = effect.boundsAt(t, size);
        expect(bounds.left, greaterThan(-60));
        expect(bounds.right, lessThan(size.width + 60));
      }
    });

    test('the duration is the documented one', () {
      expect(effect.duration, const Duration(milliseconds: 1600));
      expect(effect.name, 'confetti');
    });
  });

  group('the registry', () {
    test('ships confetti and accepts a contributed effect', () {
      final registry = EffectRegistry();
      expect(registry.has('confetti'), isTrue);
      expect(registry.names, contains('confetti'));
      registry.register('sparkle', () => Effect.confetti(count: 5, seed: 1));
      expect(registry.build('sparkle')?.particles, hasLength(5));
      expect(registry.build('nope'), isNull);
    });

    test('playing an unknown effect changes nothing', () {
      final controller = EffectController();
      final before = controller.generation;
      controller.play('nope');
      expect(controller.generation, before);
      controller.play('confetti');
      expect(controller.generation, before + 1);
      controller.dispose();
    });
  });

  group('the host', () {
    testWidgets('paints a burst and clears it when it ends', (tester) async {
      final controller = EffectController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        EffectScope(
          controller: controller,
          child: EffectHost(
            controller: controller,
            child: const SizedBox.expand(),
          ),
        ),
      );

      expect(find.byKey(const ValueKey('effect-confetti')), findsNothing);
      controller.play('confetti');
      await tester.pump();
      expect(find.byKey(const ValueKey('effect-confetti')), findsOneWidget);

      // Step the burst rather than pumpAndSettle: the painter listens to its
      // controller and a settle would run it to the end in one go.
      await tester.pump(const Duration(milliseconds: 800));
      expect(find.byKey(const ValueKey('effect-confetti')), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 900));
      expect(find.byKey(const ValueKey('effect-confetti')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('reduced motion paints nothing', (tester) async {
      final controller = EffectController();
      addTearDown(controller.dispose);
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );

      await tester.pumpWidget(
        EffectScope(
          controller: controller,
          child: EffectHost(
            controller: controller,
            child: const SizedBox.expand(),
          ),
        ),
      );
      controller.play('confetti');
      await tester.pump();
      expect(find.byKey(const ValueKey('effect-confetti')), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}
