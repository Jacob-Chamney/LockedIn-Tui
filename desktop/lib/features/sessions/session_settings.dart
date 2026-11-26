import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../shared/format.dart';
import '../../theme/tokens.dart';

/// Returns one file path, or null when the user cancelled.
typedef InstructionsPicker = Future<String?> Function();

/// One session's settings: the instruction text the model reads, and the
/// provenance of the file it may have come from.
///
/// This is a layer of the session detail, not a separate surface: `Esc` returns
/// to the detail and the chat/steps behind it are untouched. The page reads no
/// file and writes none — it sends text or a user-picked path and the core owns
/// `prompt.md`, `meta.json` and the `sources/` copy.
class SessionSettingsView extends StatefulWidget {
  const SessionSettingsView({
    super.key,
    required this.detail,
    required this.instructions,
    required this.loading,
    this.error,
    this.onSave,
    this.onImport,
    this.onReextract,
    this.onRetry,
    this.onBack,
    this.pickFile,
  });

  /// The open session's `session.open` projection, used for the header name.
  final SessionDetail? detail;

  /// `session.instructions.get`, or null while the first read is in flight.
  final SessionInstructions? instructions;

  /// True while the shell is reading the instructions.
  final bool loading;

  /// One readable read/write failure from the shell, shown with a retry.
  final String? error;

  /// Writes `prompt.md` through `session.instructions.save`. Returns whether the
  /// core accepted the write; false leaves the previous prompt and shows
  /// [error].
  final Future<bool> Function(String text)? onSave;

  /// Loads a user-picked file through `session.instructions.import`. Null when
  /// the core refused it; the shell's [error] says why.
  final Future<InstructionsImportResult?> Function(String file)? onImport;

  /// Re-reads the copied original through `session.instructions.reextract`.
  /// Null on failure; the returned prompt replaces the editor on success.
  final Future<String?> Function()? onReextract;

  /// Asks for the instructions again after a failed read.
  final Future<void> Function()? onRetry;

  /// `Esc` and the back control return to the session detail.
  final VoidCallback? onBack;

  /// Test seam: a scripted picker. Production leaves it null and the platform
  /// file dialog is used.
  final InstructionsPicker? pickFile;

  @override
  State<SessionSettingsView> createState() => _SessionSettingsViewState();
}

class _SessionSettingsViewState extends State<SessionSettingsView> {
  late final TextEditingController _controller;

  /// The text the core last confirmed. A difference from the editor is unsaved
  /// work.
  var _baseline = '';

  /// True while this file is writing the controller, so the listener does not
  /// schedule a redundant rebuild.
  var _applying = false;

  var _saving = false;
  var _importing = false;
  var _reextracting = false;

  /// A failure thrown by a callback itself; the shell reports its own answer
  /// through [SessionSettingsView.error].
  String? _failure;
  String? _notice;
  var _noticeOk = true;

  bool get _busy => _saving || _importing || _reextracting;

  bool get _dirty => _controller.text != _baseline;

  String? get _displayError => widget.error ?? _failure;

  @override
  void initState() {
    super.initState();
    _baseline = widget.instructions?.prompt ?? '';
    _controller = TextEditingController(text: _baseline);
    _controller.addListener(_onTextChanged);
  }

  @override
  void didUpdateWidget(SessionSettingsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final prompt = widget.instructions?.prompt;
    if (prompt == null || _dirty || prompt == _baseline) return;
    _setText(prompt);
  }

  @override
  void dispose() {
    _controller.removeListener(_onTextChanged);
    _controller.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    if (_applying || !mounted) return;
    setState(() {});
  }

  void _setText(String text) {
    _applying = true;
    _controller.text = text;
    _applying = false;
    _baseline = text;
  }

  Future<void> _leave() async {
    if (_busy) return;
    if (_dirty) {
      final discard = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('discard unsaved changes?'),
          content: const Text(
            'The prompt has edits that are not saved. Leaving session settings '
            'loses them; the saved prompt stays as it was.',
          ),
          actions: [
            TextButton(
              key: const ValueKey('instructions-leave-cancel'),
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Keep editing'),
            ),
            FilledButton(
              key: const ValueKey('instructions-leave-confirm'),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Discard'),
            ),
          ],
        ),
      );
      if (discard != true || !mounted) return;
    }
    widget.onBack?.call();
  }

  Future<void> _save() async {
    final save = widget.onSave;
    if (save == null || _busy) return;
    final text = _controller.text;
    setState(() {
      _saving = true;
      _failure = null;
      _notice = null;
    });
    try {
      final ok = await save(text);
      if (!mounted) return;
      setState(() {
        _saving = false;
        if (ok) {
          _baseline = text;
          _notice = 'saved prompt.md';
          _noticeOk = true;
        } else {
          _failure = 'the prompt was not saved';
        }
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _failure = userMessage(failure);
      });
    }
  }

  Future<void> _import() async {
    final import = widget.onImport;
    if (import == null || _busy) return;
    final pick = widget.pickFile ?? _defaultPickFile;

    final String? picked;
    try {
      picked = await pick();
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _notice = null;
        _failure = userMessage(failure);
      });
      return;
    }
    if (picked == null || picked.trim().isEmpty || !mounted) return;
    final path = picked.trim();
    final name = _baseName(path);

    if (_controller.text.trim().isNotEmpty) {
      final replace = await _confirmReplace(name);
      if (replace != true || !mounted) return;
    }

    setState(() {
      _importing = true;
      _failure = null;
      _notice = null;
    });
    try {
      final result = await import(path);
      if (!mounted) return;
      if (result == null) {
        setState(() {
          _importing = false;
          _failure = 'the instructions file was not loaded';
        });
        return;
      }
      _applying = true;
      _controller.text = result.prompt;
      _applying = false;
      setState(() {
        _baseline = result.prompt;
        _importing = false;
        _noticeOk = true;
        _notice = result.added
            ? 'imported $name · copied into this session'
            : 'imported $name · already a source';
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _importing = false;
        _failure = userMessage(failure);
      });
    }
  }

  Future<void> _reextract() async {
    final reextract = widget.onReextract;
    if (reextract == null || _busy) return;
    final name = widget.instructions?.instructionsSource?.name ?? '';
    final confirmed = await _confirmReextract(
      name.isEmpty ? 'the copied file' : name,
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _reextracting = true;
      _failure = null;
      _notice = null;
    });
    try {
      final prompt = await reextract();
      if (!mounted) return;
      if (prompt == null) {
        setState(() {
          _reextracting = false;
          _failure = 'the copied file could not be re-extracted';
        });
        return;
      }
      _applying = true;
      _controller.text = prompt;
      _applying = false;
      setState(() {
        _baseline = prompt;
        _reextracting = false;
        _noticeOk = true;
        _notice = 're-extracted the instructions';
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _reextracting = false;
        _failure = userMessage(failure);
      });
    }
  }

  Future<void> _retry() async {
    final retry = widget.onRetry;
    if (retry == null || _busy) return;
    setState(() {
      _failure = null;
      _notice = null;
    });
    try {
      await retry();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _failure = userMessage(failure));
    }
  }

  /// The one confirmation that keeps a non-empty prompt from being replaced
  /// without the user knowing. `Keep editing` changes nothing.
  Future<bool> _confirmReplace(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('replace the prompt?'),
        content: Text(
          'The prompt currently has text. Loading instructions from $name '
          'replaces it with the text extracted from that file. Manual edits are '
          'discarded.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('instructions-replace-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep editing'),
          ),
          FilledButton(
            key: const ValueKey('instructions-replace-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Replace'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  /// The re-extract confirmation: the copied original wins over manual edits.
  Future<bool> _confirmReextract(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('re-extract instructions?'),
        content: Text(
          'The prompt is replaced with the text extracted from $name. Manual '
          'edits are discarded; the copied original inside the session is the '
          'source of truth.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('instructions-reextract-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('instructions-reextract-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Re-extract'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  /// The platform file dialog, then a typed-path fallback for a build with no
  /// native dialog (a headless run, or a widget test that did not inject
  /// [SessionSettingsView.pickFile]).
  Future<String?> _defaultPickFile() async {
    try {
      final files = await openFiles();
      for (final file in files) {
        if (file.path.trim().isNotEmpty) return file.path;
      }
      return null;
    } on MissingPluginException {
      if (!mounted) return null;
      return _askForPath();
    } on UnimplementedError {
      if (!mounted) return null;
      return _askForPath();
    }
  }

  Future<String?> _askForPath() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('choose an instructions file'),
        content: SizedBox(
          width: 480,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'This build has no native file dialog. Paste the absolute path '
                'of a Markdown, text, DOCX or PDF file. The core copies it into '
                'the session and extracts its text.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('instructions-path-field'),
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: '/home/you/input/assignment.pdf',
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
            key: const ValueKey('instructions-path-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Use file'),
          ),
        ],
      ),
    );
    controller.dispose();
    final value = text?.trim() ?? '';
    return value.isEmpty ? null : value;
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      unawaited(_leave());
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS &&
        HardwareKeyboard.instance.isControlPressed) {
      if (event is KeyDownEvent) unawaited(_save());
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(),
          if (widget.loading && widget.instructions != null)
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _header() {
    final theme = Theme.of(context);
    final name = widget.detail?.name ?? '';
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to session',
            onPressed: widget.onBack == null ? null : () => unawaited(_leave()),
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
                  name.isEmpty ? 'Session settings' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                Text(
                  'session settings · prompt.md',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          if (_dirty) ...[
            const SizedBox(width: 8),
            _countChip('unsaved changes', tone: LockedInColors.warning),
          ],
          const SizedBox(width: 12),
          Text(
            'Ctrl+S save · Esc back',
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (widget.instructions == null) {
      if (widget.loading) return const _Loading(label: 'loading instructions…');
      return _stateCard(
        icon: Icons.error_outline,
        tone: LockedInColors.error,
        title: 'could not read the instructions',
        body: _displayError ?? 'The core returned no instruction text.',
        actions: [
          if (widget.onRetry != null)
            FilledButton(
              key: const ValueKey('instructions-retry'),
              onPressed: () => unawaited(_retry()),
              child: const Text('Retry'),
            ),
          if (widget.onBack != null)
            OutlinedButton(
              onPressed: () => unawaited(_leave()),
              child: const Text('Back to session'),
            ),
        ],
      );
    }

    final source = widget.instructions?.instructionsSource;
    return ListView(
      key: const ValueKey('session-settings-list'),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_displayError != null) ...[
                  _errorBanner(_displayError!),
                  const SizedBox(height: 12),
                ],
                if (_notice != null) ...[
                  _noticeBanner(_notice!),
                  const SizedBox(height: 12),
                ],
                if (source != null) ...[
                  _provenanceCard(source),
                  const SizedBox(height: 14),
                ],
                _promptCard(),
                const SizedBox(height: 14),
                _importCard(),
                const SizedBox(height: 14),
                _notesCard(),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _provenanceCard(InstructionsSource source) {
    final facts = <String>[
      if (source.kind.isNotEmpty) source.kind,
      if (source.characters > 0) '${source.characters} characters',
      if (source.pages != null) '${source.pages} pages',
      if (source.extractedAt.isNotEmpty)
        'extracted ${_shortDate(source.extractedAt)}',
    ];
    return _card(
      label: 'INSTRUCTIONS FILE',
      trailing: _countChip(
        source.kind.isEmpty ? 'file' : source.kind,
        tone: LockedInColors.secondary,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                sourceIcon(source.kind),
                size: 16,
                color: LockedInColors.muted,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  source.name.isEmpty
                      ? 'copied instructions file'
                      : source.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                shortHash(source.hash),
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 10,
                  fontFamily: 'monospace',
                ),
              ),
            ],
          ),
          if (facts.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              facts.join(' · '),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 11.5,
                height: 1.4,
              ),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            'The copy lives inside this session, so later edits to your original '
            'cannot change it. Re-extracting replaces the prompt with that '
            'copy\u2019s text.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const ValueKey('instructions-reextract'),
              onPressed: widget.onReextract == null || _busy
                  ? null
                  : () => unawaited(_reextract()),
              icon: _reextracting
                  ? const Icon(Icons.hourglass_top, size: 16)
                  : const Icon(Icons.refresh, size: 16),
              label: Text(
                _reextracting ? 're-extracting…' : 're-extract from original',
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _promptCard() {
    final empty = _controller.text.trim().isEmpty;
    final readOnly = widget.onSave == null;
    return _card(
      label: 'PROMPT.MD',
      trailing: _dirty
          ? _countChip('unsaved changes', tone: LockedInColors.warning)
          : _countChip(
              empty ? 'empty' : 'saved',
              tone: empty ? LockedInColors.warning : LockedInColors.success,
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'This is the text the chat reads as its instructions. It is saved '
            'in prompt.md, next to the session\u2019s sources.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            key: const ValueKey('session-prompt-field'),
            controller: _controller,
            enabled: !_busy && !readOnly,
            minLines: 8,
            maxLines: 14,
            style: TextStyle(
              color: LockedInColors.foreground,
              fontSize: 13,
              height: 1.45,
            ),
            decoration: const InputDecoration(
              hintText: 'write the instructions the chat should follow…',
              alignLabelWithHint: true,
            ),
          ),
          if (empty) ...[
            const SizedBox(height: 8),
            Text(
              'An empty prompt is allowed: the chat still answers from this '
              'session\u2019s sources. Add instructions when the assignment has '
              'a specific goal.',
              style: TextStyle(
                color: LockedInColors.warning,
                fontSize: 11.5,
                height: 1.45,
              ),
            ),
          ],
          if (readOnly) ...[
            const SizedBox(height: 8),
            Text(
              'This session is read-only here: the core did not offer a write.',
              style: TextStyle(color: LockedInColors.muted, fontSize: 11.5),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              FilledButton(
                key: const ValueKey('instructions-save'),
                onPressed: widget.onSave == null || _busy || !_dirty
                    ? null
                    : () => unawaited(_save()),
                child: Text(_saving ? 'saving…' : 'Save'),
              ),
              const SizedBox(width: 8),
              TextButton(
                key: const ValueKey('instructions-cancel'),
                onPressed: _busy ? null : () => unawaited(_leave()),
                child: const Text('Cancel'),
              ),
              const Spacer(),
              if (_dirty)
                Text(
                  'unsaved changes',
                  style: TextStyle(color: LockedInColors.warning, fontSize: 11),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _importCard() {
    return _card(
      label: 'LOAD FROM A FILE',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Choose a Markdown, text, DOCX or PDF file. It is copied into this '
            'session, its text is extracted into prompt.md and its provenance is '
            'recorded. A scanned PDF with no text layer is refused; OCR is not '
            'supported.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              key: const ValueKey('instructions-import'),
              onPressed: widget.onImport == null || _busy
                  ? null
                  : () => unawaited(_import()),
              icon: _importing
                  ? const Icon(Icons.hourglass_top, size: 16)
                  : const Icon(Icons.upload_file_outlined, size: 16),
              label: const Text('choose instructions file'),
            ),
          ),
          if (_importing) ...[
            const SizedBox(height: 8),
            Text(
              'importing…',
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }

  Widget _notesCard() {
    return _card(
      label: 'HOW INSTRUCTIONS WORK',
      child: Text(
        'The prompt and its provenance are written atomically: a failed import '
        'or re-extract leaves the previous prompt and metadata exactly as they '
        'were. The original file you pick is never moved or deleted, and this '
        'session\u2019s chat still reads only its own sources.',
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 12,
          height: 1.5,
        ),
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
        borderRadius: BorderRadius.circular(Radii.layer),
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
        borderRadius: BorderRadius.circular(Radii.control),
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

  Widget _noticeBanner(String message) {
    final tone = _noticeOk ? LockedInColors.success : LockedInColors.warning;
    return Container(
      key: const ValueKey('instructions-notice'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: tone.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            _noticeOk ? Icons.check_circle_outline : Icons.info_outline,
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

  Widget _errorBanner(String message) {
    return Container(
      key: const ValueKey('instructions-error'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
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
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                message,
                style: TextStyle(
                  color: LockedInColors.error,
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
            ),
          ),
          TextButton(
            key: const ValueKey('instructions-retry'),
            onPressed: widget.onRetry == null || _busy
                ? null
                : () => unawaited(_retry()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _stateCard({
    required IconData icon,
    required Color tone,
    required String title,
    required String body,
    required List<Widget> actions,
  }) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            decoration: BoxDecoration(
              color: LockedInColors.surface,
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(color: LockedInColors.line),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 17, color: tone),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(title, style: theme.textTheme.titleMedium),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 13,
                    height: 1.5,
                  ),
                ),
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.end,
                    children: actions,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading({required this.label});

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
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

String _baseName(String path) {
  final parts = path.split(RegExp(r'[/\\]'));
  return parts.isEmpty ? path : parts.last;
}

String _shortDate(String stamp) {
  final text = stamp.replaceFirst('T', ' ');
  return text.length > 16 ? text.substring(0, 16) : text;
}
