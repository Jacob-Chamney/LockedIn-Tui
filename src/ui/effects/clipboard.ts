/**
 * Clipboard writes without native access.
 *
 * OSC 52 asks the terminal to place text on the system clipboard; the app
 * never reads it. Terminals that do not implement OSC 52 will ignore the
 * sequence, so a failed copy is not a rendering error.
 */
import { MAX_CLIPBOARD_CHARS } from "./sandbox/limits"

/** Only line breaks and tabs are allowed through; other controls are removed. */
function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
}

/** The escape sequence for one clipboard payload. */
export function osc52(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64")
  return `\u001b]52;c;${encoded}\u0007`
}

export type ClipboardWriter = (data: string) => void

export function copyToClipboard(
  text: string,
  write: ClipboardWriter = (data) => {
    process.stdout.write(data)
  },
): boolean {
  if (typeof text !== "string") return false
  const value = clean(text)
  if (value.length === 0 || value.length > MAX_CLIPBOARD_CHARS) return false
  try {
    write(osc52(value))
    return true
  } catch {
    return false
  }
}
