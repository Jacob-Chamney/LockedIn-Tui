export const NAMED_KEYBIND_KEYS = ["escape", "enter", "tab", "space"] as const;

/** The accepted forms, in the one sentence a refusal repeats. */
export const KEYBIND_FORMS =
  'a leader binding ("space+<key>"), one printable character, a named key (escape, enter, tab), "space", or "ctrl+<character>"';

export function isPrintableKey(char: string): boolean {
  return char.length === 1 && char >= "!" && char <= "~";
}

/**
 * Validate and normalise one binding string; `null` means "not a binding".
 *
 * The stored form is lowercase and trimmed, so two spellings of one chord can
 * never be saved as two different bindings. A chord is the leader prefix plus a
 * letter; the bare `space` is the named space key, not the leader prefix.
 */
export function normalizeKeybind(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (text === "") return null;
  if (text.startsWith("ctrl+")) {
    return isPrintableKey(text.slice("ctrl+".length)) ? text : null;
  }
  if (text.startsWith("space+")) {
    return isPrintableKey(text.slice("space+".length)) ? text : null;
  }
  if (isPrintableKey(text)) return text;
  return (NAMED_KEYBIND_KEYS as readonly string[]).includes(text) ? text : null;
}

/** The binding as a person reads it: `Space x`, `Esc`, `Ctrl+Q`, `?`. */
export function displayBinding(binding: string): string {
  const text = binding.trim().toLowerCase();
  if (text.startsWith("space+")) return `Space ${text.slice("space+".length)}`;
  if (text.startsWith("ctrl+")) return `Ctrl+${text.slice("ctrl+".length).toUpperCase()}`;
  if (text === "escape") return "Esc";
  if (text === "enter") return "Enter";
  if (text === "tab") return "Tab";
  if (text === "space") return "Space";
  return text;
}

/**
 * One table from the loaded config, without the empty "no override" markers.
 *
 * An empty binding is how a cleared action is stored (a config patch merges
 * tables, so a key cannot be deleted), and every reader treats it as absent.
 */
export function keybindTable(raw: Record<string, string> | undefined): Record<string, string> {
  const table: Record<string, string> = {};
  for (const [action, binding] of Object.entries(raw ?? {})) {
    if (typeof binding !== "string" || binding.trim() === "") continue;
    table[action] = binding;
  }
  return table;
}

/** The action that already holds `binding` in either table, if any. */
export function keybindConflict(
  action: string,
  binding: string,
  tables: readonly Record<string, string>[],
): string | null {
  for (const table of tables) {
    for (const [id, existing] of Object.entries(table)) {
      if (id === action) continue;
      if (existing.trim().toLowerCase() === binding) return id;
    }
  }
  return null;
}

/**
 * The two stored keybind tables (`docs/data-model.md` §2).
 *
 * `ui.keybinds` holds leader chords (the space prefix plus a letter);
 * `ui.fixed_keybinds` holds the direct/fixed keys (`escape`, `j`, `ctrl+q`).
 * Both are `action id -> binding`, and neither carries a default: the default
 * action catalogue is the UI registry's, so this layer stores only what the
 * user changed.
 */
export type KeybindMaps = {
  keybinds: Record<string, string>;
  fixedKeybinds: Record<string, string>;
};

/** One `keybinds.set` write, handed to `main.ts` as a config patch. */
export type KeybindWrite = KeybindMaps & {
  /**
   * Actions whose override was removed, per table.
   *
   * A config patch merges tables, so a deletion is expressed as an empty
   * binding; every read filters it out, which means "use the registry default".
   */
  cleared: { keybinds: string[]; fixedKeybinds: string[] };
};
