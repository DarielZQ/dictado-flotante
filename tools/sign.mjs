// Firma la extensión en addons.mozilla.org como "unlisted" (privada, no aparece en la tienda).
// Credenciales: WEB_EXT_API_KEY y WEB_EXT_API_SECRET en el entorno o en .env.local (excluido de git).
// El script nunca las muestra. Uso: npm run sign
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowDirty = process.argv.includes("--allow-dirty");

function readEnvLocal() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const local = readEnvLocal();
const apiKey = process.env.WEB_EXT_API_KEY || local.WEB_EXT_API_KEY || "";
const apiSecret = process.env.WEB_EXT_API_SECRET || local.WEB_EXT_API_SECRET || "";
if (!apiKey || !apiSecret) {
  console.error(
    "Faltan las credenciales de firma. Añade a .env.local:\n" +
      "  WEB_EXT_API_KEY=user:12345:678\n" +
      "  WEB_EXT_API_SECRET=...\n" +
      "Se generan en https://addons.mozilla.org/developers/addon/api/key/",
  );
  process.exit(2);
}
if (!/^user:\d+:\d+$/.test(apiKey)) {
  console.error("WEB_EXT_API_KEY no tiene el formato esperado (user:números:números). Revisa .env.local.");
  process.exit(2);
}

// El código fuente que se sube a Mozilla sale de git: debe coincidir con lo compilado.
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
if (dirty && !allowDirty) {
  console.error("Hay cambios sin confirmar. Haz commit antes de firmar (o usa --allow-dirty).\n" + dirty);
  process.exit(2);
}

const version = JSON.parse(readFileSync(path.join(root, "src/manifest.json"), "utf8")).version;
const artifacts = path.join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });

console.log(`Compilando la versión ${version}…`);
execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "inherit" });

const sourceZip = path.join(artifacts, `source-${version}.zip`);
execFileSync("git", ["archive", "--format=zip", "-o", sourceZip, "HEAD"], { cwd: root });
console.log(`Código fuente para la revisión: ${path.relative(root, sourceZip)}`);

console.log("Enviando a addons.mozilla.org (puede tardar unos minutos)…");
const webExt = path.join(root, "node_modules/web-ext/bin/web-ext.js");
const result = spawnSync(
  process.execPath,
  [
    webExt,
    "sign",
    "--source-dir",
    "dist",
    "--artifacts-dir",
    "artifacts",
    "--channel",
    "unlisted",
    "--upload-source-code",
    sourceZip,
  ],
  { cwd: root, stdio: "inherit", env: { ...process.env, WEB_EXT_API_KEY: apiKey, WEB_EXT_API_SECRET: apiSecret } },
);
process.exit(result.status ?? 1);
