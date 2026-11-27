import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../shared/cards.dart';
import '../../theme/palette.dart';
import '../../theme/numerals.dart';
import '../../theme/breakpoints.dart';
import '../../theme/tokens.dart';
import '../keys.dart';
import '../chat/transcript_scroll.dart';
import 'export_saver.dart';

part 'stats_cards.dart';
part 'stats_chart.dart';
part 'stats_export.dart';

/// Requests one Stats export document from the shell (`stats.export`).
///
/// The page never reaches the core itself: the shell owns the store, so the
/// callback is the only path to the export and the page only renders the text
/// the core returned. It writes no file.
typedef StatsExportHandler = Future<StatsExportResult> Function({
  required String range,
  required String scope,
  required String format,
});

/// The Stats surface: the dashboard, its range/scope chips and the `x` export.
///
/// The shell owns the store and passes the latest [StatsSummary] in; the page
/// formats it and forwards the user's intents. `r` and `s` cycle the chips and
/// `x` asks [onExport] for the document text, which is shown in a dialog with
/// Save, Copy and Close. Saving is the shell's documented half of
/// `stats.export`: the core returns text, and a file is written only to a path
/// the user picked (`s` or Save… in the open dialog).
class StatsPage extends StatefulWidget {
  const StatsPage({
    super.key,
    this.summary,
    this.loading = false,
    this.error,
    this.onRetry,
    this.range = 'all',
    this.scope = 'all',
    this.onRange,
    this.onScope,
    this.onExport,
    this.pickSavePath,
    this.onAchievements,
  });

  final StatsSummary? summary;
  final bool loading;
  final String? error;
  final VoidCallback? onRetry;
  final String range;
  final String scope;
  final ValueChanged<String>? onRange;
  final ValueChanged<String>? onScope;

  /// Called with the page's current range/scope and the chosen format on `x`.
  ///
  /// When it is null the export action is not offered: a footer hint for a
  /// key that does nothing would be a lie. A failure is the core's own
  /// message, shown inline in the dialog with Retry.
  final StatsExportHandler? onExport;

  /// The destination picker the export dialog's Save action uses.
  ///
  /// Defaults to the platform Save dialog. Tests inject a scripted path; a
  /// `null` answer cancels and writes nothing. The core never returns a path,
  /// so this is the only way a file is written.
  final SavePathPicker? pickSavePath;

  /// `a` opens the Achievements layer over Stats.
  ///
  /// Achievements is a layer of this surface, not a surface of its own: the
  /// global chord and the palette row live in the keymap registry
  /// (`achievements`), and this page-local `a` is the same layer's shortcut
  /// while Stats has focus. When it is null the key is not offered, so the
  /// footer never names a key that does nothing.
  final VoidCallback? onAchievements;

  @override
  State<StatsPage> createState() => _StatsPageState();
}

class _StatsPageState extends State<StatsPage> {
  /// The dashboard is taller than 800×600; it has to scroll by keyboard.
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  KeyEventResult _handleKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    // Modified chords belong to the shell's registry.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final scrolled = scrollKey(_scroll, event);
    if (scrolled != null) return scrolled;
    if (key == LogicalKeyboardKey.keyA && widget.onAchievements != null) {
      widget.onAchievements!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyX) {
      final export = widget.onExport;
      if (export == null || widget.summary == null) {
        return KeyEventResult.ignored;
      }
      unawaited(_openExport(export));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR) {
      final onRange = widget.onRange;
      if (onRange == null) return KeyEventResult.ignored;
      onRange(_nextRange(widget.range));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS) {
      final onScope = widget.onScope;
      if (onScope == null) return KeyEventResult.ignored;
      onScope(_nextScope(widget.scope));
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  Future<void> _openExport(StatsExportHandler export) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _ExportDialog(
        range: widget.range,
        scope: widget.scope,
        onExport: export,
        pickSavePath: widget.pickSavePath,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final summary = widget.summary;
    if (summary == null) {
      return Focus(
        autofocus: true,
        onKeyEvent: _handleKey,
        child: _State(
          loading: widget.loading,
          error: widget.error,
          onRetry: widget.onRetry,
        ),
      );
    }
    return Focus(
      autofocus: true,
      onKeyEvent: _handleKey,
      child: Column(
        children: [
          Expanded(
            child: _Dashboard(
              summary: summary,
              range: widget.range,
              scope: widget.scope,
              scrollController: _scroll,
              onRange: widget.onRange,
              onScope: widget.onScope,
              onAchievements: widget.onAchievements,
              onExport: widget.onExport == null
                  ? null
                  : () => unawaited(_openExport(widget.onExport!)),
            ),
          ),
          _StatsFooter(
            canCycleRange: widget.onRange != null,
            canCycleScope: widget.onScope != null,
            canExport: widget.onExport != null,
            canOpenAchievements: widget.onAchievements != null,
          ),
        ],
      ),
    );
  }
}

/// The one footer line for the surface: only the keys that actually work are
/// named, so the bar never advertises an action the shell did not wire.
