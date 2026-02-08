import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger, initLogging, readLogTail } from "./index";

function makeDir(name: string): string {
  return path.join(os.tmpdir(), `blah-code-${name}-${Date.now()}-${Math.random()}`);
}

describe("logger", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0, dirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writes logs and reads tail", async () => {
    const dir = makeDir("logger");
    dirs.push(dir);

    initLogging({ dir, level: "debug", print: false, sync: true });
    const logger = createLogger("test");
    logger.info("hello logger");
    await Bun.sleep(20);

    const tail = await readLogTail(20);
    expect(tail.some((line) => line.includes("hello logger"))).toBe(true);
  });

  test("prunes rotated logs beyond retention", () => {
    const dir = makeDir("logger-rotate");
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });

    writeFileSync(path.join(dir, "20240101T010101.log"), "a");
    writeFileSync(path.join(dir, "20240102T010101.log"), "b");
    writeFileSync(path.join(dir, "20240103T010101.log"), "c");

    initLogging({ dir, retainFiles: 2, sync: true });

    const rotated = readdirSync(dir).filter((name) => /^\\d{8}T\\d{6}\\.log$/.test(name));
    expect(rotated.length).toBeLessThanOrEqual(2);
  });
});
