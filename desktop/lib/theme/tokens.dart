import 'package:material_ui/material_ui.dart';

/// The spatial, typographic and motion scales the whole shell draws from.
///
/// `desktop/docs/redesign.md` §3: **hairlines, type, one accent**. Nothing in
/// the UI may use a size, radius or duration that is not on these scales, so
/// the app stays visually coherent as surfaces are added — the previous shell
/// had 6, 7, 8, 9, 10, 11.5, 12, 12.5, 13 and 15 px type in the same column.
///
/// Colour is not here: it comes from [LockedInColors], which the core's custom
/// palette can override.
abstract final class Space {
  /// 2 px — the gap between a glyph and its label.
  static const double hair = 2;

  /// 4 px — inside a chip, between tiny pairs.
  static const double xxs = 4;

  /// 8 px — the default gap between related things.
  static const double xs = 8;

  /// 12 px — a row's horizontal padding.
  static const double sm = 12;

  /// 16 px — a surface's inner padding.
  static const double md = 16;

  /// 24 px — between blocks.
  static const double lg = 24;

  /// 32 px — around a centred state, above a section.
  static const double xl = 32;

  /// 48 px — the air around a display line.
  static const double xxl = 48;

  /// The reading measure: long prose never exceeds this, on any window.
  static const double proseMeasure = 660;
}

/// Corner radii, plural so it cannot shadow Flutter's `Radius`.
abstract final class Radii {
  /// Chrome and controls: square. The crispness is the point.
  static const double none = 0;

  /// 2 px — a chip or a key cap, where a hard corner would clip the glyph.
  static const double control = 2;

  /// 6 px — floating layers only (palette, leader, dialogs).
  static const double layer = 6;

  /// A fully rounded cap (a status pill). Only for a shape that is meant to be
  /// a capsule; chrome and controls stay square.
  static const double pill = 999;
}

/// Stroke widths.
abstract final class Stroke {
  /// The default separator and border.
  static const double hairline = 1;

  /// A focused pane's marker.
  static const double focus = 2;

  /// Progress and meter fills.
  static const double progress = 3;
}

/// Motion durations and curves.
///
/// One settle animation per state change, 90–220 ms, nothing loops. The shell
/// checks `MediaQuery.disableAnimations` before using any of these
/// (`docs/design.md` §9: honour reduced motion).
abstract final class Motion {
  static const Duration fast = Duration(milliseconds: 90);
  static const Duration base = Duration(milliseconds: 120);
  static const Duration settle = Duration(milliseconds: 220);

  static const Curve enter = Curves.easeOutCubic;
  static const Curve settleCurve = Curves.easeOutQuint;
}

/// The numeric type scale, in px.
///
/// Every `fontSize` in the shell draws from these eight steps. A raw number on
/// a widget was the last place two surfaces could disagree about hierarchy:
/// `fontSize: 12` and `fontSize: 13` side by side read as two different apps.
abstract final class TypeScale {
  static const double micro = 10.5;
  static const double label = 11.5;
  static const double key = 12.5;
  static const double body = 13;
  static const double proseSmall = 13.5;
  static const double prose = 15;
  static const double title = 18;
  static const double display = 24;
}

/// The two families, and the text styles built from them.
///
/// **Mono for structure, sans for reading.** Every label, key, number, id and
/// bar is mono; anything a learner reads as prose is Plex at a comfortable
/// measure. A proportional label would lose the terminal identity; a mono
/// paragraph would cost readability at length.
abstract final class LockedInType {
  /// Chrome, data, keys, code.
  static const String mono = 'JetBrainsMono';

  /// Prose and long-form text.
  static const String sans = 'IBMPlexSans';

  /// The fallback chain: a machine without the bundled fonts still renders.
  static const List<String> fallback = <String>['monospace'];

  /// 10.5 px — the smallest label: a section name, a badge.
  static const TextStyle micro = TextStyle(
    fontFamily: mono,
    fontFamilyFallback: fallback,
    fontSize: 10.5,
    height: 1.3,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.4,
  );

  /// 11.5 px — a row's secondary line, a footer hint.
  static const TextStyle label = TextStyle(
    fontFamily: mono,
    fontFamilyFallback: fallback,
    fontSize: 11.5,
    height: 1.4,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.1,
  );

  /// 12.5 px — a key cap, a compact value.
  static const TextStyle key = TextStyle(
    fontFamily: mono,
    fontFamilyFallback: fallback,
    fontSize: 12.5,
    height: 1.2,
    fontWeight: FontWeight.w600,
  );

  /// 13 px — UI body: a list row, a field, a chip.
  static const TextStyle body = TextStyle(
    fontFamily: mono,
    fontFamilyFallback: fallback,
    fontSize: 13,
    height: 1.5,
    fontWeight: FontWeight.w400,
  );

  /// 15 px / 1.7 — the prose a learner reads. Proportional, capped at
  /// [Space.proseMeasure].
  static const TextStyle prose = TextStyle(
    fontFamily: sans,
    fontSize: 15,
    height: 1.7,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.05,
  );

  /// 13 px / 1.6 — prose inside a bubble or a narrow pane.
  static const TextStyle proseSmall = TextStyle(
    fontFamily: sans,
    fontSize: 13.5,
    height: 1.6,
    fontWeight: FontWeight.w400,
  );

  /// 18 px — a surface title.
  static const TextStyle title = TextStyle(
    fontFamily: mono,
    fontFamilyFallback: fallback,
    fontSize: 18,
    height: 1.3,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
  );

  /// 24 px — the one display line a surface may have.
  static const TextStyle display = TextStyle(
    fontFamily: mono,
    fontFamilyFallback: fallback,
    fontSize: 24,
    height: 1.2,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.4,
  );

  /// 15 px — inline `code` inside prose.
  static const TextStyle code = TextStyle(
    fontFamily: mono,
    fontFamilyFallback: fallback,
    fontSize: 13,
    height: 1.5,
  );
}
