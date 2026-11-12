/** Blend two #RRGGBB colours; the one colour arithmetic used by the UI. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = channels(from)
  const b = channels(to)
  const t = Math.max(0, Math.min(1, amount))
  return `#${[a[0], a[1], a[2]]
    .map((value, index) => Math.round(value + (b[index]! - value) * t).toString(16).padStart(2, "0"))
    .join("")}`
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "")
  const normal = value.length === 3 ? value.split("").map((c) => c + c).join("") : value
  const n = Number.parseInt(normal, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
