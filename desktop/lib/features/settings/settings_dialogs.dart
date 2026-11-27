import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/errors.dart';
import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

class CustomPaletteDialog extends StatefulWidget {
  const CustomPaletteDialog({
    super.key,
    required this.initial,
    required this.onSave,
  });

  final Map<String, String> initial;
  final Future<ThemeTokens> Function(Map<String, String> tokens) onSave;

  @override
  State<CustomPaletteDialog> createState() => CustomPaletteDialogState();
}

class CustomPaletteDialogState extends State<CustomPaletteDialog> {
  late final Map<String, String> _overrides = <String, String>{
    ...widget.initial,
  };
  final _hex = TextEditingController();
  final _scroll = ScrollController();
  int _selected = 0;
  bool _editing = false;
  bool _saving = false;
  String? _error;

  String get _token => customThemeTokenNames[_selected];

  @override
  void dispose() {
    _hex.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _move(int delta) {
    if (_editing) return;
    final next = (_selected + delta).clamp(0, customThemeTokenNames.length - 1);
    if (next == _selected) return;
    setState(() {
      _selected = next;
      _error = null;
    });
  }

  void _beginEdit() {
    setState(() {
      _editing = true;
      _error = null;
      _hex.text = customTokenHex(_token, _overrides);
      _hex.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _hex.text.length,
      );
    });
  }

  void _commitEdit() {
    final text = _hex.text.trim();
    if (!isHexColour(text)) {
      setState(() => _error = 'use #RRGGBB, for example #0D0F11');
      return;
    }
    final colour = parseHexColour(text)!;
    setState(() {
      _overrides[_token] = hexOfColour(colour);
      _editing = false;
      _error = null;
    });
  }

  void _resetOne() {
    if (_overrides.remove(_token) == null) return;
    setState(() => _error = null);
  }

  void _resetAll() {
    if (_overrides.isEmpty) return;
    setState(() {
      _overrides.clear();
      _error = null;
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = await widget.onSave({..._overrides});
      if (!mounted) return;
      Navigator.of(context).pop(saved.values);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _error = userMessage(failure));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (_editing) {
      // The field owns typing; `Esc` backs out to the list and Enter commits
      // through `onSubmitted` (or here, when the field does not consume it).
      if (key == LogicalKeyboardKey.escape) {
        setState(() {
          _editing = false;
          _error = null;
        });
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter) {
        _commitEdit();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.escape) {
      Navigator.of(context).maybePop();
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
      _beginEdit();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR) {
      if (HardwareKeyboard.instance.isShiftPressed) {
        _resetAll();
      } else {
        _resetOne();
      }
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS) {
      unawaited(_save());
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Dialog(
        backgroundColor: LockedInColors.surface,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 560),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Text(
                      'custom palette',
                      style: TextStyle(
                        color: LockedInColors.foreground,
                        fontSize: TypeScale.prose,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '${_overrides.length} of '
                      '${customThemeTokenNames.length} set',
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                _PalettePreview(overrides: _overrides),
                const SizedBox(height: 8),
                Flexible(
                  child: Scrollbar(
                    controller: _scroll,
                    child: ListView.builder(
                      controller: _scroll,
                      shrinkWrap: true,
                      itemCount: customThemeTokenNames.length,
                      itemBuilder: (context, index) => _tokenRow(index),
                    ),
                  ),
                ),
                if (_editing) ...[
                  const SizedBox(height: 8),
                  TextField(
                    key: const ValueKey('custom-palette-hex-field'),
                    controller: _hex,
                    autofocus: true,
                    style: TextStyle(color: LockedInColors.foreground),
                    decoration: InputDecoration(
                      labelText: '$_token · #RRGGBB',
                      hintText: '#0D0F11',
                    ),
                    onSubmitted: (_) => _commitEdit(),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    _error!,
                    key: const ValueKey('custom-palette-error'),
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: TypeScale.label,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'j/k move · Enter edit · r reset · R reset all · s save · '
                        'Esc back',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: TypeScale.label,
                          height: 1.4,
                        ),
                      ),
                    ),
                    TextButton(
                      key: const ValueKey('custom-palette-reset-all'),
                      onPressed: _resetAll,
                      child: const Text('reset all'),
                    ),
                    const SizedBox(width: 6),
                    OutlinedButton(
                      key: const ValueKey('custom-palette-cancel'),
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('cancel'),
                    ),
                    const SizedBox(width: 6),
                    FilledButton(
                      key: const ValueKey('custom-palette-save'),
                      onPressed: () => unawaited(_save()),
                      child: const Text('save'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _tokenRow(int index) {
    final name = customThemeTokenNames[index];
    final selected = index == _selected;
    final overridden = _overrides.containsKey(name);
    final swatch = parseHexColour(_overrides[name]) ?? crimsonToken(name);
    return GestureDetector(
      key: ValueKey('custom-token-$name'),
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() {
        _selected = index;
        _editing = false;
        _error = null;
      }),
      onDoubleTap: () {
        setState(() => _selected = index);
        _beginEdit();
      },
      child: Container(
        padding: const EdgeInsets.fromLTRB(4, 6, 6, 6),
        color: selected ? LockedInColors.panel : Colors.transparent,
        child: Row(
          children: [
            Container(
              width: 3,
              height: 14,
              color: selected ? LockedInColors.primary : Colors.transparent,
            ),
            const SizedBox(width: 8),
            Container(
              key: ValueKey('custom-swatch-$name'),
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                color: swatch,
                border: Border.all(color: LockedInColors.line),
                borderRadius: BorderRadius.circular(Radii.control),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                name,
                style: TextStyle(
                  color: selected
                      ? LockedInColors.foreground
                      : LockedInColors.secondary,
                  fontSize: TypeScale.label,
                ),
              ),
            ),
            Text(
              customTokenHex(name, _overrides),
              key: ValueKey('custom-hex-$name'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 10),
            Text(
              overridden ? 'custom' : 'crimson',
              style: TextStyle(
                color: overridden
                    ? LockedInColors.accent
                    : LockedInColors.muted,
                fontSize: TypeScale.micro,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The live preview: the effective background, foreground and primary.
///
/// Each swatch prints its token name and hex, so the strip is legible without
/// relying on the colour alone.
class _PalettePreview extends StatelessWidget {
  const _PalettePreview({required this.overrides});

  final Map<String, String> overrides;

  @override
  Widget build(BuildContext context) {
    Color token(String name) =>
        parseHexColour(overrides[name]) ??
        crimsonToken(name) ??
        LockedInColors.foreground;
    final background = token('background');
    final foreground = token('foreground');
    final primary = token('primary');
    return Container(
      key: const ValueKey('custom-palette-preview'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: background,
        border: Border.all(color: token('line')),
        borderRadius: BorderRadius.circular(Radii.control),
      ),
      child: Row(
        children: [
          Text(
            'Aa',
            style: TextStyle(
              color: foreground,
              fontSize: TypeScale.title,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'live preview',
              style: TextStyle(color: foreground, fontSize: TypeScale.label),
            ),
          ),
          _PreviewChip(token: 'primary', colour: primary),
          const SizedBox(width: 6),
          _PreviewChip(token: 'background', colour: background),
        ],
      ),
    );
  }
}

class _PreviewChip extends StatelessWidget {
  const _PreviewChip({required this.token, required this.colour});

  final String token;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          key: ValueKey('custom-preview-$token'),
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: colour,
            border: Border.all(color: LockedInColors.muted),
            borderRadius: BorderRadius.circular(Radii.control),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          token,
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.micro,
          ),
        ),
      ],
    );
  }
}

/// One validated theme document: the overrides and, optionally, a base palette.
class ImportedTheme {
  const ImportedTheme({required this.tokens, this.base});
  final Map<String, String> tokens;
  final String? base;
}

/// Paste-or-edit a theme JSON document, validate it, then close.
///
/// Validation happens in the dialog so a typo does not close the only place the
/// text exists. The clipboard is prefilled because that is how a theme arrives
/// from another machine or a note.
class ThemeJsonDialog extends StatefulWidget {
  const ThemeJsonDialog({super.key});

  @override
  State<ThemeJsonDialog> createState() => ThemeJsonDialogState();
}

class ThemeJsonDialogState extends State<ThemeJsonDialog> {
  final _input = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_prefill());
  }

  Future<void> _prefill() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (!mounted || _input.text.isNotEmpty) return;
    final text = data?.text?.trim() ?? '';
    if (text.startsWith('{')) {
      _input.text = text;
      setState(() {});
    }
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _import() {
    final result = parseThemeDocument(_input.text);
    if (result.error != null) {
      setState(() => _error = result.error);
      return;
    }
    Navigator.of(context)
        .pop(ImportedTheme(tokens: result.tokens, base: result.base));
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: LockedInColors.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Import theme',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'Paste a theme document. Unknown tokens and non-hex values are '
                'refused before anything is stored.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const ValueKey('theme-json-input'),
                controller: _input,
                minLines: 8,
                maxLines: 14,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontFamily: 'JetBrainsMono',
                  fontSize: TypeScale.label,
                ),
                decoration: const InputDecoration(
                  hintText: '{"base":"lockedin","tokens":{"panel":"#161A20"}}',
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 6),
                Text(
                  _error!,
                  key: const ValueKey('theme-json-error'),
                  style: TextStyle(
                    color: LockedInColors.error,
                    fontSize: TypeScale.label,
                  ),
                ),
              ],
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('cancel'),
                  ),
                  const SizedBox(width: 6),
                  FilledButton(
                    key: const ValueKey('theme-json-import'),
                    onPressed: _import,
                    child: const Text('import'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Edit one prompt note.
///
/// The note is appended below the generator's own contract. The dialog says that
/// plainly, so the user never expects it to replace the shape or the limits.
class PromptNoteDialog extends StatefulWidget {
  const PromptNoteDialog({super.key, required this.prompt});

  final PromptNoteView prompt;

  @override
  State<PromptNoteDialog> createState() => PromptNoteDialogState();
}

class PromptNoteDialogState extends State<PromptNoteDialog> {
  late final TextEditingController _note = TextEditingController(
    text: widget.prompt.note,
  );

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: LockedInColors.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Prompt note · ${widget.prompt.label}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                '${widget.prompt.description} The note is guidance. The reply '
                'shape, its length limits and the safety rules still apply.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const ValueKey('prompt-note-input'),
                controller: _note,
                minLines: 6,
                maxLines: 12,
                maxLength: 2000,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: TypeScale.key,
                  height: 1.45,
                ),
                decoration: const InputDecoration(
                  hintText:
                      'e.g. prefer short sentences and one concrete example',
                ),
              ),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('cancel'),
                  ),
                  const SizedBox(width: 6),
                  FilledButton(
                    key: const ValueKey('prompt-note-save'),
                    onPressed: () => Navigator.of(context).pop(_note.text),
                    child: const Text('save'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The add/edit form for one MCP server.
///
/// `args` is one argument per line, so an argument containing spaces survives.
/// The name is fixed while editing: a rename is a remove plus an add, because
/// the name is the config table key and every policy cell refers to it.
class McpServerDialog extends StatefulWidget {
  const McpServerDialog({super.key, this.initial, required this.onSave});

  /// Null adds a server; non-null edits that stored definition.
  final McpServerDefinition? initial;

  final Future<void> Function(
    String name,
    String command,
    List<String> args,
    bool enabled,
  )
  onSave;

  @override
  State<McpServerDialog> createState() => _McpServerDialogState();
}

class _McpServerDialogState extends State<McpServerDialog> {
  late final TextEditingController _name = TextEditingController(
    text: widget.initial?.name ?? '',
  );
  late final TextEditingController _command = TextEditingController(
    text: widget.initial?.command ?? '',
  );
  late final TextEditingController _args = TextEditingController(
    text: (widget.initial?.args ?? const <String>[]).join('\n'),
  );
  late bool _enabled = widget.initial?.enabled ?? true;
  var _busy = false;
  String? _error;

  bool get _editing => widget.initial != null;

  @override
  void dispose() {
    _name.dispose();
    _command.dispose();
    _args.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    final name = _name.text.trim();
    final command = _command.text.trim();
    if (!_editing && !RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]*$').hasMatch(name)) {
      setState(
        () => _error = 'use letters, digits, dot, dash or underscore; start with a letter or digit',
      );
      return;
    }
    if (command.isEmpty) {
      setState(() => _error = 'the command that starts the server is required');
      return;
    }
    final args = [
      for (final line in _args.text.split('\n'))
        if (line.trim().isNotEmpty) line.trimRight(),
    ];
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSave(name, command, args, _enabled);
      if (mounted) Navigator.of(context).pop();
    } catch (failure) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = userMessage(failure);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_editing ? 'edit MCP server' : 'add MCP server'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                key: const ValueKey('mcp-server-name'),
                controller: _name,
                enabled: !_editing && !_busy,
                decoration: const InputDecoration(
                  hintText: 'name (the config table key)',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('mcp-server-command'),
                controller: _command,
                enabled: !_busy,
                decoration: const InputDecoration(
                  hintText: 'command, for example mcp-filesystem',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('mcp-server-args'),
                controller: _args,
                enabled: !_busy,
                minLines: 2,
                maxLines: 5,
                decoration: const InputDecoration(
                  hintText: 'arguments, one per line',
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'enabled',
                      style: LockedInType.label.copyWith(
                        color: LockedInColors.foreground,
                      ),
                    ),
                  ),
                  Switch(
                    key: const ValueKey('mcp-server-enabled'),
                    value: _enabled,
                    onChanged: _busy
                        ? null
                        : (value) => setState(() => _enabled = value),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  key: const ValueKey('mcp-server-error'),
                  style: LockedInType.label.copyWith(
                    color: LockedInColors.error,
                  ),
                ),
              ],
              const SizedBox(height: 6),
              Text(
                'servers are stdio only; config.toml never stores a credential',
                style: LockedInType.micro.copyWith(color: LockedInColors.muted),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          key: const ValueKey('mcp-server-cancel'),
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const ValueKey('mcp-server-save'),
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'saving…' : 'Save'),
        ),
      ],
    );
  }
}
