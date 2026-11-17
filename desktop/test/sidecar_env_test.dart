import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';

import 'fake_core.dart';

/// A packaged sidecar needs `LOCKEDIN_KEYRING_ADDON` because
/// `bun build --compile` cannot embed the native `@napi-rs/keyring` addon.
/// These tests prove the shell only advertises an addon that is really on disk,
/// and that the path it advertises is absolute.
void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('lockedin-sidecar-env-');
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  /// Create `<base>/node_modules/@napi-rs/keyring/index.js` inside [base] so the
  /// helper sees a bundled addon.
  String addonDir(String base) =>
      '$base${Platform.pathSeparator}node_modules'
      '${Platform.pathSeparator}@napi-rs${Platform.pathSeparator}keyring';

  File writeAddon([String? base]) {
    final dir = Directory(addonDir(base ?? root.path))
      ..createSync(recursive: true);
    return File('${dir.path}${Platform.pathSeparator}index.js')
      ..writeAsStringSync('// stub addon\n');
  }

  test('no bundled addon means no environment override', () {
    expect(sidecarEnvironment(root.path), isEmpty);
  });

  test('a bundled addon points LOCKEDIN_KEYRING_ADDON at it', () {
    final addon = writeAddon();

    final environment = sidecarEnvironment(root.path);

    expect(environment, hasLength(1));
    final path = environment['LOCKEDIN_KEYRING_ADDON'];
    expect(path, addon.path);
    expect(File(path!).existsSync(), isTrue);
  });

  test('the addon path is absolute', () {
    writeAddon();

    final path = sidecarEnvironment(root.path)['LOCKEDIN_KEYRING_ADDON'];

    expect(path, isNotNull);
    // A packaged shell starts the core from a neutral working directory, so a
    // relative path would resolve against the wrong folder inside the core.
    expect(File(path!).isAbsolute, isTrue);
  });

  test('a relative directory still yields an absolute addon path', () {
    // A child of the working directory, so its relative form is its basename.
    final relativeRoot = Directory.current.createTempSync('lockedin-sidecar-');
    addTearDown(() {
      if (relativeRoot.existsSync()) relativeRoot.deleteSync(recursive: true);
    });
    final addon = writeAddon(relativeRoot.path);
    final basename = relativeRoot.path.split(Platform.pathSeparator).last;

    final path = sidecarEnvironment(basename)['LOCKEDIN_KEYRING_ADDON'];

    expect(path, isNotNull);
    expect(File(path!).isAbsolute, isTrue);
    expect(File(path).existsSync(), isTrue);
    expect(File(path).absolute.path, addon.absolute.path);
  });

  test('an addon directory without index.js is not advertised', () {
    Directory(addonDir(root.path)).createSync(recursive: true);

    expect(sidecarEnvironment(root.path), isEmpty);
  });

  test('CoreStore.start hands the launch environment to the core', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.start();

    // A `bun run` development launch passes no map: the parent environment is
    // inherited exactly and the core probes the addon itself.
    expect(core.launchedEnvironment, isNull);
  });
}
