import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

class SessionLoading extends StatelessWidget {
  const SessionLoading({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: LockedInColors.primary,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            label,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        ],
      ),
    );
  }
}

class SessionEmptyNote extends StatelessWidget {
  const SessionEmptyNote({
    super.key,
    required this.tone,
    required this.title,
    required this.body,
  });

  final Color tone;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              tone == LockedInColors.warning
                  ? Icons.info_outline
                  : Icons.remove_circle_outline,
              size: 14,
              color: tone,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                title,
                style: TextStyle(
                  color: tone,
                  fontSize: TypeScale.key,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          body,
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

class ArchivedBadge extends StatelessWidget {
  const ArchivedBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.archive_outlined, size: 10, color: LockedInColors.muted),
          SizedBox(width: 4),
          Text(
            'archived',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
            ),
          ),
        ],
      ),
    );
  }
}

String createdLabel(String created) {
  if (created.isEmpty) return 'date unknown';
  final stamp = created.replaceFirst('T', ' ');
  final cut = stamp.length > 16 ? stamp.substring(0, 16) : stamp;
  return 'created $cut';
}

/// A short, single-line rendering of an ISO-8601 instant: `YYYY-MM-DD HH:MM`.
String shortStamp(String stamp) {
  final value = stamp.replaceFirst('T', ' ');
  return value.length > 16 ? value.substring(0, 16) : value;
}

/// One rendered line of `assignment-steps.md`.
///
/// [index] is the task-item ordinal the core toggles; headings and prose lines
/// carry none. Parsing here is display-only: the counts come from the core, and
/// a toggle's answer replaces the markdown rather than being merged locally.
class StepRow {
  const StepRow({
    required this.text,
    this.index,
    this.checked,
    this.heading = false,
  });

  final String text;
  final int? index;
  final bool? checked;
  final bool heading;
}

final _stepHeadingPattern = RegExp(r'^(#{1,6})\s+(.*)$');
final _stepCheckboxPattern = RegExp(r'^[-*]\s+\[([ xX])\]\s+(.*)$');
final _stepBulletPattern = RegExp(r'^[-*]\s+(.*)$');

List<StepRow> parseSteps(String markdown) {
  final rows = <StepRow>[];
  var task = 0;
  final lines = markdown
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n');
  for (final line in lines) {
    final trimmed = line.trim();
    if (trimmed.isEmpty) continue;

    final heading = _stepHeadingPattern.firstMatch(trimmed);
    if (heading != null) {
      rows.add(StepRow(text: heading.group(2)!.trim(), heading: true));
      continue;
    }

    final checkbox = _stepCheckboxPattern.firstMatch(trimmed);
    if (checkbox != null) {
      rows.add(
        StepRow(
          text: checkbox.group(2)!.trimRight(),
          index: task++,
          checked: checkbox.group(1)!.toLowerCase() == 'x',
        ),
      );
      continue;
    }

    final bullet = _stepBulletPattern.firstMatch(trimmed);
    if (bullet != null) {
      rows.add(StepRow(text: bullet.group(1)!.trimRight()));
      continue;
    }

    final quote = trimmed.startsWith('>')
        ? trimmed.substring(1).trim()
        : trimmed;
    rows.add(StepRow(text: quote));
  }
  return rows;
}
