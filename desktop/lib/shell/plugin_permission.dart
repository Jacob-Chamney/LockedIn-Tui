import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../bridge/models.dart';
import '../bridge/protocol.dart';
import '../theme/palette.dart';

/// The blocking prompt for one write-capable plugin tool call (`mcp.permission`).
///
/// The core is waiting on this decision for up to 120 s, so the prompt sits
/// above every other overlay and owns the keyboard while it is open. It shows
/// the model's tool-call input verbatim — untrusted data that is rendered and
/// never executed — and answers with exactly one `mcp.confirm`.
class PluginPermissionModal extends StatefulWidget {
  const PluginPermissionModal({
    super.key,
    required this.request,
    required this.onConfirm,
    this.error,
    this.queued = 0,
    this.expired = false,
    this.onDismissExpired,
  });

  /// True once the core's own 120 s window passed: the call was denied and
  /// there is nothing left to allow. The prompt stays only to say so.
  final bool expired;

  /// Drop an expired prompt. Nothing is sent to the core.
  final VoidCallback? onDismissExpired;

  /// How many more prompts are waiting behind this one. Each is answered on
  /// its own: there is no bulk approve.
  final int queued;

  /// `y` and the Allow button.
  static const allowKey = ValueKey('plugin-permission-allow');

  /// `n`, `Esc` and the Deny button.
  static const denyKey = ValueKey('plugin-permission-deny');

  /// The pretty-printed, read-only tool input block.
  static const inputKey = ValueKey('plugin-permission-input');

  /// The one inline failure message beside a failed answer.
  static const errorKey = ValueKey('plugin-permission-error');

  final PluginPermissionRequest request;

  /// `true` allows this one call; `false` denies it. A refusal rethrows so the
  /// modal can show the core's sentence and stay open.
  final Future<void> Function(bool allow) onConfirm;

  /// The store's last `mcp.confirm` failure, or null.
  final String? error;

  @override
  State<PluginPermissionModal> createState() => _PluginPermissionModalState();
}

class _PluginPermissionModalState extends State<PluginPermissionModal> {
  final _focus = FocusNode();
  var _answering = false;
  String? _failure;

  @override
  void initState() {
    super.initState();
    // A node-level handler runs before any ancestor, so the surface underneath
    // never sees a press meant for this decision.
    _focus.onKeyEvent = _onKey;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    _focus.onKeyEvent = null;
    _focus.dispose();
    super.dispose();
  }

  String get _message => widget.error ?? _failure ?? '';

  Future<void> _confirm(bool allow) async {
    if (_answering) return;
    setState(() {
      _answering = true;
      _failure = null;
    });
    try {
      await widget.onConfirm(allow);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _failure = _messageOf(failure));
    } finally {
      if (mounted) setState(() => _answering = false);
    }
  }

  static String _messageOf(Object failure) {
    if (failure is RpcException) {
      final data = failure.data;
      if (data is Map && data['message'] is String) {
        return data['message'] as String;
      }
      return failure.message;
    }
    return failure.toString();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (widget.expired) {
      // The decision is gone: any of the usual keys dismisses the notice.
      final key = event.logicalKey;
      if (key == LogicalKeyboardKey.escape ||
          key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter ||
          key == LogicalKeyboardKey.space) {
        widget.onDismissExpired?.call();
      }
      return KeyEventResult.handled;
    }
    // Everything else is claimed: this is a modal decision, not a surface.
    if (_answering) return KeyEventResult.handled;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.keyY) {
      unawaited(_confirm(true));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyN || key == LogicalKeyboardKey.escape) {
      unawaited(_confirm(false));
      return KeyEventResult.handled;
    }
    return KeyEventResult.handled;
  }

  /// The model's tool input as a stable, indented document.
  ///
  /// The value came from JSON, so encoding cannot normally fail; a type that
  /// somehow is not encodable still renders rather than throwing on the prompt.
  static String _pretty(Object? input) {
    try {
      return const JsonEncoder.withIndent('  ').convert(input);
    } on Object {
      return input.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = widget.request;
    final message = _message;
    final pretty = _pretty(request.input);
    const muted = TextStyle(height: 1.45);
    return Focus(
      focusNode: _focus,
      onKeyEvent: _onKey,
      child: Stack(
        children: [
          // A non-dismissible barrier: a stray click must not answer a decision
          // the core is waiting on, and cannot silently dismiss it either.
          Positioned.fill(
            child: ModalBarrier(
              dismissible: false,
              color: LockedInColors.background.withValues(alpha: 0.82),
            ),
          ),
          Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  maxWidth: 640,
                  maxHeight: 520,
                ),
                child: Container(
                  decoration: BoxDecoration(
                    color: LockedInColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: LockedInColors.warning),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
                        child: Row(
                          children: [
                            Icon(
                              Icons.warning_amber_rounded,
                              size: 16,
                              color: LockedInColors.warning,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'PLUGIN WRITE · ${request.server}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: LockedInColors.warning,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.2,
                                ),
                              ),
                            ),
                            if (widget.queued > 0)
                              Text(
                                '${widget.queued} more waiting',
                                key: const ValueKey('plugin-permission-queued'),
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: 11,
                                ),
                              ),
                          ],
                        ),
                      ),
                      Divider(height: 1, color: LockedInColors.line),
                      Flexible(
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    'tool',
                                    style: TextStyle(
                                      color: LockedInColors.muted,
                                      fontSize: 11,
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      request.tool,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'This is the tool call the model asked for. '
                                'It has not run.',
                                style: muted.copyWith(
                                  color: LockedInColors.muted,
                                  fontSize: 12,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Container(
                                key: PluginPermissionModal.inputKey,
                                constraints: const BoxConstraints(
                                  maxHeight: 180,
                                ),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: LockedInColors.background,
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(
                                    color: LockedInColors.line,
                                  ),
                                ),
                                child: SingleChildScrollView(
                                  child: Text(
                                    pretty,
                                    style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 12,
                                      height: 1.4,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'Plugin output is still sent to the model. '
                                'This decision applies to this one call only.',
                                style: muted.copyWith(
                                  color: LockedInColors.muted,
                                  fontSize: 12,
                                ),
                              ),
                              if (message.isNotEmpty) ...[
                                const SizedBox(height: 12),
                                Container(
                                  key: PluginPermissionModal.errorKey,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 8,
                                  ),
                                  decoration: BoxDecoration(
                                    color: LockedInColors.background,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(
                                      color: LockedInColors.error,
                                    ),
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        Icons.error_outline,
                                        size: 14,
                                        color: LockedInColors.error,
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          message,
                                          style: TextStyle(
                                            color: LockedInColors.error,
                                            fontSize: 12,
                                            height: 1.4,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      Divider(height: 1, color: LockedInColors.line),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                widget.expired
                                    ? 'expired · the tool did not run'
                                    : _answering
                                    ? 'answering…'
                                    : 'y allow · n deny · Esc deny',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            if (widget.expired)
                              FilledButton(
                                key: const ValueKey(
                                  'plugin-permission-dismiss',
                                ),
                                onPressed: widget.onDismissExpired,
                                child: const Text('Dismiss'),
                              )
                            else ...[
                              TextButton(
                                key: PluginPermissionModal.denyKey,
                                onPressed: _answering
                                    ? null
                                    : () => unawaited(_confirm(false)),
                                child: const Text('Deny'),
                              ),
                              const SizedBox(width: 8),
                              FilledButton(
                                key: PluginPermissionModal.allowKey,
                                style: FilledButton.styleFrom(
                                  backgroundColor: LockedInColors.warning,
                                  foregroundColor: contrastOn(
                                    LockedInColors.warning,
                                  ),
                                ),
                                onPressed: _answering
                                    ? null
                                    : () => unawaited(_confirm(true)),
                                child: const Text('Allow'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
