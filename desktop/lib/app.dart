import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'bridge/core_client.dart';
import 'bridge/core_scope.dart';
import 'bridge/models.dart';
import 'effects/effect.dart';
import 'shell/shell.dart';
import 'theme/palette.dart';

/// The app shell: one [CoreStore], one palette, one [MaterialApp].
///
/// The palette is a projection of `store.settings?.theme` (`ui.theme` in
/// `config.toml`), so a Settings write repaints the whole app on the next
/// frame. When that id is `custom`, the stored `[ui.custom_theme]` tokens are
/// fetched once and merged over crimson per token; a missing or partial map
/// still paints. The listener rebuilds only when the theme or its tokens change:
/// a streamed chat token must not rebuild the MaterialApp.
class LockedInApp extends StatefulWidget {
  const LockedInApp({super.key, required this.store});

  final CoreStore store;

  @override
  State<LockedInApp> createState() => _LockedInAppState();
}

class _LockedInAppState extends State<LockedInApp> {
  /// The particle layer's controller. One per app, above the shell, so any
  /// surface can celebrate without owning an animation.
  final _effects = EffectController();
  late String _themeId;
  String _tokenSignature = '';

  @override
  void initState() {
    super.initState();
    _themeId = _resolveThemeId(widget.store.settings?.theme);
    _tokenSignature = _signature(widget.store.customThemeTokens);
    widget.store.addListener(_onStoreChanged);
    // The palette catalogue is the shell's, so the custom tokens are read here
    // rather than during core boot. The first frame paints crimson (which is
    // also an empty custom palette) and this repaints only if the core answers
    // with overrides.
    unawaited(widget.store.refreshCustomTheme());
  }

  @override
  void didUpdateWidget(covariant LockedInApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (identical(oldWidget.store, widget.store)) return;
    oldWidget.store.removeListener(_onStoreChanged);
    _themeId = _resolveThemeId(widget.store.settings?.theme);
    _tokenSignature = _signature(widget.store.customThemeTokens);
    widget.store.addListener(_onStoreChanged);
    unawaited(widget.store.refreshCustomTheme());
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStoreChanged);
    _effects.dispose();
    super.dispose();
  }

  /// A configured id the shell knows, else the crimson default. An unknown or
  /// empty value is not an error: the shell must never go blank because
  /// `config.toml` carries a stale theme.
  static String _resolveThemeId(String? id) =>
      paletteFor(id) == null ? defaultPaletteId : id!;

  /// A cheap fingerprint of the stored tokens, so a repaint happens on an edit
  /// and not on every unrelated store notification.
  static String _signature(ThemeTokens tokens) => tokens.values.entries
      .map((entry) => '${entry.key}=${entry.value}')
      .join(',');

  void _onStoreChanged() {
    final next = _resolveThemeId(widget.store.settings?.theme);
    final signature = _signature(widget.store.customThemeTokens);
    final tokensChanged = signature != _tokenSignature;
    _tokenSignature = signature;
    if (next == _themeId && !(tokensChanged && next == 'custom')) return;
    setState(() => _themeId = next);
  }

  @override
  Widget build(BuildContext context) {
    // The palette is process-wide: apply it before the theme is built so every
    // widget that reads `LockedInColors` paints the configured identity. A
    // partial custom map falls back to crimson per token inside `customPalette`.
    applyPaletteOr(_themeId, tokens: widget.store.customThemeTokens.values);
    return CoreScope(
      store: widget.store,
      child: MaterialApp(
        title: 'LockedIn',
        debugShowCheckedModeBanner: false,
        theme: lockedInTheme(),
        home: EffectScope(
          controller: _effects,
          child: EffectHost(controller: _effects, child: const Shell()),
        ),
      ),
    );
  }
}
