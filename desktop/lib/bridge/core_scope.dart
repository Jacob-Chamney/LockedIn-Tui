import 'package:flutter/widgets.dart';

import 'core_client.dart';

/// Provides the single [CoreStore] to the widget tree.
class CoreScope extends InheritedNotifier<CoreStore> {
  const CoreScope({super.key, required CoreStore store, required super.child})
    : super(notifier: store);

  static CoreStore of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<CoreScope>();
    assert(scope != null, 'CoreScope is missing above this widget');
    return scope!.notifier!;
  }

  static CoreStore? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<CoreScope>()?.notifier;
  }
}
