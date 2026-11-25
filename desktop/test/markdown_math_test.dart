import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/features/chat/diagram.dart';
import 'package:lockedin_desktop/features/chat/markdown.dart';
import 'package:lockedin_desktop/features/chat/math.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: child,
    ),
  ),
);

void main() {
  group('math', () {
    test('parses a fraction, a root and a superscript', () {
      final fraction = parseMath(r'\frac{a}{b}');
      expect(fraction.whereType<MathFraction>(), hasLength(1));
      expect(mathPlainText(fraction), 'a over b');

      final root = parseMath(r'\sqrt{x}');
      expect(root.whereType<MathRoot>(), hasLength(1));

      final power = parseMath(r'x^2');
      expect(power.whereType<MathSuperscript>(), hasLength(1));
      expect(mathPlainText(power), contains('to the 2'));
    });

    test('maps greek letters and operators without dropping them', () {
      expect(mathPlainText(parseMath(r'\alpha + \beta')), 'α + β');
      expect(mathPlainText(parseMath(r'\le \infty')), '≤ ∞');
      // An unknown command keeps its name visible rather than vanishing.
      expect(mathPlainText(parseMath(r'\weird')), 'weird');
    });

    testWidgets('renders a fraction as numerator over denominator', (
      tester,
    ) async {
      await tester.pumpWidget(_app(const MathView(r'\frac{rise}{run}')));
      expect(find.text('rise'), findsOneWidget);
      expect(find.text('run'), findsOneWidget);
    });

    testWidgets('display maths in a markdown block', (tester) async {
      await tester.pumpWidget(
        _app(const ChatMarkdown(text: r'**slope** $$\frac{rise}{run}$$')),
      );
      expect(find.text('rise'), findsOneWidget);
      expect(find.text('run'), findsOneWidget);
    });

    testWidgets('inline maths sits in a sentence', (tester) async {
      await tester.pumpWidget(
        _app(const ChatMarkdown(text: r'The area is $x^2$ square units.')),
      );
      expect(find.textContaining('The area is'), findsOneWidget);
      expect(find.text('x'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('a currency amount is not maths', (tester) async {
      await tester.pumpWidget(
        _app(const ChatMarkdown(text: r'It costs $5 today.')),
      );
      expect(find.textContaining(r'$5'), findsOneWidget);
    });
  });

  group('mermaid', () {
    test('parses nodes, labels and edges', () {
      final chart = parseFlowchart('''
graph TD
  A[Start] --> B{Ready?}
  B -->|yes| C(Done)
  B -->|no| A
''');
      expect(chart, isNotNull);
      expect(chart!.nodes.map((node) => node.id), containsAll(['A', 'B', 'C']));
      expect(chart.nodes.firstWhere((node) => node.id == 'A').label, 'Start');
      expect(chart.edges, hasLength(3));
      expect(chart.edges[1].label, 'yes');
      expect(chart.nodes.firstWhere((node) => node.id == 'B').shape, 'diamond');
    });

    test('refuses a diagram with no edges', () {
      expect(parseFlowchart('graph TD\n  A[Only]'), isNull);
      expect(parseFlowchart('not a diagram'), isNull);
    });

    testWidgets('draws the labels of every node', (tester) async {
      await tester.pumpWidget(
        _app(const Flowchart('graph LR\n A[read] --> B[write]')),
      );
      expect(find.text('read'), findsOneWidget);
      expect(find.text('write'), findsOneWidget);
    });

    testWidgets('an unusable diagram keeps its source visible', (tester) async {
      await tester.pumpWidget(
        _app(const ChatMarkdown(text: '```mermaid\nnot a diagram\n```')),
      );
      expect(find.textContaining('not a diagram'), findsOneWidget);
    });
  });
}
