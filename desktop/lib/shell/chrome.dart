import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// The shell's chrome primitives.
///
/// `desktop/docs/redesign.md` §3.1: **hairlines, type, one accent**. Every
/// surface composes these instead of inventing a box: a panel is a title row
/// over content with a hairline above it, never a rounded card with a shadow.
/// The previous shell had a private `_Card` in four files and a `Container`
/// with its own radius in a dozen more, which is why no two surfaces lined up.

/// A surface section: a label row, a hairline, then the content.
///
/// The hairline sits *above* the label so the eye reads a continuous rule down
/// the page; the label is micro type, not a heading.
class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.label,
    required this.child,
    this.trailing,
    this.padding = const EdgeInsets.fromLTRB(0, Space.sm, 0, Space.md),
    this.first = false,
  });

  /// The section name, printed in micro caps.
  final String label;
  final Widget child;

  /// A right-aligned value or control on the label row.
  final Widget? trailing;

  /// Content padding. The label row is always flush with the panel's own edge.
  final EdgeInsets padding;

  /// True for the first panel on a surface, which draws no rule above it.
  final bool first;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!first) const Rule(),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: Space.xs),
          child: Row(
            children: [
              Expanded(child: SectionLabel(label)),
              ?trailing,
            ],
          ),
        ),
        Padding(padding: padding, child: child),
      ],
    );
  }
}

/// A 1 px rule across the available width.
class Rule extends StatelessWidget {
  const Rule({super.key, this.color, this.indent = 0});

  final Color? color;
  final double indent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: indent),
      child: Container(
        height: Stroke.hairline,
        color: color ?? LockedInColors.line,
      ),
    );
  }
}

/// A vertical 1 px rule, for splitting a pane.
class VRule extends StatelessWidget {
  const VRule({super.key, this.color});

  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: Stroke.hairline,
      color: color ?? LockedInColors.line,
    );
  }
}

/// Micro caps: a section name, a field label, a badge word.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.color, this.trailing});

  final String text;
  final Color? color;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final style = LockedInType.micro.copyWith(
      color: color ?? LockedInColors.secondary,
    );
    return Row(
      children: [
        Flexible(
          child: Text(
            text.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: style,
          ),
        ),
        if (trailing != null) ...[
          const SizedBox(width: Space.xs),
          Text(
            trailing!,
            maxLines: 1,
            style: LockedInType.micro.copyWith(color: LockedInColors.muted),
          ),
        ],
      ],
    );
  }
}

/// A key as the app prints it: a hairline cap in mono, no fill.
///
/// Keys are the shell's most repeated glyph, so they are one widget: `Space`,
/// `Esc`, `Ctrl+K`, `Shift+N`.
class KeyCap extends StatelessWidget {
  const KeyCap(this.keyLabel, {super.key, this.tone});

  final String keyLabel;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final colour = tone ?? LockedInColors.secondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        border: Border.all(color: LockedInColors.line),
        borderRadius: BorderRadius.circular(Radii.control),
      ),
      child: Text(
        keyLabel,
        maxLines: 1,
        style: LockedInType.key.copyWith(color: colour, fontSize: 11.5),
      ),
    );
  }
}

/// `j/k move · Enter open · Esc back`, with the keys in caps.
///
/// The separator is a middot and the keys are drawn as caps, so a hint reads as
/// a key sequence rather than as a sentence.
class KeyHint extends StatelessWidget {
  const KeyHint(this.parts, {super.key, this.compact = false});

  /// `(key, label)` pairs, in reading order.
  final List<(String, String)> parts;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    for (var index = 0; index < parts.length; index++) {
      final (key, label) = parts[index];
      if (index > 0) {
        children.add(
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.xxs),
            child: Text(
              '·',
              style: LockedInType.micro.copyWith(color: LockedInColors.line),
            ),
          ),
        );
      }
      children.add(KeyCap('$key $label'));
    }
    return Wrap(
      spacing: Space.hair,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: children,
    );
  }
}

/// A thin value bar: focus, progress, a score.
///
/// Filled with a gradient from the tone to the same tone at 70 %, which reads as
/// dimension at 3 px without a second colour.
class Meter extends StatelessWidget {
  const Meter({
    super.key,
    required this.value,
    this.tone,
    this.height = Stroke.progress,
    this.track,
  });

  /// 0–1.
  final double value;
  final Color? tone;
  final double height;
  final Color? track;

  @override
  Widget build(BuildContext context) {
    final colour = tone ?? LockedInColors.primary;
    final clamped = value.isNaN ? 0.0 : value.clamp(0.0, 1.0);
    return ClipRRect(
      borderRadius: BorderRadius.circular(height / 2),
      child: Container(
        height: height,
        color: track ?? LockedInColors.panel,
        child: FractionallySizedBox(
          alignment: Alignment.centerLeft,
          widthFactor: clamped,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [colour, colour.withValues(alpha: 0.7)],
              ),
            ),
            child: const SizedBox.expand(),
          ),
        ),
      ),
    );
  }
}

/// A status word with its glyph: `● streaming`, `✓ done`, `! blocked`.
///
/// Colour never carries the state alone; the glyph and the word always agree.
class StatusTag extends StatelessWidget {
  const StatusTag({
    super.key,
    required this.glyph,
    required this.label,
    this.tone,
  });

  final String glyph;
  final String label;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final colour = tone ?? LockedInColors.muted;
    // One Text, so the state reads as one string to a test, a screen reader and
    // a copy-paste: `× failed`, not two fragments.
    return Text(
      '$glyph $label',
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: LockedInType.micro.copyWith(color: colour),
    );
  }
}

/// The reading column: prose never spans a wide window.
///
/// Wraps a prose block in a [Space.proseMeasure] cap and centres it, which is
/// what keeps a 1600 px window readable without a second layout.
class ProseColumn extends StatelessWidget {
  const ProseColumn({
    super.key,
    required this.child,
    this.align = Alignment.topCenter,
  });

  final Widget child;
  final Alignment align;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: align,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: Space.proseMeasure),
        child: child,
      ),
    );
  }
}
