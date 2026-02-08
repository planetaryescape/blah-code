import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino, { type Logger as PinoLogger } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggingConfig {
  level?: LogLevel;
  print?: boolean;
  retainFiles?: number;
  dir?: string;
  sync?: boolean;
}

const defaultLogDir = path.join(os.homedir(), ".blah-code", "logs");
const currentLogFileName = "current.log";
const rotatedPattern = /^\d{8}T\d{6}\.log$/;

const state: {
  root: PinoLogger | null;
  config: {
    level: LogLevel;
    print: boolean;
    retainFiles: number;
    sync: boolean;
  };
  dir: string;
  file: string;
} = {
  root: null,
  config: { level: "info", print: false, retainFiles: 10, sync: false },
  dir: defaultLogDir,
  file: path.join(defaultLogDir, currentLogFileName),
};

function timestampFileName(now = new Date()): string {
  const value = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "");
  return `${value}.log`;
}

function rotateCurrentLog(currentPath: string): void {
  if (!existsSync(currentPath)) return;
  const stat = statSync(currentPath);
  if (stat.size === 0) return;

  const rotatedPath = path.join(path.dirname(currentPath), timestampFileName(stat.mtime));
  renameSync(currentPath, rotatedPath);
}

function pruneRotatedLogs(dir: string, retainFiles: number): void {
  const rotated = readdirSync(dir)
    .filter((name) => rotatedPattern.test(name))
    .map((name) => {
      const fullPath = path.join(dir, name);
      return {
        name,
        fullPath,
        mtime: statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const entry of rotated.slice(retainFiles)) {
    unlinkSync(entry.fullPath);
  }
}

function buildRootLogger(): PinoLogger {
  const destination = pino.destination({
    dest: state.file,
    mkdir: true,
    sync: state.config.sync,
    append: true,
  });

  if (state.config.print) {
    return pino(
      {
        level: state.config.level,
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.multistream([
        { stream: destination },
        { stream: process.stderr },
      ]),
    );
  }

  return pino(
    {
      level: state.config.level,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

export function initLogging(input?: LoggingConfig): void {
  state.config = {
    level: input?.level ?? state.config.level,
    print: input?.print ?? state.config.print,
    retainFiles: input?.retainFiles ?? 10,
    sync: input?.sync ?? false,
  };
  state.dir = input?.dir ?? defaultLogDir;
  state.file = path.join(state.dir, currentLogFileName);

  mkdirSync(state.dir, { recursive: true });
  rotateCurrentLog(state.file);
  pruneRotatedLogs(state.dir, state.config.retainFiles);
  state.root = buildRootLogger();
}

function getRootLogger(): PinoLogger {
  if (!state.root) {
    initLogging();
  }
  return state.root as PinoLogger;
}

export function createLogger(scope: string): PinoLogger {
  return getRootLogger().child({ scope });
}

export function logPath(): string {
  return state.file;
}

export function logDir(): string {
  return state.dir;
}

export async function readLogTail(lines = 200): Promise<string[]> {
  const safeLines = Number.isFinite(lines) ? Math.max(1, Math.min(Math.floor(lines), 5000)) : 200;
  const text = await readFile(state.file, "utf8").catch(() => "");
  if (!text) return [];

  const all = text.split("\n").filter((line) => line.length > 0);
  return all.slice(-safeLines);
}
