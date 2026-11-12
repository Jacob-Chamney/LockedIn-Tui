/**
 * The task registry: one place that answers "what is running, and how do I
 * stop it" (docs/product.md §2.7, docs/design.md §8).
 *
 * In-memory only in v1 — a restart starts empty, by design. A task record never
 * carries a prompt, a body or file content: only identity, status and usage.
 */
export type TaskKind = "chat" | "generation" | "swarm"
export type TaskStatus = "running" | "done" | "failed" | "cancelled"

export type TaskUsage = { input: number; output: number; total: number }

export type TaskRecord = {
  id: string
  kind: TaskKind
  label: string
  status: TaskStatus
  startedAt: string
  finishedAt?: string
  usage?: TaskUsage
  cancellable: boolean
  /** True once the task produced output; cancelling then asks first. */
  producedOutput: boolean
  /** The same copy the chat bubble shows. */
  error?: string
}

export type TaskEvent =
  | { type: "done"; usage?: TaskUsage }
  | { type: "cancelled" }
  | { type: "failed"; error: string; usage?: TaskUsage }

/** The owner of a running operation; today `ChatService.cancel(requestId)`. */
export type CancelPort = (id: string) => void

export type StartInput = {
  id: string
  kind: TaskKind
  label: string
  cancellable?: boolean
}

export type CancelOutcome = "asked" | "already-finished" | "unknown" | "needs-confirmation"

const TERMINAL: TaskStatus[] = ["done", "failed", "cancelled"]

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.includes(status)
}

export class TaskRegistry {
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly order: string[] = []
  private cancelPort: CancelPort | undefined
  private readonly clock: () => number

  constructor(options: { clock?: () => number; cancelPort?: CancelPort } = {}) {
    this.clock = options.clock ?? (() => Date.now())
    this.cancelPort = options.cancelPort
  }

  /** One cancel implementation for every surface (chat Esc, task centre `c`). */
  setCancelPort(port: CancelPort | undefined): void {
    this.cancelPort = port
  }

  start(input: StartInput): TaskRecord {
    const existing = this.tasks.get(input.id)
    if (existing) return existing
    const record: TaskRecord = {
      id: input.id,
      kind: input.kind,
      label: input.label,
      status: "running",
      startedAt: new Date(this.clock()).toISOString(),
      cancellable: input.cancellable ?? true,
      producedOutput: false,
    }
    this.tasks.set(input.id, record)
    this.order.push(input.id)
    return record
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id)
  }

  /** Marks that a running task has produced output, so cancel asks first. */
  noteOutput(id: string): void {
    const task = this.tasks.get(id)
    if (!task || isTerminal(task.status)) return
    task.producedOutput = true
  }

  /**
   * Apply the operation's terminal event. A second terminal event on the same
   * task is ignored: a task never flips state twice.
   */
  finish(id: string, event: TaskEvent): TaskRecord | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    if (isTerminal(task.status)) return task
    task.status = event.type
    task.finishedAt = new Date(this.clock()).toISOString()
    if (event.type === "failed") task.error = event.error
    if ("usage" in event && event.usage) task.usage = event.usage
    return task
  }

  /**
   * Ask the owner to cancel. The owner emits `cancelled`; this never marks the
   * task cancelled itself, so chat `Esc` and task-centre `c` converge on one
   * terminal event.
   */
  cancel(id: string, options: { confirmed?: boolean } = {}): CancelOutcome {
    const task = this.tasks.get(id)
    if (!task) return "unknown"
    if (isTerminal(task.status)) return "already-finished"
    if (!task.cancellable) return "needs-confirmation"
    if (task.producedOutput && !options.confirmed) return "needs-confirmation"
    this.cancelPort?.(id)
    return "asked"
  }

  running(): TaskRecord[] {
    return this.order
      .map((id) => this.tasks.get(id)!)
      .filter((task) => task.status === "running")
  }

  runningCount(): number {
    return this.running().length
  }

  /** Running first (oldest first), then finished (newest first). */
  list(): TaskRecord[] {
    const all = this.order.map((id) => this.tasks.get(id)!)
    const running = all.filter((task) => task.status === "running")
    const finished = all
      .filter((task) => isTerminal(task.status))
      .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))
    return [...running, ...finished]
  }

  clear(): void {
    this.tasks.clear()
    this.order.length = 0
  }
}
