import 'dart:async';

import 'package:flutter/widgets.dart';

import 'app.dart';
import 'bridge/core_client.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final store = CoreStore(reconnectFactory: CoreClient.new);
  runApp(LockedInApp(store: store));
  // The shell renders immediately; the core connects and fills the projections.
  unawaited(store.start());
}
