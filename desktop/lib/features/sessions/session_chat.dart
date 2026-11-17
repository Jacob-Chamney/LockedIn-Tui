import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../chat/markdown.dart';

/// The session-bound chat surface.
///
/// The shell owns the store and passes this session's own [ChatSnapshot] in;
/// a send is an intent and the transcript only grows when the core emits
/// `session.chat.state` for this session. The page reads no files and calls no
/// core method.
///
/// The composer and bubble layout follow `features/chat/chat_page.dart` so the
/// session chat behaves exactly like Chill. Those widgets are private to the
/// chat page today; extracting them into a shared composer is a chat-owner
/// packet (see T-009 handoff).
class SessionChatView extends StatefulWidget {
  const SessionChatView({
    super.key,
    required this.detail,
    required this.chat,
    required this.loading,
    this.error,
    this.onBack,
    this.onSend,
    this.onCancel,
    this.onRetry,
    this.onModeChanged,
  });

  /// The open session, used for the title and the empty-state copy.
  final SessionDetail? detail;

  /// This session's chat projection, or null while it is unavailable.
  final ChatSnapshot? chat;

  final bool loading;
  final String? error;

  /// `Esc` and the back control return to the session detail.
  final VoidCallback? onBack;

  final ValueChanged<String>? onSend;
  final VoidCallback? onCancel;
  final VoidCallback? onRetry;

  /// Reports `INSERT` (true) while the composer holds focus and `NORMAL`
  /// (false) when it loses it, so the shell renders the mode exactly like
  /// Chill. The page never switches mode itself.
  final ValueChanged<bool>? onModeChanged;

  @override
  State<SessionChatView> createState() => _SessionChatViewState();
}

class _SessionChatViewState extends State<SessionChatView> {
  final _composer = TextEditingController();
  final _composerFocus = FocusNode();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _composerFocus.onKeyEvent = _handleComposerKey;
    _composerFocus.addListener(_reportMode);
  }

  @override
  void didUpdateWidget(SessionChatView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final before = oldWidget.chat;
    final after = widget.chat;
    final grew =
        (after?.messages.length ?? 0) > (before?.messages.length ?? 0) ||
        (after?.streamed.length ?? 0) > (before?.streamed.length ?? 0);
    if (grew) _scrollToBottom();
  }

  @override
  void dispose() {
    _composerFocus.removeListener(_reportMode);
    _composerFocus.dispose();
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
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
    if (key == LogicalKeyboardKey.escape) {
      _composerFocus.unfocus();
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.tab) {
      if (_composerFocus.hasFocus) return KeyEventResult.ignored;
      _composerFocus.requestFocus();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyC && !_composerFocus.hasFocus) {
      _composerFocus.requestFocus();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
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
    final text = _composer.text.trim();
    if (text.isEmpty || widget.onSend == null) return;
    final chat = widget.chat;
    if (chat == null || chat.streaming || chat.blocked != null) return;
    widget.onSend!(text);
    _composer.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
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
    if (chat.error != null) {
      return _stateCard(
        icon: Icons.error_outline,
        tone: LockedInColors.error,
        title: 'the last turn failed',
        body: [
          chat.error!.failed,
          if (chat.error!.kept.isNotEmpty) chat.error!.kept,
          if (chat.error!.next.isNotEmpty) chat.error!.next,
        ].where((line) => line.isNotEmpty).join('\n'),
        actions: [
          if (widget.onRetry != null)
            FilledButton(onPressed: widget.onRetry, child: const Text('Retry')),
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
        ? 'streaming · Stop ends the reply'
        : canSend
        ? 'Enter send · Shift+Enter newline · Esc back'
        : 'send unavailable';

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 780),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (blocked != null || !canSend)
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
                        prefixIcon: const Icon(
                          Icons.keyboard_command_key,
                          size: 16,
                        ),
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
                    _usageLabel(chat.usage),
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

String _usageLabel(ChatUsageView usage) {
  final cost = usage.costMicroUsd == null
      ? 'cost unknown'
      : '\$${(usage.costMicroUsd! / 1000000).toStringAsFixed(4)}';
  final duration = usage.durationMs == null
      ? null
      : '${(usage.durationMs! / 1000).toStringAsFixed(1)}s';
  return ['${_compact(usage.tokens)} tok', cost, ?duration].join(' · ');
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
