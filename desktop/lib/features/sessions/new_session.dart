import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';

/// What the wizard gathered on its way to the Review step.
///
/// It is a value object, not a core call: the shell maps it onto
/// `CoreStore.createSession` (which sends `session.create`). The wizard never
/// names a core method, never reads a file and never writes one — [files] and
/// [instructionsFile] are paths the **user picked**, and the core copies them
/// into the session.
class NewSessionInput {
  const NewSessionInput({
    required this.name,
    this.prompt = '',
    this.files = const [],
    this.instructionsFile,
    this.steps = true,
  });

  final String name;

  /// Written instructions, sent as `prompt`. Empty when an instructions file is
  /// chosen: the core extracts that file's text into `prompt.md` itself.
  final String prompt;

  /// Absolute paths the user picked. Never destinations.
  final List<String> files;

  /// One instructions file the user picked, or null.
  final String? instructionsFile;

  /// Ask the core to generate `assignment-steps.md`.
  final bool steps;
}

/// The three wizard steps, in order.
enum _Step {
  sources('Sources'),
  instructions('Instructions'),
  review('Review');

  const _Step(this.label);

  final String label;
}

/// How the instructions are supplied: typed text or a picked file.
enum _InstructionsMode { text, file }

/// The New lock-in wizard: **Sources → Instructions → Review**.
///
/// A full-pane view, not a dialog, so it fits 800×600 without a modal stack. It
/// is keyboard-first: `Enter` continues (or creates on Review), `Esc` backs out
/// one layer and `Tab` moves between controls. The name and content rules are
/// the only validation here; everything about copying, extracting and writing
/// belongs to the core.
class NewSessionWizard extends StatefulWidget {
  const NewSessionWizard({
    super.key,
    required this.onCreate,
    required this.onCancel,
    required this.onCreated,
    this.pickFiles,
  });

  /// Creates the session. The shell's implementation calls
  /// `CoreStore.createSession`, which rethrows the core's [RpcException] so the
  /// wizard can show the exact message and stay on Review.
  final Future<SessionCreateResult> Function(NewSessionInput input) onCreate;

  /// `Esc` at Sources (and the back control) leave the wizard without writing.
  final VoidCallback onCancel;

  /// Called with the new session id after the core accepted the create. The
  /// shell decides what "created" means — refresh, open the detail, swap the
  /// surface.
  final ValueChanged<String> onCreated;

  /// Test seam: a scripted picker. Production leaves it null and the platform
  /// file dialog is used.
  final Future<List<String>> Function()? pickFiles;

  @override
  State<NewSessionWizard> createState() => _NewSessionWizardState();
}

class _NewSessionWizardState extends State<NewSessionWizard> {
  static const _rule =
      'A lock-in needs a name and at least one source, written instructions, '
      'or an instructions file.';

  final _nameController = TextEditingController();
  final _promptController = TextEditingController();
  final _rootFocus = FocusNode(debugLabel: 'new-session-wizard');
  final _nameFocus = FocusNode(debugLabel: 'new-session-name');
  final _promptFocus = FocusNode(debugLabel: 'new-session-prompt');

  final _files = <String>[];

  _Step _step = _Step.sources;
  _InstructionsMode _mode = _InstructionsMode.text;
  String? _instructionsFile;
  var _steps = true;
  var _busy = false;
  String? _failure;

  /// A blocked rule is a warning; a core refusal is an error. Both stay inline
  /// on the step that produced them.
  var _failureIsCore = false;

  @override
  void dispose() {
    _nameController.dispose();
    _promptController.dispose();
    _rootFocus.dispose();
    _nameFocus.dispose();
    _promptFocus.dispose();
    super.dispose();
  }

  bool get _nameOk => _nameController.text.trim().isNotEmpty;

  bool get _contentOk =>
      _files.isNotEmpty ||
      (_mode == _InstructionsMode.text &&
          _promptController.text.trim().isNotEmpty) ||
      (_mode == _InstructionsMode.file && _instructionsFile != null);

  /// The blocked copy, or null when the Review step may create.
  String? _blocked() {
    if (!_nameOk && !_contentOk) return _rule;
    if (!_nameOk) return 'Give this session a name before continuing.';
    if (!_contentOk) {
      return 'Add at least one source, write instructions, or choose an '
          'instructions file.';
    }
    return null;
  }

  void _fail(String message, {required bool core}) {
    setState(() {
      _failure = message;
      _failureIsCore = core;
    });
  }

  /// Move to [step] and focus the control that step starts with, so `Enter` and
  /// `Tab` keep working without a mouse.
  void _goTo(_Step step) {
    setState(() {
      _step = step;
      _failure = null;
      _failureIsCore = false;
    });
    FocusScope.of(context).unfocus();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      switch (_step) {
        case _Step.sources:
          _nameFocus.requestFocus();
        case _Step.instructions:
          // The prompt field only exists in text mode; in file mode the step's
          // controls are buttons, so the form's own node takes the keyboard.
          if (_mode == _InstructionsMode.text) {
            _promptFocus.requestFocus();
          } else {
            _rootFocus.requestFocus();
          }
        case _Step.review:
          _rootFocus.requestFocus();
      }
    });
  }

  void _back() {
    if (_busy) return;
    if (_step == _Step.sources) {
      widget.onCancel();
      return;
    }
    _goTo(_Step.values[_step.index - 1]);
  }

  void _next() {
    if (_busy) return;
    if (_step == _Step.sources) {
      // The name is the only thing this step owns; the content rule is checked
      // once the Instructions step has had its turn, so a prompt-only or a
      // file-only session is reachable.
      if (!_nameOk) {
        _fail(_rule, core: false);
        return;
      }
      _goTo(_Step.instructions);
      return;
    }
    if (_step == _Step.instructions) {
      final blocked = _blocked();
      if (blocked != null) {
        _fail(blocked, core: false);
        return;
      }
      _goTo(_Step.review);
    }
  }

  Future<void> _create() async {
    if (_busy) return;
    final blocked = _blocked();
    if (blocked != null) {
      _fail(blocked, core: false);
      return;
    }
    setState(() {
      _busy = true;
      _failure = null;
      _failureIsCore = false;
    });
    try {
      final result = await widget.onCreate(
        NewSessionInput(
          name: _nameController.text.trim(),
          prompt: _mode == _InstructionsMode.text
              ? _promptController.text.trim()
              : '',
          files: List<String>.unmodifiable(_files),
          instructionsFile: _mode == _InstructionsMode.file
              ? _instructionsFile
              : null,
          steps: _steps,
        ),
      );
      if (!mounted) return;
      setState(() => _busy = false);
      widget.onCreated(result.id);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _busy = false);
      _fail(userMessage(failure), core: true);
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (_busy) {
      // A create is in flight. `Esc` must not fall through to the shell, which
      // would unmount the wizard and leave the session it created unopened.
      return key == LogicalKeyboardKey.escape
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.escape) {
      _back();
      return KeyEventResult.handled;
    }
    // While a text field is focused `Enter` belongs to it: the name field is
    // wrapped in [_submitOnEnter] and the prompt field inserts a newline.
    if (_nameFocus.hasFocus || _promptFocus.hasFocus) {
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (_step == _Step.review) {
        unawaited(_create());
      } else {
        _next();
      }
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  /// The platform file dialog. A build without one (headless runs) falls back to
  /// a typed path dialog so the action is never dead.
  Future<List<String>> _defaultPickFiles() async {
    try {
      final files = await openFiles();
      return [
        for (final file in files)
          if (file.path.trim().isNotEmpty) file.path,
      ];
    } on MissingPluginException {
      if (!mounted) return const [];
      return _askForPaths();
    } on UnimplementedError {
      if (!mounted) return const [];
      return _askForPaths();
    }
  }

  Future<List<String>> _askForPaths() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('add a file path'),
        content: SizedBox(
          width: 480,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'This build has no native file dialog. Paste the absolute path '
                'of a file you want to attach; the core copies it into the '
                'session and the original is never moved.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('new-session-path-field'),
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: '/home/you/input/lecture-4.md',
                ),
                onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('new-session-path-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (text == null) return const [];
    return [
      for (final line in text.split('\n'))
        if (line.trim().isNotEmpty) line.trim(),
    ];
  }

  Future<List<String>> _pick() async {
    final pick = widget.pickFiles ?? _defaultPickFiles;
    try {
      return await pick();
    } catch (failure) {
      if (!mounted) return const [];
      _fail(userMessage(failure), core: true);
      return const [];
    }
  }

  Future<void> _addSources() async {
    if (_busy) return;
    final paths = await _pick();
    if (!mounted || paths.isEmpty) return;
    setState(() {
      _failure = null;
      _failureIsCore = false;
      for (final path in paths) {
        final trimmed = path.trim();
        if (trimmed.isNotEmpty && !_files.contains(trimmed)) {
          _files.add(trimmed);
        }
      }
    });
  }

  Future<void> _chooseInstructionsFile() async {
    if (_busy) return;
    final paths = await _pick();
    if (!mounted || paths.isEmpty) return;
    setState(() {
      _mode = _InstructionsMode.file;
      _instructionsFile = paths.first.trim();
      _failure = null;
      _failureIsCore = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _rootFocus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < Breakpoints.hint;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(compact: compact),
              if (_busy)
                LinearProgressIndicator(
                  minHeight: 2,
                  color: LockedInColors.primary,
                  backgroundColor: LockedInColors.line,
                ),
              Expanded(child: _body()),
              _footer(compact: compact),
            ],
          );
        },
      ),
    );
  }

  Widget _header({required bool compact}) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to sessions',
            onPressed: _busy ? null : widget.onCancel,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'New lock-in',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                Text(
                  compact
                      ? 'step ${_step.index + 1} of 3 · ${_step.label}'
                      : 'sources → instructions → review',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          if (!compact) _stepChips(),
        ],
      ),
    );
  }

  Widget _stepChips() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var index = 0; index < _Step.values.length; index++) ...[
          if (index > 0) const SizedBox(width: 8),
          _stepChip(_Step.values[index], index),
        ],
      ],
    );
  }

  Widget _stepChip(_Step step, int index) {
    final current = step == _step;
    final done = index < _step.index;
    final tone = current
        ? LockedInColors.primary
        : (done ? LockedInColors.success : LockedInColors.muted);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: current ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: current
              ? LockedInColors.primary.withValues(alpha: 0.6)
              : LockedInColors.line,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            done ? Icons.check : Icons.circle,
            size: done ? 11 : 7,
            color: tone,
          ),
          const SizedBox(width: 6),
          Text(
            '${index + 1} ${step.label}',
            style: TextStyle(
              color: tone,
              fontSize: 11,
              fontWeight: current ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_failure != null) ...[
                _failureBanner(_failure!),
                const SizedBox(height: 14),
              ],
              switch (_step) {
                _Step.sources => _sourcesStep(),
                _Step.instructions => _instructionsStep(),
                _Step.review => _reviewStep(),
              },
            ],
          ),
        ),
      ),
    );
  }

  Widget _sourcesStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _card(
          label: 'SESSION NAME',
          child: _submitOnEnter(
            TextField(
              key: const ValueKey('new-session-name'),
              controller: _nameController,
              focusNode: _nameFocus,
              autofocus: true,
              textInputAction: TextInputAction.next,
              inputFormatters: [LengthLimitingTextInputFormatter(120)],
              onChanged: (_) {
                if (_failure != null && !_failureIsCore) {
                  setState(() => _failure = null);
                }
              },
              onSubmitted: (_) => _next(),
              decoration: const InputDecoration(
                hintText: 'Physics — Unit 4',
                isDense: true,
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        _card(
          label: 'SOURCES',
          trailing: _countChip('${_files.length}'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_files.isEmpty)
                const _EmptyNote(
                  title: 'no files picked yet',
                  body:
                      'Choose the files this session should read. Each is '
                      'copied into the session folder; the original is never '
                      'moved or changed.',
                )
              else
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var index = 0; index < _files.length; index++) ...[
                      if (index > 0)
                        Divider(
                          height: 1,
                          thickness: 1,
                          color: LockedInColors.line,
                        ),
                      _fileRow(index),
                    ],
                  ],
                ),
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  key: const ValueKey('new-session-pick'),
                  onPressed: _busy ? null : _addSources,
                  icon: const Icon(Icons.attach_file, size: 16),
                  label: const Text('choose files'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _card(
          label: 'WHAT IS REQUIRED',
          child: Text(
            '$_rule Any regular file is a source, whatever its extension. You '
            'can also continue with instructions only, on the next step.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ),
      ],
    );
  }

  /// A single-line field consumes hardware `Enter` through the platform text
  /// shortcuts, so the wizard wraps it in one closer handler: `Enter` continues
  /// from Sources, exactly like the Next button.
  Widget _submitOnEnter(Widget child) {
    return Focus(
      canRequestFocus: false,
      skipTraversal: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
          return KeyEventResult.ignored;
        }
        final key = event.logicalKey;
        if (key != LogicalKeyboardKey.enter &&
            key != LogicalKeyboardKey.numpadEnter) {
          return KeyEventResult.ignored;
        }
        _next();
        return KeyEventResult.handled;
      },
      child: child,
    );
  }

  Widget _fileRow(int index) {
    final path = _files[index];
    final name = _baseName(path);
    final folder = _parentOf(path);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            Icons.insert_drive_file_outlined,
            size: 15,
            color: LockedInColors.muted,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: 13,
                  ),
                ),
                Text(
                  folder,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 10.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            key: ValueKey('new-session-remove-$index'),
            tooltip: 'Remove $name',
            onPressed: _busy
                ? null
                : () => setState(() => _files.removeAt(index)),
            icon: const Icon(Icons.close, size: 15),
          ),
        ],
      ),
    );
  }

  Widget _instructionsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _card(
          label: 'INSTRUCTIONS',
          trailing: _countChip(
            _contentOk ? 'ready' : 'needed',
            tone: _contentOk ? LockedInColors.success : LockedInColors.warning,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ChoiceChip(
                    key: const ValueKey('new-session-mode-text'),
                    label: const Text('write instructions'),
                    selected: _mode == _InstructionsMode.text,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() {
                            _mode = _InstructionsMode.text;
                            _failure = null;
                          }),
                  ),
                  ChoiceChip(
                    key: const ValueKey('new-session-mode-file'),
                    label: const Text('choose a file'),
                    selected: _mode == _InstructionsMode.file,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() {
                            _mode = _InstructionsMode.file;
                            _failure = null;
                          }),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (_mode == _InstructionsMode.text)
                TextField(
                  key: const ValueKey('new-session-prompt'),
                  controller: _promptController,
                  focusNode: _promptFocus,
                  minLines: 3,
                  maxLines: 6,
                  keyboardType: TextInputType.multiline,
                  onChanged: (_) {
                    if (_failure != null && !_failureIsCore) {
                      setState(() => _failure = null);
                    }
                  },
                  decoration: const InputDecoration(
                    hintText: 'Explain the problem set…',
                  ),
                )
              else
                _instructionsFilePicker(),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _card(
          label: 'HOW INSTRUCTIONS WORK',
          child: Text(
            _mode == _InstructionsMode.file
                ? 'The file is copied into the session and its text is '
                      'extracted into prompt.md. A scanned PDF with no text '
                      'layer is refused — there is no OCR.'
                : 'The text you write becomes prompt.md in the session folder. '
                      'It is optional when the sources already say what to do.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ),
      ],
    );
  }

  Widget _instructionsFilePicker() {
    final file = _instructionsFile;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (file == null)
          const _EmptyNote(
            title: 'no file chosen',
            body:
                'Pick the assignment file. It is copied into the session and '
                'only its text is read.',
          )
        else
          Row(
            children: [
              Icon(
                Icons.description_outlined,
                size: 15,
                color: LockedInColors.muted,
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  _baseName(file),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: 13,
                  ),
                ),
              ),
              IconButton(
                key: const ValueKey('new-session-instructions-clear'),
                tooltip: 'Remove the instructions file',
                onPressed: _busy
                    ? null
                    : () => setState(() => _instructionsFile = null),
                icon: const Icon(Icons.close, size: 15),
              ),
            ],
          ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: const ValueKey('new-session-instructions-pick'),
            onPressed: _busy ? null : _chooseInstructionsFile,
            icon: const Icon(Icons.folder_open, size: 16),
            label: Text(
              file == null ? 'choose instructions file' : 'choose another file',
            ),
          ),
        ),
      ],
    );
  }

  Widget _reviewStep() {
    final prompt = _promptController.text.trim();
    final file = _instructionsFile;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _card(
          label: 'REVIEW',
          trailing: _countChip(_busy ? 'creating' : 'ready'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _reviewRow(
                'name',
                _nameController.text.trim().isEmpty
                    ? 'not set'
                    : _nameController.text.trim(),
              ),
              _reviewDivider(),
              _reviewRow(
                'sources',
                _files.isEmpty
                    ? 'none'
                    : '${_files.length} '
                          '${_files.length == 1 ? 'file' : 'files'}',
              ),
              _reviewDivider(),
              _reviewRow(
                'instructions',
                _mode == _InstructionsMode.file
                    ? (file == null
                          ? 'no file chosen'
                          : 'file · ${_baseName(file)}')
                    : (prompt.isEmpty ? 'none written' : 'written'),
              ),
              _reviewDivider(),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'steps',
                            style: TextStyle(
                              color: LockedInColors.foreground,
                              fontSize: 13,
                            ),
                          ),
                          Text(
                            _steps
                                ? 'the core generates assignment-steps.md'
                                : 'created without a steps file — R builds it',
                            maxLines: 2,
                            style: TextStyle(
                              color: LockedInColors.muted,
                              fontSize: 11,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Switch(
                      key: const ValueKey('new-session-steps'),
                      value: _steps,
                      onChanged: _busy
                          ? null
                          : (value) => setState(() => _steps = value),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _card(
          label: 'WHAT CREATE DOES',
          child: Text(
            _files.isEmpty
                ? 'Creates the session folder, extracts the instructions, and '
                      'writes a steps file when steps is on. Nothing outside '
                      'the session is touched.'
                : 'Copies the ${_files.length} chosen '
                      '${_files.length == 1 ? 'file' : 'files'} into the '
                      'session, extracts the instructions, and writes a steps '
                      'file when steps is on. The originals stay where they '
                      'are.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ),
      ],
    );
  }

  Widget _reviewRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 104,
            child: Text(
              label,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 11,
                letterSpacing: 0.6,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: 13,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _reviewDivider() {
    return Divider(height: 1, thickness: 1, color: LockedInColors.line);
  }

  Widget _footer({required bool compact}) {
    final hint = Text(
      compact ? 'Esc back' : 'Tab moves · Enter next · Esc back',
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(color: LockedInColors.muted, fontSize: 11),
    );
    final buttons = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        OutlinedButton(
          key: const ValueKey('new-session-back'),
          onPressed: _busy ? null : _back,
          child: const Text('Back'),
        ),
        const SizedBox(width: 8),
        if (_step == _Step.review)
          FilledButton(
            key: const ValueKey('new-session-create'),
            onPressed: _busy ? null : () => unawaited(_create()),
            child: Text(_busy ? 'creating…' : 'Create'),
          )
        else
          FilledButton(
            key: const ValueKey('new-session-next'),
            onPressed: _busy ? null : _next,
            child: const Text('Next'),
          ),
      ],
    );
    return Container(
      padding: EdgeInsets.fromLTRB(compact ? 12 : 20, 8, compact ? 12 : 20, 10),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(top: BorderSide(color: LockedInColors.line)),
      ),
      child: compact
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                hint,
                const SizedBox(height: 8),
                Align(alignment: Alignment.centerRight, child: buttons),
              ],
            )
          : Row(
              children: [
                Expanded(child: hint),
                const SizedBox(width: 12),
                buttons,
              ],
            ),
    );
  }

  Widget _card({
    required String label,
    required Widget child,
    Widget? trailing,
  }) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: LockedInColors.secondary,
                  letterSpacing: 1.4,
                ),
              ),
              const Spacer(),
              ?trailing,
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }

  Widget _countChip(String text, {Color? tone}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: tone ?? LockedInColors.muted,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _failureBanner(String message) {
    final tone = _failureIsCore ? LockedInColors.error : LockedInColors.warning;
    return Container(
      key: const ValueKey('new-session-error'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: tone.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            _failureIsCore ? Icons.error_outline : Icons.info_outline,
            size: 16,
            color: tone,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: tone, fontSize: 12, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyNote extends StatelessWidget {
  const _EmptyNote({required this.title, required this.body});

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
              Icons.remove_circle_outline,
              size: 14,
              color: LockedInColors.muted,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                title,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 12.5,
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
            fontSize: 12,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

/// The last path segment, whatever the separator. Display only: the full path is
/// what the core receives.
String _baseName(String path) => path.split(RegExp(r'[/\\]')).last;

String _parentOf(String path) {
  final index = path.lastIndexOf(RegExp(r'[/\\]'));
  if (index <= 0) return path;
  return path.substring(0, index);
}
