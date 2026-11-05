// Build de la extensión con esbuild.
// Uso: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
// --e2e: build de pruebas en dist-e2e con un puente de configuración para Selenium.
const e2e = process.argv.includes("--e2e");
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const src = path.join(root, "src");
const dist = path.join(root, e2e ? "dist-e2e" : "dist");

const entries = {
  "background/index": "src/background/index.ts",
  "content/index": "src/content/index.ts",
  "recorder/recorder": "src/recorder/recorder-page.ts",
  "options/options": "src/options/options.ts",
  "popup/popup": "src/popup/popup.ts",
};

const STATIC_EXT = new Set([".html", ".css", ".svg", ".json", ".png"]);

async function copyStatic(dir = src) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await copyStatic(from);
    } else if (STATIC_EXT.has(path.extname(entry.name))) {
      const to = path.join(dist, path.relative(src, from));
      await mkdir(path.dirname(to), { recursive: true });
      await cp(from, to);
    }
  }
}

const common = {
  bundle: true,
  format: "iife",
  target: "firefox140",
  logLevel: "info",
  define: { __DEV__: watch || e2e ? "true" : "false", __E2E__: e2e ? "true" : "false" },
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "none",
};

const extensionOptions = {
  ...common,
  absWorkingDir: root,
  entryPoints: entries,
  outdir: dist,
};

const testPagesOptions = {
  ...common,
  absWorkingDir: root,
  entryPoints: { "react/app": "test-pages/react/app.tsx" },
  outdir: path.join(root, "test-pages-dist"),
  jsx: "automatic",
  define: { ...common.define, "process.env.NODE_ENV": '"development"' },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const ctx = await esbuild.context(extensionOptions);
  await ctx.watch();
  console.log("Vigilando cambios… (los archivos estáticos se copian solo al arrancar)");
} else {
  await esbuild.build(extensionOptions);
  await esbuild.build(testPagesOptions);
}
