// Servidor estático mínimo para las páginas de prueba (sin dependencias).
// Uso: node tools/serve-test-pages.mjs [puerto]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export function startServer(listenPort = port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/test-pages/basic.html";
    const file = path.normalize(path.join(root, rel));
    const allowed = [path.join(root, "test-pages"), path.join(root, "test-pages-dist")];
    if (!allowed.some((dir) => file.startsWith(dir + path.sep))) {
      res.writeHead(403).end("Prohibido");
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("No encontrado");
    }
  });
  return new Promise((resolve) => server.listen(listenPort, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
  console.log(`Páginas de prueba en http://127.0.0.1:${port}/test-pages/basic.html`);
}
