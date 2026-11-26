import 'package:material_ui/material_ui.dart';

enum Surface {
  chat('Chat', '◇', Icons.forum_outlined, 'Enter send · Shift+Enter newline'),
  sessions('Sessions', '▤', Icons.history, '↑↓ move · / search · Esc clear'),
  // Teaching is the harness: measure → plan → teach → practice. The enum id is
  // `teaching` while the protocol keeps its `skill.*` methods and `skills`
  // storage — renaming those is a wire change, and the wall is a path rule, not
  // a label (`desktop/docs/redesign.md` §4a).
  skills(
    // The product name. The enum id and the `skill.*` methods keep the old
    // word: renaming those is a wire change, and the label is what a person
    // reads.
    'Teaching',
    '◈',
    Icons.school_outlined,
    'Enter open · n new goal · Esc back',
  ),
  sources('Sources', '▢', Icons.folder_open_outlined, 'a add · r reload'),
  stats(
    'Stats',
    '▦',
    Icons.insights_outlined,
    'r range · s scope · a achievements · x export',
  ),
  work(
    'Work',
    '⌗',
    Icons.work_outline,
    'n new project · Enter open · Esc back',
  ),
  review(
    'Review',
    '↻',
    Icons.checklist,
    'j/k move · Enter open · k known · m missed · r refresh · s side · Esc back',
  ),
  archive('Archive', '▣', Icons.archive_outlined, 'r refresh · Esc back'),
  knowledge(
    'Knowledge',
    '◍',
    Icons.hub_outlined,
    '/ search · j/k move · Enter open · Esc back',
  ),
  settings('Settings', '◆', Icons.tune, '↑↓ move · Enter edit · Esc back');

  const Surface(this.label, this.glyph, this.icon, this.hint);

  final String label;

  /// The mono glyph the expanded rail and the breadcrumb draw. A Material icon
  /// in a text column is what made the rail read as a phone app; the glyph is
  /// one terminal cell wide and sits on the same baseline as the label.
  final String glyph;

  /// The Material icon the **compact** rail draws. The narrow rail is 40 px and
  /// a glyph alone is hard to hit, so it keeps the icon (and its tests).
  final IconData icon;

  final String hint;
}

/// How the navigation rail is showing.
///
/// Two states only: full labels, or the icon rail. There is no "hidden" state —
/// a desktop window with no navigation is a dead end, and the shrink is what
/// gives the chat its width back. The rail starts **shrunk**, so a new window
/// opens on the chat with the icons down the side (`docs/design.md` §2.2).
enum SidebarMode {
  expanded,
  icons;

  IconData get icon => switch (this) {
    SidebarMode.expanded => Icons.menu_open,
    SidebarMode.icons => Icons.menu,
  };
}
