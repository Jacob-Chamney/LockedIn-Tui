part of 'stats_page.dart';

class _ExportDialog extends StatefulWidget {
  const _ExportDialog({
    required this.range,
    required this.scope,
    required this.onExport,
    this.pickSavePath,
  });

  final String range;
  final String scope;
  final StatsExportHandler onExport;
  final SavePathPicker? pickSavePath;

  @override
  State<_ExportDialog> createState() => _ExportDialogState();
}

class _ExportDialogState extends State<_ExportDialog> {
  /// The chips in display order, mapped to the core's `format` values.
  static const _formats = <String, String>{'markdown': 'md', 'csv': 'csv'};

  String _format = 'markdown';
  String _text = '';
  String? _error;
  bool _loading = true;
  bool _copied = false;
  bool _saving = false;

  /// Where the last export was written, or why it could not be. Both are
  /// cleared when the document changes, because the old file no longer
  /// matches what the dialog shows.
  String? _savedPath;
  String? _saveError;

  /// Bumped on every request and format change, so an answer for a format the
  /// user has already left is dropped instead of replacing the visible text.
  int _request = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final ticket = ++_request;
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
      _copied = false;
      _savedPath = null;
      _saveError = null;
    });
    try {
      final result = await widget.onExport(
        range: widget.range,
        scope: widget.scope,
        format: _formats[_format]!,
      );
      if (!mounted || ticket != _request) return;
      setState(() {
        _text = result.text;
        _loading = false;
      });
    } catch (failure) {
      if (!mounted || ticket != _request) return;
      setState(() {
        _error = userMessage(failure);
        _loading = false;
      });
    }
  }

  void _selectFormat(String format) {
    if (format == _format || _loading) return;
    setState(() => _format = format);
    unawaited(_load());
  }

  bool get _canSave => !_loading && _error == null && _text.isNotEmpty;

  Future<void> _copy() async {
    if (_text.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: _text));
    if (!mounted) return;
    setState(() => _copied = true);
  }

  /// Pick a destination, then write exactly the text on screen.
  ///
  /// The write is deliberately after the picker: a dialog the user cancels
  /// must leave the filesystem alone. Nothing here logs the document.
  Future<void> _save() async {
    if (!_canSave || _saving) return;
    final pick = widget.pickSavePath ?? pickExportSavePath;
    final document = _text;
    setState(() {
      _saving = true;
      _saveError = null;
    });
    String? picked;
    try {
      picked = await pick(
        exportFileName(
          scope: widget.scope,
          range: widget.range,
          format: _formats[_format]!,
        ),
      );
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _savedPath = null;
        _saveError = 'could not save: ${saveFailureReason(failure)}';
      });
      return;
    }
    if (!mounted) return;
    final path = picked?.trim();
    if (path == null || path.isEmpty) {
      // Cancelled: not an error, and nothing was written.
      setState(() => _saving = false);
      return;
    }
    try {
      await writeExportFile(path, document);
      if (!mounted) return;
      setState(() {
        _saving = false;
        _savedPath = path;
        _saveError = null;
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _savedPath = null;
        _saveError = 'could not save: ${saveFailureReason(failure)}';
      });
    }
  }

  /// The core's own one-line reason for a refusal, never a wrapper.

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        final key = event.logicalKey;
        if (key == LogicalKeyboardKey.escape) {
          Navigator.of(context).pop();
          return KeyEventResult.handled;
        }
        // `s` is the dialog's save. It is consumed even while the document is
        // loading, so the page's `s scope` can never fire behind the dialog.
        if (key == LogicalKeyboardKey.keyS) {
          unawaited(_save());
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: Row(
          children: [
            const Expanded(
              child: Text(
                'export stats',
                style: TextStyle(fontSize: TypeScale.title),
              ),
            ),
            Text(
              '${widget.range} · ${widget.scope}',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
        ),
        content: SizedBox(
          width: 540,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final entry in _formats.entries)
                    _Chip(
                      label: entry.key,
                      selected: _format == entry.key,
                      onTap: () => _selectFormat(entry.key),
                    ),
                  const SizedBox(width: 8),
                  Text(
                    's save · Esc close',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _body(),
              if (_savedPath != null || _saveError != null) ...[
                const SizedBox(height: 10),
                Text(
                  _saveError ?? 'saved to $_savedPath',
                  style: TextStyle(
                    color: _saveError != null
                        ? LockedInColors.error
                        : LockedInColors.success,
                    fontSize: TypeScale.label,
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: _canSave && !_saving ? _save : null,
            child: Text(_saving ? 'saving…' : 'Save…'),
          ),
          TextButton(
            onPressed: _loading || _error != null || _text.isEmpty
                ? null
                : _copy,
            child: Text(_copied ? 'copied' : 'Copy'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: Center(
          child: Text(
            'exporting…',
            style: TextStyle(color: LockedInColors.muted),
          ),
        ),
      );
    }
    final error = _error;
    if (error != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            error,
            style: TextStyle(
              color: LockedInColors.error,
              fontSize: TypeScale.body,
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ],
      );
    }
    return Container(
      constraints: const BoxConstraints(maxHeight: 300),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(12),
        child: SelectableText(
          _text,
          style: TextStyle(
            fontFamily: LockedInType.mono,
            fontSize: TypeScale.label,
            height: 1.4,
            color: LockedInColors.foreground,
          ),
        ),
      ),
    );
  }
}
