/**
 * The chat bubble.
 *
 * The rounded ends are rasterised once per shape and drawn as images. The cap
 * image is **opaque**: pixels outside the curve are the chat background colour,
 * not transparent. That is the whole trick. With a transparent image the
 * terminal composites the empty corner against its own default background,
 * which produced a grey square outline under the pill on two different designs;
 * an opaque image leaves the terminal nothing to decide.
 *
 * A terminal that cannot draw a real image (blocks fallback, tmux, or no pixel
 * size) gets a cell chamfer instead: one-row caps with a quadrant glyph in each
 * corner. It is subtle, but it is deterministic and it never glitches.
 */
import { NativeImage, resolveImageRenderProtocol, type CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, onMount, type Accessor, type JSX } from "solid-js"

export type CellSize = { width: number; height: number }

/**
 * The cell fallback cuts the *outer* corner, so the corner cell is mostly
 * fill: `▘` fills the upper-left quarter, and it is painted with the chat
 * background while the cell background is the fill. The inverse quadrants
 * (`▟` and friends) would leave three quarters empty and read as a notch.
 */
const TOP_LEFT = "▘"
const TOP_RIGHT = "▝"
const BOTTOM_LEFT = "▖"
const BOTTOM_RIGHT = "▗"

type Rgb = { r: number; g: number; b: number }

function rgb(hex: string): Rgb {
  const value = hex.replace("#", "")
  const normal = value.length === 3 ? value.split("").map((c) => c + c).join("") : value
  const n = Number.parseInt(normal, 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/** Signed distance to a stadium of height `2 * radius`. */
function distance(x: number, y: number, width: number, height: number, radius: number): number {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const qx = Math.abs(x - halfWidth) - (halfWidth - radius)
  const qy = Math.abs(y - halfHeight) - (halfHeight - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

/**
 * One cap row as an opaque frame: the fill inside the curve, the chat
 * background outside it, blended at the edge. No alpha channel.
 */
export function capPixels(input: {
  width: number
  capHeight: number
  fill: string
  background: string
  edge: "top" | "bottom"
}): Uint8Array {
  const width = Math.max(2, Math.round(input.width))
  const capHeight = Math.max(2, Math.round(input.capHeight))
  const whole = capHeight * 2
  const fill = rgb(input.fill)
  const behind = rgb(input.background)
  const out = new Uint8Array(width * capHeight * 4)
  for (let y = 0; y < capHeight; y++) {
    const sourceY = input.edge === "top" ? y : whole - capHeight + y
    for (let x = 0; x < width; x++) {
      const coverage = Math.max(0, Math.min(1, 0.5 - distance(x + 0.5, sourceY + 0.5, width, whole, capHeight)))
      const index = (y * width + x) * 4
      out[index] = Math.round(behind.r + (fill.r - behind.r) * coverage)
      out[index + 1] = Math.round(behind.g + (fill.g - behind.g) * coverage)
      out[index + 2] = Math.round(behind.b + (fill.b - behind.b) * coverage)
      out[index + 3] = 255
    }
  }
  return out
}

/** Cap images repeat across messages: cache by shape and colour. */
const capCache = new Map<string, NativeImage>()

export function bubbleCapCacheSize(): number {
  return capCache.size
}

export function disposeBubbleCaps(): void {
  for (const image of capCache.values()) image.dispose()
  capCache.clear()
}

function capImage(fill: string, background: string, width: number, capHeight: number, edge: "top" | "bottom"): NativeImage {
  const key = `${fill}:${background}:${width}:${capHeight}:${edge}`
  const cached = capCache.get(key)
  if (cached) return cached
  const image = NativeImage.fromRgba(capPixels({ width, capHeight, fill, background, edge }), width, capHeight)
  capCache.set(key, image)
  return image
}

/**
 * Caps need a real image protocol and a known pixel size.
 *
 * `blocks` draws the image as Unicode glyphs, which cannot carry a curve, and
 * tmux resolves to blocks by policy. Those terminals take the cell chamfer.
 */
export function capsAllowed(input: {
  resolution: { width: number; height: number } | null
  capabilities: Parameters<typeof resolveImageRenderProtocol>[1]
}): boolean {
  // Sixel needs the pixel size to encode the image; kitty can scale a fill
  // image into a cell box without it. The resolver already turns an
  // unresolvable sixel into blocks, so its answer is the whole test.
  const protocol = resolveImageRenderProtocol("auto", input.capabilities, input.resolution !== null)
  return protocol === "kitty" || protocol === "sixel"
}

function couldUseImages(capabilities: Parameters<typeof resolveImageRenderProtocol>[1]): boolean {
  return capabilities !== null && (capabilities.kitty_graphics || capabilities.sixel)
}

/**
 * Pixels per cell when the terminal can draw an image, or null when the cell
 * chamfer is the only option.
 *
 * A kitty terminal that has not answered the pixel query still gets a sensible
 * 1:2 cell: `fit="fill"` stretches the cap into the one-cell box, so only the
 * aspect ratio matters and the curve stays round. A sixel terminal without the
 * answer has to wait, because the encoder needs real pixels.
 */
export function cellSizeFor(input: {
  resolution: { width: number; height: number } | null
  columns: number
  rows: number
  capabilities: Parameters<typeof resolveImageRenderProtocol>[1]
}): CellSize | null {
  if (input.columns <= 0 || input.rows <= 0) return null
  if (!capsAllowed({ resolution: input.resolution, capabilities: input.capabilities })) return null
  if (!input.resolution) return { width: 8, height: 16 }
  return { width: input.resolution.width / input.columns, height: input.resolution.height / input.rows }
}

function readCellSize(renderer: CliRenderer): CellSize | null {
  return cellSizeFor({
    resolution: renderer.resolution,
    columns: renderer.terminalWidth || renderer.width,
    rows: renderer.terminalHeight || renderer.height,
    capabilities: renderer.capabilities,
  })
}

/**
 * Pixels per cell, or null until the terminal answers.
 *
 * The renderer starts before the pixel-size reply arrives, so the first frames
 * have no caps and the bubbles upgrade when the answer lands.
 */
export function useCellSize(): Accessor<CellSize | null> {
  const renderer = useRenderer()
  const [size, setSize] = createSignal<CellSize | null>(readCellSize(renderer))
  onMount(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    let attempts = 0
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    // The terminal's capability and pixel replies can land after the first
    // frame, and a small window is no reason to give up on them. Poll until
    // the answer is final: an image protocol with a size, or a terminal that
    // cannot draw an image at all.
    const poll = () => {
      attempts += 1
      const next = readCellSize(renderer)
      if (next) {
        setSize(next)
        stop()
        return
      }
      if (renderer.capabilities !== null && !couldUseImages(renderer.capabilities)) {
        setSize(null)
        stop()
        return
      }
      // A sixel terminal still waiting for its pixel answer is not final.
      if (attempts >= 120) stop()
    }
    if (size() === null && renderer.capabilities === null) timer = setInterval(poll, 250)
    const refresh = () => {
      const next = readCellSize(renderer)
      setSize(next)
      if (next) {
        stop()
        return
      }
      if (renderer.capabilities === null) {
        attempts = 0
        if (!timer) timer = setInterval(poll, 250)
      } else if (!couldUseImages(renderer.capabilities)) {
        stop()
      }
    }
    const onResize = () => refresh()
    const onCapabilities = () => refresh()
    renderer.on("resize", onResize)
    renderer.on("capabilities", onCapabilities)
    onCleanup(() => {
      stop()
      renderer.off("resize", onResize)
      renderer.off("capabilities", onCapabilities)
    })
  })
  return size
}

/**
 * True after the renderer's first frame.
 *
 * An image whose source is set during the initial render is measured before
 * Yoga has given the bubble a width, so it can keep a one-cell paint box and
 * never be corrected. Waiting for one frame means the box is real.
 */
export function useAfterFirstFrame(): Accessor<boolean> {
  const renderer = useRenderer()
  const [ready, setReady] = createSignal(false)
  onMount(() => {
    const onFrame = () => {
      setReady(true)
      renderer.off("frame", onFrame)
    }
    renderer.on("frame", onFrame)
    onCleanup(() => renderer.off("frame", onFrame))
  })
  return ready
}

export function Bubble(props: {
  width: number
  fill: string
  /** The pane behind the bubble: the cap image paints it, and the cut reveals it. */
  background: string
  /** null = no image; the cell chamfer is used instead. */
  cell: CellSize | null
  /** False until the first frame has laid the bubble out. */
  ready: boolean
  children: JSX.Element
}) {
  const pixelWidth = () => Math.max(8, Math.round(props.width * (props.cell?.width ?? 8)))
  const capHeight = () => Math.max(4, Math.round(props.cell?.height ?? 16))
  const image = (edge: "top" | "bottom") =>
    capImage(props.fill, props.background, pixelWidth(), capHeight(), edge)

  const imageCap = (edge: "top" | "bottom") => (
    <box width={props.width} height={1} backgroundColor={props.background} flexShrink={0}>
      {props.ready ? (
        <image width={props.width} height={1} source={image(edge)} fit="fill" protocol="auto" />
      ) : null}
    </box>
  )

  const cellCap = (left: string, right: string) => (
    <box width={props.width} height={1} flexDirection="row" flexShrink={0}>
      {/* The glyph cuts the outer quarter with the background colour; the
          cell background is the fill, so only that quarter is empty. */}
      <text fg={props.background} bg={props.fill} wrapMode="none">
        {left}
      </text>
      <box flexGrow={1} height={1} backgroundColor={props.fill} />
      <text fg={props.background} bg={props.fill} wrapMode="none">
        {right}
      </text>
    </box>
  )

  return (
    <box width={props.width} flexDirection="column">
      {props.cell ? imageCap("top") : cellCap(TOP_LEFT, TOP_RIGHT)}
      <box width={props.width} flexDirection="column" backgroundColor={props.fill} paddingX={1}>
        {props.children}
      </box>
      {props.cell ? imageCap("bottom") : cellCap(BOTTOM_LEFT, BOTTOM_RIGHT)}
    </box>
  )
}
