import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// One failed turn, shown **beside** the transcript instead of replacing it.
///
/// `docs/product.md` §3.2 asks for "one error bubble with reason and next
/// step"; the four chats used to return a centred card from `_body`, which hid
/// every earlier message for as long as the error lasted. This banner sits
/// between the transcript and the composer, so the conversation stays readable
/// and the failure is still one message with what happened, what was kept and
/// what to do.
class ChatFailureBanner extends StatelessWidget {
  const ChatFailureBanner({
    super.key,
    required this.failed,
    this.kept = '',
    this.next = '',
    this.onRetry,
  });

  /// The core's one-line reason.
  final String failed;

  /// What the core kept, when it says so.
  final String kept;

  /// The core's next step, when it says so.
  final String next;

  /// Offered only when the caller can actually retry the turn.
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final lines = [
      if (kept.trim().isNotEmpty) kept.trim(),
      if (next.trim().isNotEmpty) next.trim(),
    ];
    return Container(
      key: const ValueKey('chat-failure-banner'),
      margin: const EdgeInsets.fromLTRB(24, 0, 24, 10),
      padding: const EdgeInsets.fromLTRB(12, 9, 8, 9),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.6)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 15, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  failed.trim().isEmpty
                      ? 'the last turn failed'
                      : failed.trim(),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.error,
                    fontSize: TypeScale.label,
                    height: 1.4,
                  ),
                ),
                for (final line in lines)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text(
                      line,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                        height: 1.4,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(width: 8),
            TextButton(
              key: const ValueKey('chat-failure-retry'),
              onPressed: onRetry,
              child: const Text('retry'),
            ),
          ],
        ],
      ),
    );
  }
}
