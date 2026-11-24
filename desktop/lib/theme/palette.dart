import 'package:material_ui/material_ui.dart';

import 'tokens.dart';

/// One theme's twelve semantic tokens (`docs/design.md` §3.1).
///
/// Mirrors `src/ui/theme/palettes.ts`: an id names the same identity on both
/// sides of the shell/core wall, and a token never changes meaning between
/// themes.
class LockedInPalette {
  const LockedInPalette({
    required this.id,
    required this.label,
    required this.background,
    required this.surface,
    required this.panel,
    required this.foreground,
    required this.muted,
    required this.primary,
    required this.secondary,
    required this.accent,
    required this.success,
    required this.warning,
    required this.error,
    required this.line,
  });

  /// Stable config id (`ui.theme`), never a label.
  final String id;

  /// Human label for the theme picker.
  final String label;

  final Color background;
  final Color surface;
  final Color panel;
  final Color foreground;
  final Color muted;
  final Color primary;
  final Color secondary;
  final Color accent;
  final Color success;
  final Color warning;
  final Color error;
  final Color line;
}

/// LockedIn Crimson — the default identity (`docs/design.md` §3.1).
const lockedInCrimson = LockedInPalette(
  id: 'lockedin',
  label: 'LockedIn Crimson',
  background: Color(0xFF0D0F11),
  surface: Color(0xFF15181B),
  panel: Color(0xFF1D2125),
  foreground: Color(0xFFE7E7E7),
  muted: Color(0xFF9199A3),
  primary: Color(0xFFD9534F),
  secondary: Color(0xFF9AA3AD),
  accent: Color(0xFFFF6B6B),
  success: Color(0xFF7FA37A),
  warning: Color(0xFFD8B26A),
  error: Color(0xFFFF5C5C),
  line: Color(0xFF30363C),
);

/// Maximum legibility; background/foreground/line/primary pushed apart for
/// low-vision use. Text stays plain white on true black, borders are light.
const lockedInHighContrast = LockedInPalette(
  id: 'high-contrast',
  label: 'High Contrast',
  background: Color(0xFF000000),
  surface: Color(0xFF000000),
  panel: Color(0xFF111111),
  foreground: Color(0xFFFFFFFF),
  muted: Color(0xFFD0D0D0),
  primary: Color(0xFFFF8080),
  secondary: Color(0xFFA6C8FF),
  accent: Color(0xFFFFD166),
  success: Color(0xFF5CFF8F),
  warning: Color(0xFFFFD400),
  error: Color(0xFFFF6B6B),
  line: Color(0xFF8C8C8C),
);

/// Claude Code CLI, approximated from its published palette.
const lockedInClaude = LockedInPalette(
  id: 'claude-code',
  label: 'Claude Code',
  background: Color(0xFF1F1E1D),
  surface: Color(0xFF262523),
  panel: Color(0xFF2C2B29),
  foreground: Color(0xFFE8E6E3),
  muted: Color(0xFFA39E97),
  primary: Color(0xFFD97757),
  secondary: Color(0xFFB1A79B),
  accent: Color(0xFFE8A87C),
  success: Color(0xFF7AC47F),
  warning: Color(0xFFE5B567),
  error: Color(0xFFE06C75),
  line: Color(0xFF3A3835),
);

/// Codex CLI, approximated from its published palette.
const lockedInCodex = LockedInPalette(
  id: 'codex',
  label: 'Codex',
  background: Color(0xFF0D0D0D),
  surface: Color(0xFF141414),
  panel: Color(0xFF1A1A1A),
  foreground: Color(0xFFEDEDED),
  muted: Color(0xFF9A9A9A),
  primary: Color(0xFF10A37F),
  secondary: Color(0xFF8FB8AD),
  accent: Color(0xFF4FD1B0),
  success: Color(0xFF3FBF7F),
  warning: Color(0xFFE3B341),
  error: Color(0xFFF85149),
  line: Color(0xFF30363D),
);

/// The theme ids the shell offers, in the order the Settings row cycles them.
///
/// `custom` is deliberately **not** in this cycle: the four built-ins are a
/// stable identity set, and the custom palette is reached through its own
/// editor action (`c` applies it, `e` edits it).
const lockedInThemeIds = <String>[
  'lockedin',
  'high-contrast',
  'claude-code',
  'codex',
];

/// The twelve semantic token names, in the order the palette editor lists them
/// (`docs/design.md` §3.1). The shell owns this catalogue; the core's
/// `theme.custom.*` methods accept exactly these names.
const customThemeTokenNames = <String>[
  'background',
  'surface',
  'panel',
  'foreground',
  'muted',
  'primary',
  'secondary',
  'accent',
  'success',
  'warning',
  'error',
  'line',
];

final _hexColour = RegExp(r'^#[0-9a-fA-F]{6}$');

/// True when [value] is the one stored token form, `#RRGGBB`.
bool isHexColour(String value) => _hexColour.hasMatch(value.trim());

/// Parse `#RRGGBB` to an opaque [Color], or null when the text is not that form.
Color? parseHexColour(String? value) {
  if (value == null) return null;
  final text = value.trim();
  if (!_hexColour.hasMatch(text)) return null;
  return Color(0xFF000000 | int.parse(text.substring(1), radix: 16));
}

/// The stored spelling of [color]: upper-case `#RRGGBB`.
String hexOfColour(Color color) =>
    '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

/// Crimson's swatch for one token, the fallback for a missing override.
Color? crimsonToken(String token) => switch (token) {
  'background' => lockedInCrimson.background,
  'surface' => lockedInCrimson.surface,
  'panel' => lockedInCrimson.panel,
  'foreground' => lockedInCrimson.foreground,
  'muted' => lockedInCrimson.muted,
  'primary' => lockedInCrimson.primary,
  'secondary' => lockedInCrimson.secondary,
  'accent' => lockedInCrimson.accent,
  'success' => lockedInCrimson.success,
  'warning' => lockedInCrimson.warning,
  'error' => lockedInCrimson.error,
  'line' => lockedInCrimson.line,
  _ => null,
};

/// The effective hex for one token: the stored override, else crimson.
///
/// This is what the editor prints beside a token and what a partial map paints,
/// so a missing token never reads as blank or black.
String customTokenHex(String token, Map<String, String>? tokens) {
  final override = parseHexColour(tokens?[token]);
  final colour = override ?? crimsonToken(token);
  return colour == null ? '' : hexOfColour(colour);
}

/// The custom palette: crimson with any stored token overriding one entry.
///
/// A partial map falls back to crimson **per token**, so a single edited
/// background still paints readable foreground text. Colours never change
/// meaning here: `error` stays the failure colour, and the shell still pairs it
/// with a glyph or label wherever it appears.
LockedInPalette customPalette([Map<String, String>? tokens]) {
  Color token(String name) =>
      parseHexColour(tokens?[name]) ??
      crimsonToken(name) ??
      lockedInCrimson.foreground;
  return LockedInPalette(
    id: 'custom',
    label: 'Custom',
    background: token('background'),
    surface: token('surface'),
    panel: token('panel'),
    foreground: token('foreground'),
    muted: token('muted'),
    primary: token('primary'),
    secondary: token('secondary'),
    accent: token('accent'),
    success: token('success'),
    warning: token('warning'),
    error: token('error'),
    line: token('line'),
  );
}

/// Built-in palettes by config id. `claude` is an alias for `claude-code`; the
/// catalogue and the cycle order stay canonical. `custom` resolves to crimson
/// until [applyPalette] is handed the stored tokens.
final Map<String, LockedInPalette> lockedInPalettes = <String, LockedInPalette>{
  'lockedin': lockedInCrimson,
  'high-contrast': lockedInHighContrast,
  'claude-code': lockedInClaude,
  'claude': lockedInClaude,
  'codex': lockedInCodex,
  'custom': customPalette(),
};

/// The id used when nothing is configured (`ui.theme` default).
const defaultPaletteId = 'lockedin';

LockedInPalette _active = lockedInCrimson;

/// The palette the shell is painting with right now.
LockedInPalette get activePalette => _active;

/// The id of the palette the shell is painting with right now.
String get activeThemeId => _active.id;

/// Resolve a stored id to its palette, or null for an unknown one.
LockedInPalette? paletteFor(String? id) =>
    id == null ? null : lockedInPalettes[id];

/// Switch the shell to [id].
///
/// [tokens] supplies the custom palette's stored overrides when [id] is
/// `custom`; a missing or partial map falls back to crimson per token. An
/// unknown id is a no-op that returns false and leaves the previous palette in
/// place, so a typo in `config.toml` cannot blank the shell.
bool applyPalette(String id, {Map<String, String>? tokens}) {
  if (id == 'custom') {
    _active = customPalette(tokens);
    return true;
  }
  final palette = lockedInPalettes[id];
  if (palette == null) return false;
  _active = palette;
  return true;
}

/// Apply [id], falling back to crimson for an unknown value. This is the app's
/// entry point: it resolves what the core stored without ever going blank.
LockedInPalette applyPaletteOr(String? id, {Map<String, String>? tokens}) {
  _active = id == 'custom'
      ? customPalette(tokens)
      : lockedInPalettes[id] ?? lockedInCrimson;
  return _active;
}

/// Return to the crimson default.
void resetPalette() => _active = lockedInCrimson;

/// Label for a palette id, or the id itself when it is not a built-in.
String paletteLabel(String id) => lockedInPalettes[id]?.label ?? id;

/// The LockedIn palette. Mirrors `src/ui/theme/palettes.ts` so the desktop
/// shell and the TUI share the same visual identity.
///
/// These read the *active* palette, so applying a theme repaints every widget
/// that uses them. They are getters, not `const` fields: the shell owns the
/// current choice.
abstract final class LockedInColors {
  static Color get background => _active.background;
  static Color get surface => _active.surface;
  static Color get panel => _active.panel;
  static Color get foreground => _active.foreground;
  static Color get muted => _active.muted;
  static Color get primary => _active.primary;
  static Color get secondary => _active.secondary;
  static Color get accent => _active.accent;
  static Color get success => _active.success;
  static Color get warning => _active.warning;
  static Color get error => _active.error;
  static Color get line => _active.line;
}

/// Label/icon colour for text drawn on [color].
///
/// Measured, not guessed: white and black are equally legible at luminance
/// **0.179**, so the better of the two is chosen per colour. A fixed threshold
/// of 0.35 (the old rule) picked white for every mid-tone fill, which put
/// crimson's buttons at 3.96:1 and its error fills at 3.03:1 — below the 4.5:1
/// `docs/design.md` §3.1 requires. Every built-in palette's primary now takes
/// black labels; that is the accessible choice, and it is what the filled and
/// error buttons use.
Color contrastOn(Color color) {
  final luminance = color.computeLuminance();
  final onWhite = 1.05 / (luminance + 0.05);
  final onBlack = (luminance + 0.05) / 0.05;
  return onWhite >= onBlack ? Colors.white : Colors.black;
}

/// The WCAG contrast ratio between [a] and [b] (1–21).
///
/// Exposed for the theme test, which checks every token pair of every palette
/// rather than trusting the screenshot.
double contrastRatio(Color a, Color b) {
  final high = a.computeLuminance();
  final low = b.computeLuminance();
  final lighter = high > low ? high : low;
  final darker = high > low ? low : high;
  return (lighter + 0.05) / (darker + 0.05);
}

ThemeData lockedInTheme() {
  final onPrimary = contrastOn(LockedInColors.primary);
  final scheme =
      ColorScheme.fromSeed(
        seedColor: LockedInColors.primary,
        brightness: Brightness.dark,
      ).copyWith(
        primary: LockedInColors.primary,
        onPrimary: onPrimary,
        secondary: LockedInColors.secondary,
        onSecondary: contrastOn(LockedInColors.secondary),
        surface: LockedInColors.surface,
        onSurface: LockedInColors.foreground,
        error: LockedInColors.error,
        onError: contrastOn(LockedInColors.error),
        outline: LockedInColors.line,
      );

  // The chrome is mono (`desktop/docs/redesign.md` §3.1). A widget that wants
  // proportional prose asks for `LockedInType.prose` explicitly, so nothing
  // accidentally reads as a paragraph in a label.
  final body = LockedInType.body.copyWith(color: LockedInColors.foreground);

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: LockedInColors.background,
    dividerColor: LockedInColors.line,
    splashFactory: InkSparkle.splashFactory,
    // Material's default hover wash is 4 % white, invisible on these surfaces.
    // A panel lift is the pointer equivalent of the sidebar's selected row.
    hoverColor: LockedInColors.panel.withValues(alpha: 0.55),
    highlightColor: LockedInColors.panel.withValues(alpha: 0.35),
    textTheme: TextTheme(
      bodyLarge: body,
      bodyMedium: body,
      bodySmall: LockedInType.label.copyWith(color: LockedInColors.muted),
      titleLarge: LockedInType.title.copyWith(color: LockedInColors.foreground),
      titleMedium: LockedInType.body.copyWith(
        color: LockedInColors.foreground,
        fontWeight: FontWeight.w600,
        fontSize: 14,
      ),
      labelLarge: LockedInType.label.copyWith(color: LockedInColors.foreground),
      labelSmall: LockedInType.micro.copyWith(color: LockedInColors.muted),
    ),
    // Chrome is square with a hairline; only floating layers get a radius
    // (`desktop/docs/redesign.md` §3.1).
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: LockedInColors.surface,
      hintStyle: LockedInType.body.copyWith(color: LockedInColors.muted),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: Space.sm,
        vertical: Space.xs,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.control),
        borderSide: BorderSide(color: LockedInColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.control),
        borderSide: BorderSide(color: LockedInColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(Radii.control)),
        borderSide: BorderSide(
          color: LockedInColors.primary,
          width: Stroke.hairline,
        ),
      ),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStateProperty.all(LockedInColors.line),
      thickness: WidgetStateProperty.all(6),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: LockedInColors.primary,
        foregroundColor: onPrimary,
        textStyle: LockedInType.key,
        padding: const EdgeInsets.symmetric(
          horizontal: Space.md,
          vertical: Space.xs + Space.hair,
        ),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(Radii.control)),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: LockedInColors.secondary,
        textStyle: LockedInType.label,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(Radii.control)),
        ),
      ),
    ),
    // One dialog shape for every confirm, picker and settings sheet: square,
    // one hairline, no elevation — the same frame as the palette and the
    // leader, so a floating layer looks the same wherever it opens.
    dialogTheme: DialogThemeData(
      backgroundColor: LockedInColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(Radii.control)),
        side: BorderSide(color: LockedInColors.line, width: Stroke.hairline),
      ),
      titleTextStyle: LockedInType.title.copyWith(
        color: LockedInColors.foreground,
        fontSize: 15,
      ),
      contentTextStyle: LockedInType.proseSmall.copyWith(
        color: LockedInColors.secondary,
      ),
    ),
    iconTheme: IconThemeData(color: LockedInColors.secondary, size: 16),
  );
}
