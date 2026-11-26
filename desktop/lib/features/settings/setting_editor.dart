import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// message inline, so the user can correct the value without retyping it.
class SettingEditorDialog extends StatefulWidget {
  const SettingEditorDialog({
    super.key,
    required this.edit,
    required this.onSave,
  });

  final SettingEdit edit;
  final Future<void> Function(Map<String, dynamic> patch) onSave;

  @override
  State<SettingEditorDialog> createState() => SettingEditorDialogState();
}

class SettingEditorDialogState extends State<SettingEditorDialog> {
  late final TextEditingController _controller;
  String? _validation;
  String? _failure;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.edit.initial);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) return;
    final build = widget.edit.valuePatch;
    if (build == null) return;
    final invalid = widget.edit.validate?.call(_controller.text);
    if (invalid != null) {
      setState(() {
        _validation = invalid;
        _failure = null;
      });
      return;
    }
    setState(() {
      _validation = null;
      _failure = null;
      _saving = true;
    });
    try {
      await widget.onSave(build(_controller.text));
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _failure = userMessage(failure));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final edit = widget.edit;
    return PopScope(
      canPop: !_saving,
      child: Focus(
        canRequestFocus: false,
        skipTraversal: true,
        onKeyEvent: (node, event) {
          if (event is KeyDownEvent &&
              (event.logicalKey == LogicalKeyboardKey.enter ||
                  event.logicalKey == LogicalKeyboardKey.numpadEnter)) {
            _submit();
            return KeyEventResult.handled;
          }
          return KeyEventResult.ignored;
        },
        child: AlertDialog(
          backgroundColor: LockedInColors.surface,
          title: Text('edit ${edit.label}'),
          content: SizedBox(
            width: 380,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    edit.help,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    key: const ValueKey('settings-edit-field'),
                    controller: _controller,
                    autofocus: true,
                    enabled: !_saving,
                    autocorrect: false,
                    enableSuggestions: false,
                    keyboardType: switch (edit.kind) {
                      EditKind.text => TextInputType.text,
                      EditKind.integer => TextInputType.number,
                      EditKind.decimal => const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      EditKind.toggle => TextInputType.text,
                    },
                    decoration: InputDecoration(
                      labelText: edit.label,
                      errorText: _validation,
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                  if (_failure != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      key: const ValueKey('settings-edit-error'),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        border: Border.all(color: LockedInColors.error),
                        borderRadius: BorderRadius.circular(Radii.control),
                      ),
                      child: Text(
                        _failure!,
                        style: TextStyle(
                          color: LockedInColors.error,
                          fontSize: TypeScale.label,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              key: const ValueKey('settings-edit-cancel'),
              onPressed: _saving ? null : () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const ValueKey('settings-edit-save'),
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}

enum EditKind { text, integer, decimal, toggle }

class SettingEdit {
  const SettingEdit({
    required this.kind,
    required this.label,
    required this.help,
    this.initial = '',
    this.validate,
    this.valuePatch,
    this.togglePatch,
  }) : assert(
         (kind == EditKind.toggle) == (togglePatch != null),
         'a toggle needs a togglePatch and nothing else',
       );

  final EditKind kind;
  final String label;
  final String help;
  final String initial;
  final String? Function(String input)? validate;
  final Map<String, dynamic> Function(String input)? valuePatch;
  final Map<String, dynamic> Function()? togglePatch;
}
