import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../../shell/chrome.dart';

/// A two-faced card that turns over when [showingBack] changes.
///
/// The faces are swapped exactly at the halfway point, when the card is edge-on
/// and has no visible width. That is the only way text stays readable: a card
/// whose back is painted early (or not pre-rotated) shows mirrored letters, and
/// a cross-fade mid-turn reads as a glitch.
///
/// Reduced motion turns the same state change into a 120 ms cross-fade, so the
/// information is identical and nothing spins.
class FlipCard extends StatefulWidget {
  const FlipCard({
    super.key,
    required this.showingBack,
    required this.front,
    required this.back,
    this.duration = const Duration(milliseconds: 420),
  });

  final bool showingBack;
  final Widget front;
  final Widget back;
  final Duration duration;

  @override
  State<FlipCard> createState() => _FlipCardState();
}

class _FlipCardState extends State<FlipCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: widget.duration,
    // `preserve` keeps the length real under reduced motion; the widget reads
    // the flag itself and cross-fades instead, rather than letting the engine
    // jump to the end and flash the answer.
    animationBehavior: AnimationBehavior.preserve,
  );

  @override
  void initState() {
    super.initState();
    _controller.value = widget.showingBack ? 1 : 0;
  }

  @override
  void didUpdateWidget(covariant FlipCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.showingBack == widget.showingBack) return;
    if (reducedMotionOf(context)) {
      _controller.value = widget.showingBack ? 1 : 0;
      return;
    }
    if (widget.showingBack) {
      _controller.forward();
    } else {
      _controller.reverse();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) {
      // Reduced motion: swap the face, do not cross-fade it. Two Columns of
      // different heights cross-fading overlap each other's text, which is
      // exactly what the flip exists to avoid.
      return KeyedSubtree(
        key: ValueKey(widget.showingBack),
        child: widget.showingBack ? widget.back : widget.front,
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        // Perspective is per pixel, so a fixed value that suits a 300 px card
        // doubles the near edge of a 900 px one and throws its text across the
        // header above it. Scale it to the face instead: the near edge grows by
        // at most ~12% whatever the width.
        final half = constraints.hasBoundedWidth
            ? constraints.maxWidth / 2
            : 300.0;
        final depth = 0.11 / math.max(half, 1);
        return ClipRect(
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) {
              final angle = _controller.value * math.pi;
              final showingBack = angle > math.pi / 2;
              // The back is pre-rotated by π so it is not mirrored on arrival.
              final transform = Matrix4.identity()
                ..setEntry(3, 2, depth)
                ..rotateY(showingBack ? angle - math.pi : angle);
              return Transform(
                alignment: Alignment.center,
                transform: transform,
                child: showingBack ? widget.back : widget.front,
              );
            },
          ),
        );
      },
    );
  }
}
