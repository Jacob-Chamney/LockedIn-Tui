import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/knowledge/knowledge_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

Future<void> _pump(
  WidgetTester tester, {
  required LearningGraph graph,
  VoidCallback? onLoadGraph,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: KnowledgePage(graph: graph, onLoadGraph: onLoadGraph),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

const _graph = LearningGraph(
  nodes: [
    LearningNode(
      id: 'goal:g1',
      kind: 'goal',
      label: 'Read disassembly',
      detail: 'goal',
      side: 'skills',
      context: 'Read disassembly',
      grounded: 'record',
    ),
    LearningNode(
      id: 'source:g1:intel',
      kind: 'source',
      label: 'intel.md',
      detail: 'markdown',
      side: 'skills',
      context: 'Read disassembly',
      grounded: 'source',
    ),
    LearningNode(
      id: 'step:g1:step-1',
      kind: 'step',
      label: 'A register holds state',
      detail: '1 of 2 · open · agent explanation',
      side: 'skills',
      context: 'Read disassembly',
      grounded: 'agent',
    ),
  ],
  edges: [
    LearningEdge(from: 'source:g1:intel', to: 'goal:g1', kind: 'bound-to'),
    LearningEdge(from: 'goal:g1', to: 'step:g1:step-1', kind: 'contains'),
  ],
  counts: {'goal': 1, 'source': 1, 'step': 1},
  diagnostics: [],
  truncated: false,
);

void main() {
  testWidgets('g opens the learning graph and Enter expands relations', (
    tester,
  ) async {
    var loaded = 0;
    await _pump(tester, graph: _graph, onLoadGraph: () => loaded += 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyG);
    await tester.pumpAndSettle();

    expect(loaded, 1);
    expect(find.byKey(const ValueKey('knowledge-graph-list')), findsOneWidget);
    expect(find.textContaining('3 nodes'), findsOneWidget);
    expect(find.text('agent explanation'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('knowledge-graph-step:g1:step-1')),
      findsOneWidget,
    );

    // The source row is second; expand it to see its incoming relation.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.textContaining('bound-to'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyG);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('knowledge-graph-list')), findsNothing);
    expect(find.byKey(const ValueKey('knowledge-list')), findsOneWidget);
  });

  testWidgets('an empty graph teaches the next action', (tester) async {
    await _pump(tester, graph: LearningGraph.empty);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyG);
    await tester.pumpAndSettle();
    expect(find.textContaining('no learning artifacts'), findsOneWidget);
  });
}
