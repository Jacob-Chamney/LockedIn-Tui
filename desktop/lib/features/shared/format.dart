import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';

/// Small, shared formatting helpers.
///
/// Each of these was copy-pasted into two to four feature files (15 identical
/// bodies in total), where a change to one silently left the others behind.
/// They live here because they are the same rule everywhere: a hash is ten
/// characters, a date is its day, and an empty part does not get a separator.

/// `sha256:abc…` shortened to ten characters, or `no hash` when absent.
String shortHash(String hash) {
  final value = hash.startsWith('sha256:')
      ? hash.substring('sha256:'.length)
      : hash;
  if (value.isEmpty) return 'no hash';
  return value.length <= 10 ? value : value.substring(0, 10);
}

/// The glyph for one source kind.
IconData sourceIcon(String kind) {
  return switch (kind) {
    'pdf' => Icons.picture_as_pdf_outlined,
    'docx' => Icons.description_outlined,
    'image' => Icons.image_outlined,
    'markdown' || 'text' || 'code' => Icons.article_outlined,
    _ => Icons.insert_drive_file_outlined,
  };
}

/// The parts that are not blank, separated by a middot.
String joinDot(List<String> parts) =>
    parts.where((part) => part.trim().isNotEmpty).join(' · ');

/// The `YYYY-MM-DD` day of an ISO-8601 instant, or the input when it is not one.
String dateLabel(String date) {
  final trimmed = date.trim();
  if (trimmed.isEmpty) return '';
  return trimmed.length >= 10 ? trimmed.substring(0, 10) : trimmed;
}

/// The token colour for one side of the wall.
Color sideColor(String side) => switch (side) {
  'school' => LockedInColors.primary,
  'skills' => LockedInColors.secondary,
  'work' => LockedInColors.accent,
  _ => LockedInColors.muted,
};
