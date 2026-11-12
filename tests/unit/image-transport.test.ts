import { describe, expect, test } from "bun:test"

import {
  DEFAULT_KITTY_IMAGE_TRANSPORT,
  resolveKittyImageTransport,
} from "../../src/ui/achievements/image-transport"

describe("the Kitty image transport", () => {
  test("defaults to zlib when unset or unknown", () => {
    expect(resolveKittyImageTransport("")).toBe(DEFAULT_KITTY_IMAGE_TRANSPORT)
    expect(resolveKittyImageTransport(undefined)).toBe("zlib")
    expect(resolveKittyImageTransport("nonsense")).toBe("zlib")
  })

  test("accepts the three OpenTUI modes, case and space insensitive", () => {
    expect(resolveKittyImageTransport("zlib")).toBe("zlib")
    expect(resolveKittyImageTransport(" FILE ")).toBe("file")
    expect(resolveKittyImageTransport("Raw")).toBe("raw")
  })
})
