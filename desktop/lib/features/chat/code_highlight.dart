/// A tiny, forgiving syntax highlighter for the fenced code blocks the app
/// actually shows.
///
/// This is a **lexer, not a parser**. It walks one line at a time, never
/// throws, and colours only what it can classify unambiguously:
///
/// * `comment` — `muted`
/// * `string` — `success`
/// * `number` — `accent`
/// * `keyword` — `primary`
/// * `literal` — `secondary`
/// * everything else stays `plain` and inherits the code panel's foreground.
///
/// A streaming answer re-renders on every delta, so an unterminated string, an
/// unclosed block comment or a partial fence must render something rather than
/// throw: the remainder of the line is simply coloured as the token it opened.
/// An unknown language returns `null` so the caller renders the block plain and
/// does no highlighting work at all.
library;

/// The fenced languages the app highlights.
enum CodeLanguage {
  dart,
  typescript,
  javascript,
  json,
  bash,
  python,
  c,
  cpp,
  markdown,
}

/// One lexical class a run of code can have.
enum CodeTokenKind { plain, comment, string, number, keyword, literal }

/// One contiguous run of text with a single lexical class.
class CodeToken {
  const CodeToken(this.text, this.kind);

  final String text;
  final CodeTokenKind kind;

  @override
  bool operator ==(Object other) =>
      other is CodeToken && other.text == text && other.kind == kind;

  @override
  int get hashCode => Object.hash(text, kind);

  @override
  String toString() =>
      'CodeToken(${kind.name}, ${text.replaceAll('\n', r'\n')})';
}

/// Resolve a fence label (`dart`, `ts`, ` ```js ` …) to a language.
///
/// Returns null for an empty or unknown label, which is the signal to skip
/// highlighting entirely.
CodeLanguage? codeLanguageFor(String? label) {
  final normalized = (label ?? '').trim().toLowerCase();
  if (normalized.isEmpty) return null;
  // Some fences carry attributes (`ts title="x"`); the first word is the
  // language that matters.
  final first = normalized.split(RegExp(r'[\s{,}]')).first;
  return switch (first) {
    'dart' => CodeLanguage.dart,
    'ts' || 'typescript' => CodeLanguage.typescript,
    'js' || 'javascript' || 'jsx' || 'tsx' => CodeLanguage.javascript,
    'json' => CodeLanguage.json,
    'bash' || 'sh' || 'shell' || 'zsh' => CodeLanguage.bash,
    'py' || 'python' => CodeLanguage.python,
    'c' || 'h' => CodeLanguage.c,
    'cpp' || 'c++' || 'cc' || 'cxx' || 'hpp' => CodeLanguage.cpp,
    'md' || 'markdown' => CodeLanguage.markdown,
    _ => null,
  };
}

/// Tokenise a whole fenced block for [label].
///
/// Returns `null` when the label is unknown, so the caller can keep its plain
/// `Text` widget. The returned tokens preserve every character (newlines
/// included), so `tokens.map((t) => t.text).join()` is the original [code].
List<CodeToken>? highlightCode(String code, String? label) {
  final language = codeLanguageFor(label);
  if (language == null) return null;
  if (code.isEmpty) return const <CodeToken>[];

  final lexer = _Lexer(language);
  final out = <CodeToken>[];
  final lines = code.split('\n');
  for (var index = 0; index < lines.length; index++) {
    // Keep line boundaries as their own plain token: merging a plain run across
    // hundreds of lines would concatenate the same string repeatedly.
    if (index > 0) out.add(const CodeToken('\n', CodeTokenKind.plain));
    out.addAll(lexer.tokenizeLine(lines[index]));
  }
  return out;
}

/// Tokenise exactly one line. Exposed for tests; the block API is the normal
/// entry point.
List<CodeToken> highlightCodeLine(String line, String? label) {
  final language = codeLanguageFor(label);
  if (language == null) return [CodeToken(line, CodeTokenKind.plain)];
  return _Lexer(language).tokenizeLine(line);
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

class _Lexer {
  _Lexer(this.language);

  final CodeLanguage language;
  bool _inBlockComment = false;

  List<CodeToken> tokenizeLine(String line) {
    if (language == CodeLanguage.markdown) return _markdownLine(line);
    return _codeLine(line);
  }

  List<CodeToken> _codeLine(String line) {
    final out = <CodeToken>[];
    final plain = StringBuffer();
    final spec = _specFor(language);

    void flushPlain() {
      if (plain.isEmpty) return;
      _add(out, plain.toString(), CodeTokenKind.plain);
      plain.clear();
    }

    var index = 0;
    final length = line.length;
    while (index < length) {
      // Continue a block comment that started on a previous line.
      if (_inBlockComment) {
        final end = line.indexOf(spec.blockEnd!, index);
        if (end < 0) {
          flushPlain();
          _add(out, line.substring(index), CodeTokenKind.comment);
          return out;
        }
        flushPlain();
        _add(
          out,
          line.substring(index, end + spec.blockEnd!.length),
          CodeTokenKind.comment,
        );
        index = end + spec.blockEnd!.length;
        _inBlockComment = false;
        continue;
      }

      final char = line[index];

      // Preprocessor lines (`#include`, `#define`) are metadata, not code.
      if (spec.preprocessor && char == '#' && _atLineStart(line, index)) {
        flushPlain();
        _add(out, line.substring(index), CodeTokenKind.comment);
        return out;
      }

      // Line comments.
      if (spec.lineComment != null &&
          line.startsWith(spec.lineComment!, index) &&
          _commentBoundary(line, index, spec.lineComment!)) {
        flushPlain();
        _add(out, line.substring(index), CodeTokenKind.comment);
        return out;
      }

      // Block comments.
      if (spec.blockStart != null && line.startsWith(spec.blockStart!, index)) {
        final end = line.indexOf(
          spec.blockEnd!,
          index + spec.blockStart!.length,
        );
        flushPlain();
        if (end < 0) {
          _add(out, line.substring(index), CodeTokenKind.comment);
          _inBlockComment = true;
          return out;
        }
        _add(
          out,
          line.substring(index, end + spec.blockEnd!.length),
          CodeTokenKind.comment,
        );
        index = end + spec.blockEnd!.length;
        continue;
      }

      // Quoted strings. A quote only opens a string at a token boundary, so a
      // contraction (`don't`) is not treated as an unterminated string.
      if (spec.quotes.contains(char) && _atTokenBoundary(line, index)) {
        final end = _scanString(line, index, char);
        flushPlain();
        _add(out, line.substring(index, end), CodeTokenKind.string);
        index = end;
        continue;
      }

      if (spec.backtick && char == '`') {
        final end = _scanString(line, index, '`');
        flushPlain();
        _add(out, line.substring(index, end), CodeTokenKind.string);
        index = end;
        continue;
      }

      // Numbers. Start at a token boundary so `x1` stays an identifier.
      if (_isDigit(char) && _atTokenBoundary(line, index)) {
        var end = index + 1;
        while (end < length) {
          final next = line[end];
          if (_isWordChar(next) || next == '.' || next == '_') {
            end++;
            continue;
          }
          break;
        }
        flushPlain();
        _add(out, line.substring(index, end), CodeTokenKind.number);
        index = end;
        continue;
      }

      // Identifiers and keywords.
      if (_isWordStart(char)) {
        var end = index + 1;
        while (end < length && _isWordChar(line[end])) {
          end++;
        }
        final word = line.substring(index, end);
        if (spec.literals.contains(word)) {
          flushPlain();
          _add(out, word, CodeTokenKind.literal);
        } else if (spec.keywords.contains(word)) {
          flushPlain();
          _add(out, word, CodeTokenKind.keyword);
        } else {
          plain.write(word);
        }
        index = end;
        continue;
      }

      plain.write(char);
      index++;
    }

    flushPlain();
    return out;
  }

  /// Scan a quoted run. Returns the index after the closing quote, or the end
  /// of the line when the quote is unterminated (a streaming partial).
  int _scanString(String line, int start, String quote) {
    var index = start + 1;
    while (index < line.length) {
      final char = line[index];
      if (char == '\\' && index + 1 < line.length) {
        index += 2;
        continue;
      }
      if (char == quote) return index + 1;
      index++;
    }
    return line.length;
  }

  List<CodeToken> _markdownLine(String line) {
    final trimmed = line.trimLeft();
    if (trimmed.isEmpty) return [CodeToken(line, CodeTokenKind.plain)];

    // Headings: the hashes and their text are the block's strongest signal.
    if (trimmed.startsWith('#')) {
      final out = <CodeToken>[];
      final indent = line.length - trimmed.length;
      if (indent > 0) {
        out.add(CodeToken(line.substring(0, indent), CodeTokenKind.plain));
      }
      var hashes = 0;
      while (hashes < trimmed.length && trimmed[hashes] == '#') {
        hashes++;
      }
      _add(out, trimmed.substring(0, hashes), CodeTokenKind.keyword);
      _add(out, trimmed.substring(hashes), CodeTokenKind.keyword);
      return out;
    }

    if (trimmed.startsWith('>')) {
      return [CodeToken(line, CodeTokenKind.comment)];
    }

    // Fence markers stand out; inline code is a string.
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      return [CodeToken(line, CodeTokenKind.keyword)];
    }

    final out = <CodeToken>[];
    final plain = StringBuffer();
    var index = 0;
    while (index < line.length) {
      if (line[index] == '`') {
        final end = line.indexOf('`', index + 1);
        final stop = end < 0 ? line.length : end + 1;
        if (plain.isNotEmpty) {
          _add(out, plain.toString(), CodeTokenKind.plain);
          plain.clear();
        }
        _add(out, line.substring(index, stop), CodeTokenKind.string);
        index = stop;
        continue;
      }
      plain.write(line[index]);
      index++;
    }
    if (plain.isNotEmpty) _add(out, plain.toString(), CodeTokenKind.plain);
    return out;
  }
}

/// The per-language comment/string/keyword shape. Manual sets keep the lexer
/// cheap and avoid a regex over the whole document.
class _LanguageSpec {
  const _LanguageSpec({
    this.lineComment,
    this.blockStart,
    this.blockEnd,
    this.backtick = false,
    this.preprocessor = false,
    this.keywords = const <String>{},
    this.literals = const <String>{},
  }) : quotes = const ['"', "'"];

  final String? lineComment;
  final String? blockStart;
  final String? blockEnd;
  final List<String> quotes;
  final bool backtick;
  final bool preprocessor;
  final Set<String> keywords;
  final Set<String> literals;
}

const _dartKeywords = <String>{
  'abstract',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'deferred',
  'do',
  'dynamic',
  'else',
  'enum',
  'export',
  'extends',
  'extension',
  'external',
  'factory',
  'final',
  'finally',
  'for',
  'Function',
  'get',
  'hide',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'is',
  'late',
  'library',
  'mixin',
  'new',
  'on',
  'operator',
  'part',
  'required',
  'rethrow',
  'return',
  'set',
  'show',
  'static',
  'super',
  'switch',
  'sync',
  'this',
  'throw',
  'try',
  'typedef',
  'var',
  'void',
  'while',
  'with',
  'yield',
};

const _jsKeywords = <String>{
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
};

const _tsKeywords = <String>{
  ..._jsKeywords,
  'abstract',
  'as',
  'asserts',
  'declare',
  'keyof',
  'namespace',
  'readonly',
  'satisfies',
  'type',
  'unique',
  'unknown',
  'infer',
  'override',
};

const _cKeywords = <String>{
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'register',
  'restrict',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
};

const _cppKeywords = <String>{
  ..._cKeywords,
  'alignas',
  'alignof',
  'bool',
  'catch',
  'class',
  'constexpr',
  'const_cast',
  'decltype',
  'delete',
  'dynamic_cast',
  'explicit',
  'export',
  'false',
  'friend',
  'mutable',
  'namespace',
  'new',
  'noexcept',
  'nullptr',
  'operator',
  'override',
  'private',
  'protected',
  'public',
  'reinterpret_cast',
  'static_cast',
  'template',
  'this',
  'throw',
  'true',
  'try',
  'typeid',
  'typename',
  'using',
  'virtual',
};

const _pythonKeywords = <String>{
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
};

const _bashKeywords = <String>{
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'in',
  'select',
  'time',
  'coproc',
  'return',
  'local',
  'export',
  'readonly',
  'declare',
  'unset',
};

const _literalWords = <String>{
  'true',
  'false',
  'null',
  'nil',
  'None',
  'True',
  'False',
};

_LanguageSpec _specFor(CodeLanguage language) {
  return switch (language) {
    CodeLanguage.dart => const _LanguageSpec(
      lineComment: '//',
      blockStart: '/*',
      blockEnd: '*/',
      keywords: _dartKeywords,
      literals: _literalWords,
    ),
    CodeLanguage.typescript => const _LanguageSpec(
      lineComment: '//',
      blockStart: '/*',
      blockEnd: '*/',
      backtick: true,
      keywords: _tsKeywords,
      literals: _literalWords,
    ),
    CodeLanguage.javascript => const _LanguageSpec(
      lineComment: '//',
      blockStart: '/*',
      blockEnd: '*/',
      backtick: true,
      keywords: _jsKeywords,
      literals: _literalWords,
    ),
    CodeLanguage.json => const _LanguageSpec(
      // JSON has no comments; a string followed by a colon is still a string.
      keywords: <String>{},
      literals: _literalWords,
    ),
    CodeLanguage.bash => const _LanguageSpec(
      lineComment: '#',
      keywords: _bashKeywords,
      literals: <String>{'true', 'false'},
    ),
    CodeLanguage.python => const _LanguageSpec(
      lineComment: '#',
      keywords: _pythonKeywords,
      literals: _literalWords,
    ),
    CodeLanguage.c => const _LanguageSpec(
      lineComment: '//',
      blockStart: '/*',
      blockEnd: '*/',
      preprocessor: true,
      keywords: _cKeywords,
      literals: _literalWords,
    ),
    CodeLanguage.cpp => const _LanguageSpec(
      lineComment: '//',
      blockStart: '/*',
      blockEnd: '*/',
      preprocessor: true,
      keywords: _cppKeywords,
      literals: _literalWords,
    ),
    CodeLanguage.markdown => const _LanguageSpec(),
  };
}

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

void _add(List<CodeToken> out, String text, CodeTokenKind kind) {
  if (text.isEmpty) return;
  if (out.isNotEmpty && out.last.kind == kind) {
    // Merge adjacent runs of the same class so a line produces few spans.
    out[out.length - 1] = CodeToken(out.last.text + text, kind);
    return;
  }
  out.add(CodeToken(text, kind));
}

bool _isDigit(String char) =>
    char.codeUnitAt(0) >= 48 && char.codeUnitAt(0) <= 57;

bool _isLetter(String char) {
  final code = char.codeUnitAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

bool _isWordStart(String char) =>
    _isLetter(char) || char == '_' || char == r'$';

bool _isWordChar(String char) => _isWordStart(char) || _isDigit(char);

/// True when [index] is the first non-space character of [line].
bool _atLineStart(String line, int index) {
  for (var cursor = 0; cursor < index; cursor++) {
    final char = line[cursor];
    if (char != ' ' && char != '\t') return false;
  }
  return true;
}

/// True when [index] does not continue a word, so a quote or digit can open a
/// new token.
bool _atTokenBoundary(String line, int index) {
  if (index == 0) return true;
  return !_isWordChar(line[index - 1]);
}

/// `#` is a comment only at the start of a line or after whitespace, so `$#`
/// and `foo#bar` in shell code stay plain.
bool _commentBoundary(String line, int index, String marker) {
  if (marker != '#') return true;
  if (index == 0) return true;
  final previous = line[index - 1];
  return previous == ' ' || previous == '\t' || previous == ';';
}
