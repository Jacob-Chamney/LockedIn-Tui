import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// Registers one project through the shell's `work.create`.
///
/// The dialog never touches a path itself: it sends the name, folder and mode
/// the user typed and the core resolves, creates and registers the folder. A
/// refusal throws, which keeps the dialog open with the core's own sentence.
typedef ProjectCreator = Future<WorkCreateResult> Function({
  required String name,
  required String folder,
  required String mode,
});

/// Opens the create-project dialog over the Work list.
///
/// Returns the created project, or null when the user cancelled. Nothing is
/// written when the dialog is dismissed.
Future<WorkCreateResult?> showNewProjectDialog(
  BuildContext context, {
  required ProjectCreator onCreate,
}) {
  return showDialog<WorkCreateResult>(
    context: context,
    // A typed name and folder are unsaved input: a stray click outside must not
    // throw them away.
    barrierDismissible: false,
    builder: (dialogContext) => _NewProjectDialog(onCreate: onCreate),
  );
}

class _NewProjectDialog extends StatefulWidget {
  const _NewProjectDialog({required this.onCreate});

  final ProjectCreator onCreate;

  @override
  State<_NewProjectDialog> createState() => _NewProjectDialogState();
}

class _NewProjectDialogState extends State<_NewProjectDialog> {
  final _name = TextEditingController();
  final _folder = TextEditingController();
  var _mode = 'chat';
  var _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _folder.dispose();
    super.dispose();
  }

  /// The dialog's own checks. The core validates the path shape and refuses a
  /// duplicate registration; those messages arrive from the call itself.
  String? _validation() {
    if (_name.text.trim().isEmpty) return 'a project needs a name';
    if (_folder.text.trim().isEmpty) return 'a project needs a folder path';
    return null;
  }

  Future<void> _submit() async {
    if (_saving) return;
    final problem = _validation();
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await widget.onCreate(
        name: _name.text.trim(),
        folder: _folder.text.trim(),
        mode: _mode,
      );
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = userMessage(failure);
      });
    }
  }

  /// The core's own sentence when it sent one, otherwise the exception's.

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (event.logicalKey != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    if (_saving) return KeyEventResult.handled;
    Navigator.of(context).pop();
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      onKeyEvent: _onKey,
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: const Text('register a project'),
        content: SizedBox(
          width: 460,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'The folder stays where it is. LockedIn registers its path '
                  'and writes one metadata file; it never moves, copies or '
                  'deletes your files.',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 12,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const ValueKey('project-name'),
                  controller: _name,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'name',
                    hintText: 'My app',
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('project-folder'),
                  controller: _folder,
                  decoration: const InputDecoration(
                    labelText: 'folder',
                    hintText: '/home/you/Projects/my-app',
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    SizedBox(
                      width: 64,
                      child: Text(
                        'mode',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    SegmentedButton<String>(
                      key: const ValueKey('project-mode'),
                      segments: const [
                        ButtonSegment(value: 'chat', label: Text('chat')),
                        ButtonSegment(value: 'swarm', label: Text('swarm')),
                      ],
                      selected: {_mode},
                      onSelectionChanged: _saving
                          ? null
                          : (selected) =>
                                setState(() => _mode = selected.first),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'chat is one read-only agent · swarm adds a coordinator and '
                  'workers',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 11,
                    height: 1.4,
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  _ErrorNote(message: _error!),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            key: const ValueKey('project-cancel'),
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('project-create'),
            onPressed: _saving ? null : _submit,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Register'),
          ),
        ],
      ),
    );
  }
}

class _ErrorNote extends StatelessWidget {
  const _ErrorNote({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 15, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.error,
                fontSize: 12,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
