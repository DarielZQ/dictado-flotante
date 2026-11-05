// Prueba real contra Groq: transcribe los audios de tests/audio/ con tu clave.
// La clave se lee de .env.local (GROQ_API_KEY=...), que está excluido de git.
// Uso: node tests/e2e/groq-smoke.mjs
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const audioDir = path.join(root, "tests/audio");
const BASE = "https://api.groq.com/openai/v1";
const MODEL = "whisper-large-v3-turbo";
const TYPES = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".webm": "audio/webm" };

async function readKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
  try {
    const env = await readFile(path.join(root, ".env.local"), "utf8");
    return /^\s*GROQ_API_KEY\s*=\s*(.+?)\s*$/m.exec(env)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}

const normalize = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/** Porcentaje de palabras esperadas que aparecen en la transcripción. */
function wordRecall(expected, got) {
  const want = normalize(expected).split(" ");
  const have = new Set(normalize(got).split(" "));
  return Math.round((want.filter((w) => have.has(w)).length / want.length) * 100);
}

const key = await readKey();
if (!key) {
  console.error("Falta la clave: crea .env.local con GROQ_API_KEY=... (ver .env.example).");
  process.exit(2);
}

let files = [];
try {
  files = (await readdir(audioDir)).filter((f) => TYPES[path.extname(f).toLowerCase()]);
} catch {
  // carpeta inexistente
}
if (!files.length) {
  console.error("No hay audios en tests/audio/. Genera frases con tools/make-test-audio.ps1 o copia grabaciones tuyas.");
  process.exit(2);
}

const models = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } });
console.log(`Clave: ${models.ok ? "válida ✔" : `rechazada (HTTP ${models.status}) ✘`}`);
if (!models.ok) process.exit(1);

let failures = 0;
for (const file of files.sort()) {
  const full = path.join(audioDir, file);
  const language = /-en-/.test(file) ? "en" : "es";
  const form = new FormData();
  form.append("file", new File([await readFile(full)], file, { type: TYPES[path.extname(file).toLowerCase()] }));
  form.append("model", MODEL);
  form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  const t0 = performance.now();
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    failures++;
    console.log(`✘ ${file}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const body = await res.json();
  const expected = await readFile(`${full}.txt`, "utf8").catch(() => null);
  const recall = expected ? wordRecall(expected, body.text) : null;
  if (recall !== null && recall < 80) failures++;
  console.log(
    `${recall === null || recall >= 80 ? "✔" : "✘"} ${file} (${ms} ms${recall !== null ? `, ${recall}% de palabras` : ""})\n` +
      `   → ${body.text.trim()}` +
      (expected ? `\n   esperado: ${expected.trim()}` : ""),
  );
}
const remaining = models.headers.get("x-ratelimit-remaining-requests");
if (remaining) console.log(`Peticiones restantes hoy (según Groq): ${remaining}`);
process.exitCode = failures ? 1 : 0;
