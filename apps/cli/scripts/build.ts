import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outdir: new URL("../dist", import.meta.url).pathname,
  target: "bun",
  sourcemap: "external",
  plugins: [solidPlugin],
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
