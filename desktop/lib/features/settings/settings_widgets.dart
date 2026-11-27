import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

class GroupHeader extends StatelessWidget {
  const GroupHeader({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
      child: Row(
        children: [
          Container(width: 3, height: 14, color: LockedInColors.primary),
          const SizedBox(width: 7),
          Text(
            title,
            style: TextStyle(
              color: LockedInColors.secondary,
              fontSize: TypeScale.label,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.8,
            ),
          ),
        ],
      ),
    );
  }
}

class StateMessage extends StatelessWidget {
  const StateMessage({
    super.key,
    required this.icon,
    required this.title,
    required this.body,
    this.tone,
    this.action,
  });

  final IconData icon;
  final String title;
  final String body;
  final Color? tone;
  final VoidCallback? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 24, color: tone ?? LockedInColors.muted),
              const SizedBox(height: 10),
              Text(
                title,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(
                body,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.body,
                  height: 1.5,
                ),
              ),
              if (action != null) ...[
                const SizedBox(height: 16),
                FilledButton(onPressed: action, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class ModelHint extends StatelessWidget {
  const ModelHint({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 4, 12, 0),
      child: Row(
        children: [
          Icon(Icons.link_off, size: 14, color: LockedInColors.warning),
          SizedBox(width: 6),
          Text(
            'not connected',
            key: ValueKey('settings-model-not-connected'),
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        ],
      ),
    );
  }
}

class ConnectModelAction extends StatelessWidget {
  const ConnectModelAction({super.key, required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 2),
      child: Align(
        alignment: Alignment.centerLeft,
        child: FilledButton.icon(
          key: const ValueKey('settings-connect-model'),
          onPressed: onPressed,
          icon: const Icon(Icons.link, size: 16),
          label: const Text('connect a model'),
          style: FilledButton.styleFrom(
            backgroundColor: LockedInColors.primary,
            foregroundColor: Theme.of(context).colorScheme.onPrimary,
            shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.all(Radius.circular(Radii.control)),
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: Space.md,
              vertical: Space.xs + 2,
            ),
            textStyle: LockedInType.label,
          ),
        ),
      ),
    );
  }
}

/// The one sentence the Plugins section must always carry: plugin output is an
/// external explanation, and it is still sent to the model.
class PluginsNote extends StatelessWidget {
  const PluginsNote({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
          SizedBox(width: 6),
          Expanded(
            child: Text(
              'Plugin output is external explanation and is still sent to the '
              'model.',
              key: ValueKey('settings-plugins-note'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The one standing note under the `DECISION LAYER` group.
///
/// `enabled` records only whether the optional ranking layer may run; the cheap
/// rules are always on, and the layer never decides anything with a consequence.
class DecisionRulesNote extends StatelessWidget {
  const DecisionRulesNote({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'The rules are always on. The layer never decides a write, an '
              'archive, or which side of the school/skills wall a request '
              'belongs to.',
              key: const ValueKey('settings-decision-rules'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// `decision.get` is in flight and nothing has been read yet.
class DecisionLoading extends StatelessWidget {
  const DecisionLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Text(
        'loading the decision layer…',
        key: const ValueKey('settings-decision-loading'),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.label,
          height: 1.4,
        ),
      ),
    );
  }
}

/// A failed decision-layer read. The last view, if any, stays on screen.
class DecisionFailure extends StatelessWidget {
  const DecisionFailure({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.warning_amber_outlined,
            size: 13,
            color: LockedInColors.warning,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'the decision layer could not load: $message',
              key: const ValueKey('settings-decision-error'),
              style: TextStyle(
                color: LockedInColors.warning,
                fontSize: TypeScale.label,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The standing note under the `WORK` group.
///
/// The two flags are the **outer** gate only: an approval still needs its own
/// per-action confirmation, and the agent profile's flag must also be on. The
/// core enforces both, so the page never implies a toggle approves anything.
class WorkNote extends StatelessWidget {
  const WorkNote({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Every write and command still needs its own approval, and the '
              'project’s agent profile must allow it too. The core enforces '
              'both; there is no “remember this session”.',
              key: const ValueKey('settings-work-note'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// `work.permissions.get` is in flight and nothing has been read yet.
class WorkLoading extends StatelessWidget {
  const WorkLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Text(
        'loading Work permissions…',
        key: const ValueKey('settings-work-loading'),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.label,
          height: 1.4,
        ),
      ),
    );
  }
}

/// A failed Work-permissions read. The last view, if any, stays on screen.
class WorkFailure extends StatelessWidget {
  const WorkFailure({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.warning_amber_outlined,
            size: 13,
            color: LockedInColors.warning,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Work permissions could not load: $message',
              key: const ValueKey('settings-work-error'),
              style: TextStyle(
                color: LockedInColors.warning,
                fontSize: TypeScale.label,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// No configured servers: say so, and name the only place one can be added.
class PluginsEmpty extends StatelessWidget {
  const PluginsEmpty({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Column(
        key: ValueKey('settings-mcp-empty'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'no MCP servers configured',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.4,
            ),
          ),
          Text(
            'add a server in config.toml',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// A failed read or reconnect. The server rows above stay visible.
class PluginsFailure extends StatelessWidget {
  const PluginsFailure({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.warning_amber_outlined,
            size: 13,
            color: LockedInColors.warning,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'plugins could not load: $message',
              key: const ValueKey('settings-mcp-error'),
              style: TextStyle(
                color: LockedInColors.warning,
                fontSize: TypeScale.label,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class PluginsRefreshing extends StatelessWidget {
  const PluginsRefreshing({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 6, 12, 0),
      child: Text(
        'refreshing plugins…',
        key: ValueKey('settings-mcp-refreshing'),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.label,
          height: 1.4,
        ),
      ),
    );
  }
}

/// Edits one scalar setting and commits it through the core.
///
/// Validation is local and happens before the callback: an out-of-range value
/// never reaches [onSave]. A core rejection keeps the dialog open with the

/// The pointer controls for the configured MCP servers.
///
/// The rows above it are read-only projections; this block is where a person
/// adds, edits or removes a server without hand-editing `config.toml`. Every
/// button is a consequence of a core write, so a failure is shown here in the
/// core's own sentence rather than in a second dialog.
class McpServerActions extends StatelessWidget {
  const McpServerActions({
    super.key,
    required this.servers,
    this.onAdd,
    this.onEdit,
    this.onRemove,
    this.error,
  });

  final List<McpServerView> servers;
  final VoidCallback? onAdd;
  final ValueChanged<McpServerView>? onEdit;
  final ValueChanged<McpServerView>? onRemove;
  final String? error;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final server in servers)
            Row(
              children: [
                Expanded(
                  child: Text(
                    server.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: LockedInType.label.copyWith(
                      color: LockedInColors.secondary,
                    ),
                  ),
                ),
                TextButton(
                  key: ValueKey('mcp-edit-${server.name}'),
                  onPressed: onEdit == null ? null : () => onEdit!(server),
                  child: const Text('edit'),
                ),
                TextButton(
                  key: ValueKey('mcp-remove-${server.name}'),
                  onPressed: onRemove == null ? null : () => onRemove!(server),
                  style: TextButton.styleFrom(
                    foregroundColor: LockedInColors.warning,
                  ),
                  child: const Text('remove'),
                ),
              ],
            ),
          if (onAdd != null) ...[
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                key: const ValueKey('mcp-add-server'),
                onPressed: onAdd,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('add server'),
              ),
            ),
          ],
          if (error != null && error!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              error!,
              key: const ValueKey('mcp-action-error'),
              style: LockedInType.label.copyWith(color: LockedInColors.error),
            ),
          ],
        ],
      ),
    );
  }
}
