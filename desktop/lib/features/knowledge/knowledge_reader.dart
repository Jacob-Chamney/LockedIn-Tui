import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../../theme/tokens.dart';
import '../chat/document_search.dart';
import '../chat/markdown.dart';
import '../shared/format.dart';

/// One Knowledge item, read through the core's `knowledge.read`.
///
/// The reader is a **layer** of the Knowledge surface: the shell mounts it above
/// the list, `Esc` returns to the list exactly where the selection was, and
/// nothing here writes. The body is the core's own text — a vault note's
/// Markdown, a session memory note or a copied source's extracted content — and
/// it is rendered through [ChatMarkdown] so notes and sources read like the rest
/// of the app.
///
/// Two kinds carry a product label, because they are reference material rather
/// than a new fact:
///
/// * `memory` — `session memory · history, not a source`;
/// * `source` — `copied source · content, not a new citation`.
///
/// [KnowledgeDocument.truncated] adds a third: the core capped the body, so the
/// document on screen is not the whole file.
class KnowledgeReader extends StatefulWidget {
  const KnowledgeReader({
    super.key,
    required this.documentId,
    this.document,
    this.loading = false,
    this.error,
    this.hitIds = const <String>[],
    this.hitIndex,
    this.onNavigate,
    this.onRetry,
    this.onBack,
  });

  /// The id the shell asked for. It names the item while the body is in flight,
  /// so the header never goes blank on a slow read.
  final String documentId;

  /// The core's reply, or null before it arrives (or after it failed).
  final KnowledgeDocument? document;

  /// True while `knowledge.read` is in flight.
  final bool loading;

  /// The core's own one-line refusal, shown with a Retry.
  final String? error;

  /// The ids of the search result set this item came from, in reply order.
  ///
  /// The shell owns the list, so moving between hits never duplicates the search
  /// results here. Empty means the item came from the tree, which has no
  /// ordering to walk.
  final List<String> hitIds;

  /// Where [documentId] sits inside [hitIds], or null when it came from the tree.
  final int? hitIndex;

  /// Open the hit at that index (`[`/`]`). Null leaves the reader read-only.
  final ValueChanged<int>? onNavigate;

  /// Ask again for the failed item. Null keeps the reader read-only.
  final VoidCallback? onRetry;

  /// `Esc` and the back control return to the Knowledge list.
  final VoidCallback? onBack;

  @override
  State<KnowledgeReader> createState() => _KnowledgeReaderState();
}

class _KnowledgeReaderState extends State<KnowledgeReader> {
  final _scroll = ScrollController();

  /// The reader's keyboard node.
  ///
  /// It is focused explicitly after the first frame rather than with
  /// `autofocus`, because the list underneath is still mounted (it keeps the
  /// selection) and therefore still owns the scope's focus.
  final _focus = FocusNode(debugLabel: 'knowledge-reader');

  /// The reader's own muted line: an end of the hit list, or a tree item with no
  /// ordering to walk. It is never a core failure and never an error toast.
  String? _notice;

  /// The in-document search (`/`). It owns the query field's focus, so a bare
  /// `n` is typing while the field has the keyboard and a command afterwards.
  final _search = DocumentSearchController();

  /// The last match the reader scrolled to. The controller notifies on every
  /// keystroke, and only a change of match should move the scroll position.
  int _lastSearchStart = -1;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearchChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void didUpdateWidget(covariant KnowledgeReader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.documentId != widget.documentId) {
      // Another item is another document: drop the previous end-of-list note and
      // read the new one from the top.
      _notice = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scroll.hasClients) _scroll.jumpTo(0);
      });
    }
    // The body can arrive after the reader opened, and a re-read can replace
    // it without changing the id. Keep the matcher on the rendered bytes.
    _search.updateDocument(_searchDocument());
  }

  @override
  void dispose() {
    _search.removeListener(_onSearchChanged);
    _search.dispose();
    _scroll.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// The document text the search scans: the core's body, exactly as rendered.
  String _searchDocument() => widget.document?.body ?? '';

  void _openSearch() {
    _search.openWith(_searchDocument());
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _search.fieldFocus.requestFocus();
    });
  }

  void _closeSearch() {
    _search.close();
    setState(() {});
    _focus.requestFocus();
  }

  void _onSearchChanged() {
    final start = _search.current?.start ?? -1;
    if (start == _lastSearchStart) return;
    _lastSearchStart = start;
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _scrollToSearchMatch();
    });
  }

  /// Move the reader to the selected match. The Markdown is laid out as one
  /// column, so the offset is mapped to a fraction of the scroll extent rather
  /// than to an exact line; the count in the bar is the precise part.
  void _scrollToSearchMatch() {
    final fraction = _search.currentFraction;
    if (fraction == null || !_scroll.hasClients) return;
    final position = _scroll.position;
    final target = (fraction * position.maxScrollExtent)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (target == position.pixels) return;
    position.jumpTo(target);
  }

  /// The search keys. Returns null when the key belongs to the reader.
  KeyEventResult? _searchKey(LogicalKeyboardKey key) {
    if (!_search.open) {
      if (key == LogicalKeyboardKey.slash) {
        _openSearch();
        return KeyEventResult.handled;
      }
      return null;
    }
    if (key == LogicalKeyboardKey.escape) {
      _closeSearch();
      return KeyEventResult.handled;
    }
    if (_search.typing) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.slash) {
      _search.fieldFocus.requestFocus();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyN) {
      if (HardwareKeyboard.instance.isShiftPressed) {
        _search.previous();
      } else {
        _search.next();
      }
      return KeyEventResult.handled;
    }
    return null;
  }

  /// Scroll by [delta] logical pixels, clamped to the document's extent.
  void _scrollBy(double delta) {
    if (!_scroll.hasClients) return;
    final position = _scroll.position;
    final next = (position.pixels + delta)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (next == position.pixels) return;
    position.jumpTo(next);
  }

  /// True when this item came from a search result set with a real position.
  bool get _hasHitOrder {
    final index = widget.hitIndex;
    final ids = widget.hitIds;
    return index != null && index >= 0 && index < ids.length;
  }

  /// Move one hit in `[hitIds]` and open it in place.
  ///
  /// The ends clamp rather than wrap, and each end says so in one muted line
  /// instead of doing nothing. A tree item has no result set to walk, so it says
  /// that once rather than inventing an order.
  void _moveHit(int delta) {
    final navigate = widget.onNavigate;
    if (!_hasHitOrder) {
      setState(() => _notice = 'no hits to move through');
      return;
    }
    if (navigate == null) {
      setState(() => _notice = 'hit navigation is not wired in this build');
      return;
    }
    final index = widget.hitIndex!;
    final next = index + delta;
    if (next < 0) {
      setState(() => _notice = 'first hit');
      return;
    }
    if (next >= widget.hitIds.length) {
      setState(() => _notice = 'last hit');
      return;
    }
    setState(() => _notice = null);
    navigate(next);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    // `/` opens the search; while its field is focused bare keys are text, so
    // the reader's own bindings resume after Enter hands the keyboard back.
    final search = _searchKey(key);
    if (search != null) return search;
    if (_search.open && _search.typing) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.escape) {
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _scrollBy(40);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _scrollBy(-40);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.pageDown || key == LogicalKeyboardKey.keyD) {
      _scrollBy(320);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.pageUp || key == LogicalKeyboardKey.keyU) {
      _scrollBy(-320);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.home) {
      _scrollBy(-double.infinity);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.end) {
      _scrollBy(double.infinity);
      return KeyEventResult.handled;
    }
    // `[`/`]` walk the search result set, not a text selection: this surface is
    // a reader. The verbs fire once per press so a held key cannot skip hits.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.bracketLeft) {
      _moveHit(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.bracketRight) {
      _moveHit(1);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _focus,
      onKeyEvent: _onKey,
      child: Container(
        key: const ValueKey('knowledge-reader'),
        // Opaque: the reader is a layer over the list, and the list keeps its
        // scroll position and selection behind it.
        color: LockedInColors.background,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _header(),
            if (_notice != null) _noticeLine(_notice!),
            if (_search.open)
              DocumentSearchBar(
                controller: _search,
                onClose: _closeSearch,
                onSubmit: _focus.requestFocus,
              ),
            if (widget.loading && widget.document != null)
              LinearProgressIndicator(
                minHeight: 2,
                color: LockedInColors.primary,
                backgroundColor: LockedInColors.line,
              ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    // The reader sits in the main pane; the window is up to 208 px wider than
    // the box this header actually gets.
    return LayoutBuilder(
      builder: (context, constraints) => _headerAt(constraints.maxWidth),
    );
  }

  Widget _headerAt(double width) {
    final theme = Theme.of(context);
    final hit = widget.document?.hit;
    final compact = width < Breakpoints.column;
    final title = hit?.displayTitle ?? _idLabel(widget.documentId);
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('knowledge-reader-back'),
            tooltip: 'Back to Knowledge',
            onPressed: widget.onBack,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 30, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title.isEmpty ? 'reference item' : title,
                  key: const ValueKey('knowledge-reader-title'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                Text(
                  _subtitle(hit),
                  key: const ValueKey('knowledge-reader-subtitle'),
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
          if (!compact && hit != null) ...[
            const SizedBox(width: 10),
            _kindChip(hit.kind),
            const SizedBox(width: 6),
            _sideChip(hit.side),
          ],
          if (_hasHitOrder) ...[
            const SizedBox(width: 10),
            // The pointer path for `[` / `]`: the same two moves the keys run.
            IconButton(
              key: const ValueKey('knowledge-reader-prev'),
              tooltip: 'previous hit ([)',
              onPressed: () => _moveHit(-1),
              icon: const Icon(Icons.chevron_left, size: 17),
              visualDensity: VisualDensity.compact,
              color: LockedInColors.muted,
            ),
            _positionChip(widget.hitIndex!, widget.hitIds.length),
            IconButton(
              key: const ValueKey('knowledge-reader-next'),
              tooltip: 'next hit (])',
              onPressed: () => _moveHit(1),
              icon: const Icon(Icons.chevron_right, size: 17),
              visualDensity: VisualDensity.compact,
              color: LockedInColors.muted,
            ),
          ],
        ],
      ),
    );
  }

  /// `3 of 12`: where this document sits in the search result set it was opened
  /// from. A tree item has no result set, so the header shows nothing rather
  /// than a position that would imply an ordering it cannot walk.
  Widget _positionChip(int index, int total) {
    return Container(
      key: const ValueKey('knowledge-reader-position'),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        '${index + 1} of $total',
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.micro,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  /// The reader's one muted line: an end of the hit list, or a tree item with no
  /// ordering. It never replaces the body and never reads as an error.
  Widget _noticeLine(String message) {
    return Padding(
      key: const ValueKey('knowledge-reader-notice'),
      padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
      child: Row(
        children: [
          Icon(Icons.info_outline, size: 12, color: LockedInColors.muted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              message,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ),
          if (_hasHitOrder)
            Text(
              '[ previous · ] next',
              key: const ValueKey('knowledge-reader-navhint'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
        ],
      ),
    );
  }

  /// `kind · side` plus the path and its date, so the header says what the body
  /// is and where it came from without a second lookup.
  String _subtitle(KnowledgeHit? hit) {
    if (hit == null) {
      return widget.loading ? 'reading…' : 'reference material';
    }
    return joinDot([
      'kind ${hit.kind.isEmpty ? 'unknown' : hit.kind}',
      'side ${hit.side.isEmpty ? 'unknown' : hit.side}',
      hit.path,
      dateLabel(hit.updated),
    ]);
  }

  Widget _kindChip(String kind) {
    final label = kind.trim().isEmpty ? 'item' : kind;
    final color = _kindColor(label);
    return Container(
      key: const ValueKey('knowledge-reader-kind'),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_kindIcon(label), size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            label.toUpperCase(),
            style: TextStyle(
              color: color,
              fontSize: TypeScale.micro,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sideChip(String side) {
    final label = side.trim().isEmpty ? 'unknown' : side;
    return Container(
      key: const ValueKey('knowledge-reader-side'),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: sideColor(label),
          fontSize: TypeScale.micro,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.4,
        ),
      ),
    );
  }

  Widget _body() {
    final document = widget.document;
    if (document == null) {
      if (widget.loading) return _pending();
      final error = widget.error;
      if (error != null) return _failure(error);
      return _stateCard(
        icon: Icons.menu_book_outlined,
        tone: LockedInColors.muted,
        title: 'nothing to read',
        body: 'Pick a row from the Knowledge list to read it here.',
      );
    }

    return ListView(
      key: const ValueKey('knowledge-reader-body'),
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (document.hit.kind == 'memory') ...[
                  _label(
                    key: const ValueKey('knowledge-reader-memory-label'),
                    icon: Icons.history,
                    tone: LockedInColors.success,
                    text: 'session memory · history, not a source',
                  ),
                  const SizedBox(height: 12),
                ],
                if (document.hit.kind == 'source') ...[
                  _label(
                    key: const ValueKey('knowledge-reader-source-label'),
                    icon: Icons.article_outlined,
                    tone: LockedInColors.secondary,
                    text: 'copied source · content, not a new citation',
                  ),
                  const SizedBox(height: 12),
                ],
                if (document.truncated) ...[
                  _label(
                    key: const ValueKey('knowledge-reader-truncated'),
                    icon: Icons.content_cut,
                    tone: LockedInColors.warning,
                    text:
                        'truncated · the core capped this body, so this is not '
                        'the whole file',
                  ),
                  const SizedBox(height: 12),
                ],
                if (document.hasNoBody)
                  _stateCard(
                    key: const ValueKey('knowledge-reader-empty'),
                    icon: Icons.notes,
                    tone: LockedInColors.muted,
                    title: 'no body',
                    body:
                        'The core returned this item with no readable text. '
                        'The row is still listed; try another item.',
                  )
                else
                  ChatMarkdown(text: document.body),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _pending() {
    return Center(
      key: const ValueKey('knowledge-reader-loading'),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: LockedInColors.primary,
            ),
          ),
          const SizedBox(width: 12),
          Text(
            'reading…',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        ],
      ),
    );
  }

  /// One readable refusal with the retry that makes it actionable. The reader
  /// stays open so the failure replaces the body rather than the surface.
  Widget _failure(String message) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Container(
              key: const ValueKey('knowledge-reader-error'),
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              decoration: BoxDecoration(
                color: LockedInColors.panel,
                borderRadius: BorderRadius.circular(Radii.control),
                border: Border.all(
                  color: LockedInColors.error.withValues(alpha: 0.55),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.error_outline,
                        size: 16,
                        color: LockedInColors.error,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'could not read this item',
                              style: TextStyle(
                                color: LockedInColors.error,
                                fontSize: TypeScale.key,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              message,
                              style: TextStyle(
                                color: LockedInColors.error,
                                fontSize: TypeScale.label,
                                height: 1.45,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  if (widget.onRetry != null) ...[
                    const SizedBox(height: 10),
                    Align(
                      alignment: Alignment.centerRight,
                      child: OutlinedButton.icon(
                        key: const ValueKey('knowledge-reader-retry'),
                        onPressed: widget.loading ? null : widget.onRetry,
                        icon: const Icon(Icons.refresh, size: 15),
                        label: const Text('Retry'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// A labelling line: icon plus words, so colour is never the only signal.
  Widget _label({
    required Key key,
    required IconData icon,
    required Color tone,
    required String text,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: tone.withValues(alpha: 0.45)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 13, color: tone),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: tone,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stateCard({
    Key? key,
    required IconData icon,
    required Color tone,
    required String title,
    required String body,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: tone),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: TypeScale.body,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  body,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A readable name for an id whose body has not arrived yet: the part after the
/// `kind:` prefix, which is the workspace-relative path for a note.
String _idLabel(String id) {
  final trimmed = id.trim();
  if (trimmed.isEmpty) return '';
  final colon = trimmed.indexOf(':');
  return colon == -1 ? trimmed : trimmed.substring(colon + 1);
}

/// The same kind→semantic-token pairing the list uses, so one item reads the
/// same on both layers.
Color _kindColor(String kind) => switch (kind) {
  'note' => LockedInColors.primary,
  'memory' => LockedInColors.success,
  'source' => LockedInColors.secondary,
  'session' => LockedInColors.accent,
  'goal' => LockedInColors.secondary,
  'project' => LockedInColors.accent,
  'archive' => LockedInColors.warning,
  _ => LockedInColors.muted,
};

IconData _kindIcon(String kind) => switch (kind) {
  'note' => Icons.description_outlined,
  'memory' => Icons.memory,
  'source' => Icons.article_outlined,
  'session' => Icons.history,
  'goal' => Icons.school_outlined,
  'project' => Icons.work_outline,
  'archive' => Icons.archive_outlined,
  _ => Icons.circle_outlined,
};
