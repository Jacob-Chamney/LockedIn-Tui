import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The crimson tokens `customPalette` falls back to, used to prove that a
/// partial map paints per token.
const _crimsonBackground = Color(0xFF0D0F11);
const _crimsonForeground = Color(0xFFE7E7E7);
const _crimsonPrimary = Color(0xFFD9534F);
const _crimsonLine = Color(0xFF30363C);

/// A fake core whose `settings.get`/`settings.patch` carry a mutable theme id,
/// so the shell exercises the same projection the real core serves.
class _PaletteCore extends FakeCore {
  String theme = 'lockedin';

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    if (method == 'settings.patch') {
      final patch = params?['patch'];
      final ui = patch is Map ? patch['ui'] : null;
      final next = ui is Map ? ui['theme'] : null;
      if (next is String) theme = next;
    }
    final result = await super.call(method, params);
    if (method == 'settings.get' || method == 'settings.patch') {
      result['theme'] = theme;
    }
    return result;
  }
}

Future<CoreStore> _pumpApp(
  WidgetTester tester, {
  required FakeCore core,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final store = CoreStore(connection: core);
  addTearDown(store.dispose);
  await store.start();
  await tester.pumpWidget(LockedInApp(store: store));
  await tester.pumpAndSettle();
  return store;
}

/// Open the Settings surface (the sidebar is text at ≥900 px, Alt+0 below it).
Future<void> _openSettings(
  WidgetTester tester, {
  bool sidebar = true,
  bool narrow = false,
}) async {
  if (sidebar) {
    await tester.tap(find.text('Settings'));
  } else {
    expect(narrow, isTrue);
    await openSurface(tester, 0);
  }
  await tester.pumpAndSettle();
}

/// Move the settings cursor to the theme row (second row in `USER`).
Future<void> _selectThemeRow(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.home);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
  await tester.pumpAndSettle();
}

Future<void> _openEditor(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
  await tester.pumpAndSettle();
}

Finder _tokenRow(String name) => find.byKey(ValueKey('custom-token-$name'));

/// The leader key per surface ordinal (1 = Chat … 0 = Settings), matching the
/// terminal app's grammar: `Space c`, `Space h`, `Space g`, `Space s`, `Space t`,
/// `Space p`, `Space v`, `Space f`, `Space n`, `Space ,`.
const _surfaceLeaderKeys = <LogicalKeyboardKey>[
  LogicalKeyboardKey.keyC,
  LogicalKeyboardKey.keyH,
  LogicalKeyboardKey.keyG,
  LogicalKeyboardKey.keyS,
  LogicalKeyboardKey.keyT,
  LogicalKeyboardKey.keyP,
  LogicalKeyboardKey.keyV,
  LogicalKeyboardKey.keyF,
  LogicalKeyboardKey.keyN,
  LogicalKeyboardKey.comma,
];

/// Open a surface the way the terminal app does: `Space`, then the leader key.
Future<void> openSurface(WidgetTester tester, int surface) async {
  // Leave INSERT first: the leader is a NORMAL-mode chord, exactly as in the
  // terminal app, and the chat composer holds the keyboard on first paint. The
  // status bar is the shell's own answer for the mode, so this never presses
  // Esc on a page that would treat it as "back".
  if (find.text('INSERT').evaluate().isNotEmpty) {
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
  }
  // The alternate leader: `Space` is a local action on the deck, the steps
  // reader and the approvals view, and navigation must work from all of them.
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  // `0` is the tenth surface (Settings), as in the terminal app.
  final index = surface == 0 ? _surfaceLeaderKeys.length - 1 : surface - 1;
  await tester.sendKeyEvent(_surfaceLeaderKeys[index]);
  await tester.pumpAndSettle();
}

void main() {
  setUp(resetPalette);
  tearDown(resetPalette);

  group('custom palette', () {
    test('a partial map falls back to crimson per token', () {
      final palette = customPalette({'background': '#101820'});
      expect(palette.id, 'custom');
      expect(palette.background, const Color(0xFF101820));
      expect(palette.foreground, _crimsonForeground);
      expect(palette.primary, _crimsonPrimary);
      expect(palette.line, _crimsonLine);

      // No tokens at all is crimson, not a blank theme.
      final empty = customPalette();
      expect(empty.background, _crimsonBackground);
      expect(empty.foreground, _crimsonForeground);

      // The editor prints the same fallback and accepts either case.
      expect(customTokenHex('line', null), '#30363C');
      expect(customTokenHex('line', {'line': '#aabbcc'}), '#AABBCC');
      expect(customTokenHex('line', {'line': 'not-a-colour'}), '#30363C');
    });

    test('applyPalette custom merges the stored tokens and reset restores', () {
      resetPalette();
      expect(applyPalette('custom', tokens: {'primary': '#00FF00'}), isTrue);
      expect(activeThemeId, 'custom');
      expect(LockedInColors.primary, const Color(0xFF00FF00));
      expect(LockedInColors.background, _crimsonBackground);

      applyPaletteOr('custom', tokens: {'background': '#101820'});
      expect(LockedInColors.background, const Color(0xFF101820));
      expect(LockedInColors.primary, _crimsonPrimary);

      // The four built-ins are untouched by the custom branch.
      expect(applyPalette('high-contrast'), isTrue);
      expect(LockedInColors.background, const Color(0xFF000000));

      resetPalette();
      expect(activeThemeId, 'lockedin');
      expect(LockedInColors.background, _crimsonBackground);
    });

    test('hex parsing accepts exactly #RRGGBB', () {
      expect(isHexColour('#0D0F11'), isTrue);
      expect(isHexColour(' #0d0f11 '), isTrue);
      expect(isHexColour('#12345'), isFalse);
      expect(isHexColour('0D0F11'), isFalse);
      expect(isHexColour('#GGGGGG'), isFalse);
      expect(hexOfColour(const Color(0xFF101820)), '#101820');
    });
  });

  group('custom palette editor', () {
    testWidgets('lists the twelve tokens with a swatch and their hex', (
      tester,
    ) async {
      final core = _PaletteCore();
      core.themeTokens['background'] = '#101820';
      await _pumpApp(tester, core: core);
      await _openSettings(tester);
      await _selectThemeRow(tester);
      await _openEditor(tester);

      expect(find.text('custom palette'), findsOneWidget);
      expect(customThemeTokenNames, hasLength(12));
      for (final name in customThemeTokenNames) {
        expect(_tokenRow(name), findsOneWidget, reason: name);
        expect(find.byKey(ValueKey('custom-hex-$name')), findsOneWidget);
        expect(find.byKey(ValueKey('custom-swatch-$name')), findsOneWidget);
      }
      // The stored override and the crimson fallback are labelled differently.
      expect(find.text('#101820'), findsOneWidget);
      expect(find.text('custom'), findsOneWidget);
      expect(find.text('crimson'), findsNWidgets(11));
      expect(
        find.byKey(const ValueKey('custom-palette-preview')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a valid hex saves and the app repaints', (tester) async {
      final core = _PaletteCore();
      final store = await _pumpApp(tester, core: core);
      await _openSettings(tester);
      await _selectThemeRow(tester);

      // Pick custom first: the editor stores tokens without forcing a theme.
      await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
      await tester.pumpAndSettle();
      expect(core.theme, 'custom');
      expect(store.settings?.theme, 'custom');
      expect(activeThemeId, 'custom');

      await _openEditor(tester);
      // `background` is the first row and starts selected.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('custom-palette-hex-field')),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const ValueKey('custom-palette-hex-field')),
        '#101820',
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();

      expect(core.themeTokenWrites, hasLength(1));
      expect(core.themeTokens, {'background': '#101820'});
      expect(store.customThemeTokens['background'], '#101820');
      expect(LockedInColors.background, const Color(0xFF101820));
      // The dialog closed and the row reports the saved count.
      expect(find.text('custom palette'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a bad hex is refused locally and nothing is sent', (
      tester,
    ) async {
      final core = _PaletteCore();
      final store = await _pumpApp(tester, core: core);
      await _openSettings(tester);
      await _selectThemeRow(tester);
      await _openEditor(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('custom-palette-hex-field')),
        'crimson',
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('custom-palette-error')),
        findsOneWidget,
      );
      expect(find.text('use #RRGGBB, for example #0D0F11'), findsOneWidget);
      expect(core.themeTokenWrites, isEmpty);
      expect(store.customThemeTokens.isEmpty, isTrue);

      // Esc leaves the field, a second Esc backs out of the dialog.
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('custom palette'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('custom palette'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('r resets one token and R resets all', (tester) async {
      final core = _PaletteCore();
      core.themeTokens
        ..['foreground'] = '#FFFFFF'
        ..['line'] = '#101010';
      final store = await _pumpApp(tester, core: core);
      await _openSettings(tester);
      await _selectThemeRow(tester);
      await _openEditor(tester);

      // `foreground` is the fourth token row.
      for (var step = 0; step < 3; step++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
        await tester.pumpAndSettle();
      }
      expect(find.text('#FFFFFF'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pumpAndSettle();
      expect(find.text('#E7E7E7'), findsWidgets);
      expect(find.text('custom'), findsOneWidget, reason: 'line is still set');

      // The shift modifier is what the dialog reads; press it as a chord.
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pumpAndSettle();
      expect(find.text('custom'), findsNothing);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();

      expect(core.themeTokens, isEmpty);
      expect(store.customThemeTokens.isEmpty, isTrue);
      expect(core.themeTokenWrites.last, {'tokens': <String, dynamic>{}});
      expect(tester.takeException(), isNull);
    });

    testWidgets('the editor is usable at 800x600', (tester) async {
      final core = _PaletteCore();
      core.themeTokens['primary'] = '#AABBCC';
      await _pumpApp(tester, core: core, size: const Size(800, 600));
      await _openSettings(tester, sidebar: false, narrow: true);
      await _selectThemeRow(tester);
      await _openEditor(tester);

      expect(find.text('custom palette'), findsOneWidget);
      expect(_tokenRow('line'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('custom-palette-preview')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  });
}
