import 'package:material_ui/material_ui.dart';

import '../../bridge/core_client.dart';
import '../../bridge/models.dart';
import '../../features/chat/usage_text.dart';
import '../../theme/numerals.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

class TopBar extends StatelessWidget {
  const TopBar({
    super.key,
    required this.surfaceLabel,
    required this.store,
    required this.sidebarExpanded,
    required this.toggleHint,
    required this.onToggleSidebar,
    required this.onOpenSettings,
  });

  /// The breadcrumb label; the shell owns which surface is open.
  final String surfaceLabel;
  final CoreStore store;

  /// True when the rail shows its labels; the toggle says what the next press does.
  final bool sidebarExpanded;

  /// The registry's chord for that action (`Space e` by default).
  final String toggleHint;

  final VoidCallback onToggleSidebar;

  /// Settings, from the model badge.
  final VoidCallback onOpenSettings;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 38,
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(
          bottom: BorderSide(
            color: LockedInColors.line,
            width: Stroke.hairline,
          ),
        ),
      ),
      child: Row(
        children: [
          // A pointer path for the same registry action the chord runs, so the
          // sidebar is reachable with a mouse without being mouse-only.
          _RailToggle(
            expanded: sidebarExpanded,
            hint: toggleHint,
            onTap: onToggleSidebar,
          ),
          const SizedBox(width: Space.sm),
          Text(
            'LOCKEDIN',
            style: LockedInType.micro.copyWith(
              color: LockedInColors.primary,
              letterSpacing: 2.2,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(width: Space.xs),
          Text(
            '›',
            style: LockedInType.micro.copyWith(color: LockedInColors.line),
          ),
          const SizedBox(width: Space.xs),
          // The breadcrumb takes the free space and the badge takes its
          // natural width at the right edge. A `Spacer` plus a loose
          // `Flexible` around an `Align` split the remainder into equal
          // thirds, so `! no model` floated ~220 px from the edge at 1280.
          Expanded(
            child: Text(
              surfaceLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: LockedInType.label.copyWith(
                color: LockedInColors.foreground,
                fontSize: TypeScale.key,
              ),
            ),
          ),
          const SizedBox(width: Space.sm),
          _CoreChip(store: store, onOpenSettings: onOpenSettings),
          const SizedBox(width: Space.sm),
        ],
      ),
    );
  }
}

/// The rail's pointer toggle: a glyph, a hairline, and the chord in its tooltip.
class _RailToggle extends StatelessWidget {
  const _RailToggle({
    required this.expanded,
    required this.hint,
    required this.onTap,
  });

  final bool expanded;
  final String hint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final active = expanded;
    return Tooltip(
      message: '${active ? 'Shrink' : 'Expand'} sidebar ($hint)',
      waitDuration: const Duration(milliseconds: 400),
      child: InkWell(
        key: const ValueKey('sidebar-toggle'),
        onTap: onTap,
        child: Container(
          width: 38,
          height: 37,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border(
              right: BorderSide(
                color: LockedInColors.line,
                width: Stroke.hairline,
              ),
            ),
          ),
          child: Text(
            '≡',
            style: LockedInType.key.copyWith(
              color: active ? LockedInColors.primary : LockedInColors.muted,
              fontSize: TypeScale.prose,
            ),
          ),
        ),
      ),
    );
  }
}

class _CoreChip extends StatelessWidget {
  const _CoreChip({required this.store, this.onOpenSettings});

  final CoreStore store;

  /// The badge is the app's only model indicator, so it is also the way to
  /// Settings → Providers with a mouse.
  final VoidCallback? onOpenSettings;

  @override
  Widget build(BuildContext context) {
    final configured = store.configured;
    final model = store.workspace?.model ?? '';
    // Glyph + word, so the state never depends on colour alone.
    final (glyph, label, tone) = switch (store.status) {
      CoreStatus.connecting => ('◌', 'connecting…', LockedInColors.warning),
      CoreStatus.failed => ('×', 'core offline', LockedInColors.error),
      CoreStatus.offline => ('○', 'core offline', LockedInColors.muted),
      CoreStatus.online when !configured => (
        '!',
        'no model',
        LockedInColors.warning,
      ),
      CoreStatus.online => ('●', model, LockedInColors.success),
    };
    return Tooltip(
      message: configured ? label : 'open Settings → Providers',
      waitDuration: const Duration(milliseconds: 500),
      child: InkWell(
        key: const ValueKey('model-badge'),
        onTap: onOpenSettings,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Space.xs,
            vertical: Space.xxs,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(glyph, style: LockedInType.micro.copyWith(color: tone)),
              const SizedBox(width: Space.xxs + 2),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 240),
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LockedInType.label.copyWith(
                    color: configured ? LockedInColors.foreground : tone,
                    fontSize: TypeScale.label,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StatusBar extends StatelessWidget {
  const StatusBar({
    super.key,
    required this.chat,
    required this.insert,
    required this.label,
    required this.hint,
    required this.helpKey,
  });

  /// The transcript the bar reports usage for: the one on screen.
  final ChatSnapshot? chat;
  final bool insert;

  /// The scope name: the surface label, or `SESSION` / `SESSION CHAT` inside a
  /// lock-in. Uppercased by the caller so the layout never changes.
  final String label;

  /// The keys for the layer that has focus, already resolved by the shell.
  final String hint;

  /// The registry's help chord, e.g. `?`.
  final String helpKey;

  String _usageLabel() {
    final chat = this.chat;
    // No snapshot is "not read", not "zero tokens spent".
    if (chat == null) return '— tok · cost unknown';
    // The same formatter the chats use: this copy kept the `.0`, so the status
    // bar said `2.0K` beside a chat that said `2K`.
    final compact = compactTokens(chat.usage.tokens);
    final cost = chatCostLabel(chat.usage.costMicroUsd);
    final duration = chat.usage.durationMs == null
        ? ''
        : ' · ${(chat.usage.durationMs! / 1000).toStringAsFixed(1)}s';
    return '$compact tok · $cost$duration';
  }

  @override
  Widget build(BuildContext context) {
    final micro = LockedInType.micro;
    return Container(
      height: 26,
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(
          top: BorderSide(color: LockedInColors.line, width: Stroke.hairline),
        ),
      ),
      child: Row(
        children: [
          // The scope, as a filled tab: the one place the accent is a surface.
          Container(
            height: 26,
            padding: const EdgeInsets.symmetric(horizontal: Space.xs),
            alignment: Alignment.center,
            color: LockedInColors.primary,
            child: Text(
              label,
              style: micro.copyWith(
                color: Theme.of(context).colorScheme.onPrimary,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.9,
              ),
            ),
          ),
          const _BarDivider(),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.xs),
            child: Text(
              insert ? 'INSERT' : 'NORMAL',
              style: micro.copyWith(
                color: insert
                    ? LockedInColors.primary
                    : LockedInColors.foreground,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.9,
              ),
            ),
          ),
          const _BarDivider(),
          const SizedBox(width: Space.xs),
          Expanded(
            child: Text(
              key: const ValueKey('status-hint'),
              hint,
              overflow: TextOverflow.ellipsis,
              style: micro.copyWith(
                color: LockedInColors.muted,
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
              ),
            ),
          ),
          const SizedBox(width: Space.xs),
          Text(
            _usageLabel(),
            key: const ValueKey('status-usage'),
            style: tabular(
              micro.copyWith(
                color: LockedInColors.muted,
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
              ),
            ),
          ),
          const _BarDivider(),
          const SizedBox(width: Space.xs),
          Text(
            '$helpKey help',
            style: micro.copyWith(
              color: LockedInColors.secondary,
              fontWeight: FontWeight.w600,
              letterSpacing: 0,
            ),
          ),
          const SizedBox(width: Space.sm),
        ],
      ),
    );
  }
}

/// A hairline cell separator in the status bar.
class _BarDivider extends StatelessWidget {
  const _BarDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: Stroke.hairline,
      height: 26,
      color: LockedInColors.line,
    );
  }
}
