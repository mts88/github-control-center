const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

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

// the webview loads mermaid from dist/ (local resource, nonce'd script — no CDN)
function copyMermaidBundle() {
  const mermaidSource = path.join(__dirname, "node_modules", "mermaid", "dist", "mermaid.min.js");
  const mermaidTarget = path.join(__dirname, "dist", "mermaid.min.js");
  fs.mkdirSync(path.dirname(mermaidTarget), { recursive: true });
  fs.copyFileSync(mermaidSource, mermaidTarget);
}

copyMermaidBundle();

if (isWatchMode) {
  esbuild.context(options).then((buildContext) => buildContext.watch());
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
