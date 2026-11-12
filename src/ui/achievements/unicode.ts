/**
 * Achievement pictures as Unicode half blocks.
 *
 * Each terminal cell carries two vertical pixels using `▀`, `▄` or `█`. The
 * source is resampled to the requested viewport, so the full-window view can be
 * larger than the 80x48 source. Colours come from the source palette; this is
 * not braille and needs no terminal image protocol.
 */
import type { Achievement } from "../../domain/achievements"
import { achievementArt } from "./pixel-source"

export type UnicodeCell = {
  char: string
  /** Foreground colour as `#rrggbb`, when the upper pixel exists. */
  fg: string | null
  /** Background colour as `#rrggbb`, when the lower pixel exists. */
  bg: string | null
}

export type UnicodeArt = { width: number; rows: UnicodeCell[][] }

type Pixel = { colour: string; alpha: number } | null

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`

export function unicodeArt(
  achievement: Pick<Achievement, "id" | "category">,
  maxColumns: number,
  maxRows: number,
): UnicodeArt {
  const source = achievementArt(achievement)
  if (maxColumns <= 0 || maxRows <= 0) return { width: 0, rows: [] }
  const width = Math.max(1, maxColumns)
  const height = Math.max(2, maxRows * 2)
  const sourcePixel = (x: number, y: number): Pixel => {
    const at = (y * source.width + x) * 4
    const alpha = source.pixels[at + 3] ?? 0
    if (alpha === 0) return null
    return {
      colour: hex(source.pixels[at] ?? 0, source.pixels[at + 1] ?? 0, source.pixels[at + 2] ?? 0),
      alpha,
    }
  }
  const rows: UnicodeCell[][] = []
  for (let row = 0; row < height / 2; row++) {
    const cells: UnicodeCell[] = []
    for (let column = 0; column < width; column++) {
      const sourceX = Math.min(source.width - 1, Math.floor((column * source.width) / width))
      const topY = Math.min(source.height - 1, Math.floor(((row * 2) * source.height) / height))
      const bottomY = Math.min(source.height - 1, Math.floor(((row * 2 + 1) * source.height) / height))
      const top = sourcePixel(sourceX, topY)
      const bottom = sourcePixel(sourceX, bottomY)
      if (top === null && bottom === null) {
        cells.push({ char: " ", fg: null, bg: null })
      } else if (top !== null && bottom !== null) {
        cells.push({ char: top.colour === bottom.colour ? "█" : "▀", fg: top.colour, bg: bottom.colour })
      } else if (top !== null) {
        cells.push({ char: "▀", fg: top.colour, bg: null })
      } else {
        cells.push({ char: "▄", fg: bottom!.colour, bg: null })
      }
    }
    rows.push(cells)
  }
  return { width, rows }
}

export function unicodeSpans(
  cells: readonly UnicodeCell[],
): Array<{ text: string; fg: string | null; bg: string | null }> {
  const out: Array<{ text: string; fg: string | null; bg: string | null }> = []
  for (const cell of cells) {
    const last = out.at(-1)
    if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.char
    else out.push({ text: cell.char, fg: cell.fg, bg: cell.bg })
  }
  return out
}
