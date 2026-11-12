/**
 * Kitty image transfer mode.
 *
 * "raw" (OpenTUI's own default) base64-encodes the pixels, so a full-screen
 * achievement frame is several megabytes per frame and can exceed the ~8 MiB
 * output frame limit. "zlib" compresses before transfer and "file" hands the
 * local terminal a temporary path, so both can carry a much larger image in
 * one frame. The starfield compresses well, so zlib is the default here.
 */
export type KittyImageTransportMode = "raw" | "zlib" | "file"

export const DEFAULT_KITTY_IMAGE_TRANSPORT: KittyImageTransportMode = "zlib"

export function resolveKittyImageTransport(
  raw: string | undefined = process.env.LOCKEDIN_KITTY_TRANSPORT,
): KittyImageTransportMode {
  const value = raw?.trim().toLowerCase()
  if (value === "raw" || value === "zlib" || value === "file") return value
  return DEFAULT_KITTY_IMAGE_TRANSPORT
}
