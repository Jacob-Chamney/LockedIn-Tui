import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/keymap/binding.dart';
import 'package:lockedin_desktop/keymap/registry.dart';
import 'package:lockedin_desktop/shell/shell.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

SettingsView _settings() => const SettingsView(
  username: 'friend',
  theme: 'crimson',
  chatModel: 'deepseek/deepseek-flash',
  baseUrl: '',
  maxToolCalls: 8,
  maxTokensPerRequest: 16000,
  budgetUsd: 5,
  period: 'day',
  warnAt: 0.8,
  pauseAtLimit: false,
  dataDir: '/home/friend/.local/share/lockedin',
  archiveBackend: 'folder',
  archiveFolder: '/home/friend/LockedIn-archive',
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: [],
  hideHints: false,
  pluginDirs: [],
  disabledPlugins: [],
);

Future<void> _pumpSettings(
  WidgetTester tester, {
  required KeymapRegistry keymap,
  Future<void> Function(String action, String? binding, {bool fixed})?
  onSetKeybind,
}) async {
  tester.view.physicalSize = const Size(1280, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: SettingsPage(
          settings: _settings(),
          loading: false,
          keymap: keymap,
          onSetKeybind: onSetKeybind,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapRow(WidgetTester tester, String rowId) async {
  final row = find.byKey(ValueKey('settings-row-$rowId'));
  // The KEYBINDS group is the last one: bring the row into the viewport before
  // a tap, exactly as a person scrolling to it would.
  await tester.ensureVisible(row);
  await tester.pumpAndSettle();
  await tester.tap(row);
  await tester.pumpAndSettle();
}

Future<void> _pressCtrl(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pumpAndSettle();
}

void main() {
  rebindGroup();
  group('binding', () {
    test('parses and formats every documented form round-trip', () {
      for (final raw in const [
        'space+e',
        'space+,',
        'ctrl+q',
        'ctrl+/',
        '?',
        ':',
        '/',
        'i',
        '0',
        'escape',
        'enter',
        'tab',
        'space',
      ]) {
        final binding = Binding.parse(raw);
        expect(binding.format(), raw, reason: 'round trip for $raw');
      }
    });

    test('rejects everything the core rejects', () {
      for (final raw in const [
        '',
        'banana',
        'f6',
        'ctrl+shift+k',
        'space+',
        'space+escape',
        'ctrl+space',
        'alt+1',
        ' ',
      ]) {
        expect(Binding.tryParse(raw), isNull, reason: 'should refuse "$raw"');
      }
      expect(() => Binding.parse('banana'), throwsFormatException);
    });

    test('a person reads the chord, the core stores it', () {
      expect(Binding.parse('space+x').display, 'Space x');
      expect(Binding.parse('ctrl+q').display, 'Ctrl+Q');
      expect(Binding.parse('escape').display, 'Esc');
      expect(Binding.parse('?').display, '?');
      expect(Binding.parse('space+x').isLeader, isTrue);
      expect(Binding.parse('space+x').hasModifier, isFalse);
      expect(Binding.parse('ctrl+q').hasModifier, isTrue);
    });

    test('alt is a shell default the core cannot store', () {
      const alt = Binding.direct('1', alt: true);
      expect(alt.format(), 'alt+1');
      expect(alt.isStorable, isFalse);
      expect(alt.hasModifier, isTrue);
      expect(Binding.tryParse('alt+1'), isNull);
    });

    test('captures a key event as one chord', () {
      final plain = Binding.fromKey(
        logical: LogicalKeyboardKey.keyE,
        character: 'e',
      );
      expect(plain?.format(), 'e');
      expect(
        Binding.fromKey(
          logical: LogicalKeyboardKey.keyK,
          character: 'k',
          control: true,
        )?.format(),
        'ctrl+k',
      );
      expect(
        Binding.fromKey(logical: LogicalKeyboardKey.escape)?.format(),
        'escape',
      );
      // A bare modifier is not a chord, so Control-then-K stays one press.
      expect(Binding.fromKey(logical: LogicalKeyboardKey.controlLeft), isNull);
    });
  });

  group('registry', () {
    test('the defaults are real chords and cover every surface', () {
      final registry = KeymapRegistry();
      expect(registry.actions.length, 17);
      expect(surfaceActionIds, [
        for (final surface in Surface.values) surface.name,
      ], reason: 'the shell surfaces and the registry key table must agree');
      for (var index = 0; index < surfaceActionIds.length; index++) {
        final row = registry.rowFor('surface.${surfaceActionIds[index]}')!;
        // The terminal app's grammar: every surface is a leader chord.
        expect(row.binding.format(), 'space+${surfaceLeaderKey(index)}');
        expect(row.custom, isFalse);
        expect(row.group, ActionGroup.context);
      }
      // The nine chords the TUI uses, pinned by name so a reshuffle is visible.
      expect(
        [
          for (final id in surfaceActionIds)
            registry.rowFor('surface.$id')!.binding.format(),
        ],
        [
          'space+c',
          'space+h',
          'space+g',
          'space+s',
          'space+t',
          'space+p',
          'space+v',
          'space+f',
          'space+n',
          'space+,',
        ],
      );
      expect(registry.rowFor('palette')!.binding.format(), 'ctrl+k');
      expect(registry.rowFor('refresh')!.binding.format(), 'space+r');
      expect(registry.rowFor('retry')!.binding.format(), 'ctrl+r');
      final shell = KeymapRegistry(catalogue: shellActionCatalogue());
      expect(shell.rowFor('sidebar')!.binding.format(), 'space+e');
      expect(shell.rowFor('achievements')!.binding.format(), 'space+i');
      // The learning verbs the terminal app keeps on the leader.
      expect(shell.rowFor('new-lock-in')!.binding.format(), 'space+l');
      expect(shell.rowFor('flashcards')!.binding.format(), 'space+k');
      // The Work verbs the terminal app keeps on the leader.
      for (final (id, chord) in [
        ('work-agents', 'space+m'),
        ('work-chats', 'space+u'),
        ('work-swarms', 'space+x'),
        ('work-changes', 'space+d'),
      ]) {
        expect(shell.rowFor(id)!.binding.format(), chord);
      }
      expect(registry.rowFor('leader')!.binding.format(), 'space');
      expect(registry.rowFor('help')!.binding.format(), '?');
      expect(registry.rowFor('close')!.binding.format(), 'escape');
      expect(registry.rowFor('leader')!.fixed, isTrue);
      expect(registry.rowFor('close')!.fixed, isTrue);
      // Every default is a chord the core can store: no shell-only forms left.
      for (final row in registry.rows) {
        expect(
          row.binding.isStorable,
          isTrue,
          reason: '${row.id} has an impossible default',
        );
      }
    });

    test('a stored override replaces exactly one row', () {
      final registry = KeymapRegistry(keybinds: const {'refresh': 'space+z'});
      final overridden = registry.rowFor('refresh')!;
      expect(overridden.custom, isTrue);
      expect(overridden.binding.format(), 'space+z');
      // Every other row keeps its default.
      expect(registry.rowFor('retry')!.binding.format(), 'ctrl+r');
      expect(registry.rowFor('retry')!.custom, isFalse);
      expect(registry.rowFor('palette')!.binding.format(), 'ctrl+k');
    });

    test('an empty override is a cleared override, not a blank binding', () {
      final registry = KeymapRegistry(keybinds: const {'refresh': ''});
      expect(registry.rowFor('refresh')!.binding.format(), 'space+r');
      expect(registry.rowFor('refresh')!.custom, isFalse);
    });

    test('the spec table wins, and a move between tables still resolves', () {
      final fixedWins = KeymapRegistry(
        keybinds: const {'leader': 'ctrl+l'},
        fixedKeybinds: const {'leader': 'ctrl+m'},
      );
      expect(fixedWins.rowFor('leader')!.binding.format(), 'ctrl+m');
      final moved = KeymapRegistry(fixedKeybinds: const {'refresh': 'space+g'});
      expect(moved.rowFor('refresh')!.binding.format(), 'space+g');
      expect(moved.rowFor('refresh')!.custom, isTrue);
    });

    test('a duplicate is detected across both tables and names the holder', () {
      final registry = KeymapRegistry(
        keybinds: const {'refresh': 'ctrl+k'},
        fixedKeybinds: const {'retry': 'ctrl+k'},
      );
      final conflicts = registry.conflicts;
      expect(conflicts, hasLength(2));
      final refresh = conflicts.firstWhere(
        (conflict) => conflict.actionId == 'refresh',
      );
      expect(refresh.otherId, 'palette');
      expect(refresh.message, 'Ctrl+K is already bound to palette.');
      final retry = conflicts.firstWhere(
        (conflict) => conflict.actionId == 'retry',
      );
      expect(retry.otherId, 'palette');
      expect(
        registry.conflictFor('palette', Binding.parse('ctrl+k'))?.otherId,
        'refresh',
      );
      expect(registry.conflictFor('palette', Binding.parse('ctrl+j')), isNull);
      expect(KeymapRegistry().conflicts, isEmpty);
    });

    test(
      'resolves a chord to its action, and a rebound one stops resolving',
      () {
        final registry = KeymapRegistry();
        // `Space t` is Stats, and a bare `t` is not a chord: surfaces live on
        // the leader, as they do in the terminal app.
        expect(
          registry
              .resolveChord(logical: LogicalKeyboardKey.keyT, character: 't')
              ?.id,
          isNull,
        );
        expect(
          registry.leaderRows().any((row) => row.id == 'surface.stats'),
          isTrue,
        );
        expect(
          registry
              .resolveChord(
                logical: LogicalKeyboardKey.keyK,
                character: 'k',
                control: true,
              )
              ?.id,
          'palette',
        );
        expect(
          registry
              .resolveChord(logical: LogicalKeyboardKey.slash, character: '?')
              ?.id,
          'help',
        );
        expect(
          registry.resolveChord(logical: LogicalKeyboardKey.space)?.id,
          'leader',
        );
        expect(
          registry.resolveChord(logical: LogicalKeyboardKey.escape)?.id,
          'close',
        );
        expect(
          registry.resolveChord(
            logical: LogicalKeyboardKey.keyS,
            character: 's',
          ),
          isNull,
        );
        // A stored override is what resolves: Space+h was Sessions, and after
        // the rebind it is Stats.
        final rebound = KeymapRegistry(
          keybinds: const {'surface.stats': 'space+h'},
        );
        expect(rebound.rowFor('surface.stats')!.binding.format(), 'space+h');
        expect(rebound.rowFor('surface.sessions')!.binding.format(), 'space+h');
      },
    );

    test('leader rows are generated once, grouped, without the prefix', () {
      final registry = KeymapRegistry();
      final leader = registry.leaderRows();
      expect(leader.map((row) => row.id), isNot(contains('leader')));
      expect(leader.map((row) => row.id), isNot(contains('close')));
      expect(leader, hasLength(registry.rows.length - 2));
      final grouped = [
        for (final group in ActionGroup.values)
          ...registry.leaderRowsFor(group),
      ];
      expect(grouped.map((row) => row.id), leader.map((row) => row.id));
      expect(registry.editorRows().map((row) => row.id), [
        for (final action in registry.actions) action.id,
      ]);
      expect(
        registry.leaderRowsFor(ActionGroup.context),
        hasLength(surfaceActionIds.length),
      );
    });
  });

  group('settings keybinds', () {
    testWidgets('the KEYBINDS group lists every action with its binding', (
      tester,
    ) async {
      await _pumpSettings(
        tester,
        keymap: KeymapRegistry(keybinds: const {'refresh': 'space+z'}),
        onSetKeybind: (action, binding, {fixed = false}) async {},
      );
      expect(find.text('KEYBINDS'), findsOneWidget);
      expect(find.text('Space z'), findsOneWidget);
      expect(find.text('Space c'), findsOneWidget);
      expect(find.text('Ctrl+K'), findsOneWidget);
      for (final label in const ['chat', 'palette', 'leader', 'help']) {
        expect(find.text(label), findsWidgets, reason: 'missing row $label');
      }
      expect(
        find.text('Enter rebind · Backspace clear · r reset · R reset all'),
        findsOneWidget,
      );
    });

    testWidgets('Enter captures the next chord and writes it through', (
      tester,
    ) async {
      final writes = <String?>[];
      final actions = <String>[];
      await _pumpSettings(
        tester,
        keymap: KeymapRegistry(),
        onSetKeybind: (action, binding, {fixed = false}) async {
          actions.add(action);
          writes.add(binding);
        },
      );

      await _tapRow(tester, 'keybind-refresh');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('press a key…'), findsOneWidget);

      // A chord no default holds: `ctrl+k` belongs to the palette, and the
      // registry now refuses a collision before anything is sent.
      await _pressCtrl(tester, LogicalKeyboardKey.keyG);

      expect(actions, ['refresh']);
      expect(writes, ['ctrl+g']);
      expect(find.text('press a key…'), findsNothing);
    });

    testWidgets(
      'a duplicate shows the core message and keeps the old binding',
      (tester) async {
        await _pumpSettings(
          tester,
          keymap: KeymapRegistry(keybinds: const {'refresh': 'space+z'}),
          onSetKeybind: (action, binding, {fixed = false}) async {
            throw const RpcException(
              -32000,
              'Ctrl+K is already bound to palette.',
              {
                'kind': 'keybind',
                'action': 'refresh',
                'binding': 'ctrl+k',
                'conflict': 'palette',
                'message': 'Ctrl+K is already bound to palette.',
              },
            );
          },
        );

        await _tapRow(tester, 'keybind-refresh');
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.pumpAndSettle();
        await _pressCtrl(tester, LogicalKeyboardKey.keyK);

        expect(
          find.text('Ctrl+K is already bound to palette.'),
          findsOneWidget,
        );
        expect(find.text('Space z'), findsOneWidget);
      },
    );

    testWidgets('Enter, then Space and a letter, binds a leader chord', (
      tester,
    ) async {
      final actions = <String>[];
      final writes = <String?>[];
      await _pumpSettings(
        tester,
        keymap: KeymapRegistry(),
        onSetKeybind: (action, binding, {fixed = false}) async {
          actions.add(action);
          writes.add(binding);
        },
      );

      // `close` defaults to Esc; the editor could not produce a leader chord at
      // all before, because capture only built direct bindings. The chevron
      // starts the capture, and a second press switches it to the leader.
      final chevron = find.byKey(
        const ValueKey('settings-activate-keybind-close'),
      );
      await tester.ensureVisible(chevron);
      await tester.tap(chevron);
      await tester.pumpAndSettle();
      await tester.tap(chevron);
      await tester.pumpAndSettle();
      expect(find.text('Space …'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyQ);
      await tester.pumpAndSettle();

      expect(actions, ['close']);
      expect(writes, ['space+q']);
    });

    testWidgets('a leader chord onto a taken letter is refused in the editor', (
      tester,
    ) async {
      final writes = <String?>[];
      await _pumpSettings(
        tester,
        keymap: KeymapRegistry(),
        onSetKeybind: (action, binding, {fixed = false}) async {
          writes.add(binding);
        },
      );

      // `Space c` is the chat surface's default; the registry names it instead
      // of sending a write the core would refuse.
      final chevron = find.byKey(
        const ValueKey('settings-activate-keybind-close'),
      );
      await tester.ensureVisible(chevron);
      await tester.tap(chevron);
      await tester.pumpAndSettle();
      await tester.tap(chevron);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
      await tester.pumpAndSettle();

      expect(writes, isEmpty);
      expect(
        find.textContaining('Space c is already bound to'),
        findsOneWidget,
      );
    });

    testWidgets('Backspace clears one row back to its default', (tester) async {
      final actions = <String>[];
      final writes = <String?>[];
      await _pumpSettings(
        tester,
        keymap: KeymapRegistry(keybinds: const {'refresh': 'space+z'}),
        onSetKeybind: (action, binding, {fixed = false}) async {
          actions.add(action);
          writes.add(binding);
        },
      );

      await _tapRow(tester, 'keybind-refresh');
      await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
      await tester.pumpAndSettle();

      expect(actions, ['refresh']);
      expect(writes, [null]);
    });

    testWidgets('r resets one row and R resets every override', (tester) async {
      final actions = <String>[];
      final writes = <String?>[];
      Future<void> write(
        String action,
        String? binding, {
        bool fixed = false,
      }) async {
        actions.add(action);
        writes.add(binding);
      }

      await _pumpSettings(
        tester,
        keymap: KeymapRegistry(
          keybinds: const {'refresh': 'space+g', 'retry': 'space+y'},
        ),
        onSetKeybind: write,
      );

      await _tapRow(tester, 'keybind-refresh');
      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pumpAndSettle();
      expect(actions, ['refresh']);
      expect(writes, [null]);

      actions.clear();
      writes.clear();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pumpAndSettle();

      // Resetting every override asks first, and names the count.
      expect(find.text('reset all keybinds'), findsOneWidget);
      expect(find.textContaining('2 customised bindings'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('keybind-reset-confirm')));
      await tester.pumpAndSettle();

      expect(actions, ['refresh', 'retry']);
      expect(writes, [null, null]);
    });

    testWidgets('without a writer the group stays read-only', (tester) async {
      await _pumpSettings(tester, keymap: KeymapRegistry());

      expect(
        find.text('selection only · no keybind writer in this build'),
        findsOneWidget,
      );
      await _tapRow(tester, 'keybind-refresh');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('press a key…'), findsNothing);
      // `r` falls through to the group's own keys without throwing.
      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });
}

void rebindGroup() {
  group('registry-owned rebinding', () {
    test('a free chord is accepted and reports the whole table', () {
      final registry = KeymapRegistry();
      final decision = registry.rebind('close', const Binding.direct('q'));
      expect(decision.accepted, isTrue);
      expect(decision.overrides?['close'], 'q');
      expect(decision.overrides, hasLength(registry.rows.length));
    });

    test('a duplicate is refused with the core copy, and changes nothing', () {
      final registry = KeymapRegistry(catalogue: shellActionCatalogue());
      final held = registry.rowFor('work-swarms')!;
      final decision = registry.rebind('close', held.binding);
      expect(decision.accepted, isFalse);
      expect(decision.conflict?.otherId, 'work-swarms');
      expect(
        decision.message,
        '${held.binding.display} is already bound to work-swarms.',
      );
      // Nothing moved: the registry is immutable and `close` keeps its Esc.
      expect(registry.rowFor('close')!.binding.format(), 'escape');
    });

    test("rebinding onto another action's default is caught too", () {
      final registry = KeymapRegistry(catalogue: shellActionCatalogue());
      // `help` has never been overridden; its default still owns the chord.
      final target = registry.rowFor('help')!;
      expect(target.custom, isFalse);
      final decision = registry.rebind('close', target.binding);
      expect(decision.accepted, isFalse);
      expect(decision.conflict?.otherId, 'help');
    });

    test('a direct action can become a leader chord and back', () {
      final registry = KeymapRegistry();
      final toLeader = registry.rebind('close', const Binding.leader('q'));
      expect(toLeader.accepted, isTrue);
      expect(toLeader.overrides?['close'], 'space+q');
      final back = registry.rebind('close', null);
      expect(back.accepted, isTrue);
      expect(back.overrides?.containsKey('close'), isFalse);
    });

    test('an unknown action is refused by name', () {
      final decision = KeymapRegistry().rebind(
        'no-such-action',
        const Binding.direct('q'),
      );
      expect(decision.accepted, isFalse);
      expect(decision.message, contains('no-such-action'));
    });
  });
}
