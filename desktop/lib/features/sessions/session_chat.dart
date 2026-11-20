import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../chat/chat_failure.dart';
import '../chat/usage_text.dart';
import '../chat/markdown.dart';
import '../chat/transcript_scroll.dart';
import '../keys.dart';

/// The session-bound chat surface.
///
/// The shell owns the store and passes this session's own [ChatSnapshot] in;
/// a send is an intent and the transcript only grows when the core emits
/// `session.chat.state` for this session. The page reads no files and calls no
/// core method.
///
/// The composer and bubble layout are the same on every chat: this page, the
/// session, skill and project chats, and Chill. Each carries its own copy of the
/// private widgets rather than one public composer four owners would share, so a
/// visual change is four edits; keep them in step (`docs/design.md` §4).
class SessionChatView extends StatefulWidget {
  const SessionChatView({
    super.key,
    required this.detail,
    required this.chat,
    required this.loading,
    this.error,
    this.onBack,
    this.onSend,
    this.sendError,
    this.onCancel,
    this.onRetry,
    this.onModeChanged,
    this.initialText,
    this.onDraftChanged,
  });

  /// The open session, used for the title and the empty-state copy.
  final SessionDetail? detail;

  /// This session's chat projection, or null while it is unavailable.
  final ChatSnapshot? chat;

  final bool loading;
  final String? error;

  /// `Esc` and the back control return to the session detail.
  final VoidCallback? onBack;

  /// Send one turn. **True means the core accepted it**, and only then does
  /// the composer clear: a refusal used to lose the text silently.
  final Future<bool> Function(String text)? onSend;

  /// The last send refusal for this chat, shown in the banner.
  final String? sendError;
  final VoidCallback? onCancel;
  final VoidCallback? onRetry;

  /// Reports `INSERT` (true) while the composer holds focus and `NORMAL`
  /// (false) when it loses it, so the shell renders the mode exactly like
  /// Chill. The page never switches mode itself.
  final ValueChanged<bool>? onModeChanged;

  /// The draft the shell kept when this chat was last left. Switching surfaces
  /// disposes the page, so the text is owned above it: a chat-first app must
  /// never lose a draft.
  final String? initialText;

  /// Reports every keystroke of the draft to the shell.
  final ValueChanged<String>? onDraftChanged;

  @override
  State<SessionChatView> createState() => _SessionChatViewState();
}

class _SessionChatViewState extends State<SessionChatView> {
  final _composer = TextEditingController();
  final _composerFocus = FocusNode();

  /// The page's own node: where the keyboard rests in NORMAL mode.
  final _pageFocus = FocusNode(debugLabel: 'session-chat');
  final _scroll = ScrollController();

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

  @override
  void didUpdateWidget(SessionChatView oldWidget) {
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

  void _reportDraft() {
    widget.onDraftChanged?.call(_composer.text);
  }

  void _reportMode() {
    widget.onModeChanged?.call(_composerFocus.hasFocus);
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

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    // Esc stops a streaming reply before it means "back": the composer keeps
    // focus during a turn, and cancelling must not leave the chat.
    if (key == LogicalKeyboardKey.escape && widget.onCancel != null) {
      final streaming = widget.chat?.streaming ?? false;
      if (streaming) {
        if (event is KeyDownEvent) widget.onCancel!();
        return KeyEventResult.handled;
      }
    }
    if (key == LogicalKeyboardKey.escape) {
      // INSERT → NORMAL first; only an `Esc` in NORMAL leaves the chat. One
      // press used to do both, so there was no NORMAL mode to read from.
      if (_composerFocus.hasFocus) {
        _pageFocus.requestFocus();
        return KeyEventResult.handled;
      }
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    if (_composerFocus.hasFocus) return KeyEventResult.ignored;
    if (modifierHeld) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.tab) {
      _composerFocus.requestFocus();
      return KeyEventResult.handled;
    }
    final scrolled = scrollKey(_scroll, event);
    if (scrolled != null) return scrolled;
    if ((key == LogicalKeyboardKey.keyC || key == LogicalKeyboardKey.keyI) &&
        !_composerFocus.hasFocus) {
      _composerFocus.requestFocus();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    final send = widget.onSend;
    if (text.isEmpty || send == null) return;
    final chat = widget.chat;
    // The same rule as the Send button: with no model the core refuses the
    // turn, and clearing the composer first lost the text.
    if (chat == null ||
        !chat.hasModel ||
        chat.streaming ||
        chat.blocked != null) {
      return;
    }
    final accepted = await send(text);
    if (!mounted) return;
    // A refusal keeps the text: the core did not take the turn.
    if (accepted) _composer.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _pageFocus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: Column(
        children: [
          _header(),
          if (widget.loading)
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          Expanded(child: _body()),
          if (widget.chat?.error != null)
            ChatFailureBanner(
              failed: widget.chat!.error!.failed,
              kept: widget.chat!.error!.kept,
              next: widget.chat!.error!.next,
              onRetry: widget.onRetry,
            )
          else if (widget.sendError != null && widget.sendError!.isNotEmpty)
            ChatFailureBanner(
              failed: widget.sendError!,
              kept: 'your message is still in the composer',
            ),
          _composerBox(),
        ],
      ),
    );
  }

  Widget _header() {
    final theme = Theme.of(context);
    final detail = widget.detail;
    final chat = widget.chat;
    final streaming = chat?.streaming ?? false;
    final model = chat == null
        ? 'model unknown'
        : chat.hasModel
        ? chat.model!
        : 'no model';
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to session',
            onPressed: widget.onBack,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            flex: 3,
            child: Text(
              detail == null || detail.name.isEmpty ? 'session' : detail.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleMedium,
            ),
          ),
          const SizedBox(width: 10),
          Flexible(
            flex: 2,
            child: Text(
              'session · $model',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.right,
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
          const SizedBox(width: 10),
          _StatusChip(streaming: streaming),
        ],
      ),
    );
  }

  Widget _body() {
    final chat = widget.chat;
    if (chat == null) {
      if (widget.loading) {
        return const _Loading(
          title: 'loading the session chat…',
          body: 'The core is opening this session’s transcript.',
        );
      }
      return _stateCard(
        icon: Icons.error_outline,
        tone: LockedInColors.error,
        title: 'session chat unavailable',
        body:
            widget.error ??
            'The core has not returned this session’s chat yet. Retry, or go '
                'back to the session.',
        actions: [
          if (widget.onRetry != null)
            FilledButton(onPressed: widget.onRetry, child: const Text('Retry')),
          if (widget.onBack != null)
            OutlinedButton(
              onPressed: widget.onBack,
              child: const Text('Back to session'),
            ),
        ],
      );
    }
    final messages = chat.messages;
    if (messages.isEmpty && !chat.streaming) {
      return _stateCard(
        icon: Icons.forum_outlined,
        tone: LockedInColors.primary,
        title: 'ask the first question',
        body:
            'This chat sees only this session’s sources, instructions and '
            'steps. Nothing else is visible, and nothing is written until a '
            'reply lands.',
        actions: [
          if (widget.onSend != null)
            FilledButton(
              onPressed: _composerFocus.requestFocus,
              child: const Text('Write a question'),
            ),
        ],
      );
    }

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 780),
        child: ListView.builder(
          controller: _scroll,
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
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

  Widget _composerBox() {
    final chat = widget.chat;
    final streaming = chat?.streaming ?? false;
    final blocked = chat?.blocked;
    final canSend =
        chat != null &&
        chat.hasModel &&
        blocked == null &&
        !streaming &&
        widget.onSend != null;

    final hint = blocked != null
        ? '${blocked.reason} · ${blocked.fix}'
        : chat == null
        ? 'send unavailable · waiting for this session’s chat'
        : !chat.hasModel
        ? 'no model connected · link a key in Settings → Providers'
        : streaming
        ? 'streaming · Esc stops the reply'
        : 'Enter send · Shift+Enter newline · Esc normal';

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 780),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Always one line: the keys that send, or the reason a send is
              // blocked.
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
                      key: const ValueKey('session-chat-composer'),
                      controller: _composer,
                      focusNode: _composerFocus,
                      minLines: 1,
                      maxLines: 5,
                      decoration: InputDecoration(
                        hintText: streaming
                            ? 'streaming…'
                            : chat == null
                            ? 'waiting for the session chat'
                            : 'Ask about this session…',
                        prefixIcon: const Icon(Icons.chevron_right, size: 16),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (streaming)
                    OutlinedButton.icon(
                      onPressed: widget.onCancel,
                      icon: const Icon(Icons.stop, size: 16),
                      label: const Text('Stop'),
                    )
                  else
                    FilledButton.icon(
                      onPressed: canSend ? _send : null,
                      icon: const Icon(Icons.arrow_upward, size: 16),
                      label: const Text('Send'),
                    ),
                ],
              ),
              if (chat != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    chatUsageLabel(chat.usage),
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stateCard({
    required IconData icon,
    required Color tone,
    required String title,
    required String body,
    required List<Widget> actions,
  }) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            decoration: BoxDecoration(
              color: LockedInColors.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: LockedInColors.line),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 17, color: tone),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 13,
                    height: 1.5,
                  ),
                ),
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.end,
                    children: actions,
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

class _Loading extends StatelessWidget {
  const _Loading({required this.title, required this.body});

  final String title;
  final String body;

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
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            body,
            textAlign: TextAlign.center,
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
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
              user ? 'you' : 'locked in',
              style: theme.textTheme.labelSmall?.copyWith(
                color: user ? LockedInColors.primary : LockedInColors.secondary,
                letterSpacing: 0.6,
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.streaming});

  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final (label, color) = streaming
        ? ('streaming', LockedInColors.primary)
        : ('idle', LockedInColors.success);
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
