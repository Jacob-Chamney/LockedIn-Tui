part of 'work_page.dart';

Future<bool> confirmProjectRemove(
  BuildContext context, {
  required String name,
  required String root,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('remove project'),
      content: Text(
        'Remove “${name.isEmpty ? 'this project' : name}” from LockedIn? '
        'Its files stay at $root. Only the project metadata is deleted.',
      ),
      actions: [
        TextButton(
          key: const ValueKey('project-remove-cancel'),
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const ValueKey('project-remove-confirm'),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Remove'),
        ),
      ],
    ),
  );
  return confirmed == true;
}

class _ProjectRowTile extends StatelessWidget {
  const _ProjectRowTile({
    super.key,
    required this.project,
    required this.selected,
    required this.showMode,
    required this.onTap,
    this.trailing,
  });

  final ProjectRow project;
  final bool selected;
  final bool showMode;

  /// The row's pointer verbs (a menu). Null draws nothing.
  final Widget? trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final agents = project.agents.length;
    return Material(
      color: selected ? LockedInColors.panel : LockedInColors.surface,
      borderRadius: BorderRadius.circular(Radii.control),
      child: InkWell(
        borderRadius: BorderRadius.circular(Radii.control),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(0, 10, 12, 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Radii.control),
            border: Border.all(
              color: selected
                  ? LockedInColors.primary.withValues(alpha: 0.5)
                  : LockedInColors.line,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 3,
                height: 34,
                decoration: BoxDecoration(
                  color: selected ? LockedInColors.primary : Colors.transparent,
                  borderRadius: const BorderRadius.horizontal(
                    right: Radius.circular(Radii.control),
                  ),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            project.name.isEmpty
                                ? 'untitled project'
                                : project.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: selected
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                          ),
                        ),
                        if (project.archived) ...[
                          const SizedBox(width: 8),
                          const _ArchivedBadge(),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      project.folder.isEmpty
                          ? 'no folder recorded'
                          : project.folder,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                      ),
                    ),
                  ],
                ),
              ),
              if (showMode) ...[
                const SizedBox(width: 10),
                ValueChip(project.mode.isEmpty ? 'chat' : project.mode),
              ],
              const SizedBox(width: 12),
              SizedBox(
                width: 66,
                child: Text(
                  agents == 1 ? '1 agent' : '$agents agents',
                  textAlign: TextAlign.right,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 4), trailing!],
            ],
          ),
        ),
      ),
    );
  }
}

class _ArchivedBadge extends StatelessWidget {
  const _ArchivedBadge();

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

class _EmptyNote extends StatelessWidget {
  const _EmptyNote({
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

class _LoadingState extends StatelessWidget {
  const _LoadingState({required this.label});

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

class _EmptyState extends StatelessWidget {
  const _EmptyState({this.onCreate});

  /// The pointer path for `n`. Without it a mouse user could not register the
  /// first project.
  final VoidCallback? onCreate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.work_outline, size: 26, color: LockedInColors.muted),
        const SizedBox(height: 10),
        Text('no projects yet', style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(
          'n registers one',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
          ),
        ),
        if (onCreate != null) ...[
          const SizedBox(height: 14),
          FilledButton.icon(
            key: const ValueKey('work-empty-new'),
            onPressed: onCreate,
            icon: const Icon(Icons.add, size: 16),
            label: const Text('new project'),
          ),
        ],
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, this.onRefresh});

  final String message;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
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
            ],
          ),
          if (onRefresh != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh, size: 15),
                label: const Text('Retry'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The project-instructions editor. It owns its controller, so the dialog's
/// closing animation and the field's lifetime cannot overlap.
class _InstructionsEditor extends StatefulWidget {
  const _InstructionsEditor({required this.initial, required this.onSave});

  final String initial;
  final Future<void> Function(String instructions) onSave;

  @override
  State<_InstructionsEditor> createState() => _InstructionsEditorState();
}

class _InstructionsEditorState extends State<_InstructionsEditor> {
  late final TextEditingController _text = TextEditingController(
    text: widget.initial,
  );
  var _saving = false;
  String? _failure;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _failure = null;
    });
    try {
      await widget.onSave(_text.text);
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _failure = userMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      scrollable: true,
      title: const Text('project instructions'),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Every project chat reads this. It is stored in the project '
              'metadata, never written into the folder.',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('work-instructions-field'),
              controller: _text,
              autofocus: true,
              minLines: 4,
              maxLines: 8,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.proseSmall,
                height: 1.5,
              ),
              decoration: const InputDecoration(
                hintText: 'prefer small diffs; cite file paths',
              ),
            ),
            if (_failure != null) ...[
              const SizedBox(height: 8),
              Text(
                _failure!,
                key: const ValueKey('work-instructions-error'),
                style: TextStyle(
                  color: LockedInColors.error,
                  fontSize: TypeScale.label,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const ValueKey('work-instructions-save'),
          onPressed: _saving ? null : _save,
          child: Text(_saving ? 'saving…' : 'Save'),
        ),
      ],
    );
  }
}
