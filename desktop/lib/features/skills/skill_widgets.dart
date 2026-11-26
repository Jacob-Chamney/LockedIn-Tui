import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

class StagePromptDialog extends StatefulWidget {
  const StagePromptDialog({
    super.key,
    required this.dialogTitle,
    required this.confirmLabel,
    required this.fieldKeyPrefix,
    required this.initialTitle,
    required this.initialMilestone,
  });

  final String dialogTitle;
  final String confirmLabel;
  final String fieldKeyPrefix;
  final String initialTitle;
  final String initialMilestone;

  @override
  State<StagePromptDialog> createState() => StagePromptDialogState();
}

class StagePromptDialogState extends State<StagePromptDialog> {
  late final _title = TextEditingController(text: widget.initialTitle);
  late final _milestone = TextEditingController(text: widget.initialMilestone);

  @override
  void dispose() {
    _title.dispose();
    _milestone.dispose();
    super.dispose();
  }

  void _submit() {
    final title = _title.text.trim();
    if (title.isEmpty) return;
    final milestone = _milestone.text.trim();
    Navigator.of(context)
        .pop((title: title, milestone: milestone.isEmpty ? null : milestone));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: LockedInColors.surface,
      title: Text(widget.dialogTitle),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                key: ValueKey('${widget.fieldKeyPrefix}-title'),
                controller: _title,
                autofocus: true,
                maxLength: 120,
                onSubmitted: (_) => _submit(),
                decoration: const InputDecoration(
                  labelText: 'stage title',
                  hintText: 'Trace a loop',
                ),
              ),
              const SizedBox(height: 4),
              TextField(
                key: ValueKey('${widget.fieldKeyPrefix}-milestone'),
                controller: _milestone,
                maxLength: 200,
                onSubmitted: (_) => _submit(),
                decoration: const InputDecoration(
                  labelText: 'milestone (optional)',
                  hintText: 'Explain a stack frame',
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'The whole curriculum is saved in this order, so a stage '
                'keeps its id, status and lesson.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          key: ValueKey('${widget.fieldKeyPrefix}-cancel'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: _title,
          builder: (context, value, _) {
            return FilledButton(
              key: ValueKey('${widget.fieldKeyPrefix}-confirm'),
              onPressed: value.text.trim().isEmpty ? null : _submit,
              child: Text(widget.confirmLabel),
            );
          },
        ),
      ],
    );
  }
}

/// Confirms removing one curriculum stage, naming it.
///
/// A `done` stage's finished progress is lost with it, so the copy says so.
/// Returns true only for the explicit Remove button; `Esc`, Cancel or a
/// dismissal is false and nothing is sent.
Future<bool> confirmSkillStageRemove(
  BuildContext context, {
  required String title,
  required bool done,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StageConfirmDialog(
      question: 'Remove “$title”?',
      detail: done
          ? 'This stage is done, so removing it loses its finished progress. '
                'The curriculum is saved again without it.'
          : 'The curriculum is saved again without this stage. Its lesson file '
                'is not touched by this pane.',
      confirmLabel: 'Remove',
    ),
  );
  return result ?? false;
}

class StageConfirmDialog extends StatelessWidget {
  const StageConfirmDialog({
    super.key,
    required this.question,
    required this.detail,
    required this.confirmLabel,
  });

  final String question;
  final String detail;
  final String confirmLabel;

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (event.logicalKey != LogicalKeyboardKey.escape) {
          return KeyEventResult.ignored;
        }
        Navigator.of(context).pop(false);
        return KeyEventResult.handled;
      },
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: const Text('remove stage', key: ValueKey('skill-stage-remove')),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                question,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: TypeScale.body,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                detail,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            key: const ValueKey('skill-stage-remove-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('skill-stage-remove-confirm'),
            style: FilledButton.styleFrom(
              backgroundColor: LockedInColors.error,
              // The theme derives onError by measurement; `background` is only
              // readable while the palette is dark.
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 16, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.error,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(width: 8),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ],
      ),
    );
  }
}

class Notice extends StatelessWidget {
  const Notice({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(
          color: LockedInColors.warning.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 15, color: LockedInColors.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.warning,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A successful gather, stated in `success` with an explicit glyph.
class SourceNotice extends StatelessWidget {
  const SourceNotice({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('skill-sources-notice'),
      padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(
          color: LockedInColors.success.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.check_circle_outline,
            size: 15,
            color: LockedInColors.success,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.success,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class EmptyNote extends StatelessWidget {
  const EmptyNote({
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

/// The glyph a gathered source's `kind` is labelled with. The text label always
/// sits beside it, so the icon never carries meaning alone.
IconData skillSourceIcon(String kind) {
  return switch (kind) {
    'pdf' => Icons.picture_as_pdf_outlined,
    'docx' => Icons.description_outlined,
    'image' => Icons.image_outlined,
    'markdown' || 'text' || 'code' => Icons.article_outlined,
    _ => Icons.insert_drive_file_outlined,
  };
}
