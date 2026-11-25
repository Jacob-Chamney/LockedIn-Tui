import 'package:material_ui/material_ui.dart';

import '../../theme/breakpoints.dart';

/// The shared width cap for a page's content column.
///
/// A detail view caps its reading column so a line does not run the width of a
/// wide window; the list managers used to stop at the window edge, so the same
/// item looked different in a list and in its detail, and a row's trailing
/// control sat far right of its sentence (review #21).
///
/// One widget, one number: a manager wraps its page body and inherits the same
/// 900 px column the details use. On a window narrower than the cap the column
/// fills the window as before.
class ContentColumn extends StatelessWidget {
  const ContentColumn({
    super.key,
    required this.child,
    this.maxWidth = Breakpoints.content,
  });

  /// The widest the column may be, including any page padding the caller puts
  /// inside it.
  final double maxWidth;

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: child,
      ),
    );
  }
}
