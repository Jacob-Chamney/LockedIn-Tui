import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';

/// Creates one goal. The shell's implementation calls `CoreStore.createSkill`,
/// which rethrows the core's [RpcException] so the wizard can show the exact
/// message and stay on Review.
typedef GoalCreateCallback = Future<SkillCreateResult> Function({
  required String goal,
  required String prior,
});

/// The two wizard steps, in order.
enum _Step {
  goal('Goal'),
  review('Review');

  const _Step(this.label);

  final String label;
}

/// The New skill goal wizard: **Goal → Review**.
///
/// A full-pane view, not a dialog, so it fits 800×600 without a modal stack. It
/// is keyboard-first: `Enter` continues (or creates on Review), `Esc` backs out
/// one layer and `Tab` moves between controls.
///
/// The wizard sends only the goal and what the learner already knows. The core
/// owns the id, the goal folder and the curriculum, and makes no provider call:
/// the Review step says the plan is the built-in template instead of implying a
/// generated course.
class GoalWizard extends StatefulWidget {
  const GoalWizard({
    super.key,
    required this.onCreate,
    required this.onCancel,
    required this.onCreated,
  });

  /// Creates the goal. A refusal is thrown, never recorded here, so a create
  /// failure stays on Review with the core's own sentence.
  final GoalCreateCallback onCreate;

  /// `Esc` at the Goal step (and the back control) leave without writing.
  final VoidCallback onCancel;

  /// Called with the new goal id after the core accepted the create. The shell
  /// decides what "created" means — refresh, open the detail, swap the layer.
  final ValueChanged<String> onCreated;

  @override
  State<GoalWizard> createState() => _GoalWizardState();
}

class _GoalWizardState extends State<GoalWizard> {
  static const _rule = 'A goal is required: say what you want to learn.';
  static const _maxGoal = 200;
  static const _maxPrior = 2000;

  final _goalController = TextEditingController();
  final _priorController = TextEditingController();
  final _rootFocus = FocusNode(debugLabel: 'goal-wizard');
  final _goalFocus = FocusNode(debugLabel: 'goal-wizard-goal');
  final _priorFocus = FocusNode(debugLabel: 'goal-wizard-prior');

  _Step _step = _Step.goal;
  var _busy = false;
  String? _failure;

  /// A blocked rule is a warning; a core refusal is an error. Both stay inline
  /// on the step that produced them.
  var _failureIsCore = false;

  @override
  void dispose() {
    _goalController.dispose();
    _priorController.dispose();
    _rootFocus.dispose();
    _goalFocus.dispose();
    _priorFocus.dispose();
    super.dispose();
  }

  String get _goal => _goalController.text.trim();

  String get _prior => _priorController.text.trim();

  /// The blocked copy, or null when Review may create.
  String? _blocked() {
    if (_goal.isEmpty) return _rule;
    if (_goal.length > _maxGoal) {
      return 'A goal is at most $_maxGoal characters.';
    }
    if (_prior.length > _maxPrior) {
      return 'Prior knowledge is at most $_maxPrior characters.';
    }
    return null;
  }

  void _fail(String message, {required bool core}) {
    setState(() {
      _failure = message;
      _failureIsCore = core;
    });
  }

  /// Move to [step] and focus the control that step starts with, so `Enter` and
  /// `Tab` keep working without a mouse.
  void _goTo(_Step step) {
    setState(() {
      _step = step;
      _failure = null;
      _failureIsCore = false;
    });
    FocusScope.of(context).unfocus();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      switch (_step) {
        case _Step.goal:
          _goalFocus.requestFocus();
        case _Step.review:
          _rootFocus.requestFocus();
      }
    });
  }

  void _back() {
    if (_busy) return;
    if (_step == _Step.goal) {
      widget.onCancel();
      return;
    }
    _goTo(_Step.goal);
  }

  void _next() {
    if (_busy) return;
    if (_step == _Step.review) return;
    final blocked = _blocked();
    if (blocked != null) {
      _fail(blocked, core: false);
      return;
    }
    _goTo(_Step.review);
  }

  Future<void> _create() async {
    if (_busy) return;
    final blocked = _blocked();
    if (blocked != null) {
      _fail(blocked, core: false);
      return;
    }
    setState(() {
      _busy = true;
      _failure = null;
      _failureIsCore = false;
    });
    try {
      final result = await widget.onCreate(goal: _goal, prior: _prior);
      if (!mounted) return;
      setState(() => _busy = false);
      widget.onCreated(result.id);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _busy = false);
      _fail(userMessage(failure), core: true);
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (_busy) {
      // A create is in flight. `Esc` must not fall through to the shell, which
      // would unmount the wizard and leave the session it created unopened.
      return key == LogicalKeyboardKey.escape
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.escape) {
      _back();
      return KeyEventResult.handled;
    }
    // While a text field is focused `Enter` belongs to it: the goal field is
    // wrapped in [_submitOnEnter] and the prior field inserts a newline.
    if (_goalFocus.hasFocus || _priorFocus.hasFocus) {
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (_step == _Step.review) {
        unawaited(_create());
      } else {
        _next();
      }
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _rootFocus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < Breakpoints.hint;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(compact: compact),
              if (_busy)
                LinearProgressIndicator(
                  minHeight: 2,
                  color: LockedInColors.primary,
                  backgroundColor: LockedInColors.line,
                ),
              Expanded(child: _body()),
              _footer(compact: compact),
            ],
          );
        },
      ),
    );
  }

  Widget _header({required bool compact}) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to skills',
            onPressed: _busy ? null : widget.onCancel,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'New skill goal',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                Text(
                  compact
                      ? 'step ${_step.index + 1} of 2 · ${_step.label}'
                      : 'goal → review',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          if (!compact) _stepChips(),
        ],
      ),
    );
  }

  Widget _stepChips() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var index = 0; index < _Step.values.length; index++) ...[
          if (index > 0) const SizedBox(width: 8),
          _stepChip(_Step.values[index], index),
        ],
      ],
    );
  }

  Widget _stepChip(_Step step, int index) {
    final current = step == _step;
    final done = index < _step.index;
    final tone = current
        ? LockedInColors.primary
        : (done ? LockedInColors.success : LockedInColors.muted);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: current ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: current
              ? LockedInColors.primary.withValues(alpha: 0.6)
              : LockedInColors.line,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            done ? Icons.check : Icons.circle,
            size: done ? 11 : 7,
            color: tone,
          ),
          const SizedBox(width: 6),
          Text(
            '${index + 1} ${step.label}',
            style: TextStyle(
              color: tone,
              fontSize: 11,
              fontWeight: current ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_failure != null) ...[
                _failureBanner(_failure!),
                const SizedBox(height: 14),
              ],
              switch (_step) {
                _Step.goal => _goalStep(),
                _Step.review => _reviewStep(),
              },
            ],
          ),
        ),
      ),
    );
  }

  Widget _goalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _card(
          label: 'GOAL',
          trailing: _chip('${_goalController.text.length}/$_maxGoal'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Single line on purpose: a multi-line goal field would keep
              // Enter for a newline, and Enter is the wizard's "continue".
              _submitOnEnter(
                TextField(
                  key: const ValueKey('goal-wizard-goal'),
                  controller: _goalController,
                  focusNode: _goalFocus,
                  autofocus: true,
                  textInputAction: TextInputAction.next,
                  inputFormatters: [LengthLimitingTextInputFormatter(_maxGoal)],
                  onChanged: (_) {
                    setState(() {
                      if (_failure != null && !_failureIsCore) _failure = null;
                    });
                  },
                  onSubmitted: (_) => _next(),
                  decoration: const InputDecoration(
                    hintText: 'Read disassembly output confidently',
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'One sentence is enough. The goal becomes the course name, so '
                'write it the way you would say it out loud.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 11.5,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _card(
          label: 'PRIOR KNOWLEDGE',
          trailing: _chip(
            _prior.isEmpty
                ? 'optional'
                : '${_priorController.text.length}/$_maxPrior',
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                key: const ValueKey('goal-wizard-prior'),
                controller: _priorController,
                focusNode: _priorFocus,
                minLines: 2,
                maxLines: 4,
                keyboardType: TextInputType.multiline,
                inputFormatters: [LengthLimitingTextInputFormatter(_maxPrior)],
                onChanged: (_) {
                  setState(() {
                    if (_failure != null && !_failureIsCore) _failure = null;
                  });
                },
                decoration: const InputDecoration(
                  hintText: 'I know a little C, but no assembly…',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'What you already know shapes the first chapter. Leave it empty '
                'to start from scratch.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 11.5,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _card(
          label: 'WHAT CREATE DOES',
          child: Text(
            'Writes one goal folder with its curriculum and lesson files. No '
            'model is called and nothing is charged. Esc here writes nothing.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ),
      ],
    );
  }

  /// A single-line field consumes hardware `Enter` through the platform text
  /// shortcuts, so the wizard wraps it in one closer handler: `Enter` continues
  /// exactly like the Next button, never twice.
  Widget _submitOnEnter(Widget child) {
    return Focus(
      canRequestFocus: false,
      skipTraversal: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
          return KeyEventResult.ignored;
        }
        final key = event.logicalKey;
        if (key != LogicalKeyboardKey.enter &&
            key != LogicalKeyboardKey.numpadEnter) {
          return KeyEventResult.ignored;
        }
        _next();
        return KeyEventResult.handled;
      },
      child: child,
    );
  }

  Widget _reviewStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _card(
          label: 'REVIEW',
          trailing: _chip(
            _busy ? 'creating' : 'ready',
            tone: _busy ? LockedInColors.warning : LockedInColors.success,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _reviewRow('goal', _goal.isEmpty ? 'not set' : _goal),
              _reviewDivider(),
              _reviewRow(
                'prior knowledge',
                _prior.isEmpty ? 'not recorded' : _prior,
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _card(
          label: 'CURRICULUM',
          trailing: _chip('plan · model or template'),
          child: Text(
            'The curriculum uses your configured model to write a chapter plan '
            'when one is available; otherwise it starts from the built-in '
            'template. A model call uses your configured provider and budget. '
            'You can edit these stages from the goal page (`e`).',
            key: ValueKey('goal-wizard-template-note'),
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ),
      ],
    );
  }

  Widget _reviewRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 11,
                letterSpacing: 0.6,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: 13,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _reviewDivider() {
    return Divider(height: 1, thickness: 1, color: LockedInColors.line);
  }

  Widget _footer({required bool compact}) {
    final hint = Text(
      compact ? 'Esc back' : 'Tab moves · Enter next · Esc back',
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(color: LockedInColors.muted, fontSize: 11),
    );
    final buttons = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        OutlinedButton(
          key: const ValueKey('goal-wizard-back'),
          onPressed: _busy ? null : _back,
          child: const Text('Back'),
        ),
        const SizedBox(width: 8),
        if (_step == _Step.review)
          FilledButton(
            key: const ValueKey('goal-wizard-create'),
            onPressed: _busy ? null : () => unawaited(_create()),
            child: Text(_busy ? 'creating…' : 'Create'),
          )
        else
          FilledButton(
            key: const ValueKey('goal-wizard-next'),
            onPressed: _busy ? null : _next,
            child: const Text('Next'),
          ),
      ],
    );
    return Container(
      padding: EdgeInsets.fromLTRB(compact ? 12 : 20, 8, compact ? 12 : 20, 10),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border(top: BorderSide(color: LockedInColors.line)),
      ),
      child: compact
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                hint,
                const SizedBox(height: 8),
                Align(alignment: Alignment.centerRight, child: buttons),
              ],
            )
          : Row(
              children: [
                Expanded(child: hint),
                const SizedBox(width: 12),
                buttons,
              ],
            ),
    );
  }

  Widget _card({
    required String label,
    required Widget child,
    Widget? trailing,
  }) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: LockedInColors.secondary,
                  letterSpacing: 1.4,
                ),
              ),
              const Spacer(),
              ?trailing,
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }

  Widget _chip(String text, {Color? tone}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: tone ?? LockedInColors.muted,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _failureBanner(String message) {
    final tone = _failureIsCore ? LockedInColors.error : LockedInColors.warning;
    return Container(
      key: const ValueKey('goal-wizard-error'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: tone.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            _failureIsCore ? Icons.error_outline : Icons.info_outline,
            size: 16,
            color: tone,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: tone, fontSize: 12, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}
