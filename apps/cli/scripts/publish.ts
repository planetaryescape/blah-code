#!/usr/bin/env bun

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const REPO = "planetaryescape/blah-code";
const SCOPE = "@blah-code";
const DIST = resolve(import.meta.dirname, "../dist/npm");

interface Platform {
  name: string;
  archiveName: string;
  archiveExt: string;
  binaryName: string;
  os: string;
  cpu: string;
}

const PLATFORMS: Platform[] = [
  {
    name: "darwin-arm64",
    archiveName: "blah-code-cli-darwin-arm64",
    archiveExt: "tar.gz",
    binaryName: "blah-code",
    os: "darwin",
    cpu: "arm64",
  },
  {
    name: "linux-x64",
    archiveName: "blah-code-cli-linux-x64",
    archiveExt: "tar.gz",
    binaryName: "blah-code",
    os: "linux",
    cpu: "x64",
  },
  {
    name: "linux-arm64",
    archiveName: "blah-code-cli-linux-arm64",
    archiveExt: "tar.gz",
    binaryName: "blah-code",
    os: "linux",
    cpu: "arm64",
  },
  {
    name: "windows-x64",
    archiveName: "blah-code-cli-windows-x64",
    archiveExt: "zip",
    binaryName: "blah-code.exe",
    os: "win32",
    cpu: "x64",
  },
];

function parseArgs(): { version: string; dryRun: boolean; tag: string; otp?: string } {
  const args = process.argv.slice(2);
  let version = "";
  let dryRun = false;
  let tag = "latest";
  let otp: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) {
      version = args[i + 1].replace(/^v/, "");
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--tag" && args[i + 1]) {
      tag = args[i + 1];
      i++;
    } else if (args[i] === "--otp" && args[i + 1]) {
      otp = args[i + 1];
      i++;
    }
  }

  if (!version) {
    console.error("Usage: bun run scripts/publish.ts --version <version> [--tag latest] [--otp <code>]");
    process.exit(1);
  }

  if (!otp) {
    const envOtp = process.env.NPM_OTP?.trim();
    if (envOtp) otp = envOtp;
  }

  return { version, dryRun, tag, otp };
}

async function downloadBinary(platform: Platform, version: string, destDir: string): Promise<void> {
  const url = `https://github.com/${REPO}/releases/download/cli-v${version}/${platform.archiveName}.${platform.archiveExt}`;
  const archivePath = join(destDir, `${platform.archiveName}.${platform.archiveExt}`);

  console.log(`  Downloading ${platform.name}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  writeFileSync(archivePath, Buffer.from(buffer));

  if (platform.archiveExt === "tar.gz") {
    const proc = Bun.spawnSync(["tar", "-xzf", archivePath], { cwd: destDir });
    if (proc.exitCode !== 0) throw new Error(`Failed to extract ${archivePath}`);
  } else {
    const proc = Bun.spawnSync(["unzip", "-q", archivePath], { cwd: destDir });
    if (proc.exitCode !== 0) throw new Error(`Failed to extract ${archivePath}`);
  }

  rmSync(archivePath);
}

function createPlatformPackage(platform: Platform, version: string, downloadDir: string): string {
  const packageName = `cli-${platform.name}`;
  const packageDir = join(DIST, packageName);
  mkdirSync(packageDir, { recursive: true });

  const binaryPath = join(downloadDir, platform.archiveName, platform.binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}`);
  }

  copyFileSync(binaryPath, join(packageDir, platform.binaryName));

  const packageJson = {
    name: `${SCOPE}/${packageName}`,
    version,
    description: `blah-code CLI binary for ${platform.name}`,
    license: "MIT",
    repository: {
      type: "git",
      url: `git+https://github.com/${REPO}.git`,
      directory: "apps/cli",
    },
    homepage: `https://github.com/${REPO}`,
    os: [platform.os],
    cpu: [platform.cpu],
    files: [platform.binaryName],
  };

  writeFileSync(join(packageDir, "package.json"), JSON.stringify(packageJson, null, 2));
  return packageDir;
}

function createMainPackage(version: string): string {
  const packageDir = join(DIST, "cli");
  mkdirSync(packageDir, { recursive: true });

  const binDir = join(packageDir, "bin");
  mkdirSync(binDir, { recursive: true });
  copyFileSync(resolve(import.meta.dirname, "../bin/blah-code.js"), join(binDir, "blah-code.js"));

  const scriptsDir = join(packageDir, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(resolve(import.meta.dirname, "postinstall.mjs"), join(scriptsDir, "postinstall.mjs"));

  const optionalDependencies: Record<string, string> = {};
  for (const platform of PLATFORMS) {
    optionalDependencies[`${SCOPE}/cli-${platform.name}`] = version;
  }

  const packageJson = {
    name: `${SCOPE}/cli`,
    version,
    description: "blah-code CLI",
    license: "MIT",
    repository: {
      type: "git",
      url: `git+https://github.com/${REPO}.git`,
      directory: "apps/cli",
    },
    homepage: `https://github.com/${REPO}`,
    bin: {
      "blah-code": "./bin/blah-code.js",
    },
    type: "module",
    scripts: {
      postinstall: "node scripts/postinstall.mjs",
    },
    files: ["bin", "scripts"],
    optionalDependencies,
    engines: {
      node: ">=18",
    },
  };

  writeFileSync(join(packageDir, "package.json"), JSON.stringify(packageJson, null, 2));

  writeFileSync(
    join(packageDir, "README.md"),
    `# @blah-code/cli\n\nLocal-first coding agent CLI for blah.chat.\n\nInstall:\n\n\`\`\`bash\nnpm i -g @blah-code/cli\n\`\`\`\n`,
  );

  return packageDir;
}

async function publishPackage(packageDir: string, dryRun: boolean, tag: string, otp?: string): Promise<void> {
  if (!Bun.which("npm")) {
    throw new Error("npm not found on PATH.");
  }

  const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const pkgVersionRef = `${packageJson.name}@${packageJson.version}`;

  if (dryRun) {
    console.log(`  Would publish ${pkgVersionRef}`);
    Bun.spawnSync(["npm", "pack", "--dry-run"], {
      cwd: packageDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    return;
  }

  const existsProc = Bun.spawnSync(["npm", "view", pkgVersionRef, "version"], {
    cwd: packageDir,
    stdout: "ignore",
    stderr: "ignore",
  });
  if (existsProc.exitCode === 0) {
    console.log(`  ${pkgVersionRef} already published, skipping`);
    return;
  }

  console.log(`  Publishing ${pkgVersionRef}...`);
  const publishArgs = ["npm", "publish", "--access", "public", "--tag", tag];
  if (otp) publishArgs.push("--otp", otp);
  const proc = Bun.spawnSync(publishArgs, {
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (proc.exitCode === 0) {
    return;
  }

  const sawOtpError =
    stderr.includes("code EOTP") ||
    stderr.toLowerCase().includes("one-time password");
  const canUseTrustedPublishing =
    !otp &&
    Boolean(process.env.GITHUB_ACTIONS) &&
    Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);

  if (sawOtpError && canUseTrustedPublishing) {
    console.log("  OTP required with token auth. Retrying with npm trusted publishing (OIDC)...");
    const trustedEnv = {
      ...process.env,
      NPM_CONFIG_PROVENANCE: "true",
      NPM_CONFIG_TOKEN: "",
      NODE_AUTH_TOKEN: "",
      NPM_TOKEN: "",
    };
    delete trustedEnv.npm_config_token;
    delete trustedEnv.npm_config_otp;
    delete trustedEnv.NPM_OTP;

    const trustedProc = Bun.spawnSync(
      ["npm", "publish", "--access", "public", "--tag", tag, "--provenance"],
      {
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: trustedEnv,
      },
    );
    const trustedStdout = trustedProc.stdout.toString();
    const trustedStderr = trustedProc.stderr.toString();
    if (trustedStdout) process.stdout.write(trustedStdout);
    if (trustedStderr) process.stderr.write(trustedStderr);

    if (trustedProc.exitCode === 0) {
      return;
    }

    throw new Error(
      `Failed to publish ${packageJson.name} after trusted-publishing retry. ` +
        "If trusted publishing is not configured in npm, use an npm automation token.",
    );
  }

  if (sawOtpError && !otp) {
    throw new Error(
      `Failed to publish ${packageJson.name}: npm requires OTP. ` +
        "Use an npm automation token for CI, configure trusted publishing, or pass --otp.",
    );
  }

  throw new Error(`Failed to publish ${packageJson.name}`);
}

async function main() {
  const { version, dryRun, tag, otp } = parseArgs();

  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true });
  }
  mkdirSync(DIST, { recursive: true });

  const downloadDir = join(DIST, "_downloads");
  mkdirSync(downloadDir);

  console.log(`Publishing @blah-code/cli v${version}${dryRun ? " (dry run)" : ""}`);

  for (const platform of PLATFORMS) {
    await downloadBinary(platform, version, downloadDir);
  }

  const platformPackageDirs: string[] = [];
  for (const platform of PLATFORMS) {
    platformPackageDirs.push(createPlatformPackage(platform, version, downloadDir));
  }

  const mainPackageDir = createMainPackage(version);

  for (const dir of platformPackageDirs) {
    await publishPackage(dir, dryRun, tag, otp);
  }

  await publishPackage(mainPackageDir, dryRun, tag, otp);

  rmSync(downloadDir, { recursive: true });
  console.log("✅ Publish complete");
}

main().catch((err) => {
  console.error("❌ Publish failed:", err.message);
  process.exit(1);
});
