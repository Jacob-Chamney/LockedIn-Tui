import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';

/// Returns the files the user chose, or an empty list when they cancelled.
typedef SourcePicker = Future<List<String>> Function();

/// The Sources surface for one lock-in session.
///
/// The shell owns the store: it passes the open session, its source rows and
/// the callbacks that turn a choice into a core call. This page reads no file
/// and copies nothing — it only produces paths, and the core copies them into
/// the session's `sources/` folder.
class SourcesPage extends StatefulWidget {
  const SourcesPage({
    super.key,
    required this.session,
    required this.loading,
    required this.sources,
    this.error,
    this.onAdd,
    this.onRefresh,
    this.pickFiles,
    this.onBack,
  });

  /// The open session, or null when Chill is the target. Without it the page is
  /// a blocked empty state: sources belong to a session, never to the shell.
  final SessionDetail? session;

  /// True while the shell is opening or reloading the session.
  final bool loading;

  /// The session's attached rows, projected by the shell from `source.list`.
  final List<SessionSource> sources;

  /// One readable failure from the shell, shown beside the list.
  final String? error;

  /// Copies the chosen paths through `source.add`. It throws an [RpcException]
  /// on failure; the page shows that message inline and keeps its state.
  final Future<SourceAddResult> Function(List<String> paths)? onAdd;

  /// Re-reads `source.list`. The store's `addSources` refreshes on its own, so
  /// this is the explicit `r` action.
  final Future<void> Function()? onRefresh;

  /// Test seam: a scripted picker. Production leaves it null and the platform
  /// file dialog is used.
  final SourcePicker? pickFiles;

  /// `Esc`/back is the shell's job; the page only exposes the control.
  final VoidCallback? onBack;

  @override
  State<SourcesPage> createState() => _SourcesPageState();
}

class _SourcesPageState extends State<SourcesPage> {
  var _busy = false;
  String? _notice;
  var _noticeOk = true;
  String? _failure;

  bool get _hasSession => widget.session != null;

  /// The default picker opens the platform file dialog and returns absolute
  /// paths only. A build with no dialog (a headless run, or a widget test that
  /// did not inject [SourcesPage.pickFiles]) falls back to a typed path dialog,
  /// so the action is never dead and the shell still never opens a file.
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
                key: const ValueKey('sources-path-field'),
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
            key: const ValueKey('sources-path-confirm'),
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

  Future<void> _add() async {
    final onAdd = widget.onAdd;
    final session = widget.session;
    if (onAdd == null || session == null || _busy) return;
    final pick = widget.pickFiles ?? _defaultPickFiles;

    final List<String> paths;
    try {
      paths = await pick();
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _notice = null;
        _failure = _reason(failure);
      });
      return;
    }
    if (paths.isEmpty || !mounted) return;

    setState(() {
      _busy = true;
      _notice = null;
      _failure = null;
    });
    try {
      final result = await onAdd(paths);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _noticeOk = !result.nothingNew;
        _notice = _feedback(result);
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = _reason(failure);
      });
    }
  }

  String _feedback(SourceAddResult result) {
    if (result.added > 0) {
      return 'added ${result.added} · skipped ${result.skipped}';
    }
    if (result.skipped > 0) {
      return 'already attached · skipped ${result.skipped}';
    }
    return 'nothing added';
  }

  Future<void> _refresh() async {
    final onRefresh = widget.onRefresh;
    if (onRefresh == null || _busy) return;
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await onRefresh();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _notice = null;
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = _reason(failure);
      });
    }
  }

  /// One readable reason. The core puts the actionable sentence in `data`, so
  /// prefer it over the envelope message, exactly like the store does.
  String _reason(Object failure) {
    if (failure is RpcException) {
      final data = failure.data;
      if (data is Map && data['message'] is String) {
        return data['message'] as String;
      }
      return failure.message;
    }
    return failure.toString();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    if (!_hasSession) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.keyA && widget.onAdd != null) {
      _add();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR && widget.onRefresh != null) {
      _refresh();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 560;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(constraints.maxWidth, compact: compact),
              if (widget.loading && _hasSession)
                LinearProgressIndicator(
                  minHeight: 2,
                  color: LockedInColors.primary,
                  backgroundColor: LockedInColors.line,
                ),
              Expanded(child: _body()),
            ],
          );
        },
      ),
    );
  }

  Widget _header(double width, {required bool compact}) {
    final theme = Theme.of(context);
    final session = widget.session;
    final count = widget.sources.length;
    final countLabel = count == 1 ? '1 source' : '$count sources';
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          if (widget.onBack != null) ...[
            IconButton(
              tooltip: 'Back',
              onPressed: widget.onBack,
              icon: const Icon(Icons.arrow_back, size: 18),
            ),
            const SizedBox(width: 2),
          ],
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  session == null || session.name.isEmpty
                      ? 'Sources'
                      : session.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                Text(
                  session == null
                      ? 'no session open'
                      : '$countLabel · copied into this session',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          if (_hasSession && !compact) ...[
            const SizedBox(width: 12),
            Text(
              'a add · r refresh',
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ],
          if (_hasSession && widget.onRefresh != null) ...[
            const SizedBox(width: 6),
            IconButton(
              key: const ValueKey('sources-refresh'),
              tooltip: 'Refresh sources',
              onPressed: _busy ? null : _refresh,
              icon: const Icon(Icons.refresh, size: 18),
            ),
          ],
          if (_hasSession && widget.onAdd != null) ...[
            const SizedBox(width: 8),
            if (compact)
              IconButton(
                key: const ValueKey('sources-add'),
                tooltip: 'add sources',
                onPressed: _busy ? null : _add,
                icon: const Icon(Icons.add, size: 18),
              )
            else
              FilledButton.icon(
                key: const ValueKey('sources-add'),
                onPressed: _busy ? null : _add,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('add sources'),
              ),
          ],
        ],
      ),
    );
  }

  Widget _body() {
    final session = widget.session;
    if (session == null) {
      if (widget.loading) return const _Loading(label: 'loading sources…');
      return _centered(_blocked());
    }
    return ListView(
      key: const ValueKey('sources-list'),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  _errorBanner(widget.error!),
                  const SizedBox(height: 12),
                ],
                if (_failure != null) ...[
                  _errorBanner(_failure!),
                  const SizedBox(height: 12),
                ],
                if (_notice != null) ...[
                  _noticeBanner(_notice!),
                  const SizedBox(height: 12),
                ],
                _sourcesCard(),
                const SizedBox(height: 14),
                _hintCard(),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _sourcesCard() {
    final sources = widget.sources;
    return _card(
      label: 'SOURCES',
      trailing: _countChip('${sources.length}'),
      child: sources.isEmpty
          ? _EmptyNote(
              tone: LockedInColors.warning,
              title: 'no sources attached yet',
              body:
                  'Lock-in chat reads only the files copied into this session. '
                  'Press a to pick files, or use add sources — originals stay '
                  'where they are.',
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < sources.length; index++) ...[
                  if (index > 0)
                    Divider(
                      height: 1,
                      thickness: 1,
                      color: LockedInColors.line,
                    ),
                  _SourceRow(source: sources[index]),
                ],
              ],
            ),
    );
  }

  Widget _hintCard() {
    return _card(
      label: 'HOW SOURCES WORK',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Each file is copied into the session folder and de-duplicated by '
            'hash, so adding the same file twice attaches it once. The original '
            'is never moved or deleted, and the chat can only read this '
            'session\u2019s copies.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'a add sources · r refresh',
            style: TextStyle(
              color: LockedInColors.secondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _blocked() {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.folder_off_outlined, size: 26, color: LockedInColors.muted),
        const SizedBox(height: 10),
        Text('open a session first', style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(
          'Sources belong to one lock-in session. Open a session from Sessions, '
          'then add its files here.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 12,
            height: 1.45,
          ),
        ),
        if (widget.error != null) ...[
          const SizedBox(height: 12),
          _errorBanner(widget.error!),
        ],
        if (widget.onBack != null) ...[
          const SizedBox(height: 14),
          OutlinedButton(
            onPressed: widget.onBack,
            child: const Text('Back to sessions'),
          ),
        ],
      ],
    );
  }

  Widget _centered(Widget child) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: child,
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

  Widget _noticeBanner(String message) {
    final tone = _noticeOk ? LockedInColors.success : LockedInColors.warning;
    return Container(
      key: const ValueKey('sources-notice'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(8),
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
      key: const ValueKey('sources-error'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(8),
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

class _SourceRow extends StatelessWidget {
  const _SourceRow({required this.source});

  final SessionSource source;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Icon(_sourceIcon(source.kind), size: 15, color: LockedInColors.muted),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              source.name.isEmpty ? 'unnamed source' : source.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.foreground, fontSize: 13),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(
              color: LockedInColors.panel,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: LockedInColors.line),
            ),
            child: Text(
              source.kind.isEmpty ? 'file' : source.kind,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            _shortHash(source.hash),
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 10,
              fontFamily: 'monospace',
            ),
          ),
        ],
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

String _shortHash(String hash) {
  final value = hash.startsWith('sha256:')
      ? hash.substring('sha256:'.length)
      : hash;
  if (value.isEmpty) return 'no hash';
  return value.length <= 10 ? value : value.substring(0, 10);
}

IconData _sourceIcon(String kind) {
  return switch (kind) {
    'pdf' => Icons.picture_as_pdf_outlined,
    'docx' => Icons.description_outlined,
    'image' => Icons.image_outlined,
    'markdown' || 'text' || 'code' => Icons.article_outlined,
    _ => Icons.insert_drive_file_outlined,
  };
}
