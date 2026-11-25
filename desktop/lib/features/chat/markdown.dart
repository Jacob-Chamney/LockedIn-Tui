import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import 'code_highlight.dart';
import 'diagram.dart';
import 'math.dart';

/// Renders a small, safe subset of Markdown inside a chat bubble.
///
/// The subset is deliberately limited to what assistant answers use: headings,
/// paragraphs with inline emphasis/code/links, lists, checkboxes, fenced code
/// and pipe tables. Links render as their label plus the muted URL and never
/// launch anything.
///
/// The parser is tolerant on purpose: a streaming answer is re-rendered on
/// every delta, so an unclosed fence, a dangling `**` or an empty string must
/// render something sensible instead of throwing or flickering.
class ChatMarkdown extends StatelessWidget {
  const ChatMarkdown({super.key, required this.text, this.style});

  final String text;

  /// Base body style. Defaults to the theme body style.
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final blocks = _parse(text);
    if (blocks.isEmpty) return const SizedBox.shrink();

    final base =
        style ??
        Theme.of(context).textTheme.bodyMedium ??
        TextStyle(color: LockedInColors.foreground, fontSize: 14, height: 1.45);

    final children = <Widget>[];
    for (var index = 0; index < blocks.length; index++) {
      if (index > 0) children.add(const SizedBox(height: 8));
      children.add(_buildBlock(blocks[index], base));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: children,
    );
  }

  Widget _buildBlock(_MdBlock block, TextStyle base) {
    return switch (block) {
      _MdHeading() => _heading(block, base),
      _MdParagraph() => Text.rich(
        TextSpan(style: base, children: _inline(block.text, base)),
      ),
      _MdQuote() => Container(
        width: double.infinity,
        padding: const EdgeInsets.only(left: 10, top: 2, bottom: 2),
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(color: LockedInColors.primary, width: 3),
          ),
        ),
        child: Text.rich(
          TextSpan(
            style: base.copyWith(color: LockedInColors.muted),
            children: _inline(
              block.text,
              base.copyWith(color: LockedInColors.muted),
            ),
          ),
        ),
      ),
      _MdList() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final item in block.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 26,
                    child: Text(_marker(item), style: _markerStyle(item, base)),
                  ),
                  Expanded(
                    child: Text.rich(
                      TextSpan(style: base, children: _inline(item.text, base)),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
      _MdCode() => _codePanel(block),
      _MdMath() => MathView(block.tex, style: base),
      _MdDiagram() =>
        parseFlowchart(block.source) == null
            ? _codePanel(_MdCode(block.source, 'mermaid'))
            : Flowchart(block.source),
      _MdTable() => _table(block, base),
    };
  }

  Widget _heading(_MdHeading block, TextStyle base) {
    final style = base.copyWith(
      fontSize: _headingSize(block.level, base.fontSize),
      fontWeight: FontWeight.w700,
      color: LockedInColors.foreground,
      height: 1.3,
    );
    return Text.rich(
      TextSpan(style: style, children: _inline(block.text, style)),
    );
  }

  Widget _codePanel(_MdCode block) {
    final codeStyle = TextStyle(
      color: LockedInColors.foreground,
      fontFamily: 'monospace',
      fontSize: 12.5,
      height: 1.4,
    );
    // Highlighting is a lexer: an unknown language returns null and the block
    // stays a plain Text widget, so a fence the app does not know costs nothing.
    final tokens = highlightCode(block.code, block.language);
    final coloured =
        tokens != null &&
        tokens.any((token) => token.kind != CodeTokenKind.plain);
    return Container(
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (block.language != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 6, 10, 0),
              child: Text(
                block.language!,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 10,
                  letterSpacing: 1,
                ),
              ),
            ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: coloured
                ? Text.rich(
                    TextSpan(style: codeStyle, children: _codeSpans(tokens)),
                    softWrap: false,
                  )
                : Text(
                    block.code.isEmpty ? ' ' : block.code,
                    softWrap: false,
                    style: codeStyle,
                  ),
          ),
        ],
      ),
    );
  }

  Widget _table(_MdTable block, TextStyle base) {
    return Container(
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var row = 0; row < block.rows.length; row++) ...[
            if (row > 0)
              Divider(height: 1, thickness: 1, color: LockedInColors.line),
            Container(
              color: row == 0 ? LockedInColors.surface : null,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var cell = 0; cell < block.rows[row].length; cell++) ...[
                    if (cell > 0) const SizedBox(width: 12),
                    Expanded(
                      child: _cell(block.rows[row][cell], base, row == 0),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _cell(String text, TextStyle base, bool header) {
    final style = base.copyWith(
      fontSize: 12.5,
      fontWeight: header ? FontWeight.w700 : null,
      height: 1.35,
    );
    return Text.rich(TextSpan(style: style, children: _inline(text, style)));
  }
}

/// The token colours. Tokens come from the active palette, never a second
/// palette or a hex literal.
List<InlineSpan> _codeSpans(List<CodeToken> tokens) {
  return [
    for (final token in tokens)
      TextSpan(text: token.text, style: _codeTokenStyle(token.kind)),
  ];
}

TextStyle? _codeTokenStyle(CodeTokenKind kind) {
  return switch (kind) {
    CodeTokenKind.plain => null,
    CodeTokenKind.comment => TextStyle(
      color: LockedInColors.muted,
      fontStyle: FontStyle.italic,
    ),
    CodeTokenKind.string => TextStyle(color: LockedInColors.success),
    CodeTokenKind.number => TextStyle(color: LockedInColors.accent),
    CodeTokenKind.keyword => TextStyle(
      color: LockedInColors.primary,
      fontWeight: FontWeight.w600,
    ),
    CodeTokenKind.literal => TextStyle(color: LockedInColors.secondary),
  };
}

double _headingSize(int level, double? base) {
  final size = base ?? 14;
  return switch (level) {
    1 => size + 5,
    2 => size + 3,
    3 => size + 1,
    _ => size,
  };
}

String _marker(_MdItem item) {
  if (item.checked != null) return item.checked! ? '☑' : '☐';
  if (item.number != null) return '${item.number}.';
  return '•';
}

TextStyle _markerStyle(_MdItem item, TextStyle base) {
  if (item.checked != null) {
    return base.copyWith(
      color: item.checked! ? LockedInColors.success : LockedInColors.muted,
      fontSize: (base.fontSize ?? 14) + 1,
      height: 1.2,
    );
  }
  return base.copyWith(color: LockedInColors.muted);
}

/// Splits inline Markdown into spans. Unclosed markers render literally so a
/// streamed, still-growing answer never loses characters.
List<InlineSpan> _inline(String source, TextStyle base) {
  final spans = <InlineSpan>[];
  final buffer = StringBuffer();
  var index = 0;

  void flush() {
    if (buffer.isEmpty) return;
    spans.add(TextSpan(text: buffer.toString(), style: base));
    buffer.clear();
  }

  while (index < source.length) {
    final char = source[index];

    if (char == '`') {
      final end = source.indexOf('`', index + 1);
      if (end == -1) {
        buffer.write(char);
        index++;
        continue;
      }
      flush();
      spans.add(
        TextSpan(
          text: source.substring(index + 1, end),
          style: base.copyWith(
            fontFamily: 'monospace',
            color: LockedInColors.primary,
            backgroundColor: LockedInColors.background.withValues(alpha: 0.55),
          ),
        ),
      );
      index = end + 1;
      continue;
    }

    if (char == '*' && index + 1 < source.length && source[index + 1] == '*') {
      final end = source.indexOf('**', index + 2);
      if (end == -1) {
        buffer.write(char);
        index++;
        continue;
      }
      flush();
      spans.addAll(
        _inline(
          source.substring(index + 2, end),
          base.copyWith(fontWeight: FontWeight.w700),
        ),
      );
      index = end + 2;
      continue;
    }

    if (char == '*') {
      final end = source.indexOf('*', index + 1);
      if (end <= index + 1) {
        buffer.write(char);
        index++;
        continue;
      }
      flush();
      spans.addAll(
        _inline(
          source.substring(index + 1, end),
          base.copyWith(fontStyle: FontStyle.italic),
        ),
      );
      index = end + 1;
      continue;
    }

    if (char == r'$') {
      final close = source.indexOf(r'$', index + 1);
      if (close > index + 1) {
        final content = source.substring(index + 1, close);
        final looksLikeMath =
            !content.startsWith(' ') &&
            !content.endsWith(' ') &&
            RegExp(r'[A-Za-z\\^_{}=+\-*/<>]').hasMatch(content);
        if (looksLikeMath && !content.contains('\n')) {
          flush();
          spans.add(
            WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: InlineMath(content, style: base),
            ),
          );
          index = close + 1;
          continue;
        }
      }
      buffer.write(char);
      index++;
      continue;
    }

    if (char == '[') {
      final close = source.indexOf(']', index + 1);
      if (close != -1 &&
          close + 1 < source.length &&
          source[close + 1] == '(') {
        final paren = source.indexOf(')', close + 2);
        if (paren != -1) {
          flush();
          final label = source.substring(index + 1, close);
          final url = source.substring(close + 2, paren);
          if (label.isNotEmpty) {
            spans.addAll(
              _inline(
                label,
                base.copyWith(
                  color: LockedInColors.secondary,
                  decoration: TextDecoration.underline,
                  decorationColor: LockedInColors.muted,
                ),
              ),
            );
          }
          if (url.isNotEmpty) {
            spans.add(
              TextSpan(
                text: ' $url',
                style: base.copyWith(
                  color: LockedInColors.muted,
                  fontSize: (base.fontSize ?? 14) - 1.5,
                ),
              ),
            );
          }
          index = paren + 1;
          continue;
        }
      }
      buffer.write(char);
      index++;
      continue;
    }

    buffer.write(char);
    index++;
  }

  flush();
  return spans;
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

sealed class _MdBlock {
  const _MdBlock();
}

class _MdHeading extends _MdBlock {
  const _MdHeading(this.level, this.text);
  final int level;
  final String text;
}

class _MdParagraph extends _MdBlock {
  const _MdParagraph(this.text);
  final String text;
}

class _MdQuote extends _MdBlock {
  const _MdQuote(this.text);
  final String text;
}

class _MdList extends _MdBlock {
  const _MdList(this.items);
  final List<_MdItem> items;
}

class _MdItem {
  const _MdItem(this.text, {this.checked, this.number});
  final String text;
  final bool? checked;
  final int? number;
}

class _MdCode extends _MdBlock {
  const _MdCode(this.code, this.language);
  final String code;
  final String? language;
}

class _MdTable extends _MdBlock {
  const _MdTable(this.rows);
  final List<List<String>> rows;
}

class _MdMath extends _MdBlock {
  const _MdMath(this.tex);
  final String tex;
}

class _MdDiagram extends _MdBlock {
  const _MdDiagram(this.source);
  final String source;
}

final _headingPattern = RegExp(r'^(#{1,6})\s+(.*)$');
final _bulletPattern = RegExp(r'^[-*]\s+(.*)$');
final _checkboxPattern = RegExp(r'^[-*]\s+\[([ xX])\]\s+(.*)$');
final _orderedPattern = RegExp(r'^(\d{1,3})[.)]\s+(.*)$');
final _separatorPattern = RegExp(r'^\|?[\s:|-]+\|?$');

List<_MdBlock> _parse(String source) {
  final lines = source
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n');
  final blocks = <_MdBlock>[];
  var index = 0;

  while (index < lines.length) {
    final line = lines[index];
    final trimmed = line.trimLeft();

    if (trimmed.trim().isEmpty) {
      index++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      final language = trimmed.substring(3).trim();
      final body = <String>[];
      index++;
      while (index < lines.length &&
          !lines[index].trimLeft().startsWith('```')) {
        body.add(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      final bodyText = body.join('\n');
      if (language.toLowerCase() == 'math') {
        blocks.add(_MdMath(bodyText));
      } else if (language.toLowerCase() == 'mermaid') {
        blocks.add(_MdDiagram(bodyText));
      } else {
        blocks.add(_MdCode(bodyText, language.isEmpty ? null : language));
      }
      continue;
    }

    if (trimmed.startsWith(r'$$')) {
      final body = <String>[];
      final rest = trimmed.substring(2);
      if (rest.trim().length >= 2 && rest.trim().endsWith(r'$$')) {
        body.add(rest.trim().substring(0, rest.trim().length - 2));
        index++;
      } else {
        if (rest.trim().isNotEmpty) body.add(rest);
        index++;
        while (index < lines.length) {
          final candidate = lines[index].trimRight();
          if (candidate.endsWith(r'$$')) {
            body.add(candidate.substring(0, candidate.length - 2));
            index++;
            break;
          }
          body.add(lines[index]);
          index++;
        }
      }
      blocks.add(_MdMath(body.join('\n')));
      continue;
    }

    final heading = _headingPattern.firstMatch(trimmed);
    if (heading != null) {
      blocks.add(
        _MdHeading(heading.group(1)!.length, heading.group(2)!.trim()),
      );
      index++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      final parts = <String>[];
      while (index < lines.length) {
        final quoteLine = lines[index].trimLeft();
        if (!quoteLine.startsWith('>')) break;
        parts.add(quoteLine.substring(1).trimLeft());
        index++;
      }
      blocks.add(_MdQuote(parts.join('\n')));
      continue;
    }

    if (trimmed.contains('|') &&
        index + 1 < lines.length &&
        _isTableSeparator(lines[index + 1])) {
      final rows = <List<String>>[_cells(trimmed)];
      index += 2;
      while (index < lines.length) {
        final rowLine = lines[index].trim();
        if (rowLine.isEmpty || !rowLine.contains('|')) break;
        rows.add(_cells(rowLine));
        index++;
      }
      final columns = rows.fold<int>(
        1,
        (widest, row) => row.length > widest ? row.length : widest,
      );
      final padded = [
        for (final row in rows) ...[
          [...row, ...List.filled(columns - row.length, '')],
        ],
      ];
      blocks.add(_MdTable(padded));
      continue;
    }

    final items = <_MdItem>[];
    while (index < lines.length) {
      final itemLine = lines[index].trimLeft();
      if (itemLine.trim().isEmpty) break;

      final checkbox = _checkboxPattern.firstMatch(itemLine);
      if (checkbox != null) {
        items.add(
          _MdItem(
            checkbox.group(2)!.trimRight(),
            checked: checkbox.group(1)!.toLowerCase() == 'x',
          ),
        );
        index++;
        continue;
      }

      final bullet = _bulletPattern.firstMatch(itemLine);
      if (bullet != null) {
        items.add(_MdItem(bullet.group(1)!.trimRight()));
        index++;
        continue;
      }

      final ordered = _orderedPattern.firstMatch(itemLine);
      if (ordered != null) {
        items.add(
          _MdItem(
            ordered.group(2)!.trimRight(),
            number: int.tryParse(ordered.group(1)!) ?? 1,
          ),
        );
        index++;
        continue;
      }

      break;
    }
    if (items.isNotEmpty) {
      blocks.add(_MdList(items));
      continue;
    }

    final paragraph = <String>[];
    while (index < lines.length) {
      final paragraphLine = lines[index].trim();
      if (paragraphLine.isEmpty) break;
      if (_startsBlock(lines[index])) break;
      paragraph.add(paragraphLine);
      index++;
    }
    if (paragraph.isEmpty) {
      // Defensive: never loop on a line the block tests cannot consume.
      index++;
      continue;
    }
    blocks.add(_MdParagraph(paragraph.join(' ')));
  }

  return blocks;
}

bool _startsBlock(String line) {
  final trimmed = line.trimLeft();
  if (trimmed.startsWith('```')) return true;
  if (trimmed.startsWith('>')) return true;
  if (_headingPattern.hasMatch(trimmed)) return true;
  if (_checkboxPattern.hasMatch(trimmed)) return true;
  if (_bulletPattern.hasMatch(trimmed)) return true;
  if (_orderedPattern.hasMatch(trimmed)) return true;
  return false;
}

bool _isTableSeparator(String line) {
  final trimmed = line.trim();
  if (trimmed.isEmpty || !trimmed.contains('-')) return false;
  return _separatorPattern.hasMatch(trimmed);
}

List<String> _cells(String line) {
  var value = line.trim();
  if (value.startsWith('|')) value = value.substring(1);
  if (value.endsWith('|')) value = value.substring(0, value.length - 1);
  return [for (final cell in value.split('|')) cell.trim()];
}
