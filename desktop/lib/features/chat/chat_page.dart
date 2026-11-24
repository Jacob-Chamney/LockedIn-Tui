import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../../shell/chrome.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'attachments.dart';
import 'chat_failure.dart';
import 'usage_text.dart';
import 'markdown.dart';
import 'transcript_scroll.dart';
import '../keys.dart';

/// Returns the image paths the user chose, or an empty list when they
/// cancelled. The paths are files the **user picked**, never destinations.
typedef AttachmentPicker = Future<List<String>> Function();

/// Sends one turn with the attached image paths (`chat.send {text, images}`).
///
/// The callback throws on failure so the page can keep the chips and show one
/// readable reason instead of clearing work the core never accepted.
typedef ImageSend = Future<bool> Function(String text, List<String> images);

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
    this.sendError,
    this.connecting = false,
    this.pickFiles,
    this.onCancel,
    this.onRetry,
    this.onReconnect,
    this.error,
    this.onModeChanged,
    this.initialText,
    this.onDraftChanged,
    this.onLinkModel,
  });

  final ChatSnapshot? chat;
  final bool online;
  final bool configured;

  /// A text-only turn. Kept separate from [onSendImages] so existing shell and
  /// test call sites stay a plain `ValueChanged<String>`.
  /// Send one text turn. **True means the core accepted it**, and only then
  /// does the composer clear: a refused send used to lose the text and say
  /// nothing, because `sendChat` swallowed the refusal into the global error.
  final Future<bool> Function(String text)? onSend;

  /// A turn with images attached, forwarded to `chat.send {text, images}`.
  ///
  /// Null means the shell has not wired image sends yet: the page then refuses
  /// locally instead of silently dropping the chips.
  final ImageSend? onSendImages;

  /// The last `chat.send` refusal, shown in the banner above the composer.
  final String? sendError;

  /// True while the core is starting. A normal launch used to render as
  /// "core offline", the same card as a crash, with a Retry that raced the
  /// start.
  final bool connecting;

  /// Test seam: a scripted picker. Production leaves it null and the platform
  /// image dialog is used.
  final AttachmentPicker? pickFiles;

  final VoidCallback? onCancel;

  /// Re-read the transcript after a failed turn.
  final VoidCallback? onRetry;

  /// Restart the core. Only the `core offline` card offers this.
  final VoidCallback? onReconnect;
  final String? error;
  final ValueChanged<bool>? onModeChanged;

  /// The draft the shell kept when this page was last left. Switching surfaces
  /// disposes the page, so the composer's text is owned above it: losing a
  /// draft is the one thing a chat-first app must never do.
  final String? initialText;

  /// Reports every keystroke of the draft to the shell, which keeps it until
  /// the next visit or a successful send.
  final ValueChanged<String>? onDraftChanged;

  /// Opens Settings → Providers. The "link a model" copy is a link, not dead
  /// text: it names the fix and it is the fix.
  final VoidCallback? onLinkModel;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _composer = TextEditingController();
  final _composerFocus = FocusNode();

  /// The page's own node: where the keyboard rests in NORMAL mode. `Esc` in
  /// the composer moves here, so leaving INSERT never needs a pointer.
  final _pageFocus = FocusNode(debugLabel: 'chill');
  final _scroll = ScrollController();

  /// Chips above the composer: shell-local UI state, never persisted and never
  /// read from disk. The paths are what the core receives on send.
  final _attachments = <ChatAttachment>[];

  /// One local refusal or failure message (a fifth image, a picker error, an
  /// image send the shell has not wired). Never replaces the core's own state.
  String? _notice;

  /// True while an image send is in flight, so a turn is never claimed twice.
  var _sending = false;

  /// True while the platform image picker is open, so a held `p` cannot open
  /// several.
  var _picking = false;

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
    final before = oldWidget.chat;
    final after = widget.chat;
    // A new message always comes into view; a growing reply is only followed
    // while the reader is already at the bottom (`docs/design.md` §4.3).
    final added =
        (after?.messages.length ?? 0) > (before?.messages.length ?? 0);
    final grew = (after?.streamed.length ?? 0) > (before?.streamed.length ?? 0);
    if (added || (grew && nearBottom(_scroll))) scrollToEnd(_scroll);
  }

  @override
  void dispose() {
    _composer.removeListener(_reportDraft);
    _composerFocus.removeListener(_reportMode);
    _composerFocus.dispose();
    _pageFocus.dispose();
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// The one rule for "may a turn be sent now", shared by Enter and the button.
  bool get _canSend {
    final chat = widget.chat;
    return widget.online &&
        widget.configured &&
        !(chat?.streaming ?? false) &&
        chat?.blocked == null;
  }

  Future<void> _send() async {
    if (_sending) return;
    final text = _composer.text.trim();
    final images = [for (final attachment in _attachments) attachment.path];
    // Enter used to skip the checks the Send button applies: with no model, or
    // mid-reply, it sent anyway and cleared the draft the core then refused.
    // The text stays put; the line above the composer already says why.
    if (!_canSend) return;

    if (images.isEmpty) {
      final send = widget.onSend;
      if (text.isEmpty || send == null) return;
      final accepted = await send(text);
      if (!mounted) return;
      // A refusal keeps the text: the core did not take the turn, and the
      // banner above the composer says why.
      if (!accepted) return;
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
      final accepted = await send(text, images);
      if (!mounted) return;
      setState(() {
        _sending = false;
        if (accepted) _attachments.clear();
      });
      if (accepted) _composer.clear();
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _notice = userMessage(failure);
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
    if (_sending || _picking) return;
    _picking = true;
    try {
      final pick = widget.pickFiles ?? _defaultPickFiles;

      final List<String> paths;
      try {
        paths = await pick();
      } catch (failure) {
        if (!mounted) return;
        setState(() => _notice = userMessage(failure));
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
    } finally {
      _picking = false;
    }
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
    if (_composerFocus.hasFocus) {
      // `Esc` leaves INSERT. The composer keeps its text; the keyboard moves to
      // the page so the leader, `?`, `:` and the scroll keys work again.
      if (key == LogicalKeyboardKey.escape) {
        _pageFocus.requestFocus();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if (modifierHeld) return KeyEventResult.ignored;
    // `i` is the terminal app's insert: back into the composer from NORMAL.
    if (key == LogicalKeyboardKey.keyI) {
      _composerFocus.requestFocus();
      return KeyEventResult.handled;
    }
    final scrolled = scrollKey(_scroll, event);
    if (scrolled != null) return scrolled;
    if (key == LogicalKeyboardKey.keyP) {
      if (event is! KeyDownEvent || _sending || _picking) {
        return KeyEventResult.handled;
      }
      unawaited(_pick());
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final chat = widget.chat;
    final streaming = chat?.streaming ?? false;
    final canSend = _canSend;

    return Focus(
      focusNode: _pageFocus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: Column(
        children: [
          // No in-page header. The top bar already carries the surface name and
          // the model badge, and the start block names Chill once: a third copy
          // of `Chill`, a fourth `no model` and a status chip said the same
          // thing four times in the first 120 px of a brand-new window.
          //
          // What a header *is* worth keeping is a state the top bar cannot show
          // while the core is not answering, because that is the one thing the
          // user must act on. It is one hairline row, only when it applies.
          if (!widget.online || widget.connecting)
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: Space.md,
                vertical: Space.xs,
              ),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: LockedInColors.line,
                    width: Stroke.hairline,
                  ),
                ),
              ),
              child: Row(
                children: [
                  _BridgeChip(
                    online: widget.online,
                    configured: widget.configured,
                    streaming: streaming,
                    connecting: widget.connecting,
                  ),
                ],
              ),
            ),
          Expanded(child: _body(chat)),
          if (chat?.error != null)
            ChatFailureBanner(
              failed: chat!.error!.failed,
              kept: chat.error!.kept,
              next: chat.error!.next,
              onRetry: widget.onRetry,
            )
          else if (widget.sendError != null && widget.sendError!.isNotEmpty)
            ChatFailureBanner(
              failed: widget.sendError!,
              kept: 'your message is still in the composer',
            ),
          _composerBox(canSend, streaming),
        ],
      ),
    );
  }

  /// The first screen: a start block, not a centred void.
  ///
  /// `desktop/docs/redesign.md` §4: the empty state is where a person decides
  /// what this thing is for. It opens at the top of the reading column with the
  /// three shapes of question Chill is good at, each one click from the
  /// composer — a 900 px blank page taught nothing.
  Widget _emptyState() {
    const examples = <(String, String)>[
      ('explain', 'explain how a hash table resizes'),
      ('compare', 'compare two ways to structure this argument'),
      ('quiz', 'quiz me on what I read this morning'),
    ];
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Chill',
                style: LockedInType.display.copyWith(
                  color: LockedInColors.foreground,
                  fontSize: 26,
                ),
              ),
              const SizedBox(height: Space.xs),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: Space.proseMeasure),
                child: Text(
                  'Ask anything. This chat is read-only: no vault, no tools, no '
                  'writes, and it keeps nothing but its own history.',
                  style: LockedInType.prose.copyWith(
                    color: LockedInColors.muted,
                    fontSize: 14.5,
                  ),
                ),
              ),
              const SizedBox(height: Space.lg),
              const Rule(),
              const SizedBox(height: Space.sm),
              Text(
                'TRY',
                style: LockedInType.micro.copyWith(
                  color: LockedInColors.muted,
                  letterSpacing: 1.4,
                ),
              ),
              const SizedBox(height: Space.xs),
              for (final (index, example) in examples.indexed)
                _ExampleRow(
                  key: ValueKey('chat-example-$index'),
                  kind: example.$1,
                  text: example.$2,
                  enabled: _canSend,
                  onTap: () {
                    _composer.text = example.$2;
                    _composer.selection = TextSelection.collapsed(
                      offset: example.$2.length,
                    );
                    _composerFocus.requestFocus();
                  },
                ),
              if (!widget.configured) ...[
                const SizedBox(height: Space.md),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: const ValueKey('chat-link-model'),
                    onPressed: widget.onLinkModel,
                    style: TextButton.styleFrom(
                      foregroundColor: LockedInColors.warning,
                      padding: const EdgeInsets.symmetric(
                        horizontal: Space.xs,
                        vertical: Space.xxs,
                      ),
                    ),
                    child: const Text(
                      'link a model in Settings → Providers',
                      style: TextStyle(fontSize: 12),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(ChatSnapshot? chat) {
    if (!widget.online && widget.connecting) {
      return const _Centered(
        title: 'connecting…',
        body: 'Starting the core and reading the workspace.',
      );
    }
    if (!widget.online) {
      return _Centered(
        title: 'core offline',
        body:
            widget.error ?? 'The Bun core is not running. Start it and retry.',
        action: widget.onReconnect == null
            ? null
            : FilledButton(
                onPressed: widget.onReconnect,
                child: const Text('Reconnect'),
              ),
      );
    }
    if (chat == null) {
      return _Centered(
        title: widget.connecting ? 'connecting…' : 'chat unavailable',
        body: widget.connecting
            ? 'Starting the core and reading the workspace.'
            : 'The core has not returned a chat snapshot yet.',
        action: widget.connecting || widget.onRetry == null
            ? null
            : FilledButton(
                onPressed: widget.onRetry,
                child: const Text('Retry'),
              ),
      );
    }

    final messages = chat.messages;
    if (messages.isEmpty && !chat.streaming) {
      return _emptyState();
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
        ? (widget.connecting ? 'connecting…' : 'core offline')
        : !widget.configured
        // The top bar's badge already says `! no model`; this line is the
        // action, so it does not repeat the diagnosis.
        ? 'link a key in Settings → Providers, then ask anything'
        : streaming
        ? 'streaming · Esc stops the reply'
        : 'Enter send · Shift+Enter newline · p attach · Esc normal';
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
              // Always one line: the keys that send, or the reason a send is
              // blocked. It used to appear only when sending was *not* possible,
              // so the line naming `Enter send` never showed in the one state
              // where the user wanted it.
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  hint,
                  key: const ValueKey('chat-composer-hint'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
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
                      cursorColor: LockedInColors.primary,
                      cursorWidth: Stroke.focus,
                      style: LockedInType.prose.copyWith(
                        color: LockedInColors.foreground,
                        fontSize: 14.5,
                      ),
                      decoration: InputDecoration(
                        // Always a placeholder: an empty field with no
                        // prompt reads as broken. The line above says why a
                        // send is blocked, and a draft is still worth typing.
                        hintText: streaming ? 'streaming…' : 'Ask anything…',
                        prefixIcon: Padding(
                          padding: const EdgeInsets.only(
                            left: Space.sm,
                            right: Space.xs,
                          ),
                          child: Text(
                            '❯',
                            style: LockedInType.key.copyWith(
                              color: _canSend
                                  ? LockedInColors.primary
                                  : LockedInColors.muted,
                              fontSize: 13,
                            ),
                          ),
                        ),
                        prefixIconConstraints: const BoxConstraints(
                          minWidth: 0,
                          minHeight: 0,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.xs),
                  // The attach control keeps `IconButton` (and its key): the
                  // pointer path and the size are its own, and a glyph reads
                  // the same at 18 px.
                  IconButton(
                    key: const ValueKey('chat-attach'),
                    tooltip: 'attach image (p)',
                    onPressed: _sending ? null : _pick,
                    icon: Text(
                      '⊕',
                      style: LockedInType.key.copyWith(
                        color: _sending
                            ? LockedInColors.muted
                            : LockedInColors.secondary,
                        fontSize: 16,
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.xxs),
                  if (streaming)
                    OutlinedButton(
                      onPressed: widget.onCancel,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: LockedInColors.warning,
                        side: BorderSide(
                          color: LockedInColors.warning.withValues(alpha: 0.5),
                          width: Stroke.hairline,
                        ),
                        shape: const RoundedRectangleBorder(
                          borderRadius: BorderRadius.all(
                            Radius.circular(Radii.control),
                          ),
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: Space.sm,
                          vertical: Space.xs + 2,
                        ),
                        textStyle: LockedInType.label,
                      ),
                      // The glyph and the word are separate Texts so the label
                      // stays exactly `Stop` for a test and a screen reader.
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('■'),
                          SizedBox(width: Space.xs - 2),
                          Text('Stop'),
                        ],
                      ),
                    )
                  else
                    FilledButton(
                      onPressed: canSend && !_sending ? _send : null,
                      style: FilledButton.styleFrom(
                        backgroundColor: LockedInColors.primary,
                        foregroundColor: Theme.of(context)
                            .colorScheme
                            .onPrimary,
                        disabledBackgroundColor: LockedInColors.panel,
                        disabledForegroundColor: LockedInColors.muted,
                        shape: const RoundedRectangleBorder(
                          borderRadius: BorderRadius.all(
                            Radius.circular(Radii.control),
                          ),
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: Space.sm,
                          vertical: Space.xs + 2,
                        ),
                        textStyle: LockedInType.label.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('↵'),
                          SizedBox(width: Space.xs - 2),
                          Text('Send'),
                        ],
                      ),
                    ),
                ],
              ),
              if (widget.chat != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      chatUsageLabel(widget.chat!.usage),
                      style: LockedInType.micro.copyWith(
                        color: LockedInColors.muted,
                        fontWeight: FontWeight.w500,
                        letterSpacing: 0,
                      ),
                    ),
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

/// One suggested question: a kind in the gutter, the question in prose.
///
/// A click fills the composer rather than sending, so the user can edit the
/// prompt before it costs a call.
class _ExampleRow extends StatelessWidget {
  const _ExampleRow({
    super.key,
    required this.kind,
    required this.text,
    required this.enabled,
    required this.onTap,
  });

  final String kind;
  final String text;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = enabled ? LockedInColors.foreground : LockedInColors.muted;
    return InkWell(
      onTap: enabled ? onTap : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Space.xs - 2),
        child: Row(
          children: [
            SizedBox(
              width: 64,
              child: Text(
                kind.toUpperCase(),
                style: LockedInType.micro.copyWith(
                  color: LockedInColors.secondary,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            Expanded(
              child: Text(
                text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: LockedInType.prose.copyWith(fontSize: 13.5, color: tone),
              ),
            ),
            const SizedBox(width: Space.xs),
            Text(
              '↵',
              style: LockedInType.micro.copyWith(color: LockedInColors.line),
            ),
          ],
        ),
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

/// One turn, as a gutter block rather than a chat bubble.
///
/// `desktop/docs/redesign.md` §3.1: chrome is hairline and square. A bubble is
/// a phone metaphor; a terminal transcript is a margin — the role in a fixed
/// gutter, the content in the reading column, one hairline between turns. The
/// state words (`× failed`, `— stopped`, `streaming…`) are unchanged, so a
/// result never depends on colour alone.
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
    final user = role == 'user';
    final tone = failed
        ? LockedInColors.error
        : cancelled
        ? LockedInColors.warning
        : user
        ? LockedInColors.primary
        : LockedInColors.secondary;
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The gutter: a role label, hanging in the margin, never wrapping.
          SizedBox(
            width: 72,
            child: Padding(
              padding: const EdgeInsets.only(top: 3, right: Space.xs),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    user ? 'you' : 'locked in',
                    textAlign: TextAlign.right,
                    style: LockedInType.micro.copyWith(
                      color: tone,
                      letterSpacing: 0.2,
                    ),
                  ),
                  if (user) const SizedBox(height: 2),
                  if (user)
                    Container(
                      width: 18,
                      height: Stroke.progress,
                      color: tone.withValues(alpha: 0.5),
                    ),
                ],
              ),
            ),
          ),
          Container(width: Stroke.hairline, color: LockedInColors.line),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(left: Space.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (text.isEmpty && streaming)
                    Text(
                      '…',
                      style: LockedInType.prose.copyWith(
                        color: LockedInColors.muted,
                      ),
                    )
                  else if (user)
                    SelectableText(
                      text,
                      style: LockedInType.prose.copyWith(
                        color: LockedInColors.foreground,
                        fontSize: 14.5,
                      ),
                    )
                  else
                    ChatMarkdown(
                      text: text,
                      style: LockedInType.prose.copyWith(
                        color: LockedInColors.foreground,
                        fontSize: 14.5,
                        height: 1.65,
                      ),
                    ),
                  if (streaming || failed || cancelled)
                    Padding(
                      padding: const EdgeInsets.only(top: Space.xs),
                      child: Row(
                        children: [
                          if (streaming)
                            StatusTag(
                              glyph: '▌',
                              label: 'streaming…',
                              tone: LockedInColors.primary,
                            ),
                          if (streaming && (failed || cancelled))
                            const SizedBox(width: Space.sm),
                          if (failed)
                            StatusTag(
                              glyph: '×',
                              label: 'failed',
                              tone: LockedInColors.error,
                            ),
                          if (cancelled)
                            StatusTag(
                              glyph: '—',
                              label: 'stopped',
                              tone: LockedInColors.warning,
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BridgeChip extends StatelessWidget {
  const _BridgeChip({
    required this.online,
    required this.configured,
    required this.streaming,
    this.connecting = false,
  });

  final bool online;
  final bool connecting;
  final bool configured;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final (label, color) = connecting
        ? ('connecting…', LockedInColors.warning)
        : !online
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
