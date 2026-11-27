import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// The theme picker: every built-in palette plus the custom one, each drawn
/// with its own swatch.
///
/// The Settings row used to cycle the built-ins on `Enter`, which meant the
/// user could not see what a theme looks like before choosing it or discover
/// that four exist. This dialog makes the catalogue visible and marks the
/// active entry; `Enter` applies the highlighted one, `Esc` closes without a
/// write.
///
/// It returns the chosen id, or null when the user backs out. Nothing is stored
/// here: the Settings page owns the write, so a refusal keeps the old theme.
class ThemePickerDialog extends StatefulWidget {
  const ThemePickerDialog({
    super.key,
    required this.current,
    this.customTokens = const {},
    this.overrideTokens = const {},
  });

  /// The stored `ui.theme`, so the active entry can be marked.
  final String current;

  /// The stored custom-palette overrides, so the Custom entry previews what the
  /// user would actually get rather than plain crimson.
  final Map<String, String> customTokens;

  /// The per-token overrides that layer on top of **every** base palette.
  ///
  /// A preview that ignored them would not be the theme the user gets, so each
  /// row is drawn with the overrides applied.
  final Map<String, String> overrideTokens;

  @override
  State<ThemePickerDialog> createState() => _ThemePickerDialogState();
}

class _ThemePickerDialogState extends State<ThemePickerDialog> {
  late final List<String> _ids = [...lockedInThemeIds, 'custom'];
  late int _selected = _startIndex();

  int _startIndex() {
    final at = _ids.indexOf(widget.current.trim());
    return at < 0 ? 0 : at;
  }

  LockedInPalette _palette(String id) => id == 'custom'
      ? customPalette(
          widget.customTokens.isEmpty
              ? widget.overrideTokens
              : widget.customTokens,
        )
      : paletteWithOverrides(
          lockedInPalettes[id] ?? lockedInCrimson,
          widget.overrideTokens,
        );

  String _label(String id) =>
      id == 'custom' ? 'Custom palette' : paletteLabel(id);

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare `j`/`k` here must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      Navigator.of(context).pop();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      setState(() => _selected = (_selected + 1) % _ids.length);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      setState(() => _selected = (_selected - 1 + _ids.length) % _ids.length);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space) {
      Navigator.of(context).pop(_ids[_selected]);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _choose(int index) {
    setState(() => _selected = index);
    Navigator.of(context).pop(_ids[index]);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Dialog(
        backgroundColor: LockedInColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.layer),
          side: BorderSide(color: LockedInColors.line),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Theme', style: theme.textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(
                  'Enter applies · Esc closes',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
                const SizedBox(height: 12),
                for (var index = 0; index < _ids.length; index++)
                  _ThemeOption(
                    id: _ids[index],
                    label: _label(_ids[index]),
                    palette: _palette(_ids[index]),
                    selected: index == _selected,
                    current: _ids[index] == widget.current.trim(),
                    onTap: () => _choose(index),
                  ),
                const SizedBox(height: 8),
                Text(
                  widget.overrideTokens.isEmpty
                      ? 'The custom palette is edited in Settings with e; '
                            'twelve tokens, crimson filling any gap.'
                      : '${widget.overrideTokens.length} colour override'
                            '${widget.overrideTokens.length == 1 ? '' : 's'} apply '
                            'on top of every palette. Edit with e, export with x.',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One theme row: the palette's own colours, its name, and whether it is on.
class _ThemeOption extends StatelessWidget {
  const _ThemeOption({
    required this.id,
    required this.label,
    required this.palette,
    required this.selected,
    required this.current,
    required this.onTap,
  });

  final String id;
  final String label;
  final LockedInPalette palette;
  final bool selected;
  final bool current;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.layer),
        child: InkWell(
          key: ValueKey('theme-option-$id'),
          borderRadius: BorderRadius.circular(Radii.layer),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(
                color: selected ? LockedInColors.primary : Colors.transparent,
              ),
            ),
            child: Row(
              children: [
                _Swatch(palette: palette),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    label,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: selected
                          ? LockedInColors.foreground
                          : LockedInColors.muted,
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                ),
                if (current) ...[
                  Icon(Icons.check, size: 16, color: LockedInColors.primary),
                  const SizedBox(width: 6),
                  Text(
                    'in use',
                    style: TextStyle(
                      color: LockedInColors.primary,
                      fontSize: TypeScale.label,
                    ),
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

/// Three stacked bars in the palette's own background, primary and foreground:
/// enough to tell the themes apart without a second set of tokens.
class _Swatch extends StatelessWidget {
  const _Swatch({required this.palette});

  final LockedInPalette palette;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 26,
      decoration: BoxDecoration(
        color: palette.background,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: palette.line),
      ),
      padding: const EdgeInsets.all(4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(height: 5, color: palette.primary),
          const SizedBox(height: 3),
          Container(height: 5, color: palette.foreground),
        ],
      ),
    );
  }
}
