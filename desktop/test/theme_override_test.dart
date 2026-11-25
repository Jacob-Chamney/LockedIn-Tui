import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/theme/palette.dart';

void main() {
  tearDown(resetPalette);

  test('an override layers on top of a base palette and leaves the rest', () {
    final palette = paletteWithOverrides(lockedInCodex, {
      'panel': '#123456',
      'foreground': 'not-a-colour',
    });
    expect(palette.id, 'codex');
    expect(hexOfColour(palette.panel), '#123456');
    // A malformed value is ignored for that token, not allowed to blank it.
    expect(palette.foreground, lockedInCodex.foreground);
    // A token with no override keeps the base's identity.
    expect(palette.primary, lockedInCodex.primary);
  });

  test('an override applies to a built-in base, not only to custom', () {
    final ok = applyPalette('codex', tokens: {'panel': '#0A0B0C'});
    expect(ok, isTrue);
    expect(activeThemeId, 'codex');
    expect(hexOfColour(activePalette.panel), '#0A0B0C');
    expect(
      hexOfColour(activePalette.primary),
      hexOfColour(lockedInCodex.primary),
    );
  });

  test('an empty override map is the base palette exactly', () {
    final palette = paletteWithOverrides(lockedInHighContrast, const {});
    expect(identical(palette, lockedInHighContrast), isTrue);
  });

  test('export and import round-trip every token', () {
    final source = {
      'background': '#101010',
      'panel': '#202020',
      'primary': '#C8102E',
    };
    final json = themeDocumentJson(base: 'codex', tokens: source);
    final parsed = parseThemeDocument(json);
    expect(parsed.error, isNull);
    expect(parsed.base, 'codex');
    expect(parsed.tokens, source);
  });

  test('a bare token map is accepted; the wrapper is optional', () {
    final parsed = parseThemeDocument('{"panel":"#AABBCC"}');
    expect(parsed.error, isNull);
    expect(parsed.base, isNull);
    expect(parsed.tokens, {'panel': '#AABBCC'});
  });

  test('an unknown token is refused by name', () {
    final parsed = parseThemeDocument('{"tokens":{"glow":"#FFFFFF"}}');
    expect(parsed.error, contains('glow'));
    expect(parsed.tokens, isEmpty);
  });

  test('a value that is not #RRGGBB is refused by token', () {
    final parsed = parseThemeDocument('{"tokens":{"panel":"blurple"}}');
    expect(parsed.error, contains('panel'));
    expect(parsed.error, contains('#RRGGBB'));
  });

  test('an unknown base theme is refused rather than silently ignored', () {
    final parsed = parseThemeDocument('{"base":"solarized","tokens":{}}');
    expect(parsed.error, contains('solarized'));
  });

  test('invalid JSON and an empty document are readable errors', () {
    expect(parseThemeDocument('{oops').error, contains('valid JSON'));
    expect(parseThemeDocument('  ').error, contains('paste'));
  });
}
