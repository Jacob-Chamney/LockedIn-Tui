import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';
import 'attachments.dart';
import 'markdown.dart';

/// Returns the image paths the user chose, or an empty list when they
/// cancelled. The paths are files the **user picked**, never destinations.
typedef AttachmentPicker = Future<List<String>> Function();

/// Sends one turn with the attached image paths (`chat.send {text, images}`).
///
/// The callback throws on failure so the page can keep the chips and show one
/// readable reason instead of clearing work the core never accepted.
typedef ImageSend = Future<void> Function(String text, List<String> images);

/// Chill chat over the core's `chat.*` protocol.
///
/// The shell owns the store and passes the latest snapshot in. This page never
/// invents a message: a send is an intent, and the transcript grows only when
/// the core emits `chat.state`.
class ChatPage extends StatefulWidget {
  const ChatPage({
    super.key,
    this.chat,
    this.online = false,
    this.configured = false,
    this.onSend,
    this.onSendImages,
    this.pickFiles,
    this.onCancel,
    this.onRetry,
    this.error,
    this.onModeChanged,
    this.initialText,
    this.onDraftChanged,
  });

  final ChatSnapshot? chat;
  final bool online;
  final bool configured;

  /// A text-only turn. Kept separate from [onSendImages] so existing shell and
  /// test call sites stay a plain `ValueChanged<String>`.
  final ValueChanged<String>? onSend;

  /// A turn with images attached, forwarded to `chat.send {text, images}`.
  ///
  /// Null means the shell has not wired image sends yet: the page then refuses
  /// locally instead of silently dropping the chips.
  final ImageSend? onSendImages;

  /// Test seam: a scripted picker. Production leaves it null and the platform
  /// image dialog is used.
  final AttachmentPicker? pickFiles;

  final VoidCallback? onCancel;
  final VoidCallback? onRetry;
  final String? error;
  final ValueChanged<bool>? onModeChanged;

  /// The draft the shell kept when this page was last left. Switching surfaces
  /// disposes the page, so the composer's text is owned above it: losing a
  /// draft is the one thing a chat-first app must never do.
  final String? initialText;

  /// Reports every keystroke of the draft to the shell, which keeps it until
  /// the next visit or a successful send.
  final ValueChanged<String>? onDraftChanged;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _composer = TextEditingController();
  final _composerFocus = FocusNode();
  final _scroll = ScrollController();

  /// Chips above the composer: shell-local UI state, never persisted and never
  /// read from disk. The paths are what the core receives on send.
  final _attachments = <ChatAttachment>[];

  /// One local refusal or failure message (a fifth image, a picker error, an
  /// image send the shell has not wired). Never replaces the core's own state.
  String? _notice;

  /// True while an image send is in flight, so a turn is never claimed twice.
  var _sending = false;

  @override
  void initState() {
    super.initState();
    _composerFocus.onKeyEvent = _handleComposerKey;
    _composerFocus.addListener(_reportMode);
    final draft = widget.initialText;
    if (draft != null && draft.isNotEmpty) {
      _composer.text = draft;
      _composer.selection = TextSelection.collapsed(offset: draft.length);
    }
    _composer.addListener(_reportDraft);
  }

  void _reportMode() {
    widget.onModeChanged?.call(_composerFocus.hasFocus);
  }

  void _reportDraft() {
    widget.onDraftChanged?.call(_composer.text);
  }

  KeyEventResult _handleComposerKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final enter =
        event.logicalKey == LogicalKeyboardKey.enter ||
        event.logicalKey == LogicalKeyboardKey.numpadEnter;
    if (!enter || HardwareKeyboard.instance.isShiftPressed) {
      return KeyEventResult.ignored;
    }
    _send();
    return KeyEventResult.handled;
  }

  @override
  void didUpdateWidget(ChatPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final before = oldWidget.chat?.messages.length ?? 0;
    final after = widget.chat?.messages.length ?? 0;
    if (after > before) _scrollToBottom();
  }

  @override
  void dispose() {
    _composer.removeListener(_reportDraft);
    _composerFocus.removeListener(_reportMode);
    _composerFocus.dispose();
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  void _send() {
    if (_sending) return;
    final text = _composer.text.trim();
    final images = [for (final attachment in _attachments) attachment.path];

    if (images.isEmpty) {
      if (text.isEmpty || widget.onSend == null) return;
      widget.onSend!(text);
      _composer.clear();
      if (_notice != null) setState(() => _notice = null);
      return;
    }

    // With chips attached the turn carries them. An image-only turn is valid
    // (`chat.send` allows empty text when at least one image is attached), but
    // it is an intent the shell must be able to forward: never drop the chips.
    final send = widget.onSendImages;
    if (send == null) {
      setState(
        () =>
            _notice = 'image attach is not connected to the core in this build',
      );
      return;
    }
    final chat = widget.chat;
    final streaming = chat?.streaming ?? false;
    if (!widget.online ||
        !widget.configured ||
        streaming ||
        chat?.blocked != null) {
      return;
    }
    setState(() {
      _sending = true;
      _notice = null;
    });
    unawaited(_sendWithImages(send, text, images));
  }

  Future<void> _sendWithImages(
    ImageSend send,
    String text,
    List<String> images,
  ) async {
    try {
      await send(text, images);
      if (!mounted) return;
      setState(() {
        _sending = false;
        _attachments.clear();
      });
      _composer.clear();
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _notice = _reason(failure);
      });
    }
  }

  /// The default picker opens the platform image dialog and returns absolute
  /// paths only. A build with no dialog (a headless run, or a widget test that
  /// did not inject [ChatPage.pickFiles]) falls back to a typed path dialog, so
  /// the action is never dead and the shell still never opens a file.
  Future<List<String>> _defaultPickFiles() async {
    try {
      final files = await openFiles(
        acceptedTypeGroups: const [
          XTypeGroup(
            label: 'images',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
          ),
        ],
      );
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
    } on PlatformException {
      if (!mounted) return const [];
      return _askForPaths();
    }
  }

  Future<List<String>> _askForPaths() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('attach an image path'),
        content: SizedBox(
          width: 480,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'This build has no native file dialog. Paste the absolute path '
                'of an image you want this turn to carry; the core reads it and '
                'the file is never copied or stored.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('chat-image-path-field'),
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: '/home/you/Pictures/diagram.png',
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
            key: const ValueKey('chat-image-path-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Attach'),
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

  /// Ask for images and attach what still fits. A fifth image is refused with
  /// one visible message; nothing is dropped silently.
  Future<void> _pick() async {
    if (_sending) return;
    final pick = widget.pickFiles ?? _defaultPickFiles;

    final List<String> paths;
    try {
      paths = await pick();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _notice = _reason(failure));
      return;
    }
    if (!mounted || paths.isEmpty) return;

    var refused = false;
    final next = [..._attachments];
    for (final path in paths) {
      final trimmed = path.trim();
      if (trimmed.isEmpty) continue;
      if (next.length >= maxChatImages) {
        refused = true;
        continue;
      }
      if (next.any((attachment) => attachment.path == trimmed)) continue;
      next.add(ChatAttachment(path: trimmed));
    }
    setState(() {
      _attachments
        ..clear()
        ..addAll(next);
      _notice = refused
          ? 'four images max · remove one to attach another'
          : null;
    });
  }

  void _removeAttachment(int index) {
    if (index < 0 || index >= _attachments.length) return;
    setState(() {
      _attachments.removeAt(index);
      _notice = null;
    });
  }

  /// `Ctrl+Shift+X` (`docs/design.md` §4.2): clear every chip at once.
  void _clearAttachments() {
    if (_attachments.isEmpty) return;
    setState(() {
      _attachments.clear();
      _notice = null;
    });
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

  /// Page-level keys, the same shape every other surface uses: the composer
  /// keeps its own typing, and `p` only attaches in NORMAL mode.
  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final keyboard = HardwareKeyboard.instance;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.keyX &&
        keyboard.isControlPressed &&
        keyboard.isShiftPressed) {
      if (_attachments.isEmpty) return KeyEventResult.ignored;
      _clearAttachments();
      return KeyEventResult.handled;
    }
    // `Esc` stops a reply first, from either mode: the composer keeps focus
    // while a turn streams, and cancelling must not need a mode change
    // (docs/product.md §3: "Esc during a reply cancels it").
    if (key == LogicalKeyboardKey.escape && widget.onCancel != null) {
      final streaming = widget.chat?.streaming ?? false;
      if (streaming) {
        if (event is KeyDownEvent) widget.onCancel!();
        return KeyEventResult.handled;
      }
    }
    if (_composerFocus.hasFocus) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.keyP) {
      if (_sending) return KeyEventResult.handled;
      unawaited(_pick());
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chat = widget.chat;
    final streaming = chat?.streaming ?? false;
    final canSend =
        widget.online &&
        widget.configured &&
        !streaming &&
        chat?.blocked == null;

    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Column(
        children: [
          Container(
            height: 46,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: LockedInColors.line)),
            ),
            child: Row(
              children: [
                Text('Chill', style: theme.textTheme.titleMedium),
                const SizedBox(width: 10),
                Text(
                  widget.configured
                      ? 'read-only · ${chat?.model ?? 'model'}'
                      : 'read-only · no model',
                  style: TextStyle(color: LockedInColors.muted, fontSize: 12),
                ),
                const Spacer(),
                _BridgeChip(
                  online: widget.online,
                  configured: widget.configured,
                  streaming: streaming,
                ),
              ],
            ),
          ),
          Expanded(child: _body(chat)),
          _composerBox(canSend, streaming),
        ],
      ),
    );
  }

  Widget _body(ChatSnapshot? chat) {
    if (!widget.online) {
      return _Centered(
        title: 'core offline',
        body:
            widget.error ?? 'The Bun core is not running. Start it and retry.',
        action: widget.onRetry == null
            ? null
            : FilledButton(
                onPressed: widget.onRetry,
                child: const Text('Retry'),
              ),
      );
    }
    if (chat == null) {
      return const _Centered(
        title: 'chat unavailable',
        body: 'The core has not returned a chat snapshot yet.',
      );
    }
    if (chat.error != null) {
      return _Centered(
        title: 'the last turn failed',
        body: [
          chat.error!.failed,
          if (chat.error!.kept.isNotEmpty) chat.error!.kept,
          if (chat.error!.next.isNotEmpty) chat.error!.next,
        ].join('\n'),
        action: widget.onRetry == null
            ? null
            : FilledButton(
                onPressed: widget.onRetry,
                child: const Text('Retry'),
              ),
      );
    }

    final messages = chat.messages;
    if (messages.isEmpty && !chat.streaming) {
      return _Centered(
        title: 'Chill',
        body: 'Ask anything. This chat is read-only and keeps no vault access.',
        action: widget.configured
            ? null
            : Text(
                'link a model in Settings → Providers',
                style: TextStyle(color: LockedInColors.warning, fontSize: 12),
              ),
      );
    }

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 780),
        child: ListView.builder(
          controller: _scroll,
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
          itemCount: messages.length,
          itemBuilder: (context, index) {
            final message = messages[index];
            final last = index == messages.length - 1;
            final text =
                message.text.isEmpty && last && chat.streamed.isNotEmpty
                ? chat.streamed
                : message.text;
            return _MessageBubble(
              role: message.role,
              text: text,
              streaming: last && chat.streaming,
              failed: message.outcome == 'failed' || message.outcome == 'error',
              cancelled:
                  message.outcome == 'stopped' ||
                  message.outcome == 'cancelled',
            );
          },
        ),
      ),
    );
  }

  Widget _composerBox(bool canSend, bool streaming) {
    final blocked = widget.chat?.blocked;
    final hint = blocked != null
        ? '${blocked.reason} · ${blocked.fix}'
        : !widget.online
        ? 'core offline'
        : !widget.configured
        ? 'no model connected · link a key in Settings → Providers'
        : streaming
        ? 'streaming · Esc stops the reply'
        : 'Ask anything… · Enter send · Shift+Enter newline · p attach';
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 780),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_attachments.isNotEmpty) ...[
                _attachmentStrip(),
                const SizedBox(height: 8),
              ],
              if (_notice != null) ...[
                Text(
                  _notice!,
                  key: const ValueKey('chat-attach-notice'),
                  style: TextStyle(color: LockedInColors.warning, fontSize: 12),
                ),
                const SizedBox(height: 8),
              ],
              if (blocked != null || (!canSend && !streaming))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    hint,
                    style: TextStyle(
                      color: blocked != null
                          ? LockedInColors.warning
                          : LockedInColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      key: const ValueKey('chat-composer'),
                      controller: _composer,
                      focusNode: _composerFocus,
                      minLines: 1,
                      maxLines: 5,
                      decoration: InputDecoration(
                        hintText: canSend ? 'Ask anything…' : '',
                        prefixIcon: const Icon(
                          Icons.keyboard_command_key,
                          size: 16,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton(
                    key: const ValueKey('chat-attach'),
                    tooltip: 'attach image (p)',
                    onPressed: _sending ? null : _pick,
                    icon: const Icon(Icons.attach_file, size: 18),
                  ),
                  const SizedBox(width: 6),
                  if (streaming)
                    OutlinedButton.icon(
                      onPressed: widget.onCancel,
                      icon: const Icon(Icons.stop, size: 16),
                      label: const Text('Stop'),
                    )
                  else
                    FilledButton.icon(
                      onPressed: canSend && !_sending ? _send : null,
                      icon: const Icon(Icons.arrow_upward, size: 16),
                      label: const Text('Send'),
                    ),
                ],
              ),
              if (widget.chat != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '${_compact(widget.chat!.usage.tokens)} tok · '
                    '${widget.chat!.usage.costMicroUsd == null ? 'cost unknown' : '\$${(widget.chat!.usage.costMicroUsd! / 1000000).toStringAsFixed(4)}'}'
                    '${widget.chat!.usage.durationMs == null ? '' : ' · ${(widget.chat!.usage.durationMs! / 1000).toStringAsFixed(1)}s'}',
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// The chip row: one removable chip per image plus the clear-all hint.
  ///
  /// It is a [Wrap], so four chips reflow at 800×600 instead of overflowing the
  /// composer.
  Widget _attachmentStrip() {
    return Wrap(
      key: const ValueKey('chat-attachments'),
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (var index = 0; index < _attachments.length; index++)
          _attachmentChip(index),
        Text(
          'Ctrl+Shift+X clears',
          style: TextStyle(color: LockedInColors.muted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _attachmentChip(int index) {
    final attachment = _attachments[index];
    return Container(
      key: ValueKey('chat-attachment-$index'),
      padding: const EdgeInsets.fromLTRB(8, 2, 2, 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.image_outlined, size: 13, color: LockedInColors.muted),
          const SizedBox(width: 6),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 160),
            child: Text(
              attachment.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.foreground, fontSize: 11),
            ),
          ),
          IconButton(
            key: ValueKey('chat-attachment-remove-$index'),
            tooltip: 'remove ${attachment.name}',
            onPressed: () => _removeAttachment(index),
            icon: const Icon(Icons.close, size: 12),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints.tightFor(width: 22, height: 22),
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}

class _Centered extends StatelessWidget {
  const _Centered({required this.title, required this.body, this.action});

  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 13,
                height: 1.5,
              ),
            ),
            if (action != null) ...[const SizedBox(height: 16), action!],
          ],
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.role,
    required this.text,
    required this.streaming,
    required this.failed,
    required this.cancelled,
  });

  final String role;
  final String text;
  final bool streaming;
  final bool failed;
  final bool cancelled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = role == 'user';
    final border = failed
        ? LockedInColors.error
        : cancelled
        ? LockedInColors.warning
        : user
        ? LockedInColors.primary.withValues(alpha: 0.35)
        : LockedInColors.line;
    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 620),
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.fromLTRB(14, 11, 14, 12),
        decoration: BoxDecoration(
          color: user
              ? LockedInColors.primary.withValues(alpha: 0.16)
              : LockedInColors.panel,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(10),
            topRight: const Radius.circular(10),
            bottomLeft: Radius.circular(user ? 10 : 2),
            bottomRight: Radius.circular(user ? 2 : 10),
          ),
          border: Border.all(color: border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              user ? 'YOU' : 'LOCKEDIN',
              style: theme.textTheme.labelSmall?.copyWith(
                color: user ? LockedInColors.primary : LockedInColors.secondary,
              ),
            ),
            const SizedBox(height: 5),
            if (text.isEmpty && streaming)
              Text('…', style: theme.textTheme.bodyMedium)
            else if (user)
              Text(text, style: theme.textTheme.bodyMedium)
            else
              ChatMarkdown(text: text, style: theme.textTheme.bodyMedium),
            if (streaming) ...[
              const SizedBox(height: 6),
              Text(
                'streaming…',
                style: TextStyle(color: LockedInColors.muted, fontSize: 11),
              ),
            ],
            if (failed) ...[
              const SizedBox(height: 6),
              Text(
                '× failed',
                style: TextStyle(color: LockedInColors.error, fontSize: 11),
              ),
            ],
            if (cancelled) ...[
              const SizedBox(height: 6),
              Text(
                '— stopped',
                style: TextStyle(color: LockedInColors.warning, fontSize: 11),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _BridgeChip extends StatelessWidget {
  const _BridgeChip({
    required this.online,
    required this.configured,
    required this.streaming,
  });

  final bool online;
  final bool configured;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final (label, color) = !online
        ? ('core offline', LockedInColors.muted)
        : streaming
        ? ('streaming', LockedInColors.primary)
        : configured
        ? ('core online', LockedInColors.success)
        : ('no model', LockedInColors.warning);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.circle, size: 7, color: color),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

String _compact(int value) {
  if (value >= 1000000) {
    return '${(value / 1000000).toStringAsFixed(1).replaceAll('.0', '')}M';
  }
  if (value >= 1000) {
    return '${(value / 1000).toStringAsFixed(1).replaceAll('.0', '')}K';
  }
  return '$value';
}
