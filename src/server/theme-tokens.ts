import { err, ok, type Result } from "../domain/markdown";
import { isRecord } from "./rpc";

/**
 * The twelve semantic theme tokens (`docs/design.md` §3.1).
 *
 * The **shell** owns the palette catalogue and every default: this list exists
 * only so the core can refuse a token name the editor could not have produced.
 * A token's meaning never changes (`success` is never repurposed), which is why
 * the set is closed rather than free-form.
 */
export const THEME_TOKEN_NAMES = [
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

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

/** Stored `ui.custom_theme`: token name -> `#RRGGBB`. */
export type ThemeTokens = Record<string, string>;

/** `#RRGGBB`, exactly. A theme token is stored in this one form. */
const THEME_COLOUR = /^#[0-9A-Fa-f]{6}$/;

/**
 * Validate one `theme.custom.set` payload.
 *
 * An absent or non-object value is a malformed request; an unknown token name
 * and a value that is not `#RRGGBB` are refused *by name*, so the editor can say
 * which row is wrong. An empty object is valid and clears every override. Values
 * are normalised to upper case so one colour has one stored spelling; the read
 * path returns what the file holds.
 */
export function validateThemeTokens(
  input: unknown,
): Result<ThemeTokens, { field: "tokens"; token?: string; message: string }> {
  if (!isRecord(input)) {
    return err({
      field: "tokens",
      message: "theme.custom.set requires a tokens object",
    });
  }
  const tokens: ThemeTokens = {};
  for (const [token, value] of Object.entries(input)) {
    if (!(THEME_TOKEN_NAMES as readonly string[]).includes(token)) {
      return err({
        field: "tokens",
        token,
        message: `theme.custom.set: ${JSON.stringify(token)} is not a theme token; use ${THEME_TOKEN_NAMES.join(", ")}`,
      });
    }
    if (typeof value !== "string" || !THEME_COLOUR.test(value)) {
      return err({
        field: "tokens",
        token,
        message: `theme.custom.set: ${token} must be a #RRGGBB colour (got ${JSON.stringify(value)})`,
      });
    }
    tokens[token] = value.toUpperCase();
  }
  return ok(tokens);
}
