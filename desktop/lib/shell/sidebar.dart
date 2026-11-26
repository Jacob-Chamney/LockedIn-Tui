import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'surfaces.dart';

/// One destination in the sidebar: a surface, or the Achievements layer that
/// lives over Stats.
sealed class SidebarEntry {
  const SidebarEntry();
}

class SurfaceEntry extends SidebarEntry {
  const SurfaceEntry(this.surface);
  final Surface surface;
}

class AchievementsEntry extends SidebarEntry {
  const AchievementsEntry();
}

/// A heading in the sidebar and the destinations under it. `docs/design.md`
/// §2.4 asks for grouped destinations rather than one flat list; a null title
/// is the first, unlabelled group (Chill).
typedef SidebarGroup = (String?, List<SidebarEntry>);

const sidebarGroups = <SidebarGroup>[
  (null, [SurfaceEntry(Surface.chat)]),
  (
    'LEARN',
    [
      SurfaceEntry(Surface.sessions),
      SurfaceEntry(Surface.skills),
      SurfaceEntry(Surface.review),
    ],
  ),
  ('PRODUCTIVITY', [SurfaceEntry(Surface.work)]),
  (
    'REFERENCE',
    [
      SurfaceEntry(Surface.stats),
      AchievementsEntry(),
      SurfaceEntry(Surface.archive),
      SurfaceEntry(Surface.knowledge),
    ],
  ),
];

class Sidebar extends StatelessWidget {
  const Sidebar({
    super.key,
    required this.compact,
    required this.cursorKey,
    required this.active,
    required this.footer,
    required this.shortcuts,
    required this.onSelect,
    this.counts = const {},
    this.achievements = '',
    this.achievementsActive = false,
    this.onAchievements,
    this.recent = const [],
    this.onRecent,
    this.focusNode,
    this.onKey,
    this.onFocusChange,
    this.focused = false,
    this.cursor = -1,
  });

  /// The node the rail takes when it is opened from the keyboard, and the
  /// handler for `j`/`k`/`Enter`/`Esc` while it owns the keyboard.
  final FocusNode? focusNode;
  final KeyEventResult Function(FocusNode, KeyEvent)? onKey;

  /// Told when the keyboard arrives or leaves, so the shell's `focused` flag
  /// describes the rail rather than guessing.
  final ValueChanged<bool>? onFocusChange;

  /// True while the rail owns the keyboard; [cursor] is then the row under it
  /// (-1 when the rail is not focused).
  final bool focused;
  final int cursor;

  final bool compact;
  final Surface active;

  /// Each destination's size (`3` sessions, `12` review items). An absent or
  /// empty value draws no count, so a surface with nothing countable stays
  /// quiet instead of showing a meaningless zero.
  final Map<Surface, String> counts;

  /// `earned/total` for the Achievements row, or empty before it is read.
  final String achievements;

  /// True while the Achievements layer is open.
  final bool achievementsActive;

  /// Open the Achievements layer. Null when the shell cannot.
  final VoidCallback? onAchievements;

  /// The last few readable sessions, newest first. The sidebar lists them as
  /// destinations: selecting one opens that session, exactly as the Sessions
  /// manager would. Empty is a valid state and the section disappears rather
  /// than showing a placeholder list.
  final List<SessionRow> recent;

  /// Open one of [recent] by id. Null when the shell cannot open sessions.
  final ValueChanged<String>? onRecent;

  /// The generated shortcut summary, already resolved from the registry.
  final String footer;

  /// Each surface's real binding label, also resolved from the registry.
  final Map<Surface, String> shortcuts;

  final ValueChanged<Surface> onSelect;

  /// The cursor row's key, owned by the shell so `j` can scroll it into view.
  final GlobalKey cursorKey;

  /// Every destination in the order the rail draws them, then Settings.
  static final _entries = <SidebarEntry>[
    for (final group in sidebarGroups) ...group.$2,
  ];

  /// The keyboard cursor's index for a drawn row: its position in [_entries],
  /// and `_entries.length` for the pinned Settings row.
  static int _indexOf(SidebarEntry entry) => _entries.indexOf(entry);

  String _countFor(SidebarEntry entry) => switch (entry) {
    SurfaceEntry(:final surface) => counts[surface] ?? '',
    AchievementsEntry() => achievements,
  };

  String _shortcutFor(SidebarEntry entry) => switch (entry) {
    SurfaceEntry(:final surface) => shortcuts[surface] ?? '',
    // The achievements layer has no surface chord of its own; `a` is the
    // registry's action and the leader overlay documents it.
    AchievementsEntry() => '',
  };

  bool _selected(SidebarEntry entry) => switch (entry) {
    // While the Achievements layer is open it owns the screen, so the surface
    // underneath is not also lit. Two highlighted rows made it look as if the
    // layer had navigated to Stats.
    SurfaceEntry(:final surface) => !achievementsActive && active == surface,
    // The layer is open or it is not; before, this row could never be active
    // because it was not a surface.
    AchievementsEntry() => achievementsActive,
  };

  @override
  Widget build(BuildContext context) {
    final body = Container(
      width: compact ? 64 : 208,
      color: LockedInColors.surface,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The destinations scroll; the shortcut footer stays pinned. A short
          // window would otherwise overflow once `RECENT` is populated.
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final (index, group) in sidebarGroups.indexed) ...[
                    if (group.$1 != null && !compact)
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          10,
                          index == 0 ? 6 : 14,
                          10,
                          6,
                        ),
                        child: Text(
                          group.$1!,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.micro,
                            letterSpacing: 1.4,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    if (group.$1 == null && !compact) const SizedBox(height: 4),
                    for (final entry in group.$2)
                      SidebarRow(
                        key: focused && _indexOf(entry) == cursor
                            ? cursorKey
                            : null,
                        cursor: focused && _indexOf(entry) == cursor,
                        glyph: switch (entry) {
                          SurfaceEntry(:final surface) => surface.glyph,
                          AchievementsEntry() => '★',
                        },
                        countKey: switch (entry) {
                          SurfaceEntry(:final surface) => surface.name,
                          AchievementsEntry() => 'achievements',
                        },
                        label: switch (entry) {
                          SurfaceEntry(:final surface) => surface.label,
                          AchievementsEntry() => 'Achievements',
                        },
                        icon: switch (entry) {
                          SurfaceEntry(:final surface) => surface.icon,
                          AchievementsEntry() => Icons.emoji_events_outlined,
                        },
                        count: compact ? '' : _countFor(entry),
                        // The chord stays in the tooltip in the icon rail: it
                        // is the only place a keyboard user can learn it there.
                        shortcut: _shortcutFor(entry),
                        selected: _selected(entry),
                        compact: compact,
                        onTap: switch (entry) {
                          SurfaceEntry(:final surface) => () => onSelect(
                            surface,
                          ),
                          AchievementsEntry() => onAchievements,
                        },
                      ),
                  ],
                  if (!compact && recent.isNotEmpty && onRecent != null) ...[
                    const SizedBox(height: 14),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 0, 10, 6),
                      child: Text(
                        'RECENT',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: TypeScale.micro,
                          letterSpacing: 1.4,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    for (final row in recent)
                      _RecentItem(row: row, onTap: () => onRecent!(row.id)),
                  ],
                ],
              ),
            ),
          ),
          // Settings is pinned under a rule: it is the destination a user
          // reaches for mid-task, and scrolling to find it would be a
          // regression from the flat list this replaced.
          if (!compact)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Container(height: 1, color: LockedInColors.line),
            ),
          SidebarRow(
            key: focused && cursor == _entries.length ? cursorKey : null,
            cursor: focused && cursor == _entries.length,
            glyph: Surface.settings.glyph,
            label: Surface.settings.label,
            icon: Surface.settings.icon,
            count: '',
            shortcut: shortcuts[Surface.settings] ?? '',
            selected: active == Surface.settings,
            compact: compact,
            onTap: () => onSelect(Surface.settings),
          ),
          if (!compact)
            Padding(
              padding: const EdgeInsets.all(10),
              child: Text(
                footer,
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
    return Focus(
      focusNode: focusNode,
      onKeyEvent: onKey,
      onFocusChange: onFocusChange,
      child: body,
    );
  }
}

/// One `RECENT` row: a session name and its date, opening on click.
///
/// It is deliberately not a `SidebarRow`: a recent entry is a *destination*
/// inside Sessions, not a surface, so it carries no shortcut chip and no
/// selected state — the surface row already shows that Sessions is open.
///
/// The name and the date are one text node so the row reads as a destination
/// (`Physics — Unit 4 · 2026-11-15`) rather than a second copy of the title the
/// open session shows.
class _RecentItem extends StatelessWidget {
  const _RecentItem({required this.row, required this.onTap});

  final SessionRow row;
  final VoidCallback onTap;

  /// `name · YYYY-MM-DD`, or just the name when the core sent no date.
  String get _label {
    final name = row.name.isEmpty ? row.id : row.name;
    if (row.date.isEmpty) return name;
    final day = row.date.length >= 10 ? row.date.substring(0, 10) : row.date;
    return '$name · $day';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.layer),
        child: InkWell(
          borderRadius: BorderRadius.circular(Radii.layer),
          onTap: onTap,
          child: Container(
            height: 32,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Row(
              children: [
                Icon(
                  Icons.chevron_right,
                  size: 14,
                  color: LockedInColors.muted,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _label,
                    key: ValueKey('recent-session-${row.id}'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                    ),
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

/// A destination row: icon, label, its size, and the key that opens it.
///
/// The shortcut is drawn as a keycap on purpose. A bare muted digit beside a
/// label reads as a count, which is exactly what the old sidebar did: `Sessions
/// 2` looked like two sessions whether the user had two or twenty. The count
/// now sits next to the label and the digit sits in a bordered keycap.
class SidebarRow extends StatelessWidget {
  const SidebarRow({
    super.key,
    required this.label,
    required this.glyph,
    required this.icon,
    required this.count,
    this.countKey,
    required this.shortcut,
    required this.selected,
    required this.compact,
    required this.onTap,
    this.cursor = false,
  });

  final String label;

  /// The stable id the count key uses (`sessions`, `skills`, `work`). It is the
  /// surface name, not the label: renaming the product name must not move a
  /// test key.
  final String? countKey;

  /// The mono glyph the expanded rail draws.
  final String glyph;

  /// The Material icon the compact rail draws.
  final IconData icon;
  final String count;
  final String shortcut;
  final bool selected;
  final bool compact;
  final VoidCallback? onTap;

  /// True for the row under the rail's keyboard cursor: an accent border, so
  /// the keyboard's place is visible without relying on colour alone.
  final bool cursor;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      // `shortcut` is the registry's display form (`Space e`, `Ctrl+K`), so the
      // tooltip can never disagree with the binding.
      message: shortcut.isEmpty ? label : '$shortcut · $label',
      waitDuration: const Duration(milliseconds: 500),
      child: Padding(
        // The keyboard cursor is a widget of its own so a test can assert
        // *which* row it is on, not merely that some row has it.
        key: cursor ? const ValueKey('sidebar-row-cursor') : null,
        padding: const EdgeInsets.only(bottom: 1),
        child: Material(
          color: selected ? LockedInColors.panel : Colors.transparent,
          borderRadius: BorderRadius.circular(Radii.control),
          child: InkWell(
            borderRadius: BorderRadius.circular(Radii.control),
            onTap: onTap,
            child: Container(
              height: 30,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(Radii.control),
                // The keyboard cursor is a fill *and* an outline: a colour on
                // its own would vanish for a colour-blind user, and the active
                // row keeps its own accent bar (`docs/design.md` §2.3).
                color: cursor ? LockedInColors.panel : null,
                // Always one pixel wide, transparent when the row is not under
                // the cursor: the label must not jump as `j` walks the rail.
                border: Border.all(
                  color: cursor ? LockedInColors.accent : Colors.transparent,
                ),
              ),
              // The active destination keeps its accent bar pinned to the row's
              // left edge in both rail widths; the keyboard cursor is the
              // outline above, so the two never collide. The bar is a layer
              // (not a row child) so a centred icon stays centred beside it.
              child: Stack(
                children: [
                  if (selected)
                    Positioned(
                      left: 0,
                      top: 6,
                      bottom: 6,
                      child: Container(
                        key: ValueKey('sidebar-selected-${countKey ?? label}'),
                        width: 2,
                        color: LockedInColors.primary,
                      ),
                    ),
                  Positioned.fill(
                    child: Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: compact ? 0 : 10,
                      ),
                      child: Row(
                        mainAxisAlignment: compact
                            ? MainAxisAlignment.center
                            : MainAxisAlignment.start,
                        children: [
                          if (compact)
                            Icon(
                              icon,
                              size: 17,
                              color: selected
                                  ? LockedInColors.primary
                                  : LockedInColors.muted,
                            )
                          else
                            // One cell wide, so every label starts on the same
                            // column whatever the glyph is.
                            SizedBox(
                              width: 18,
                              child: Text(
                                glyph,
                                maxLines: 1,
                                style: LockedInType.body.copyWith(
                                  fontSize: TypeScale.label,
                                  color: selected
                                      ? LockedInColors.primary
                                      : LockedInColors.muted,
                                ),
                              ),
                            ),
                          if (!compact) ...[
                            const SizedBox(width: Space.xs),
                            Expanded(
                              child: Text(
                                label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: LockedInType.body.copyWith(
                                  fontSize: TypeScale.key,
                                  color: selected
                                      ? LockedInColors.foreground
                                      : LockedInColors.muted,
                                  fontWeight: selected
                                      ? FontWeight.w600
                                      : FontWeight.w400,
                                ),
                              ),
                            ),
                            // The size sits in a fixed, right-aligned column. The
                            // chord is not drawn here on purpose: beside a count it read
                            // as a second count ("Sessions 3 2"). It stays in the
                            // tooltip, the palette and the footer summary, which is
                            // where a keyboard user looks for a binding.
                            if (count.isNotEmpty)
                              SizedBox(
                                width: 30,
                                child: Text(
                                  count,
                                  key: ValueKey('sidebar-count-$countKey'),
                                  textAlign: TextAlign.right,
                                  maxLines: 1,
                                  style: LockedInType.label.copyWith(
                                    color: LockedInColors.muted,
                                    fontSize: TypeScale.label,
                                    fontFeatures: const [
                                      FontFeature.tabularFigures(),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
