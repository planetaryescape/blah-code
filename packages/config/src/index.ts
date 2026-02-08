import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const mcpServerSchema = z.object({
  enabled: z.boolean().default(true),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const configSchema = z.object({
  model: z.string().optional(),
  permission: z.record(z.string(), z.unknown()).optional(),
  mcp: z.record(z.string(), mcpServerSchema).optional(),
  timeout: z
    .object({
      modelMs: z.number().int().min(1000).max(600000),
    })
    .optional(),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]),
      print: z.boolean().optional(),
    })
    .optional(),
  daemon: z
    .object({
      port: z.number().int().min(1).max(65535),
      host: z.string().min(1),
      attachUrl: z.string().url().optional(),
    })
    .optional(),
});

export type BlahCodeConfig = z.infer<typeof configSchema>;
export type MCPServerConfig = z.infer<typeof mcpServerSchema>;

function loadFile(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Invalid JSON config: ${filePath}`);
  }
}

export function resolveConfigPaths(cwd = process.cwd()): string[] {
  return [
    path.join(cwd, "blah-code.json"),
    path.join(cwd, ".blah-code.json"),
    path.join(os.homedir(), ".blah-code", "config.json"),
  ];
}

export function loadBlahCodeConfig(cwd = process.cwd()): BlahCodeConfig {
  const paths = resolveConfigPaths(cwd);
  for (const filePath of paths) {
    const raw = loadFile(filePath);
    if (!raw) continue;
    return configSchema.parse(raw);
  }
  return configSchema.parse({});
}
