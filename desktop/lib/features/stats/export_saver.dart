import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';

import '../../bridge/errors.dart';

/// Chooses the destination for one Stats export.
///
/// The core returns the document text and never a path (`stats.export` in
/// `desktop/docs/protocol.md`), so saving the file is the shell's job. The
/// picker is the only source of a destination: a `null` answer means the user
/// cancelled, and nothing is written.
typedef SavePathPicker = Future<String?> Function(String suggestedName);

/// `stats-<scope>-<range>.<md|csv>`: the name the Save dialog suggests.
///
/// The extension follows the format, so a CSV export does not land in a `.md`
/// file and the dialog's own filter agrees with the bytes.
String exportFileName({
  required String scope,
  required String range,
  required String format,
}) {
  final extension = format == 'csv' ? 'csv' : 'md';
  return 'stats-${_slug(scope)}-${_slug(range)}.$extension';
}

String _slug(String value) {
  final slug = value
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  return slug.isEmpty ? 'all' : slug;
}

/// The platform Save dialog, filtered to the format's extension.
///
/// Cancelling returns `null`. The shell never invents a destination, so this
/// is the only place a path can come from.
Future<String?> pickExportSavePath(String suggestedName) async {
  final extension = suggestedName.split('.').last == 'csv' ? 'csv' : 'md';
  final location = await getSaveLocation(
    suggestedName: suggestedName,
    acceptedTypeGroups: [
      XTypeGroup(
        label: extension == 'csv' ? 'CSV' : 'Markdown',
        extensions: [extension],
      ),
    ],
  );
  final path = location?.path.trim();
  if (path == null || path.isEmpty) return null;
  return path;
}

/// Writes exactly [text] to [path]. The caller has already picked [path].
Future<void> writeExportFile(String path, String text) async {
  await File(path).writeAsString(text);
}

/// A one-line reason for a failed save, never a stack trace and never the
/// document itself.
String saveFailureReason(Object failure) {
  if (failure is FileSystemException) {
    final os = failure.osError?.message;
    if (os != null && os.trim().isNotEmpty) return os.trim();
    return failure.message;
  }
  if (failure is MissingPluginException) {
    return 'no save dialog on this platform';
  }
  // Everything else goes through the one mapper the shell uses: a timeout and
  // a dead core become sentences, a short single-line message survives, and a
  // stack trace or a multi-line provider blob is replaced. `toString()` here
  // used to print the exception class and its payload into the export dialog.
  return userMessage(failure);
}
