const esbuild = require("esbuild");

const isWatchMode = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
};

if (isWatchMode) {
  esbuild.context(options).then((buildContext) => buildContext.watch());
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
