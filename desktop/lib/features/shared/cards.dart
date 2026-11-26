import 'package:material_ui/material_ui.dart';

import '../../shell/chrome.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// A titled section, in the shell's hairline style.
///
/// This was a rounded, filled card — the last Material shape in a shell that is
/// now hairlines and type (`desktop/docs/redesign.md` §3.1). It delegates to
/// [Panel], so a section on Teaching, Work or a lesson looks the same as one on
/// the chat, and a change to the section chrome happens in one place.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.label,
    required this.child,
    this.trailing,
  });

  final String label;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Panel(
      label: label,
      trailing: trailing,
      padding: const EdgeInsets.fromLTRB(0, Space.xs, 0, Space.sm),
      child: child,
    );
  }
}

/// A short value in a bordered chip: a count, a mode, an outcome.
///
/// `tone` colours the value; the muted default is the common case. This is what
/// `_ValueChip` and `_CountChip` were, twice, in four files.
class ValueChip extends StatelessWidget {
  const ValueChip(this.text, {super.key, this.tone});

  final String text;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: tone ?? LockedInColors.muted,
          fontSize: TypeScale.micro,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
