import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/chat_page.dart';
import 'package:lockedin_desktop/shell/chrome.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'support/shell.dart';

/// Phase F: the app must be usable on a small window and readable on a large
/// one, and must not animate when the platform asks it not to.
///
/// The audit drives the **real shell** through every surface rather than each
/// page in isolation: a page can be fine alone and still overflow once the rail
/// and status bar take their rows, which is how the 800×600 overflows of the old
/// shell happened.
void main() {
  const surfaces = <int>[
    0, // chat
    1, // sessions
    2, // teaching
    3, // sources
    4, // stats
    5, // work
    6, // review
    7, // archive
    8, // knowledge
    9, // settings
  ];

  for (final size in const [Size(800, 600), Size(1600, 1000)]) {
    testWidgets('every surface lays out at ${size.width.toInt()}×'
        '${size.height.toInt()}', (tester) async {
      await pumpShell(tester, size: size);

      for (final surface in surfaces) {
        await openSurface(tester, surface);
        expect(
          tester.takeException(),
          isNull,
          reason: 'surface $surface overflowed at $size',
        );
        // The rail's own toggle still works at both widths, so a narrow window
        // is not a dead end.
        expect(
          find.byKey(const ValueKey('sidebar-toggle')),
          findsOneWidget,
          reason: 'no rail toggle on surface $surface at $size',
        );
      }
    });
  }

  testWidgets('the chat column stays capped on a very wide window', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(1600, 1000));
    final composer = tester.getRect(
      find.byKey(const ValueKey('chat-composer')),
    );
    // The composer is inside the reading column, not stretched across 1600 px.
    expect(composer.width, lessThan(900));
  });

  testWidgets('reduced motion: no transition plays', (tester) async {
    var animationsDisabled = false;
    await tester.pumpWidget(
      MediaQuery(
        data: MediaQueryData(disableAnimations: animationsDisabled),
        child: MaterialApp(
          theme: lockedInTheme(),
          home: Builder(
            builder: (context) {
              return Scaffold(
                body: Column(
                  children: [
                    TextButton(
                      onPressed: () {},
                      child: Text(
                        '${reducedMotionOf(context)}',
                        key: const ValueKey('reduced'),
                      ),
                    ),
                    Text(
                      '${motionFor(context, const Duration(milliseconds: 220)).inMilliseconds}',
                      key: const ValueKey('duration'),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );

    expect(find.text('false'), findsOneWidget);
    expect(find.text('220'), findsOneWidget);

    // Flip the platform flag: the helper reports it and every duration becomes
    // zero, which is what every animation in the shell now asks for.
    animationsDisabled = true;
    tester.platformDispatcher.accessibilityFeaturesTestValue =
        const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: MaterialApp(
          theme: lockedInTheme(),
          home: Builder(
            builder: (context) {
              return Scaffold(
                body: Column(
                  children: [
                    Text('${reducedMotionOf(context)}'),
                    Text(
                      '${motionFor(context, const Duration(milliseconds: 220)).inMilliseconds}',
                      key: const ValueKey('duration-zero'),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );

    expect(find.text('true'), findsOneWidget);
    expect(find.text('0'), findsOneWidget);
  });

  testWidgets('the composer reports INSERT and NORMAL at 800x600', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(800, 600));
    // Esc always leaves INSERT; the status bar says which mode is live.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('NORMAL'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a chat with a long model id does not overflow at 800x600', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final long = 'openrouter/${'vendor-model-tag/' * 6}end';
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          body: ChatPage(
            online: true,
            configured: true,
            chat: ChatSnapshot(
              status: 'idle',
              model: long,
              streamed: '',
              messages: const [],
              usage: const ChatUsageView(
                tokens: 0,
                costMicroUsd: null,
                durationMs: null,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
