import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';

class PlaceholderPage extends StatelessWidget {
  const PlaceholderPage({
    super.key,
    required this.surface,
    required this.title,
    required this.body,
    required this.hint,
  });

  final String surface;
  final String title;
  final String body;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              surface.toUpperCase(),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 10,
                letterSpacing: 1.6,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 13,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: LockedInColors.panel,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: LockedInColors.line),
              ),
              child: Text(
                hint,
                style: TextStyle(color: LockedInColors.secondary, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
