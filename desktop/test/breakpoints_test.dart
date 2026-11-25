import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/theme/breakpoints.dart';

/// One layout scale (UI review #22): the constants are the only thresholds,
/// and a page compares against a concept rather than a bare number.
void main() {
  test('the scale is ordered and the shared concepts agree', () {
    expect(Breakpoints.contentWide, 1180);
    expect(Breakpoints.columns, 980);
    expect(Breakpoints.rail, 900);
    expect(Breakpoints.content, 900);
    expect(Breakpoints.column, 700);
    expect(Breakpoints.snippet, 640);
    expect(Breakpoints.hint, 560);
    expect(Breakpoints.stack, 520);

    expect(Breakpoints.stack, lessThan(Breakpoints.hint));
    expect(Breakpoints.hint, lessThan(Breakpoints.column));
    expect(Breakpoints.column, lessThan(Breakpoints.columns));
    expect(Breakpoints.content, lessThanOrEqualTo(Breakpoints.contentWide));
  });

  test('no page compares a width against a bare number', () {
    final pattern = RegExp(r'\b(?:maxWidth|width)\s*(?:<|<=|>|>=)\s*\d');
    final offenders = <String>[];
    for (final root in [Directory('lib/features'), Directory('lib/shell')]) {
      for (final entity in root.listSync(recursive: true)) {
        if (entity is! File || !entity.path.endsWith('.dart')) continue;
        final lines = entity.readAsLinesSync();
        for (var index = 0; index < lines.length; index += 1) {
          if (pattern.hasMatch(lines[index])) {
            offenders.add('${entity.path}:${index + 1}');
          }
        }
      }
    }
    expect(offenders, isEmpty);
  });
}
