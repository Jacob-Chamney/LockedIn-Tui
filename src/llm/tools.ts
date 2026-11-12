/**
 * Structured tools: declaration, input validation, and execution behind a
 * scoped resolver (`docs/architecture.md` §5).
 *
 * The rule that matters most here: **validate before executing**. A model can
 * emit anything; an invalid call must not reach a tool, must not throw, and
 * must still count toward `maxToolCalls`. The rejected call is fed back to the
 * model as a tool error so it can correct itself.
 *
 * This packet ships no write and no command tool. A tool receives a resolver
 * that is already scoped to one side or one project root; it never receives an
 * absolute path.
 */
import { jsonSchema, tool, type ToolSet } from "ai"

export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

export type ToolSide = "school" | "skills" | "work" | "none"

export type ToolSpec = {
  name: string
  description: string
  inputSchema: JsonSchema
  side: ToolSide
  /** Write tools produce a proposed write; none ship in this packet. */
  write: boolean
  /** Command tools produce a proposed command; none ship in this packet. */
  command: boolean
  /** A web-search tool; learning chats hide it unless `learning-web` is used. */
  web?: boolean
}

/** Per-request facts a resolver may need; never model-controlled. */
export type ToolResolverContext = {
  /** The user typed `learning-web` for this turn. */
  webExplicit?: boolean
  /** The chat's selected tool mode. */
  toolMode?: "plan" | "build" | "learn"
}

/** A scoped resolver: the only way a tool touches data. */
export type ToolResolver = (
  name: string,
  input: Record<string, unknown>,
  context?: ToolResolverContext,
) => Promise<string>

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

/** Minimal, dependency-free JSON Schema check for the subset we declare. */
export function validateToolInput(schema: JsonSchema, input: unknown): ValidationResult {
  const errors: string[] = []
  check(schema, input, "input", errors)
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function check(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    errors.push(`${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`)
    return
  }

  switch (schema.type) {
    case undefined:
      break
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push(`${path} must be an object`)
        return
      }
      const record = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}.${key} is required`)
      }
      const properties = schema.properties ?? {}
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in properties)) errors.push(`${path}.${key} is not allowed`)
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        if (key in record) check(child, record[key], `${path}.${key}`, errors)
      }
      return
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array`)
        return
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path} needs at least ${schema.minItems} items`)
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path} allows at most ${schema.maxItems} items`)
      }
      if (schema.items) value.forEach((item, i) => check(schema.items!, item, `${path}[${i}]`, errors))
      return
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${path} must be a string`)
        return
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path} is shorter than ${schema.minLength}`)
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path} is longer than ${schema.maxLength}`)
      }
      return
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${path} must be a number`)
        return
      }
      if (schema.type === "integer" && !Number.isInteger(value)) errors.push(`${path} must be an integer`)
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`)
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`)
      return
    }
    case "boolean": {
      if (typeof value !== "boolean") errors.push(`${path} must be a boolean`)
      return
    }
    case "null": {
      if (value !== null) errors.push(`${path} must be null`)
      return
    }
  }
}

/** Convert our specs to the SDK's tool set for one step. */
export function toSdkTools(specs: readonly ToolSpec[], resolver: ToolResolver): ToolSet {
  const tools: ToolSet = {}
  for (const spec of specs) {
    tools[spec.name] = tool({
      description: spec.description,
      // The SDK only needs the schema for the model; execution is ours.
      inputSchema: jsonSchema(spec.inputSchema as Record<string, unknown>),
    })
  }
  void resolver
  return tools
}

export type ToolExecution =
  | { ok: true; output: string }
  | { ok: false; rejected: true; output: string }

/**
 * Validate, then execute. A rejected call is a normal outcome with a message
 * the model can act on — never a throw into the caller.
 */
export async function executeTool(
  spec: ToolSpec,
  input: unknown,
  resolver: ToolResolver,
): Promise<ToolExecution> {
  const validation = validateToolInput(spec.inputSchema, input)
  if (!validation.ok) {
    return {
      ok: false,
      rejected: true,
      output: `rejected: invalid input (${validation.errors.slice(0, 3).join("; ")})`,
    }
  }
  try {
    const output = await resolver(spec.name, input as Record<string, unknown>)
    return { ok: true, output }
  } catch (err) {
    // A tool that throws is a tool error, not a crash.
    return { ok: false, rejected: true, output: `rejected: tool failed (${String(err).slice(0, 120)})` }
  }
}
