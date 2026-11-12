/**
 * The shape a highlighted block is painted from.
 *
 * Kept apart from the engine so a renderer can draw plain text immediately and
 * load Shiki later, without pulling the grammar bundle into the startup module
 * graph.
 */

export type SyntaxRun = { text: string; color: string }
export type SyntaxLine = SyntaxRun[]

/** Plain lines in one colour, for an unknown fence or before the engine is ready. */
export function plainLines(code: string, colour: string): SyntaxLine[] {
  return code.split("\n").map((line) => (line === "" ? [] : [{ text: line, color: colour }]))
}
