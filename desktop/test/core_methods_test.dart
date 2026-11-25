import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_methods.g.dart';

/// The generated wire-method catalogue (`scripts/generate-dart-bindings.ts`).
void main() {
  test('every generated method is unique and non-empty', () {
    expect(CoreMethod.all.length, greaterThan(100));
    expect(CoreMethod.all.toSet().length, CoreMethod.all.length);
    expect(CoreMethod.all.every((method) => method.trim().isNotEmpty), isTrue);
  });

  test('the constants carry the documented wire strings', () {
    expect(CoreMethod.sessionList, 'session.list');
    expect(CoreMethod.sessionChatSend, 'session.chat.send');
    expect(CoreMethod.workSwarmVerify, 'work.swarm.verify');
    expect(CoreMethod.knowledgeGraph, 'knowledge.graph');
  });
}
