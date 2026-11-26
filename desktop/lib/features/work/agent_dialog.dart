import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/core_client.dart';
import '../../bridge/core_scope.dart';
import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// The one line beside the Templates row when its read failed.
///
/// `userMessage` is the same mapper every surface uses: an RPC, timeout or dead
/// core becomes a sentence, a short one-line message survives, and a stack trace
/// or a multi-line provider blob is replaced rather than printed.
String templateReadFailure(Object error) =>
    'the templates could not be read — ${userMessage(error)}';

/// Saves one agent profile through the shell's `work.agent.save`.
///
/// The dialog sends a profile, never a path: the core rewrites the project's
/// metadata only, so nothing inside the project folder is read or written.
typedef AgentSaver = Future<String> Function(AgentProfileView agent);

/// Opens the agent editor over the Work detail.
///
/// Returns the saved profile id, or null when the user cancelled. Create mode
/// omits the id so the core generates one; edit mode keeps it so a rename does
/// not break the default that points at the profile.
Future<String?> showAgentEditor(
  BuildContext context, {
  required AgentProfileView? agent,
  required AgentSaver onSave,
}) {
  return showDialog<String>(
    context: context,
    // A half-typed profile is unsaved input: a stray click outside must not
    // throw it away.
    barrierDismissible: false,
    builder: (dialogContext) => _AgentDialog(agent: agent, onSave: onSave),
  );
}

/// Confirms deleting one agent profile, naming it.
///
/// Returns true only for the explicit Delete button; a dismissal, `Esc` or
/// Cancel is false and nothing is removed.
Future<bool> confirmAgentDelete(
  BuildContext context, {
  required String name,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (event.logicalKey != LogicalKeyboardKey.escape) {
          return KeyEventResult.ignored;
        }
        Navigator.of(dialogContext).pop(false);
        return KeyEventResult.handled;
      },
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: const Text('delete agent'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Delete “$name”?',
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: TypeScale.proseSmall,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'This removes the profile from the project metadata. Nothing '
                'inside the project folder changes, and the folder is never '
                'moved or deleted.',
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
            key: const ValueKey('agent-delete-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('agent-delete-confirm'),
            style: FilledButton.styleFrom(
              backgroundColor: LockedInColors.error,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    ),
  );
  return result ?? false;
}

/// The one agent form: identity, model, budget, tools and permissions.
///
/// Every field maps to a `work.agent.save` field. The dialog never invents a
/// default or a tool: an empty model means the project default and an empty
/// tool list means every tool the profile's capabilities permit, both of which
/// are the core's rules.
class _AgentDialog extends StatefulWidget {
  const _AgentDialog({required this.agent, required this.onSave});

  /// Null creates a profile; a profile edits it in place.
  final AgentProfileView? agent;
  final AgentSaver onSave;

  @override
  State<_AgentDialog> createState() => _AgentDialogState();
}

class _AgentDialogState extends State<_AgentDialog> {
  late final TextEditingController _name;
  late final TextEditingController _role;
  late final TextEditingController _model;
  late final TextEditingController _maxToolCalls;
  late final TextEditingController _tools;
  late final TextEditingController _instructions;
  late final TextEditingController _template;
  late bool _allowWrite;
  late bool _allowCommand;
  var _saving = false;
  String? _error;

  /// The values the dialog opened with, per field label.
  ///
  /// A field whose text differs from this is one the user changed, so a template
  /// pick that would replace it asks first. The saved profile's own values are
  /// the initial set in edit mode: overwriting a stored profile's fields is the
  /// same decision as overwriting a freshly typed one.
  late final Map<String, String> _initialValues;

  /// The core the Templates row reads through, or null when the dialog is not
  /// under a [CoreScope].
  ///
  /// Null is the documented read-only state: without a store the dialog cannot
  /// read a template and must not invent one, so the row says so and the picker
  /// stays shut.
  CoreStore? _templatesStore;

  /// The project whose own templates join the built-ins; null reads built-ins.
  String? _templatesProjectId;
  var _templatesRequested = false;
  var _templatesLoading = false;
  List<AgentTemplateRow> _templates = const [];
  String? _templatesError;

  bool get _editing => widget.agent != null;

  @override
  void initState() {
    super.initState();
    final agent = widget.agent;
    _name = TextEditingController(text: agent?.name ?? '');
    _role = TextEditingController(text: agent?.role ?? '');
    _model = TextEditingController(text: agent?.model ?? '');
    _maxToolCalls = TextEditingController(
      text:
          '${agent == null || agent.maxToolCalls <= 0 ? _defaultToolCalls : agent.maxToolCalls}',
    );
    _tools = TextEditingController(text: agent?.allowedTools.join(', ') ?? '');
    _instructions = TextEditingController(text: agent?.instructions ?? '');
    _template = TextEditingController(text: agent?.template ?? '');
    _allowWrite = agent?.allowWrite ?? false;
    _allowCommand = agent?.allowCommand ?? false;
    _initialValues = {
      'name': _name.text,
      'role': _role.text,
      'instructions': _instructions.text,
      'max tool calls': _maxToolCalls.text,
      'allowed tools': _tools.text,
    };
  }

  static const _defaultToolCalls = 8;
  static const _minToolCallLimit = 1;
  static const _maxToolCallLimit = 32;

  @override
  void dispose() {
    _name.dispose();
    _role.dispose();
    _model.dispose();
    _maxToolCalls.dispose();
    _tools.dispose();
    _instructions.dispose();
    _template.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_templatesRequested) return;
    _templatesRequested = true;
    final store = CoreScope.maybeOf(context);
    if (store == null) return;
    _templatesStore = store;
    final projectId = store.activeProjectId;
    _templatesProjectId = projectId == null || projectId.trim().isEmpty
        ? null
        : projectId;
    unawaited(_loadTemplates());
  }

  /// Read the templates once, so the row can say how many there are before the
  /// user opens the picker. A failure is kept in [_templatesError] and the
  /// previous rows stay.
  Future<void> _loadTemplates() async {
    final store = _templatesStore;
    if (store == null) return;
    // No setState here: this starts from `didChangeDependencies`, before the
    // first build, and the first build reads the loading flag directly.
    _templatesLoading = true;
    _templatesError = null;
    final rows = await store.refreshWorkTemplates(_templatesProjectId);
    if (!mounted) return;
    setState(() {
      _templatesLoading = false;
      _templates = rows;
      _templatesError = store.workTemplatesError;
    });
  }

  /// The incoming value of each field a template carries.
  static Map<String, String> _templateFields(AgentTemplateRow template) => {
    'name': template.name,
    'role': template.role,
    'instructions': template.instructions,
    'max tool calls': '${template.maxToolCalls}',
    'allowed tools': template.allowedTools.join(', '),
  };

  /// The fields a pick would replace, with the values on both sides.
  ///
  /// A field the user has not touched (still equal to its opening value) is
  /// filled silently: that is the point of a template. A field the user changed,
  /// or any field of a saved profile, is listed so the confirmation can name it.
  List<_TemplateField> _changesFrom(AgentTemplateRow template) {
    final current = {
      'name': _name.text,
      'role': _role.text,
      'instructions': _instructions.text,
      'max tool calls': _maxToolCalls.text,
      'allowed tools': _tools.text,
    };
    final changes = <_TemplateField>[];
    for (final entry in _templateFields(template).entries) {
      final now = current[entry.key] ?? '';
      if (now == entry.value) continue;
      final touched = _editing || now != (_initialValues[entry.key] ?? '');
      if (!touched) continue;
      changes.add(
        _TemplateField(label: entry.key, before: now, after: entry.value),
      );
    }
    return changes;
  }

  /// Open the picker, then apply the chosen template after any confirmation.
  Future<void> _openTemplates() async {
    if (_templatesStore == null || _templatesLoading) return;
    final chosen = await showDialog<AgentTemplateRow>(
      context: context,
      builder: (dialogContext) => _TemplatePickerDialog(
        templates: _templates,
        error: _templatesError,
        loading: _templatesLoading,
      ),
    );
    if (chosen == null || !mounted) return;
    await _applyTemplate(chosen);
  }

  /// Fill the five fields a template carries, asking first when that would
  /// replace something the user set.
  ///
  /// It never touches the model, the write or command switches, or the profile's
  /// id: a template seeds fields, it does not grant a capability and it does not
  /// save anything. The id it does set is the informational `template` field.
  Future<void> _applyTemplate(AgentTemplateRow template) async {
    final changes = _changesFrom(template);
    if (changes.isNotEmpty) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) =>
            _TemplateReplaceDialog(template: template, fields: changes),
      );
      if (confirmed != true || !mounted) return;
    }
    final fields = _templateFields(template);
    setState(() {
      _name.text = fields['name'] ?? template.name;
      _role.text = fields['role'] ?? template.role;
      _instructions.text = fields['instructions'] ?? template.instructions;
      _maxToolCalls.text =
          fields['max tool calls'] ?? '${template.maxToolCalls}';
      _tools.text = fields['allowed tools'] ?? template.allowedTools.join(', ');
      _template.text = template.id;
    });
  }

  /// The line beside the Templates row: what the reader has, or why not.
  String get _templatesHint {
    if (_templatesStore == null) {
      return 'read-only — templates need a connected core';
    }
    if (_templatesLoading) return 'reading templates…';
    final error = _templatesError;
    if (error != null) return templateReadFailure(error);
    if (_templates.isEmpty) return 'no templates';
    final builtIns = _templates.where((row) => row.builtin).length;
    final project = _templates.length - builtIns;
    return '$builtIns built-in · $project project';
  }

  /// The dialog's own checks. The core validates names, tool names and the
  /// duplicate-name rule; those messages arrive from the call itself.
  String? _validation() {
    if (_name.text.trim().isEmpty) return 'an agent needs a name';
    final calls = int.tryParse(_maxToolCalls.text.trim());
    if (calls == null ||
        calls < _minToolCallLimit ||
        calls > _maxToolCallLimit) {
      return 'max tool calls is a whole number from '
          '$_minToolCallLimit to $_maxToolCallLimit';
    }
    return null;
  }

  List<String> get _parsedTools => [
    for (final part in _tools.text.split(','))
      if (part.trim().isNotEmpty) part.trim(),
  ];

  AgentProfileView _profile() => AgentProfileView(
    // An empty id is how create is expressed on the wire.
    id: widget.agent?.id ?? '',
    name: _name.text.trim(),
    role: _role.text.trim(),
    instructions: _instructions.text.trim(),
    model: _model.text.trim(),
    maxToolCalls: int.parse(_maxToolCalls.text.trim()),
    allowedTools: _parsedTools,
    allowWrite: _allowWrite,
    allowCommand: _allowCommand,
    template: _template.text.trim(),
  );

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
    final profile = _profile();
    try {
      final saved = await widget.onSave(profile);
      if (!mounted) return;
      Navigator.of(context).pop(saved.isEmpty ? profile.id : saved);
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
    // The form is taller than a 800x600 window, so its body gets a bounded
    // viewport and scrolls: the dialog's actions must never fall off the screen.
    final viewport = MediaQuery.sizeOf(context).height;
    final bodyHeight = (viewport - 260).clamp(200.0, 620.0);
    return Focus(
      onKeyEvent: _onKey,
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: Text(_editing ? 'edit agent' : 'new agent'),
        content: SizedBox(
          width: 520,
          height: bodyHeight,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'An agent profile is project metadata. Editing it never '
                  'reads, writes, moves or deletes a file inside the project '
                  'folder.',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const ValueKey('agent-name'),
                  controller: _name,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'name',
                    hintText: 'Reviewer',
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('agent-role'),
                  controller: _role,
                  decoration: const InputDecoration(
                    labelText: 'role',
                    hintText: 'reviewer',
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('agent-model'),
                  controller: _model,
                  decoration: const InputDecoration(
                    labelText: 'model',
                    hintText: 'empty = project default',
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 10),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: TextField(
                        key: const ValueKey('agent-max-tool-calls'),
                        controller: _maxToolCalls,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'max tool calls',
                          hintText: '8',
                        ),
                        onSubmitted: (_) => _submit(),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: TextField(
                        key: const ValueKey('agent-tools'),
                        controller: _tools,
                        decoration: const InputDecoration(
                          labelText: 'allowed tools',
                          hintText: 'read_file, search_files (empty = all)',
                        ),
                        onSubmitted: (_) => _submit(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'tools are comma separated · empty means every tool the '
                  'profile may use',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 12),
                _SwitchRow(
                  label: 'allow writes',
                  hint: 'each write still needs its own approval',
                  value: _allowWrite,
                  switchKey: const ValueKey('agent-allow-write'),
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => _allowWrite = value),
                ),
                const SizedBox(height: 8),
                _SwitchRow(
                  label: 'allow commands',
                  hint: 'each command still needs its own approval',
                  value: _allowCommand,
                  switchKey: const ValueKey('agent-allow-command'),
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => _allowCommand = value),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('agent-instructions'),
                  controller: _instructions,
                  minLines: 3,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: 'instructions',
                    hintText: 'Review only. Prefer small diffs.',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Text(
                      'templates',
                      style: TextStyle(
                        color: LockedInColors.foreground,
                        fontSize: TypeScale.key,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _templatesHint,
                        key: const ValueKey('agent-templates-hint'),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: TypeScale.label,
                          height: 1.4,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      key: const ValueKey('agent-templates'),
                      onPressed:
                          _templatesStore == null ||
                              _templatesLoading ||
                              _saving
                          ? null
                          : _openTemplates,
                      child: const Text('browse'),
                    ),
                  ],
                ),
                Text(
                  'a template fills name, role, instructions, max tool calls '
                  'and allowed tools — it never saves and never grants a '
                  'capability',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  key: const ValueKey('agent-template'),
                  controller: _template,
                  decoration: const InputDecoration(
                    labelText: 'template',
                    hintText: 'optional template id',
                  ),
                  onSubmitted: (_) => _submit(),
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
            key: const ValueKey('agent-cancel'),
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('agent-save'),
            onPressed: _saving ? null : _submit,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(_editing ? 'Save' : 'Create'),
          ),
        ],
      ),
    );
  }
}

/// One labelled permission toggle. The switch is the control; the label is the
/// text, so the state never relies on the switch colour alone.
class _SwitchRow extends StatelessWidget {
  const _SwitchRow({
    required this.label,
    required this.hint,
    required this.value,
    required this.switchKey,
    required this.onChanged,
  });

  final String label;
  final String hint;
  final bool value;
  final Key switchKey;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: TypeScale.key,
                ),
              ),
              Text(
                hint,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.micro,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        Switch(key: switchKey, value: value, onChanged: onChanged),
      ],
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

/// One field a template pick would replace, with both values.
class _TemplateField {
  const _TemplateField({
    required this.label,
    required this.before,
    required this.after,
  });

  final String label;
  final String before;
  final String after;
}

/// A short preview of a field value for the confirmation: one line, capped.
String _clipValue(String text) {
  final oneLine = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (oneLine.isEmpty) return 'empty';
  return oneLine.length > 44 ? '${oneLine.substring(0, 43)}…' : oneLine;
}

/// The template list: what a pick is and where it came from.
///
/// Keyboard first, like every surface: `j/k` or the arrows move, `Enter`
/// chooses, `Esc` closes without choosing. A row is also tappable, so the mouse
/// works when it is on. The list never applies anything by itself; the editor
/// fills its fields after this dialog returns a row.
class _TemplatePickerDialog extends StatefulWidget {
  const _TemplatePickerDialog({
    required this.templates,
    required this.error,
    required this.loading,
  });

  final List<AgentTemplateRow> templates;

  /// A read failure beside the rows, never instead of them.
  final String? error;
  final bool loading;

  @override
  State<_TemplatePickerDialog> createState() => _TemplatePickerDialogState();
}

class _TemplatePickerDialogState extends State<_TemplatePickerDialog> {
  var _selected = 0;

  /// One key per row, so moving the selection can keep the row on screen.
  final _rowKeys = <String, GlobalKey>{};

  void _move(int delta) {
    if (widget.templates.isEmpty) return;
    setState(() {
      _selected = (_selected + delta).clamp(0, widget.templates.length - 1);
    });
    final id = widget.templates[_selected].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _rowKeys[id]?.currentContext;
      if (target != null) Scrollable.ensureVisible(target, alignment: 0.5);
    });
  }

  void _choose() {
    if (widget.templates.isEmpty) return;
    Navigator.of(context).pop(widget.templates[_selected]);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      Navigator.of(context).pop();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      _choose();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: const Text('templates'),
        content: SizedBox(
          width: 480,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 320),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'A template fills the editor’s fields. It is not applied and '
                  'it saves nothing until you press Save.',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 10),
                if (widget.error != null) ...[
                  Text(
                    'Some templates could not be read — ${widget.error}',
                    key: const ValueKey('template-picker-error'),
                    style: TextStyle(
                      color: LockedInColors.warning,
                      fontSize: TypeScale.label,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                if (widget.loading)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'reading templates…',
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                      ),
                    ),
                  )
                else if (widget.templates.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'No templates yet. The built-ins ship with the app; a '
                      'connected core lists them here.',
                      key: const ValueKey('template-picker-empty'),
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                        height: 1.45,
                      ),
                    ),
                  )
                else
                  Flexible(
                    // The list is small — three built-ins plus a project's own
                    // files — so every row is built and the view scrolls. That
                    // keeps a `j`/`k` selection reachable by `ensureVisible`.
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (final template in widget.templates)
                            KeyedSubtree(
                              key: _rowKeys.putIfAbsent(
                                template.id,
                                GlobalKey.new,
                              ),
                              child: _TemplateRow(
                                template: template,
                                selected:
                                    widget.templates[_selected].id ==
                                    template.id,
                                onTap: () =>
                                    Navigator.of(context).pop(template),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                Text(
                  'j/k move · Enter choose · Esc back',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.micro,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            key: const ValueKey('template-picker-cancel'),
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }
}

/// One pickable template: the name, where it came from, and what it would fill.
class _TemplateRow extends StatelessWidget {
  const _TemplateRow({
    required this.template,
    required this.selected,
    required this.onTap,
  });

  final AgentTemplateRow template;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tools = template.allowedTools.isEmpty
        ? 'every tool the profile permits'
        : template.allowedTools.join(', ');
    return InkWell(
      key: ValueKey('template-row-${template.id}'),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : null,
          borderRadius: BorderRadius.circular(Radii.layer),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              template.builtin ? Icons.inventory_2_outlined : Icons.folder_open,
              size: 15,
              color: selected ? LockedInColors.primary : LockedInColors.muted,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          template.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.foreground,
                            fontSize: TypeScale.key,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      _TemplateBadge(label: template.source),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    template.summary,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${template.maxToolCalls} tool calls · $tools',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.micro,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The word beside a template name, so `built-in` vs `project` is never colour.
class _TemplateBadge extends StatelessWidget {
  const _TemplateBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.micro,
          height: 1.3,
        ),
      ),
    );
  }
}

/// Names the fields a pick would replace before anything is overwritten.
///
/// Cancelling changes nothing: the editor keeps exactly what it had, including
/// every field the template would have replaced.
class _TemplateReplaceDialog extends StatelessWidget {
  const _TemplateReplaceDialog({required this.template, required this.fields});

  final AgentTemplateRow template;
  final List<_TemplateField> fields;

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
        title: const Text('replace fields?'),
        content: SizedBox(
          width: 460,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Choosing “${template.name}” replaces these fields you have '
                  'already set. Nothing is saved until you press Save.',
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: TypeScale.key,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 10),
                for (final field in fields)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      '${field.label}: ${_clipValue(field.before)} → '
                      '${_clipValue(field.after)}',
                      key: ValueKey('template-replace-${field.label}'),
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                        height: 1.45,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            key: const ValueKey('template-replace-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('template-replace-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Replace'),
          ),
        ],
      ),
    );
  }
}
