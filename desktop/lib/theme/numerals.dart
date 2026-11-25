import 'package:material_ui/material_ui.dart';

/// Tabular figures for a number the eye compares down a column.
///
/// Proportional digits make `1` narrower than `8`, so a right-aligned count or
/// a token total shifts sideways as it changes. Tabular figures give every digit
/// the same advance, which is the review's #39 density point: the numeric
/// columns line up even while they update.
///
/// Only apply this to numbers, never to prose: the feature changes glyph widths
/// and looks loose on words.
TextStyle tabular(TextStyle style) =>
    style.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
