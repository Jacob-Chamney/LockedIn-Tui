/**
 * Cursor motion for the effects lab.
 *
 * `CursorSpring` gives the smooth position; `CursorTrail` keeps a short,
 * fading history of cells. The real app will feed the spring from
 * `renderer.getCursorState()`; the lab uses a synthetic target.
 */

export type TrailPoint = {
  x: number
  y: number
  age: number
  life: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export class CursorSpring {
  x: number
  y: number
  targetX: number
  targetY: number
  vx = 0
  vy = 0
  stiffness = 0.32
  damping = 0.72

  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
    this.targetX = x
    this.targetY = y
  }

  setTarget(x: number, y: number): void {
    this.targetX = x
    this.targetY = y
  }

  /** Advance by `dt` seconds. The spring is tuned for a 60 Hz frame. */
  update(dt: number): void {
    const step = clamp(dt, 0, 0.1) * 60
    this.vx += (this.targetX - this.x) * this.stiffness * step
    this.vy += (this.targetY - this.y) * this.stiffness * step
    this.vx *= Math.pow(this.damping, step)
    this.vy *= Math.pow(this.damping, step)
    this.x += this.vx * step
    this.y += this.vy * step
  }

  get distance(): number {
    return Math.hypot(this.targetX - this.x, this.targetY - this.y)
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy)
  }

  /** True while the spring is still visibly moving. */
  get active(): boolean {
    return this.distance > 0.02 || this.speed > 0.02
  }

  get cell(): { x: number; y: number } {
    return { x: Math.round(this.x), y: Math.round(this.y) }
  }
}

export class CursorTrail {
  readonly points: TrailPoint[] = []
  readonly life: number
  readonly max: number

  constructor(life = 0.35, max = 64) {
    this.life = life
    this.max = max
  }

  record(x: number, y: number): void {
    const last = this.points[this.points.length - 1]
    if (last && last.x === x && last.y === y) return
    this.points.push({ x, y, age: 0, life: this.life })
    if (this.points.length > this.max) this.points.splice(0, this.points.length - this.max)
  }

  update(dt: number): void {
    for (let index = this.points.length - 1; index >= 0; index--) {
      const point = this.points[index]!
      point.age += dt
      if (point.age >= point.life) this.points.splice(index, 1)
    }
  }

  clear(): void {
    this.points.length = 0
  }

  /** 0 at the newest point, 1 at the oldest; useful for fade-out. */
  strength(point: TrailPoint): number {
    return clamp(1 - point.age / point.life, 0, 1)
  }
}
