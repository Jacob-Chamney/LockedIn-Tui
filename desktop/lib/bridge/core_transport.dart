import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'protocol.dart';

/// The transport surface a [CoreStore] needs. `CoreClient` is the real one;
/// tests can pass a fake without spawning a process.
abstract class CoreConnection {
  Stream<Map<String, dynamic>> get events;

  Future<void> start({
    String executable,
    List<String> arguments,
    String? workingDirectory,
    Map<String, String>? environment,
  });

  Future<void> initialize();

  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]);

  Future<void> dispose();
}

/// Owns the Bun core process and the newline-delimited JSON-RPC connection.
///
/// The client is intentionally transport-only: it knows requests, responses and
/// notifications, not domain state. Feature models subscribe to [events] and
/// call [call] with intent-level methods.
class CoreClient implements CoreConnection {
  Process? _process;
  StreamSubscription<String>? _stdout;
  StreamSubscription<String>? _stderr;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final _pending = <int, Completer<Map<String, dynamic>>>{};
  int _nextId = 1;

  bool get isRunning => _process != null;

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  /// Starts the sidecar. In development this is usually:
  ///
  ///   `bun run ../src/server/main.ts`
  @override
  Future<void> start({
    String executable = 'bun',
    List<String> arguments = const ['run', '../src/server/main.ts'],
    String? workingDirectory,
    Map<String, String>? environment,
  }) async {
    if (_process != null) return;
    final process = await Process.start(
      executable,
      arguments,
      workingDirectory: workingDirectory,
      // Process.start merges this into the parent environment by default
      // (`includeParentEnvironment: true`), so a sidecar still sees PATH and
      // HOME while the shell adds the keyring addon path.
      environment: environment,
    );
    _process = process;
    // A write to a core that is already dying fails on this future, not at the
    // call site. The exit handler reports the crash; this only keeps a broken
    // pipe from surfacing as an unhandled error.
    unawaited(process.stdin.done.catchError((Object _) {}));
    _stdout = process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(_handleLine);
    _stderr = process.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => debugPrint('[core] $line'));
    unawaited(process.exitCode.then(_handleExit));
  }

  @override
  Future<void> initialize() async {
    final result = await call('initialize', {
      'protocol': protocolVersion,
      'client': 'flutter',
    });
    final version = result['protocol'];
    if (version != protocolVersion) {
      throw RpcException(
        -32000,
        'core protocol $version, shell expects $protocolVersion',
      );
    }
  }

  Future<Map<String, dynamic>> ping() => call('ping');

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    final process = _process;
    if (process == null) {
      throw StateError('core is not running');
    }
    final id = _nextId++;
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    process.stdin.writeln(jsonEncode(rpcRequest(id, method, params)));
    // A method that runs a model, a command, an extraction or a network
    // transfer has no deadline here. Abandoning it at 30 s reported a failure
    // while the core carried on and wrote the file, and the "retry" that
    // followed was a second paid run (or a duplicate goal). A crash still fails
    // the call: `_handleExit` completes every pending request with an error.
    //
    // `session.create` is the exception: it is local file work with its own
    // deadline and a per-attempt idempotency key, so a timed-out retry joins
    // the first create instead of duplicating it (`docs/decisions/0019`).
    final deadline = deadlineFor(method);
    if (deadline == null) return completer.future;
    return completer.future.timeout(
      deadline,
      onTimeout: () {
        _pending.remove(id);
        throw TimeoutException('core did not answer $method', deadline);
      },
    );
  }

  /// A quick read gives up at 30 s; a create gets 60 s and then reports.
  static const Duration quickCallDeadline = Duration(seconds: 30);
  static const Duration createDeadline = Duration(seconds: 60);

  /// The deadline for [method], or null when it may run indefinitely.
  ///
  /// `session.create` is deliberately **not** in `_longRunning`: its timeout is
  /// what gives the wizard a way out, and its request id makes the retry safe.
  static Duration? deadlineFor(String method) {
    if (method == 'session.create') return createDeadline;
    if (_longRunning.contains(method)) return null;
    return quickCallDeadline;
  }

  /// Methods whose reply legitimately takes longer than a quick read.
  ///
  /// Provider runs (steps, documents, outputs, lessons, a course plan, a key
  /// validation), an approved command (the service allows 120 s), source
  /// extraction and copying, zip exports, and the archive's network transfers.
  static const _longRunning = <String>{
    'session.generateSteps',
    'session.document',
    'session.output.build',
    'session.instructions.import',
    'session.instructions.reextract',
    'session.archive',
    'session.export',
    'source.add',
    'skill.create',
    'skill.lesson.build',
    'skill.sources.add',
    'skill.archive',
    'skill.export',
    'archive.list',
    'archive.restore',
    'archive.remove',
    'work.command.decide',
    'provider.link',
    'mcp.refresh',
  };

  void _handleLine(String line) {
    if (line.trim().isEmpty) return;
    Object? decoded;
    try {
      decoded = jsonDecode(line);
    } on FormatException catch (error) {
      debugPrint('[core] invalid JSON: $error');
      return;
    }
    if (decoded is! Map<String, dynamic>) {
      debugPrint('[core] non-object message');
      return;
    }

    final id = decoded['id'];
    if (id is int) {
      final completer = _pending.remove(id);
      if (completer == null || completer.isCompleted) return;
      final error = decoded['error'];
      if (error is Map<String, dynamic>) {
        completer.completeError(
          RpcException(
            error['code'] is int ? error['code'] as int : -32603,
            error['message']?.toString() ?? 'core error',
            error['data'],
          ),
        );
        return;
      }
      final result = decoded['result'];
      completer.complete(
        result is Map<String, dynamic> ? result : <String, dynamic>{},
      );
      return;
    }

    final method = decoded['method'];
    if (method is String) {
      final params = decoded['params'];
      _events.add(
        params is Map<String, dynamic>
            ? {'method': method, 'params': params}
            : {'method': method},
      );
    }
  }

  void _handleExit(int code) {
    final error = RpcException(-32000, 'core exited with code $code');
    for (final completer in _pending.values) {
      if (!completer.isCompleted) completer.completeError(error);
    }
    _pending.clear();
    _process = null;
    // `dispose` kills the process and closes the stream; the exit code then
    // arrives here. Adding to a closed controller throws, and nobody is
    // listening for an exit they asked for.
    if (_events.isClosed) return;
    _events.add({
      'method': 'core.exit',
      'params': {'code': code},
    });
  }

  @override
  Future<void> dispose() async {
    await _stdout?.cancel();
    await _stderr?.cancel();
    _process?.kill();
    _process = null;
    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(RpcException(-32000, 'core disposed'));
      }
    }
    _pending.clear();
    await _events.close();
  }
}

enum CoreStatus { offline, connecting, online, failed }

/// One concrete way to launch the core.
class SidecarLaunch {
  const SidecarLaunch({
    required this.executable,
    required this.arguments,
    this.workingDirectory,
    this.environment,
  });

  final String executable;
  final List<String> arguments;
  final String? workingDirectory;

  /// Extra environment for the sidecar, merged into the parent environment by
  /// [Process.start]. Null means "inherit exactly", which is what `bun run`
  /// development launches want.
  final Map<String, String>? environment;
}

/// The `node_modules` path a packaged bundle keeps beside its executable.
///
/// Segments, not a joined string: Windows needs `\` between them, and a mixed
/// `C:\\bundle/node_modules/@napi-rs/…` path is what a hard-coded `/` produces.
const keyringAddonSegments = [
  'node_modules',
  '@napi-rs',
  'keyring',
  'index.js',
];

/// The addon path relative to a bundle directory, using this platform's
/// separator.
String keyringAddonRelativePath({String? separator}) =>
    keyringAddonSegments.join(separator ?? Platform.pathSeparator);

/// The environment additions a packaged sidecar needs in [directory].
///
/// `bun build --compile` cannot embed a native `.node` addon, so the release
/// bundle copies `@napi-rs/keyring` next to the shell and the core is pointed
/// at it explicitly. Without the file the map is empty, and the core falls back
/// to its documented `secret-tool` path: this helper never invents a path that
/// is not on disk.
///
/// It is a pure function of [directory] so a test can point it at a temp
/// folder instead of the real executable directory.
Map<String, String> sidecarEnvironment(String directory) {
  // Absolute even when the caller passes something relative: the core runs from
  // a neutral working directory, so a relative addon path would resolve against
  // the wrong folder.
  final base = Directory(directory).absolute.path;
  final addon =
      '$base${Platform.pathSeparator}'
      '${keyringAddonRelativePath()}';
  if (!File(addon).existsSync()) return const {};
  return {'LOCKEDIN_KEYRING_ADDON': addon};
}

/// Prefer a bundled sidecar next to the app executable; fall back to `bun run`
/// for development. The release build copies `lockedin-core` into the bundle,
/// so a packaged app never needs a Bun install.
SidecarLaunch resolveSidecar() {
  final directory = File(Platform.resolvedExecutable).parent.path;
  final names = Platform.isWindows
      ? const ['lockedin-core.exe']
      : const ['lockedin-core'];
  for (final name in names) {
    final candidate = File('$directory${Platform.pathSeparator}$name');
    if (candidate.existsSync()) {
      // Run from a neutral directory: a `bunfig.toml` in the launch folder
      // (for example this repository's test preload) is read by the Bun
      // runtime inside the compiled binary and would break startup.
      final environment = sidecarEnvironment(directory);
      return SidecarLaunch(
        executable: candidate.path,
        arguments: const [],
        workingDirectory: Directory.systemTemp.path,
        environment: environment.isEmpty ? null : environment,
      );
    }
  }
  return const SidecarLaunch(
    executable: 'bun',
    arguments: ['run', '../src/server/main.ts'],
  );
}

/// The Knowledge scopes the surface offers, in chip order.
///
/// `search` accepts all four (`all|school|skills|work`); `tree` accepts
/// `all|school|skills` only, so a `work` scope is projected to `all` for the
/// tree read and the page says work items appear in search.
const knowledgeScopeValues = ['all', 'school', 'skills', 'work'];

/// A projection of the core for the shell and feature widgets.
///
/// The store owns no domain state: it starts the sidecar, performs the initial
/// snapshot, and forwards intent-level calls. Feature pages read the projections
/// and subscribe through [CoreScope].
