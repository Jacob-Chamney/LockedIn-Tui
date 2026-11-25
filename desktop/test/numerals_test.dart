import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/theme/numerals.dart';
import 'package:material_ui/material_ui.dart';

/// Review #39: numbers compared down a column share a digit width, so a
/// changing total does not slide sideways.
void main() {
  test('tabular adds tabular figures and keeps the rest of the style', () {
    const style = TextStyle(fontSize: 12, color: Color(0xFFAA0000));
    final result = tabular(style);
    expect(result.fontFeatures, contains(const FontFeature.tabularFigures()));
    expect(result.fontSize, 12);
    expect(result.color, const Color(0xFFAA0000));
  });
}
