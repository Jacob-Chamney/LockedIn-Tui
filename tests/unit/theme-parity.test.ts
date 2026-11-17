/**
 * The desktop palettes are a mirror of the TUI's theme tokens.
 *
 * `src/ui/theme/palettes.ts` is authoritative (`docs/design.md` §3.1): every
 * theme defines semantic tokens, and a token never changes meaning between
 * themes. The Flutter shell cannot import TypeScript, so it carries a second
 * copy in `desktop/lib/theme/palette.dart`. This test keeps the two in step —
 * a colour edited on one side without the other fails here instead of shipping
 * two different identities.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const TS_PALETTES = join(ROOT, "src", "ui", "theme", "palettes.ts");
const DART_PALETTES = join(ROOT, "desktop", "lib", "theme", "palette.dart");

const TOKENS = [
  "background",
  "surface",
  "panel",
  "foreground",
  "muted",
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "line",
] as const;

/** `crimson` in TypeScript, `lockedInCrimson` in Dart. */
const THEMES = [
  { id: "lockedin", ts: "crimson", dart: "lockedInCrimson" },
  { id: "high-contrast", ts: "highContrast", dart: "lockedInHighContrast" },
  { id: "claude-code", ts: "claudeCode", dart: "lockedInClaude" },
  { id: "codex", ts: "codex", dart: "lockedInCodex" },
] as const;

function block(source: string, header: RegExp): string {
  const match = header.exec(source);
  if (match === null) throw new Error(`no block matching ${header}`);
  return match[1]!;
}

function tsTokens(source: string, name: string): Record<string, string> {
  const body = block(source, new RegExp(`export const ${name}: ThemePalette = \\{([\\s\\S]*?)\\n\\}`));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(\w+): "(#[0-9A-Fa-f]{6})"/g)) {
    tokens[match[1]!] = match[2]!.toUpperCase();
  }
  return tokens;
}

function dartTokens(source: string, name: string): Record<string, string> {
  const body = block(source, new RegExp(`const ${name} = LockedInPalette\\(([\\s\\S]*?)\\n\\);`));
  const tokens: Record<string, string> = {};
  // `Color(0xFFRRGGBB)` — the leading FF is the opaque alpha channel.
  for (const match of body.matchAll(/(\w+): Color\(0x[Ff][Ff]([0-9A-Fa-f]{6})\)/g)) {
    tokens[match[1]!] = `#${match[2]!.toUpperCase()}`;
  }
  return tokens;
}

describe("desktop theme parity", () => {
  test("every desktop palette carries all twelve semantic tokens", async () => {
    const dart = await readFile(DART_PALETTES, "utf8");
    for (const theme of THEMES) {
      const tokens = dartTokens(dart, theme.dart);
      expect({ id: theme.id, keys: Object.keys(tokens).sort() }).toEqual({
        id: theme.id,
        keys: [...TOKENS].sort(),
      });
    }
  });

  test("the desktop palette ids are exactly the TUI theme ids", async () => {
    const dart = await readFile(DART_PALETTES, "utf8");
    const ids = block(dart, /const lockedInThemeIds = <String>\[([\s\S]*?)\];/);
    const listed = [...ids.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(listed).toEqual(THEMES.map((theme) => theme.id));
  });

  test("each desktop colour equals its TypeScript token", async () => {
    const [ts, dart] = await Promise.all([
      readFile(TS_PALETTES, "utf8"),
      readFile(DART_PALETTES, "utf8"),
    ]);
    for (const theme of THEMES) {
      expect({ id: theme.id, tokens: dartTokens(dart, theme.dart) }).toEqual({
        id: theme.id,
        tokens: tsTokens(ts, theme.ts),
      });
    }
  });

  test("high contrast stays legible, not merely different", async () => {
    const dart = await readFile(DART_PALETTES, "utf8");
    const high = dartTokens(dart, "lockedInHighContrast");
    const crimson = dartTokens(dart, "lockedInCrimson");

    const luminance = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const contrast = (a: string, b: string) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light! + 0.05) / (dark! + 0.05);
    };

    // Body text clears WCAG AA on the theme's own background.
    expect(contrast(high.foreground!, high.background!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(crimson.foreground!, crimson.background!)).toBeGreaterThanOrEqual(4.5);
    // High contrast is the stronger of the two, which is its whole purpose.
    expect(contrast(high.foreground!, high.background!)).toBeGreaterThan(
      contrast(crimson.foreground!, crimson.background!),
    );
  });
});
