import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';

/// A small LaTeX renderer, written for this app.
///
/// Assistant answers and lessons use a narrow slice of maths — greek letters,
/// operators, fractions, roots, superscripts and subscripts. Rather than pull a
/// typesetting engine into the bundle, the app parses that slice into a widget
/// tree. It is deliberately a renderer, not a TeX implementation: an unknown
/// command keeps its text, and anything the parser cannot read falls back to
/// the source string in a mono face, so a bad expression is visible instead of
/// blank.
///
/// Inline maths (`$x^2$`) is a [WidgetSpan] so it sits in a sentence; display
/// maths (`$$…$$` or a `math` fence) is its own block.
class MathView extends StatelessWidget {
  const MathView(this.tex, {super.key, this.style, this.display = true});

  final String tex;
  final TextStyle? style;
  final bool display;

  @override
  Widget build(BuildContext context) {
    final base =
        style ??
        TextStyle(
          color: LockedInColors.foreground,
          fontFamily: 'JetBrainsMono',
          fontSize: display ? 14 : 13,
          height: 1.4,
        );
    final atoms = parseMath(tex);
    if (atoms.isEmpty) {
      return Text(tex, style: base);
    }
    final content = _atoms(context, atoms, base);
    if (!display) return content;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: content,
      ),
    );
  }

  Widget _atoms(BuildContext context, List<MathAtom> atoms, TextStyle base) {
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 1,
      children: [for (final atom in atoms) _atom(context, atom, base)],
    );
  }

  Widget _atom(BuildContext context, MathAtom atom, TextStyle base) {
    return switch (atom) {
      MathText() => Text(
        atom.text,
        style: atom.upright ? base : base.copyWith(fontStyle: FontStyle.italic),
      ),
      MathFraction() => IntrinsicWidth(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(child: _atoms(context, atom.numerator, base)),
            Container(
              height: 1,
              margin: const EdgeInsets.symmetric(vertical: 1.5),
              color: base.color ?? LockedInColors.foreground,
            ),
            Center(child: _atoms(context, atom.denominator, base)),
          ],
        ),
      ),
      MathSuperscript() => Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          _atoms(context, atom.base, base),
          Transform.translate(
            offset: const Offset(0, -5),
            child: _atoms(
              context,
              atom.exponent,
              base.copyWith(fontSize: (base.fontSize ?? 14) * 0.72),
            ),
          ),
        ],
      ),
      MathSubscript() => Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          _atoms(context, atom.base, base),
          Transform.translate(
            offset: const Offset(0, 4),
            child: _atoms(
              context,
              atom.subscript,
              base.copyWith(fontSize: (base.fontSize ?? 14) * 0.72),
            ),
          ),
        ],
      ),
      MathRoot() => Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text('√', style: base),
          Container(
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(color: base.color ?? LockedInColors.foreground),
              ),
            ),
            padding: const EdgeInsets.only(left: 1, top: 1),
            child: _atoms(context, atom.body, base),
          ),
        ],
      ),
    };
  }
}

/// Inline maths inside a sentence. The caller adds the [WidgetSpan].
class InlineMath extends StatelessWidget {
  const InlineMath(this.tex, {super.key, this.style});

  final String tex;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) =>
      MathView(tex, style: style, display: false);
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

sealed class MathAtom {
  const MathAtom();
}

class MathText extends MathAtom {
  const MathText(this.text, {this.upright = false});
  final String text;
  final bool upright;
}

class MathFraction extends MathAtom {
  const MathFraction(this.numerator, this.denominator);
  final List<MathAtom> numerator;
  final List<MathAtom> denominator;
}

class MathSuperscript extends MathAtom {
  const MathSuperscript(this.base, this.exponent);
  final List<MathAtom> base;
  final List<MathAtom> exponent;
}

class MathSubscript extends MathAtom {
  const MathSubscript(this.base, this.subscript);
  final List<MathAtom> base;
  final List<MathAtom> subscript;
}

class MathRoot extends MathAtom {
  const MathRoot(this.body);
  final List<MathAtom> body;
}

const _symbols = <String, String>{
  'alpha': 'α',
  'beta': 'β',
  'gamma': 'γ',
  'delta': 'δ',
  'epsilon': 'ε',
  'varepsilon': 'ε',
  'zeta': 'ζ',
  'eta': 'η',
  'theta': 'θ',
  'iota': 'ι',
  'kappa': 'κ',
  'lambda': 'λ',
  'mu': 'μ',
  'nu': 'ν',
  'xi': 'ξ',
  'pi': 'π',
  'rho': 'ρ',
  'sigma': 'σ',
  'tau': 'τ',
  'upsilon': 'υ',
  'phi': 'φ',
  'chi': 'χ',
  'psi': 'ψ',
  'omega': 'ω',
  'Gamma': 'Γ',
  'Delta': 'Δ',
  'Theta': 'Θ',
  'Lambda': 'Λ',
  'Xi': 'Ξ',
  'Pi': 'Π',
  'Sigma': 'Σ',
  'Phi': 'Φ',
  'Psi': 'Ψ',
  'Omega': 'Ω',
  'times': '×',
  'cdot': '·',
  'div': '÷',
  'pm': '±',
  'mp': '∓',
  'le': '≤',
  'leq': '≤',
  'ge': '≥',
  'geq': '≥',
  'ne': '≠',
  'neq': '≠',
  'approx': '≈',
  'equiv': '≡',
  'to': '→',
  'rightarrow': '→',
  'leftarrow': '←',
  'leftrightarrow': '↔',
  'Rightarrow': '⇒',
  'Leftarrow': '⇐',
  'infty': '∞',
  'partial': '∂',
  'nabla': '∇',
  'sum': '∑',
  'prod': '∏',
  'int': '∫',
  'in': '∈',
  'notin': '∉',
  'subset': '⊂',
  'subseteq': '⊆',
  'cup': '∪',
  'cap': '∩',
  'forall': '∀',
  'exists': '∃',
  'emptyset': '∅',
  'therefore': '∴',
  'ldots': '…',
  'dots': '…',
  'circ': '∘',
  'degree': '°',
  'prime': '′',
  'hbar': 'ℏ',
  'ell': 'ℓ',
};

const _spaces = <String, String>{
  ',': '\u2009',
  ':': '\u2005',
  ';': '\u2004',
  '!': '',
  'quad': '\u2003',
  'qquad': '\u2003\u2003',
  ' ': ' ',
};

/// Parse the supported LaTeX slice. Always returns something renderable.
List<MathAtom> parseMath(String source) {
  final parser = _MathParser(source);
  final atoms = parser.parseList();
  return _merge(atoms);
}

class _MathParser {
  _MathParser(this.source);
  final String source;
  int index = 0;

  List<MathAtom> parseList({String? stop}) {
    final atoms = <MathAtom>[];
    final buffer = StringBuffer();
    var upright = false;

    void flush() {
      if (buffer.isEmpty) return;
      atoms.add(MathText(buffer.toString(), upright: upright));
      buffer.clear();
    }

    while (index < source.length) {
      final char = source[index];
      if (stop != null && char == stop) {
        index++;
        break;
      }
      if (char == '\\') {
        final command = _command();
        if (command == null) {
          buffer.write(char);
          index++;
          continue;
        }
        final (name, argument) = command;
        if (_spaces.containsKey(name)) {
          flush();
          atoms.add(MathText(_spaces[name]!, upright: true));
          continue;
        }
        if (name == 'text' || name == 'mathrm' || name == 'operatorname') {
          flush();
          final body = argument ?? _readGroupRaw();
          atoms.add(MathText(body, upright: true));
          continue;
        }
        if (name == 'frac' || name == 'dfrac' || name == 'tfrac') {
          flush();
          final numerator = argument != null
              ? parseGroup(argument)
              : _readGroup();
          final denominator = _readGroup();
          atoms.add(MathFraction(numerator, denominator));
          continue;
        }
        if (name == 'sqrt') {
          flush();
          final body = argument != null ? parseGroup(argument) : _readGroup();
          atoms.add(MathRoot(body));
          continue;
        }
        if (name == 'left' || name == 'right') {
          // The delimiter itself is the next character; render it upright.
          flush();
          if (index < source.length) {
            atoms.add(MathText(source[index], upright: true));
            index++;
          }
          continue;
        }
        final symbol = _symbols[name];
        if (symbol != null) {
          flush();
          atoms.add(MathText(symbol, upright: true));
          continue;
        }
        // Unknown command: keep its name visible rather than dropping it.
        flush();
        atoms.add(MathText(name, upright: true));
        continue;
      }
      if (char == '^' || char == '_') {
        flush();
        index++;
        final argument = _readGroup();
        final base = atoms.isEmpty
            ? <MathAtom>[const MathText('', upright: true)]
            : <MathAtom>[atoms.removeLast()];
        atoms.add(
          char == '^'
              ? MathSuperscript(base, argument)
              : MathSubscript(base, argument),
        );
        continue;
      }
      if (char == '{') {
        index++;
        final inner = parseList(stop: '}');
        flush();
        atoms.addAll(inner);
        continue;
      }
      if (char == '}') {
        // A stray close brace is not a failure; it ends the current run.
        index++;
        continue;
      }
      if (char == '~') {
        flush();
        atoms.add(const MathText(' ', upright: true));
        index++;
        continue;
      }
      if (RegExp(r'[A-Za-z]').hasMatch(char)) {
        // One letter per italic run keeps `xy` reading as x·y, as maths does.
        flush();
        atoms.add(MathText(char));
        index++;
        continue;
      }
      if (char == ' ') {
        flush();
        atoms.add(const MathText(' ', upright: true));
        index++;
        continue;
      }
      buffer.write(char);
      index++;
    }
    flush();
    return atoms;
  }

  /// A command name and, when it is a braced group, its raw argument.
  (String, String?)? _command() {
    if (source[index] != '\\') return null;
    index++;
    if (index >= source.length) return null;
    if (!RegExp(r'[A-Za-z]').hasMatch(source[index])) {
      // `\,` and friends: a one-character command.
      final name = source[index];
      index++;
      return (name, null);
    }
    final start = index;
    while (index < source.length &&
        RegExp(r'[A-Za-z]').hasMatch(source[index])) {
      index++;
    }
    final name = source.substring(start, index);
    String? argument;
    if (index < source.length && source[index] == '{') {
      argument = _readGroupRaw();
    }
    return (name, argument);
  }

  List<MathAtom> parseGroup(String raw) {
    final parser = _MathParser(raw);
    return _merge(parser.parseList());
  }

  List<MathAtom> _readGroup() {
    if (index < source.length && source[index] == '{') {
      index++;
      return _merge(parseList(stop: '}'));
    }
    if (index >= source.length) return const [];
    if (source[index] == '\\') {
      final command = _command();
      if (command == null) return const [];
      final (name, argument) = command;
      if (name == 'frac') {
        final numerator = argument != null
            ? parseGroup(argument)
            : _readGroup();
        return [MathFraction(numerator, _readGroup())];
      }
      final symbol = _symbols[name];
      if (symbol != null) return [MathText(symbol, upright: true)];
      return [MathText(name, upright: true)];
    }
    final char = source[index];
    index++;
    return [MathText(char)];
  }

  String _readGroupRaw() {
    if (index >= source.length || source[index] != '{') return '';
    index++;
    final start = index;
    var depth = 1;
    while (index < source.length && depth > 0) {
      if (source[index] == '{') depth++;
      if (source[index] == '}') depth--;
      if (depth == 0) break;
      index++;
    }
    final body = source.substring(start, index);
    if (index < source.length) index++;
    return body;
  }
}

/// Adjacent text runs are one run, so a word is not one widget per letter.
List<MathAtom> _merge(List<MathAtom> atoms) {
  final out = <MathAtom>[];
  for (final atom in atoms) {
    if (atom is MathText &&
        out.isNotEmpty &&
        out.last is MathText &&
        (out.last as MathText).upright == atom.upright) {
      final previous = out.removeLast() as MathText;
      out.add(MathText(previous.text + atom.text, upright: atom.upright));
    } else if (atom is MathText && atom.text.isEmpty) {
      continue;
    } else {
      out.add(atom);
    }
  }
  return out;
}

/// A compact summary for a11y and tests: the text a reader would hear.
String mathPlainText(List<MathAtom> atoms) {
  final buffer = StringBuffer();
  void walk(List<MathAtom> list) {
    for (final atom in list) {
      switch (atom) {
        case MathText():
          buffer.write(atom.text);
        case MathFraction():
          buffer.write(' ');
          walk(atom.numerator);
          buffer.write(' over ');
          walk(atom.denominator);
          buffer.write(' ');
        case MathSuperscript():
          walk(atom.base);
          buffer.write(' to the ');
          walk(atom.exponent);
        case MathSubscript():
          walk(atom.base);
          buffer.write(' sub ');
          walk(atom.subscript);
        case MathRoot():
          buffer.write(' root of ');
          walk(atom.body);
      }
    }
  }

  walk(atoms);
  return buffer.toString().replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// The maximum width a row of atoms wants, used by tests and the block frame.
double mathIntrinsicWidth(List<MathAtom> atoms, TextStyle style) {
  final painter = TextPainter(
    text: TextSpan(text: mathPlainText(atoms), style: style),
    textDirection: TextDirection.ltr,
    maxLines: 1,
  )..layout();
  return math.max(0, painter.width);
}
