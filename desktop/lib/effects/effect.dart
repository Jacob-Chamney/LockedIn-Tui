import 'dart:math';

import 'package:material_ui/material_ui.dart';

// A sandboxed visual effect: a short, non-blocking animation the shell paints
// above the UI.
//
// This is the app's particle layer, and it is deliberately a registry rather
// than a hard-coded confetti call: a plugin can contribute an effect by name
// (`registerEffect`) without touching the shell, and the shell decides *when*
// to play one. Effects only paint — they cannot read state, write files or
// reach the core — so a plugin that ships one stays inside the same sandbox as
// every other plugin.
//
// Everything here is deterministic: a burst takes a seed, materialises its
// particles once, and computes positions as a pure function of time. That is
// what lets a widget test assert "180 particles, all inside the pane at t=0,
// all gone at t=1" without a golden image.
/// One particle's immutable start state.
class Particle {
  const Particle({
    required this.velocity,
    required this.size,
    required this.spin,
    required this.colourIndex,
    required this.delay,
  });

  /// Initial velocity in logical pixels per second.
  final Offset velocity;

  /// Radius in logical pixels.
  final double size;

  /// Rotations per second.
  final double spin;

  /// Index into the effect's palette.
  final int colourIndex;

  /// Fraction of the burst to wait before this particle starts (0–0.35), so
  /// the confetti leaves the pin in a spray rather than a line.
  final double delay;
}

/// What a registered effect is: a duration, a particle field and a palette.
class Effect {
  const Effect({
    required this.name,
    required this.duration,
    required this.particles,
    required this.palette,
    this.gravity = 1400,
    this.origin = const Alignment(0.5, -0.1),
  });

  final String name;
  final Duration duration;
  final List<Particle> particles;
  final List<Color> palette;
  final double gravity;

  /// Where the burst starts, in alignment coordinates of the painted area.
  final Alignment origin;

  Offset originFor(Size size) => origin
      .inscribe(Size.zero, Rect.fromLTWH(0, 0, size.width, size.height))
      .center;

  /// The default celebration: confetti raining from just above the centre.
  factory Effect.confetti({
    int count = 160,
    int seed = 7,
    List<Color>? palette,
  }) {
    final random = Random(seed);
    final colours =
        palette ??
        const [
          Color(0xFFD9534F),
          Color(0xFFFF6B6B),
          Color(0xFF7FA37A),
          Color(0xFFD8B26A),
          Color(0xFF9AA3AD),
          Color(0xFFFF8A65),
        ];
    return Effect(
      name: 'confetti',
      duration: const Duration(milliseconds: 1600),
      palette: colours,
      particles: [
        for (var index = 0; index < count; index++)
          Particle(
            // A wide upward fan, so the pieces arc and fall instead of falling
            // straight down like rain.
            // A fan, not a plume: the burst has to stay inside the pane it is
            // painted over, so horizontal speed is bounded by the fall time.
            velocity: Offset(
              (random.nextDouble() - 0.5) * 300,
              -140 - random.nextDouble() * 260,
            ),
            size: 2.5 + random.nextDouble() * 4,
            spin: (random.nextDouble() - 0.5) * 10,
            colourIndex: random.nextInt(colours.length),
            delay: random.nextDouble() * 0.12,
          ),
      ],
    );
  }

  /// Where every particle is at [t] (0–1) in a [size] box. Pure.
  List<Offset> positionsAt(double t, Size size) {
    final start = originFor(size);
    return [
      for (final particle in particles)
        if (t < particle.delay)
          start
        else
          _position(particle, t - particle.delay, start),
    ];
  }

  Offset _position(Particle particle, double local, Offset start) {
    final seconds = local * duration.inMilliseconds / 1000;
    return start +
        particle.velocity * seconds +
        Offset(0, 0.5 * gravity * seconds * seconds);
  }

  /// True when every particle is out of the box or past its fall at [t].
  bool isSpentAt(double t, Size size) {
    final rect = Rect.fromLTWH(0, 0, size.width, size.height).inflate(40);
    for (final position in positionsAt(t, size)) {
      if (rect.contains(position)) return false;
    }
    return true;
  }

  /// The smallest box that holds every particle at [t]: what a test asserts
  /// against to prove nothing flies outside the pane.
  Rect boundsAt(double t, Size size) {
    final positions = positionsAt(t, size);
    if (positions.isEmpty) return Rect.zero;
    var left = positions.first.dx;
    var top = positions.first.dy;
    var right = left;
    var bottom = top;
    for (final position in positions) {
      left = min(left, position.dx);
      top = min(top, position.dy);
      right = max(right, position.dx);
      bottom = max(bottom, position.dy);
    }
    return Rect.fromLTRB(left, top, right, bottom);
  }
}

/// Builds an effect when it is played. The registry's value type, so a plugin
/// (or a test) can contribute one by name.
typedef EffectFactory = Effect Function();

/// Effect name → factory. The shell plays by name; a name it does not know is a
/// no-op with a debug message rather than a crash.
class EffectRegistry {
  EffectRegistry();

  final Map<String, EffectFactory> _factories = {
    'confetti': () => Effect.confetti(),
  };

  Iterable<String> get names => _factories.keys;

  bool has(String name) => _factories.containsKey(name);

  /// Add or replace an effect. A plugin ships one of these; nothing else in the
  /// app has to change for it to be playable.
  void register(String name, EffectFactory factory) {
    _factories[name] = factory;
  }

  /// Build [name], or null when nothing is registered under it.
  Effect? build(String name) {
    final factory = _factories[name];
    if (factory == null) {
      assert(() {
        // ignore: avoid_print
        print('effects: no effect registered as "$name"');
        return true;
      }());
      return null;
    }
    return factory();
  }
}

/// The one place effects are played from. A widget calls
/// `EffectScope.of(context).play('confetti')`; the host above it paints.
class EffectController extends ChangeNotifier {
  EffectController({EffectRegistry? registry})
    : registry = registry ?? EffectRegistry();

  final EffectRegistry registry;

  int _generation = 0;

  /// Bumped on every play, so a listener can tell two bursts apart.
  int get generation => _generation;

  void play(String name) {
    if (!registry.has(name)) return;
    _generation += 1;
    notifyListeners();
  }
}

class EffectScope extends InheritedNotifier<EffectController> {
  const EffectScope({
    super.key,
    required EffectController controller,
    required super.child,
  }) : super(notifier: controller);

  static EffectController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<EffectScope>()?.notifier;

  /// The controller, or null when no host is mounted (a bare page test). A page
  /// that celebrates stays correct without one; it just does not celebrate.
  static EffectController? of(BuildContext context) => maybeOf(context);
}

/// Paints active effects over its child.
///
/// One [AnimationController] per burst, owned here and disposed when the burst
/// ends. The painter is handed the controller through `repaint:` so frames skip
/// build and layout; only the [RepaintBoundary]'d layer repaints.
class EffectHost extends StatefulWidget {
  const EffectHost({super.key, required this.child, this.controller});

  final Widget child;
  final EffectController? controller;

  @override
  State<EffectHost> createState() => _EffectHostState();
}

class _EffectHostState extends State<EffectHost> with TickerProviderStateMixin {
  late EffectController _controller;
  final List<_Burst> _bursts = [];
  int _seen = 0;

  @override
  void initState() {
    super.initState();
    _controller = widget.controller ?? EffectController();
    _seen = _controller.generation;
    _controller.addListener(_onPlay);
  }

  @override
  void didUpdateWidget(covariant EffectHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (identical(oldWidget.controller, widget.controller)) return;
    _controller.removeListener(_onPlay);
    _controller = widget.controller ?? EffectController();
    _seen = _controller.generation;
    _controller.addListener(_onPlay);
  }

  @override
  void dispose() {
    _controller.removeListener(_onPlay);
    for (final burst in _bursts) {
      burst.controller.dispose();
    }
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  void _onPlay() {
    if (_controller.generation == _seen) return;
    _seen = _controller.generation;
    final effect = _controller.registry.build('confetti');
    if (effect == null) return;
    _start(effect);
  }

  void _start(Effect effect) {
    // Reduced motion: the celebration is motion, so it is the first thing to
    // drop. The learner still gets the flip and the "correct" mark.
    if (MediaQuery.disableAnimationsOf(context)) return;
    final controller = AnimationController(
      vsync: this,
      duration: effect.duration,
    );
    final burst = _Burst(effect: effect, controller: controller);
    setState(() => _bursts.add(burst));
    controller.addStatusListener((status) {
      if (status != AnimationStatus.completed) return;
      if (!mounted) return;
      setState(() => _bursts.remove(burst));
      controller.dispose();
    });
    controller.forward();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.topLeft,
      children: [
        widget.child,
        if (_bursts.isNotEmpty)
          Positioned.fill(
            child: IgnorePointer(
              child: RepaintBoundary(
                child: Stack(
                  alignment: Alignment.topLeft,
                  children: [
                    for (final burst in _bursts)
                      Positioned.fill(
                        child: CustomPaint(
                          key: ValueKey('effect-${burst.effect.name}'),
                          painter: _BurstPainter(
                            effect: burst.effect,
                            t: burst.controller,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _Burst {
  _Burst({required this.effect, required this.controller});

  final Effect effect;
  final AnimationController controller;
}

class _BurstPainter extends CustomPainter {
  _BurstPainter({required this.effect, required this.t}) : super(repaint: t);

  final Effect effect;
  final Animation<double> t;

  @override
  void paint(Canvas canvas, Size size) {
    final value = t.value.clamp(0.0, 1.0);
    final positions = effect.positionsAt(value, size);
    final faded = value > 0.72;
    final paint = Paint();
    for (var index = 0; index < positions.length; index++) {
      final particle = effect.particles[index];
      final colour = effect.palette[particle.colourIndex];
      paint.color = faded
          ? colour.withValues(alpha: (1 - (value - 0.72) / 0.28).clamp(0, 1))
          : colour;
      final angle = particle.spin * value * pi * 2;
      canvas.save();
      canvas.translate(positions[index].dx, positions[index].dy);
      canvas.rotate(angle);
      // A flake, not a dot: it reads as paper turning over mid-air.
      canvas.drawRect(
        Rect.fromCenter(
          center: Offset.zero,
          width: particle.size * 1.8,
          height: particle.size,
        ),
        paint,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_BurstPainter oldDelegate) =>
      !identical(oldDelegate.effect, effect) || !identical(oldDelegate.t, t);
}
