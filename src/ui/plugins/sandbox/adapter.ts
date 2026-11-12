/**
 * The in-sandbox bootstrap.
 *
 * Evaluated once per effect inside QuickJS. It never touches host objects: one
 * JSON string in, one JSON string out per frame, so the whole boundary is a
 * single call. The plugin only sees ordinary JS values and typed arrays.
 */
export const EFFECT_ADAPTER_SOURCE = String.raw`
(function () {
  "use strict";
  var system = null;
  var buffer = null;
  var store = {};
  var session = {};
  var dirty = false;

  function validValue(value) {
    return value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && isFinite(value));
  }

  function mapApi(target, persistent) {
    return {
      get: function (key) {
        return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined;
      },
      set: function (key, value) {
        if (typeof key !== "string" || key.length < 1 || key.length > 64) {
          throw new Error("store keys are 1-64 characters");
        }
        if (!validValue(value)) {
          throw new Error("store values must be a string, number, boolean or null");
        }
        target[key] = value;
        if (persistent) dirty = true;
      },
      remove: function (key) {
        if (!Object.prototype.hasOwnProperty.call(target, key)) return;
        delete target[key];
        if (persistent) dirty = true;
      },
      keys: function () { return Object.keys(target); },
      all: function () { return JSON.parse(JSON.stringify(target)); }
    };
  }

  var storeApi = mapApi(store, true);
  var sessionApi = mapApi(session, false);

  function takeStore() {
    if (!dirty) return undefined;
    dirty = false;
    return JSON.parse(JSON.stringify(store));
  }

  function makeBuffer(capacity) {
    return {
      count: 0,
      capacity: capacity,
      x: new Float32Array(capacity),
      y: new Float32Array(capacity),
      vx: new Float32Array(capacity),
      vy: new Float32Array(capacity),
      life: new Float32Array(capacity),
      maxLife: new Float32Array(capacity),
      seed: new Float32Array(capacity)
    };
  }

  function describe() {
    return {
      id: system.id,
      name: typeof system.name === "string" ? system.name : undefined,
      maxParticles: system.maxParticles,
      textLayer: system.textLayer,
      spawnRate: system.spawnRate,
      spawnOn: system.spawnOn,
      spawnBurst: system.spawnBurst,
      hasParticles: typeof system.spawn === "function" || typeof system.step === "function" || typeof system.style === "function",
      hasCompose: typeof system.compose === "function",
      fps: typeof system.fps === "number" ? system.fps : undefined,
      commandIds: Object.keys(system.commands || {})
    };
  }

  function context(input) {
    return {
      dt: input.dt,
      time: input.time,
      width: input.width,
      height: input.height,
      cursor: input.cursor,
      palette: input.palette,
      events: input.events,
      store: storeApi,
      session: sessionApi
    };
  }

  return {
    define: function (value) {
      if (!value || typeof value !== "object") {
        throw new Error("an effect must export a system object");
      }
      system = value;
      return JSON.stringify(describe());
    },

    init: function (capacity, storeText) {
      buffer = makeBuffer(capacity | 0);
      var seed = {};
      if (typeof storeText === "string" && storeText !== "") {
        try { seed = JSON.parse(storeText) || {}; } catch (error) { seed = {}; }
      }
      var key;
      for (key in store) {
        if (Object.prototype.hasOwnProperty.call(store, key)) delete store[key];
      }
      for (key in seed) {
        if (Object.prototype.hasOwnProperty.call(seed, key)) store[key] = seed[key];
      }
      return JSON.stringify(describe());
    },

    activate: function (text) {
      if (!system) throw new Error("effect is not initialised");
      var input = {};
      if (typeof text === "string" && text !== "") input = JSON.parse(text);
      if (typeof system.activate === "function") {
        system.activate({
          state: input.state,
          time: input.time,
          width: input.width,
          height: input.height,
          store: storeApi,
          session: sessionApi
        });
      }
      return JSON.stringify({ changes: takeStore() });
    },

    deactivate: function () {
      if (system && typeof system.deactivate === "function") {
        system.deactivate({ store: storeApi, session: sessionApi });
      }
      return JSON.stringify({ changes: takeStore() });
    },

    runCommand: function (text) {
      if (!system) throw new Error("effect is not initialised");
      var input = JSON.parse(text);
      var commands = system.commands || {};
      var run = commands[input.id];
      if (typeof run !== "function") throw new Error("unknown command: " + String(input.id));
      var result = run({
        id: input.id,
        state: input.state,
        time: input.time,
        pointer: input.pointer,
        store: storeApi,
        session: sessionApi
      });
      var out = { ok: true, message: undefined, level: undefined, copy: undefined };
      if (typeof result === "string") {
        out.message = result.slice(0, 300);
      } else if (result && typeof result === "object") {
        if (typeof result.message === "string") out.message = result.message.slice(0, 300);
        if (result.level === "info" || result.level === "warn" || result.level === "error") {
          out.level = result.level;
        }
        if (typeof result.copy === "string") out.copy = result.copy.slice(0, 4096);
      }
      var changes = takeStore();
      if (changes !== undefined) out.changes = changes;
      return JSON.stringify(out);
    },

    compose: function (text) {
      if (!system) throw new Error("effect is not initialised");
      if (typeof system.compose !== "function") return JSON.stringify({ nodes: [] });
      var input = JSON.parse(text);
      var result = system.compose(input) || { nodes: [] };
      var changes = takeStore();
      var out = { nodes: Array.isArray(result.nodes) ? result.nodes : [] };
      if (changes !== undefined) out.changes = changes;
      return JSON.stringify(out);
    },

    frame: function (text) {
      if (!system || !buffer) throw new Error("effect is not initialised");
      var input = JSON.parse(text);
      var count = input.count | 0;
      if (count < 0) count = 0;
      if (count > buffer.capacity) count = buffer.capacity;

      var i;
      for (i = 0; i < count; i++) {
        buffer.x[i] = input.x[i];
        buffer.y[i] = input.y[i];
        buffer.vx[i] = input.vx[i];
        buffer.vy[i] = input.vy[i];
        buffer.life[i] = input.life[i];
        buffer.maxLife[i] = input.maxLife[i];
        buffer.seed[i] = input.seed[i];
      }
      buffer.count = count;

      var ctx = context(input);
      var spawn = input.spawn | 0;
      if (spawn > 0 && typeof system.spawn === "function") {
        for (i = 0; i < spawn && count < buffer.capacity; i++) {
          buffer.count = count;
          if (system.spawn(ctx, buffer, count) === false) break;
          count++;
        }
      }
      buffer.count = count;

      if (typeof system.step === "function") system.step(ctx, buffer, count);

      var state = new Array(count * 7);
      var looks = new Array(count * 4);
      for (i = 0; i < count; i++) {
        var at = i * 7;
        state[at] = buffer.x[i];
        state[at + 1] = buffer.y[i];
        state[at + 2] = buffer.vx[i];
        state[at + 3] = buffer.vy[i];
        state[at + 4] = buffer.life[i];
        state[at + 5] = buffer.maxLife[i];
        state[at + 6] = buffer.seed[i];
        var style = typeof system.style === "function" ? system.style(ctx, buffer, i) : null;
        var look = i * 4;
        looks[look] = style && style.glyph != null ? style.glyph : "";
        looks[look + 1] = style && style.color != null ? style.color : "";
        looks[look + 2] = style && style.alpha != null ? style.alpha : 1;
        looks[look + 3] = style && style.layer != null ? style.layer : "";
      }
      var out = { count: count, state: state, looks: looks };
      var changes = takeStore();
      if (changes !== undefined) out.changes = changes;
      return JSON.stringify(out);
    }
  };
})()
`

/**
 * Wrap a CommonJS bundle so evaluating it returns its default export.
 *
 * Bun's `format: "cjs"` output is a factory:
 *   (function (exports, require, module, __filename, __dirname) { ... })
 * which must be called. Older/other builds emit plain statements that assign
 * `module.exports`; both shapes are handled.
 */
export function wrapBundle(code: string): string {
  const factory = /^\s*(?:\/\/[^\n]*\n)*\s*\(function\s*\(\s*exports\s*,\s*require\s*,\s*module/.test(code)
  const call = factory
    ? `  var factory = ${code};
  factory(exports, undefined, module, "", "");`
    : code
  return `(function () {
  "use strict";
  var module = { exports: {} };
  var exports = module.exports;
${call}
  return Object.prototype.hasOwnProperty.call(module.exports, "default")
    ? module.exports.default
    : module.exports;
})()`
}
