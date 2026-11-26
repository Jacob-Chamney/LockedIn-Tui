import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../../theme/tokens.dart';

/// One case-insensitive match inside a document.
///
/// Ranges are character offsets into the original text; nothing here rewrites
/// the document. The reader uses them to scroll a match into view, and the
/// search bar shows the matched text as a chip.
@immutable
class DocumentMatch {
  const DocumentMatch(this.start, this.end);

  final int start;
  final int end;

  int get length => end - start;

  bool get isEmpty => end <= start;

  /// The matched text, or the empty string when the range is out of bounds.
  String textIn(String document) {
    if (start < 0 || end > document.length || start >= end) return '';
    return document.substring(start, end);
  }

  @override
  bool operator ==(Object other) =>
      other is DocumentMatch && other.start == start && other.end == end;

  @override
  int get hashCode => Object.hash(start, end);

  @override
  String toString() => 'DocumentMatch($start..$end)';
}

/// The hard cap on matches, so a one-character query in a long note cannot
/// build a list large enough to stall a frame.
const int maxDocumentMatches = 200;

/// Every case-insensitive, non-overlapping occurrence of [query] in
/// [document], in document order, capped at [max].
///
/// A blank query is an empty result, not an error. The scan is two `indexOf`
/// calls over lowercased strings, so it is linear and cheap.
List<DocumentMatch> findDocumentMatches(
  String document,
  String query, {
  int max = maxDocumentMatches,
}) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty || document.isEmpty || max <= 0) {
    return const <DocumentMatch>[];
  }
  final haystack = document.toLowerCase();
  final matches = <DocumentMatch>[];
  var from = 0;
  while (matches.length < max) {
    final at = haystack.indexOf(needle, from);
    if (at < 0) break;
    matches.add(DocumentMatch(at, at + needle.length));
    from = at + needle.length;
  }
  return matches;
}

/// The state behind one reader's in-document search.
///
/// A reader owns one of these, keeps it in sync with the document it renders,
/// and asks it for the next/previous match. It owns the query field's focus
/// node so the reader can tell whether bare keys are typing or navigation.
///
/// The definition is deliberately small and honest: it finds ranges and steps
/// through them. It never rewrites the Markdown, never dims the document and
/// never touches the core.
class DocumentSearchController extends ChangeNotifier {
  DocumentSearchController({this.maxMatches = maxDocumentMatches});

  final int maxMatches;

  /// The query field's focus node. A reader checks [typing] before claiming
  /// `n`/`N`, so a letter typed into the field is never stolen as a command.
  final FocusNode fieldFocus = FocusNode(debugLabel: 'document-search');

  String _document = '';
  String _query = '';
  List<DocumentMatch> _matches = const <DocumentMatch>[];
  int _index = -1;
  bool _open = false;

  bool get open => _open;
  String get document => _document;
  String get query => _query;
  List<DocumentMatch> get matches => _matches;
  int get index => _index;

  /// True while the query field owns the keyboard.
  bool get typing => fieldFocus.hasFocus;

  bool get hasMatches => _matches.isNotEmpty;

  DocumentMatch? get current =>
      _index >= 0 && _index < _matches.length ? _matches[_index] : null;

  /// The bar's one status string: `3 of 12`, `no matches`, or the prompt.
  String get countLabel {
    if (!_open) return '';
    if (_query.trim().isEmpty) return 'type to search';
    if (_matches.isEmpty) return 'no matches';
    return '${_index + 1} of ${_matches.length}';
  }

  /// The selected match as one trimmed line, or null when there is none.
  String? get currentSnippet {
    final match = current;
    if (match == null) return null;
    final text = match.textIn(_document).replaceAll(RegExp(r'\s+'), ' ').trim();
    if (text.isEmpty) return null;
    return text.length <= 40 ? text : '${text.substring(0, 39)}…';
  }

  /// Where the selected match sits in the document, as 0..1.
  ///
  /// The reader multiplies this by its scroll extent. It is an approximation,
  /// not a text-offset-to-pixel mapping, and the reader says so by keeping the
  /// count visible instead of pretending it has precise highlighting.
  double? get currentFraction {
    final match = current;
    if (match == null || _document.isEmpty) return null;
    return (match.start / _document.length).clamp(0.0, 1.0);
  }

  /// Open the bar for [document], keeping any previous query is **not** done:
  /// a fresh open starts from a blank query.
  void openWith(String document) {
    _document = document;
    _open = true;
    _query = '';
    _matches = const <DocumentMatch>[];
    _index = -1;
    notifyListeners();
  }

  /// Keep the matcher in step with the document the reader renders.
  void updateDocument(String document) {
    if (document == _document) return;
    _document = document;
    if (!_open) return;
    _recompute();
    notifyListeners();
  }

  void close() {
    if (!_open) return;
    _open = false;
    _query = '';
    _matches = const <DocumentMatch>[];
    _index = -1;
    fieldFocus.unfocus();
    notifyListeners();
  }

  void setQuery(String value) {
    if (value == _query) return;
    _query = value;
    _recompute();
    notifyListeners();
  }

  /// Step forward. Returns false at the last match (the ends clamp, never wrap).
  bool next() {
    if (_matches.isEmpty) return false;
    final at = (_index + 1).clamp(0, _matches.length - 1);
    if (at == _index) return false;
    _index = at;
    notifyListeners();
    return true;
  }

  /// Step back. Returns false at the first match.
  bool previous() {
    if (_matches.isEmpty) return false;
    final at = (_index - 1).clamp(0, _matches.length - 1);
    if (at == _index) return false;
    _index = at;
    notifyListeners();
    return true;
  }

  void _recompute() {
    if (_query.trim().isEmpty) {
      _matches = const <DocumentMatch>[];
      _index = -1;
      return;
    }
    final previousStart = current?.start;
    _matches = findDocumentMatches(_document, _query, max: maxMatches);
    if (_matches.isEmpty) {
      _index = -1;
      return;
    }
    if (previousStart != null) {
      final at = _matches.indexWhere((match) => match.start == previousStart);
      _index = at >= 0 ? at : 0;
    } else {
      _index = 0;
    }
  }

  @override
  void dispose() {
    fieldFocus.dispose();
    super.dispose();
  }
}

/// The reusable search bar: the query field, the `3 of 12` count, the selected
/// match chip and the next/previous/close controls.
///
/// The reader owns the keys (`/`, `n`, `N`, `Esc`) and the scroll; the bar
/// owns the field and its text. `Enter` hands the keyboard back to the reader
/// so `n`/`N` step instead of typing, exactly like the Knowledge page's search.
class DocumentSearchBar extends StatefulWidget {
  const DocumentSearchBar({
    super.key,
    required this.controller,
    required this.onClose,
    this.onSubmit,
  });

  final DocumentSearchController controller;

  /// `Esc`, the close button.
  final VoidCallback onClose;

  /// `Enter`: commit the query and drop focus back to the reader.
  final VoidCallback? onSubmit;

  @override
  State<DocumentSearchBar> createState() => _DocumentSearchBarState();
}

class _DocumentSearchBarState extends State<DocumentSearchBar> {
  late final TextEditingController _text;

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: widget.controller.query);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.controller.fieldFocus.requestFocus();
    });
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('document-search-bar'),
      padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= Breakpoints.snippet;
          return Row(
            children: [
              Icon(Icons.search, size: 14, color: LockedInColors.muted),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  key: const ValueKey('document-search-field'),
                  controller: _text,
                  focusNode: widget.controller.fieldFocus,
                  onChanged: widget.controller.setQuery,
                  onSubmitted: (_) => widget.onSubmit?.call(),
                  textInputAction: TextInputAction.search,
                  maxLines: 1,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: 13,
                  ),
                  decoration: InputDecoration(
                    isDense: true,
                    filled: true,
                    fillColor: LockedInColors.panel,
                    hintText: 'find in document',
                    hintStyle: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: 12,
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(Radii.layer),
                      borderSide: BorderSide(color: LockedInColors.line),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(Radii.layer),
                      borderSide: BorderSide(color: LockedInColors.line),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(Radii.layer),
                      borderSide: BorderSide(color: LockedInColors.primary),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              ListenableBuilder(
                listenable: widget.controller,
                builder: (context, _) {
                  final snippet = widget.controller.currentSnippet;
                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (wide && snippet != null) ...[
                        _matchChip(snippet),
                        const SizedBox(width: 8),
                      ],
                      Text(
                        widget.controller.countLabel,
                        key: const ValueKey('document-search-count'),
                        maxLines: 1,
                        style: TextStyle(
                          color: widget.controller.hasMatches
                              ? LockedInColors.foreground
                              : LockedInColors.muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 4),
                      _iconButton(
                        keyName: 'document-search-prev',
                        tooltip: 'previous match (N)',
                        icon: Icons.expand_less,
                        onPressed: widget.controller.hasMatches
                            ? widget.controller.previous
                            : null,
                      ),
                      _iconButton(
                        keyName: 'document-search-next',
                        tooltip: 'next match (n)',
                        icon: Icons.expand_more,
                        onPressed: widget.controller.hasMatches
                            ? widget.controller.next
                            : null,
                      ),
                      _iconButton(
                        keyName: 'document-search-close',
                        tooltip: 'close search (Esc)',
                        icon: Icons.close,
                        onPressed: widget.onClose,
                      ),
                    ],
                  );
                },
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _matchChip(String text) {
    return Container(
      key: const ValueKey('document-search-match'),
      constraints: const BoxConstraints(maxWidth: 180),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(
          color: LockedInColors.primary.withValues(alpha: 0.5),
        ),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: LockedInColors.primary,
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _iconButton({
    required String keyName,
    required String tooltip,
    required IconData icon,
    required VoidCallback? onPressed,
  }) {
    return IconButton(
      key: ValueKey(keyName),
      tooltip: tooltip,
      onPressed: onPressed,
      icon: Icon(icon, size: 16),
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints.tightFor(width: 30, height: 30),
      color: onPressed == null
          ? LockedInColors.muted
          : LockedInColors.secondary,
      disabledColor: LockedInColors.muted.withValues(alpha: 0.5),
    );
  }
}
