/// One scale for the shell's layout thresholds.
///
/// The app used to compare against the same widths as bare numbers in a dozen
/// files, so "narrow" meant 560 on one page, 620 on the next and 720 on a third
/// (UI review #22). These constants name the *concept*, not the pixel: a page
/// picks the concept it needs, and changing a threshold is one edit here.
abstract final class Breakpoints {
  /// Below this window width the rail collapses to icons.
  static const double rail = 900;

  /// A wide window opens with the rail expanded; a laptop-sized one starts
  /// shrunk so the first frame keeps a wide composer.
  static const double railWide = 1200;

  /// The reading column shared by detail views and list managers.
  static const double content = 900;

  /// The wider data column: Stats' cards and charts use the extra room.
  static const double contentWide = 1180;

  /// A chat keeps a 340 px context pane beside it at this width. This is the
  /// same floor as a two-column detail, so the rail can be open on a laptop and
  /// the pane still leaves 640 px for the transcript.
  static const double split = 980;

  /// Below this width a four-up KPI row becomes two, and a two-column detail
  /// becomes one.
  static const double columns = 980;

  /// A row's trailing column (a date, a chapter count) and a side-by-side pane
  /// split: below this the trailing column is dropped and the panes stack.
  static const double column = 700;

  /// A search match's snippet: below this the result row omits it.
  static const double snippet = 640;

  /// The compact header and the dropped header hint: below this the header
  /// shortens to icons and the one-line hint goes away.
  static const double hint = 560;

  /// The smallest layout: a label above its value, or a chip under the title.
  static const double stack = 520;
}
