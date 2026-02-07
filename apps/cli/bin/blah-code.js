#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

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
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    process.exit(1);
  }

  return `@blah-code/cli-${os}-${cpu}`;
}

function findBinaryPath() {
  const packageName = getPlatformPackageName();
  const packageParts = packageName.split("/");
  const unscopedName = packageParts[1];

  const possiblePaths = [
    join(__dirname, "..", "node_modules", ...packageParts, "blah-code"),
    join(__dirname, "..", "node_modules", ...packageParts, "blah-code.exe"),
    join(__dirname, "..", "..", unscopedName, "blah-code"),
    join(__dirname, "..", "..", unscopedName, "blah-code.exe"),
    join(__dirname, "..", "..", "..", "node_modules", ...packageParts, "blah-code"),
    join(__dirname, "..", "..", "..", "node_modules", ...packageParts, "blah-code.exe"),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) return p;
  }

  try {
    const packagePath = require.resolve(`${packageName}/package.json`);
    const packageDir = dirname(packagePath);
    const binaryName = process.platform === "win32" ? "blah-code.exe" : "blah-code";
    const binaryPath = join(packageDir, binaryName);
    if (existsSync(binaryPath)) return binaryPath;
  } catch {
    // ignore
  }

  return null;
}

const binaryPath = findBinaryPath();
if (!binaryPath) {
  console.error("Could not find blah-code binary for your platform.");
  console.error(`Expected package: ${getPlatformPackageName()}`);
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`Failed to execute blah-code: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
