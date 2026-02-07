#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function getPlatformPackageName() {
  const platformMap = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };

  const archMap = {
    arm64: "arm64",
    x64: "x64",
  };

  const os = platformMap[process.platform];
  const cpu = archMap[process.arch];

  if (!os || !cpu) {
    return null;
  }

  return `@blah-code/cli-${os}-${cpu}`;
}

const pkg = getPlatformPackageName();
if (!pkg) {
  console.warn(`[blah-code] Unsupported platform: ${process.platform}-${process.arch}`);
  process.exit(0);
}

try {
  const packagePath = require.resolve(`${pkg}/package.json`);
  const packageDir = dirname(packagePath);
  const binaryName = process.platform === "win32" ? "blah-code.exe" : "blah-code";
  const binaryPath = join(packageDir, binaryName);
  if (!existsSync(binaryPath)) {
    console.warn(`[blah-code] Installed ${pkg} but binary missing at ${binaryPath}`);
  }
} catch {
  console.warn(`[blah-code] Platform package ${pkg} was not installed.`);
}
