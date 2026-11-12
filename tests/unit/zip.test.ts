/**
 * WP-305 — deterministic zip writing (ADR 0003).
 *
 * The acceptance criterion is byte-stability: the same input must produce the
 * same archive. These tests pin that down, plus the properties an exported
 * session depends on (sorted entries, fixed timestamps, round trip).
 */

import { describe, expect, test } from "bun:test"

import { ZIP_EPOCH_MS, listZip, readZip, writeZip } from "../../src/services/lockin/zip"

const encoder = new TextEncoder()

function entry(name: string, body: string) {
  return { name, data: encoder.encode(body) }
}

describe("writeZip", () => {
  test("round-trips entry contents", () => {
    const bytes = writeZip([entry("meta.json", "{}"), entry("prompt.md", "hello")])
    const read = readZip(bytes)
    expect(Object.keys(read).sort()).toEqual(["meta.json", "prompt.md"])
    expect(new TextDecoder().decode(read["prompt.md"]!)).toBe("hello")
  })

  test("entries are sorted by name, whatever the input order", () => {
    const forwards = writeZip([
      entry("a/1.txt", "1"),
      entry("a/2.txt", "2"),
      entry("b.txt", "3"),
    ])
    const backwards = writeZip([
      entry("b.txt", "3"),
      entry("a/2.txt", "2"),
      entry("a/1.txt", "1"),
    ])
    expect(listZip(forwards)).toEqual(["a/1.txt", "a/2.txt", "b.txt"])
    expect(forwards).toEqual(backwards)
  })

  test("the same input produces the same bytes", () => {
    const first = writeZip([entry("meta.json", '{"schema":1}'), entry("prompt.md", "x")])
    const second = writeZip([entry("meta.json", '{"schema":1}'), entry("prompt.md", "x")])
    expect(second).toEqual(first)
  })

  test("different content produces different bytes", () => {
    expect(writeZip([entry("a.txt", "one")])).not.toEqual(writeZip([entry("a.txt", "two")]))
  })

  test("timestamps are pinned to the zip epoch", () => {
    expect(ZIP_EPOCH_MS).toBe(Date.UTC(1980, 0, 1))
    const bytes = writeZip([entry("a.txt", "one")])
    // The DOS date field for 1980-01-01 is 0x0021; a zero date would be 0.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint16(12, true)).toBe(0x0021)
    expect(view.getUint16(10, true)).toBe(0)
  })

  test("an empty archive is still a valid zip", () => {
    const bytes = writeZip([])
    expect(bytes.length).toBeGreaterThan(0)
    expect(readZip(bytes)).toEqual({})
  })

  test("binary content survives", () => {
    const data = new Uint8Array([0, 1, 2, 250, 251, 255])
    const read = readZip(writeZip([{ name: "blob.bin", data }]))
    expect([...read["blob.bin"]!]).toEqual([...data])
  })

  test("nested paths keep their separators", () => {
    const read = readZip(writeZip([entry("sources/aa-lecture-4.md", "notes")]))
    expect(Object.keys(read)).toEqual(["sources/aa-lecture-4.md"])
  })
})
