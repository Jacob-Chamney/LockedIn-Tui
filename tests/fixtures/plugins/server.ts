/**
 * S6-derived fake MCP stdio server for the plugin contract test.
 *
 * One read-only tool, one write-capable tool, and a slow tool for cancellation.
 * Nothing here touches real data, and no third-party server is ever started.
 *
 *   PLUGIN_MODE=crash-on-call  exit mid-call
 *   PLUGIN_STDERR=noisy        chatter on stderr, to prove it is captured
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const MODE = process.env["PLUGIN_MODE"] ?? "ok"
const NOISY = process.env["PLUGIN_STDERR"] === "noisy"

const server = new McpServer({ name: "lockedin-plugin-fixture", version: "0.0.0" })

function announce(tool: string, input: unknown) {
  process.stderr.write(`CALL ${tool} ${JSON.stringify(input)}\n`)
  if (NOISY) process.stderr.write(`noise ${"x".repeat(64)}\n`)
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

server.registerTool(
  "read_note",
  {
    title: "Read note",
    description: "Read one note. Read-only.",
    inputSchema: { path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ path }) => {
    announce("read_note", { path })
    await delay(5)
    return { content: [{ type: "text", text: `# ${path}\n\nContents of ${path}.` }] }
  },
)

server.registerTool(
  "write_note",
  {
    title: "Write note",
    description: "Replace a note. Write-capable; requires approval.",
    inputSchema: { path: z.string(), body: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ path, body }) => {
    announce("write_note", { path, bytes: body.length })
    await delay(5)
    if (MODE === "crash-on-call") {
      await delay(10)
      process.exit(9)
    }
    return { content: [{ type: "text", text: `wrote ${body.length} bytes to ${path}` }] }
  },
)

server.registerTool(
  "slow_tool",
  {
    title: "Slow tool",
    description: "Sleeps. Used to test cancellation.",
    inputSchema: { ms: z.number().int().min(0).max(30_000) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ ms }) => {
    announce("slow_tool", { ms })
    await delay(ms)
    return { content: [{ type: "text", text: `slept ${ms}ms` }] }
  },
)

await server.connect(new StdioServerTransport())
process.stderr.write(`READY ${process.pid}\n`)
