import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execa } from "execa";
import fg from "fast-glob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export type ToolPermission = "read" | "write" | "exec" | "network";
export type ToolName = "read_file" | "write_file" | "list_files" | "grep" | "exec";

export interface ToolSpec {
  name: string;
  description: string;
  schema: unknown;
  permission: ToolPermission;
}

export interface ToolRuntime {
  listToolSpecs(): ToolSpec[];
  executeTool(name: string, input: unknown, cwd: string): Promise<unknown>;
  permissionFor(name: string): ToolPermission;
  close(): Promise<void>;
}

interface BuiltinToolDef {
  name: ToolName;
  description: string;
  schema: z.ZodTypeAny;
  permission: ToolPermission;
  run: (input: unknown, cwd: string) => Promise<unknown>;
}

interface MCPServerConfig {
  enabled?: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

const readSchema = z.object({ path: z.string() });
const writeSchema = z.object({ path: z.string(), content: z.string() });
const listSchema = z.object({
  pattern: z.string().default("**/*"),
  limit: z.number().int().min(1).max(1000).default(200),
});
const grepSchema = z.object({ pattern: z.string(), glob: z.string().default("**/*") });
const execSchema = z.object({
  command: z.string(),
  timeoutMs: z.number().int().min(100).max(120000).default(30000),
});

function resolvePath(cwd: string, rel: string): string {
  const abs = path.resolve(cwd, rel);
  if (!abs.startsWith(path.resolve(cwd))) {
    throw new Error("Path escapes cwd");
  }
  return abs;
}

const builtinTools: Record<ToolName, BuiltinToolDef> = {
  read_file: {
    name: "read_file",
    description: "Read UTF-8 file content",
    schema: readSchema,
    permission: "read",
    async run(input, cwd) {
      const { path: rel } = readSchema.parse(input);
      const filePath = resolvePath(cwd, rel);
      const content = await fs.readFile(filePath, "utf8");
      return { path: rel, content };
    },
  },
  write_file: {
    name: "write_file",
    description: "Write UTF-8 file content",
    schema: writeSchema,
    permission: "write",
    async run(input, cwd) {
      const { path: rel, content } = writeSchema.parse(input);
      const filePath = resolvePath(cwd, rel);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      return { path: rel, bytes: Buffer.byteLength(content, "utf8") };
    },
  },
  list_files: {
    name: "list_files",
    description: "List files under cwd",
    schema: listSchema,
    permission: "read",
    async run(input, cwd) {
      const { pattern, limit } = listSchema.parse(input);
      const files = await fg(pattern, { cwd, dot: true, onlyFiles: true, unique: true });
      return { files: files.slice(0, limit), total: files.length };
    },
  },
  grep: {
    name: "grep",
    description: "Regex search in files",
    schema: grepSchema,
    permission: "read",
    async run(input, cwd) {
      const { pattern, glob } = grepSchema.parse(input);
      const re = new RegExp(pattern, "i");
      const files = await fg(glob, { cwd, dot: true, onlyFiles: true });
      const matches: Array<{ file: string; line: number; text: string }> = [];
      for (const file of files.slice(0, 300)) {
        const raw = await fs.readFile(path.join(cwd, file), "utf8").catch(() => "");
        if (!raw) continue;
        const lines = raw.split("\n");
        lines.forEach((text, idx) => {
          if (re.test(text)) matches.push({ file, line: idx + 1, text });
        });
        if (matches.length >= 200) break;
      }
      return { matches: matches.slice(0, 200), total: matches.length };
    },
  },
  exec: {
    name: "exec",
    description: "Run shell command in cwd",
    schema: execSchema,
    permission: "exec",
    async run(input, cwd) {
      const { command, timeoutMs } = execSchema.parse(input);
      const result = await execa(command, {
        cwd,
        shell: true,
        timeout: timeoutMs,
        reject: false,
      });
      return {
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  },
};

interface MCPToolBinding {
  runtimeName: string;
  serverName: string;
  toolName: string;
  description: string;
  schema: unknown;
  permission: ToolPermission;
}

class MCPRegistry {
  private readonly clients = new Map<string, Client>();
  private readonly transports = new Map<string, StdioClientTransport>();
  private readonly bindings = new Map<string, MCPToolBinding>();

  async connect(servers: Record<string, MCPServerConfig>): Promise<void> {
    for (const [serverName, cfg] of Object.entries(servers)) {
      if (cfg.enabled === false) continue;

      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
        stderr: "pipe",
      });

      const client = new Client({
        name: "blah-code",
        version: "0.1.0",
      });

      await client.connect(transport);
      const listed = await client.listTools();

      this.clients.set(serverName, client);
      this.transports.set(serverName, transport);

      for (const tool of listed.tools) {
        const runtimeName = `mcp.${serverName}.${tool.name}`;
        const permission: ToolPermission = tool.annotations?.readOnlyHint
          ? "read"
          : "exec";

        this.bindings.set(runtimeName, {
          runtimeName,
          serverName,
          toolName: tool.name,
          description: tool.description ?? `${serverName}:${tool.name}`,
          schema: tool.inputSchema,
          permission,
        });
      }
    }
  }

  specs(): ToolSpec[] {
    return Array.from(this.bindings.values()).map((binding) => ({
      name: binding.runtimeName,
      description: binding.description,
      schema: binding.schema,
      permission: binding.permission,
    }));
  }

  permissionFor(name: string): ToolPermission | null {
    return this.bindings.get(name)?.permission ?? null;
  }

  async run(name: string, input: unknown): Promise<unknown> {
    const binding = this.bindings.get(name);
    if (!binding) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }

    const client = this.clients.get(binding.serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${binding.serverName}`);
    }

    const response = await client.callTool({
      name: binding.toolName,
      arguments: typeof input === "object" && input ? (input as Record<string, unknown>) : {},
    });

    if ("isError" in response && response.isError) {
      throw new Error(`MCP tool failed: ${binding.runtimeName}`);
    }

    if ("structuredContent" in response && response.structuredContent) {
      return response.structuredContent;
    }

    const contentArray =
      "content" in response && Array.isArray(response.content)
        ? response.content
        : [];

    const text =
      contentArray.length > 0
        ? contentArray
            .map((item: unknown) => {
              if (
                item &&
                typeof item === "object" &&
                "type" in item &&
                "text" in item &&
                (item as { type: string }).type === "text"
              ) {
                return String((item as { text: unknown }).text ?? "");
              }
              return JSON.stringify(item);
            })
            .join("\n")
        : JSON.stringify(response);

    return { output: text };
  }

  async close(): Promise<void> {
    const closing = Array.from(this.transports.values()).map((transport) =>
      transport.close().catch(() => undefined),
    );
    await Promise.all(closing);
    this.bindings.clear();
    this.clients.clear();
    this.transports.clear();
  }
}

class DefaultToolRuntime implements ToolRuntime {
  private readonly mcp = new MCPRegistry();

  constructor(private readonly mcpServers: Record<string, MCPServerConfig>) {}

  async init(): Promise<void> {
    if (Object.keys(this.mcpServers).length === 0) return;
    await this.mcp.connect(this.mcpServers);
  }

  listToolSpecs(): ToolSpec[] {
    const builtin = Object.values(builtinTools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: z.toJSONSchema(tool.schema),
      permission: tool.permission,
    }));

    return [...builtin, ...this.mcp.specs()];
  }

  permissionFor(name: string): ToolPermission {
    if (name in builtinTools) {
      return builtinTools[name as ToolName].permission;
    }

    const mcpPerm = this.mcp.permissionFor(name);
    if (mcpPerm) return mcpPerm;

    return "exec";
  }

  async executeTool(name: string, input: unknown, cwd: string): Promise<unknown> {
    if (name in builtinTools) {
      return builtinTools[name as ToolName].run(input, cwd);
    }

    if (name.startsWith("mcp.")) {
      return this.mcp.run(name, input);
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  async close(): Promise<void> {
    await this.mcp.close();
  }
}

export async function createToolRuntime(input?: {
  mcpServers?: Record<string, MCPServerConfig>;
}): Promise<ToolRuntime> {
  const runtime = new DefaultToolRuntime(input?.mcpServers ?? {});
  await runtime.init();
  return runtime;
}
