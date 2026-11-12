/**
 * Example scene plugin: the shape primitives.
 *
 * Copy this directory to start a panel or widget. Every shape is host-drawn
 * from geometry you declare; the plugin never sees pixels. A square is a rect
 * with equal width and height, and `radius` rounds its corners.
 */
export default {
  id: "example.scene-shapes",
  name: "Shapes",
  fps: 30,

  compose(ctx: { state: { width: number; height: number }; time?: number }) {
    const spin = ((ctx.time ?? 0) * 45) % 360
    return {
      nodes: [
        // circle: radius in cells, outline by default
        { kind: "circle", anchor: "absolute", x: 4, y: 5, radius: 4, fill: false, border: true, thickness: 0.6, color: "accent" },
        // square with rounded corners (radius 3); a square is width === height
        { kind: "rect", anchor: "absolute", x: 15, y: 5, width: 10, height: 10, radius: 3, fill: false, border: true, color: "warning" },
        // triangle
        { kind: "triangle", anchor: "absolute", x: 29, y: 5, width: 10, height: 10, direction: "up", fill: true, color: "success", rotation: spin },
        // polygon: a diamond from four points in local cell space
        { kind: "polygon", anchor: "absolute", x: 43, y: 5, width: 12, height: 10, points: [6, 0, 12, 5, 6, 10, 0, 5], fill: false, border: true, thickness: 0.6, color: "secondary" },
        // ring progress: a full track arc plus a value arc
        { kind: "arc", anchor: "absolute", x: 59, y: 4, width: 11, height: 11, thickness: 1.2, color: "line" },
        { kind: "arc", anchor: "absolute", x: 59, y: 4, width: 11, height: 11, thickness: 1.2, start: -90, value: 0.62, rounded: true, color: "accent" },
        // smooth bar: the fill ends between cells
        { kind: "progress", anchor: "absolute", x: 4, y: 17, width: 32, height: 2, value: 0.62, radius: 1, color: "success", track: "line" },
        // a line and a polyline path
        { kind: "line", anchor: "absolute", x: 38, y: 16, width: 10, height: 6, x1: 0, y1: 6, x2: 10, y2: 0, thickness: 0.6, color: "warning", rotation: -spin },
        { kind: "path", anchor: "absolute", x: 53, y: 16, width: 14, height: 6, points: [0, 6, 4, 0, 8, 6, 12, 0], thickness: 0.6, color: "secondary" },
        { kind: "text", anchor: "bottom-left", x: 2, y: 2, text: "shapes · ring · bar · line · path", color: "muted" },
      ],
    }
  },
}
