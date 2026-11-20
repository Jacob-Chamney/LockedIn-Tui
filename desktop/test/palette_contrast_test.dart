import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// Every label the app draws on a coloured fill must reach WCAG AA (4.5:1),
/// on **every** palette, including a custom one — the palette editor accepts
/// any `#RRGGBB` per token and does not check pairs.
///
/// The old rule chose the label by a fixed luminance threshold (0.35), which
/// put crimson's primary buttons at 3.96:1 and its error fills at 3.03:1.
void main() {
  const minimum = 4.5;

  test('the crossover is where white and black are equal', () {
    // Luminance 0.179 is the point where 1.05/(L+0.05) == (L+0.05)/0.05.
    final justBelow = contrastOn(Color.lerp(Colors.black, Colors.white, 0.28)!);
    final justAbove = contrastOn(Color.lerp(Colors.black, Colors.white, 0.62)!);
    expect(justBelow, Colors.white);
    expect(justAbove, Colors.black);
  });

  for (final palette in lockedInPalettes.values) {
    group('${palette.label} (${palette.id})', () {
      for (final (name, fill) in <(String, Color)>[
        ('primary', palette.primary),
        ('secondary', palette.secondary),
        ('error', palette.error),
        ('success', palette.success),
        ('warning', palette.warning),
      ]) {
        test('$name labels reach AA', () {
          final ink = contrastOn(fill);
          expect(
            contrastRatio(ink, fill),
            greaterThanOrEqualTo(minimum),
            reason:
                '$name ${hexOfColour(fill)} with '
                '${ink == Colors.white ? 'white' : 'black'} is only '
                '${contrastRatio(ink, fill).toStringAsFixed(2)}:1',
          );
        });
      }
    });
  }

  test('crimson primary no longer claims white on a 3.96:1 fill', () {
    // The identity choice the review recorded: the accessible label wins.
    expect(contrastOn(lockedInCrimson.primary), Colors.black);
    expect(
      contrastRatio(Colors.white, lockedInCrimson.primary),
      lessThan(minimum),
    );
  });

  test('a light custom palette still gets a readable label', () {
    const custom = LockedInPalette(
      id: 'custom',
      label: 'Custom',
      background: Color(0xFFFFFFFF),
      surface: Color(0xFFFFFFFF),
      panel: Color(0xFFF2F2F2),
      foreground: Color(0xFF101010),
      muted: Color(0xFF555555),
      primary: Color(0xFFFFE082),
      secondary: Color(0xFFB3E5FC),
      accent: Color(0xFFFFCC80),
      success: Color(0xFFA5D6A7),
      warning: Color(0xFFFFE082),
      error: Color(0xFFFFCDD2),
      line: Color(0xFFDDDDDD),
    );
    for (final fill in [
      custom.primary,
      custom.secondary,
      custom.error,
      custom.success,
      custom.warning,
    ]) {
      expect(
        contrastRatio(contrastOn(fill), fill),
        greaterThanOrEqualTo(minimum),
        reason: '${hexOfColour(fill)} has no readable label',
      );
    }
  });
}
