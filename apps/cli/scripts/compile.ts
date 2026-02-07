import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "../dist/release");
const ENTRYPOINT = resolve(import.meta.dirname, "../src/index.ts");

type Target = {
  bunTarget: string;
  name: string;
  ext: string;
  archiveType: "tar" | "zip";
};

const ALL_TARGETS: Target[] = [
  {
    bunTarget: "bun-darwin-arm64",
    name: "blah-code-cli-darwin-arm64",
    ext: "",
    archiveType: "tar",
  },
  {
    bunTarget: "bun-linux-x64",
    name: "blah-code-cli-linux-x64",
    ext: "",
    archiveType: "tar",
  },
  {
    bunTarget: "bun-linux-arm64",
    name: "blah-code-cli-linux-arm64",
    ext: "",
    archiveType: "tar",
  },
  {
    bunTarget: "bun-windows-x64",
    name: "blah-code-cli-windows-x64",
    ext: ".exe",
    archiveType: "zip",
  },
];

function currentTarget(): Target {
  const platform =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "windows"
        : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = ALL_TARGETS.find((t) => t.bunTarget === `bun-${platform}-${arch}`);

  if (!target) {
    console.error(`Unsupported current platform for single build: ${platform}-${arch}`);
    process.exit(1);
  }

  return target;
}

const singleMode = process.argv.includes("--single");
const targets = singleMode ? [currentTarget()] : ALL_TARGETS;

if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(DIST, { recursive: true });

for (const target of targets) {
  const dir = join(DIST, target.name);
  const binaryName = `blah-code${target.ext}`;
  const outfile = join(dir, binaryName);

  console.log(`Building ${target.name}...`);
  mkdirSync(dir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    compile: {
      target: target.bunTarget as any,
      outfile,
    },
    minify: true,
  });

  if (!result.success) {
    console.error(`Build failed for ${target.name}:`, result.logs);
    process.exit(1);
  }

  if (target.archiveType === "tar") {
    const archive = `${target.name}.tar.gz`;
    const proc = Bun.spawnSync(["tar", "-czf", archive, target.name], {
      cwd: DIST,
    });
    if (proc.exitCode !== 0) {
      console.error(`Failed to create ${archive}:`, proc.stderr.toString());
      process.exit(1);
    }
  } else {
    const archive = `${target.name}.zip`;
    const isWindows = process.platform === "win32";
    const proc = isWindows
      ? Bun.spawnSync(
          [
            "powershell",
            "-Command",
            `Compress-Archive -Path '${target.name}' -DestinationPath '${archive}'`,
          ],
          { cwd: DIST },
        )
      : Bun.spawnSync(["zip", "-r", archive, target.name], { cwd: DIST });

    if (proc.exitCode !== 0) {
      console.error(`Failed to create ${archive}:`, proc.stderr.toString());
      process.exit(1);
    }
  }

  rmSync(dir, { recursive: true });
  console.log(`  ${target.name} done`);
}

console.log("\nAll builds complete. Archives in apps/cli/dist/release/");
