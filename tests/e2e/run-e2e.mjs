// Prueba de extremo a extremo en Firefox real con Selenium.
// - Micrófono simulado de Firefox (permiso aprobado automáticamente).
// - Servicio de transcripción simulado en 127.0.0.1 (no consume cuota ni necesita clave).
// - Verifica que el texto llega a input, textarea, contenteditable, React, iframes y shadow DOM.
//
// Uso: npm run test:e2e   (o node tests/e2e/run-e2e.mjs --headed para ver Firefox)
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { createServer } from "node:http";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../../tools/serve-test-pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "tests/e2e/output");
const headed = process.argv.includes("--headed");
const EXT_ID = "dictado-flotante@extension.local";
const EXT_UUID = "5d3c9a2e-7b1f-4c55-9e2a-1f0b8c6d4e21";
const PAGES = "http://127.0.0.1:5173/test-pages";
const MOCK_PORT = 5174;
const TRANSCRIPT = "Hola desde la prueba automática.";

// ---------- Servicio STT simulado ----------
const stt = { requests: [] };
function startMockStt() {
  const server = createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.url === "/v1/models") {
        res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end('{"data":[]}');
        return;
      }
      if (req.url === "/v1/audio/transcriptions" && req.method === "POST") {
        const text = body.toString("latin1");
        const field = (name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(text)?.[1];
        stt.requests.push({
          bytes: body.length,
          auth: req.headers.authorization,
          model: field("model"),
          language: field("language"),
          format: field("response_format"),
          fileType: /name="file"; filename="([^"]+)"\r\nContent-Type: ([^\r]+)/.exec(text)?.slice(1),
        });
        res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(
          JSON.stringify({
            text: TRANSCRIPT,
            language: "spanish",
            segments: [{ text: TRANSCRIPT, start: 0, end: 2, no_speech_prob: 0.01, avg_logprob: -0.1 }],
          }),
        );
        return;
      }
      res.writeHead(404, cors).end();
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------- Utilidades ----------
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findXpi() {
  const dir = path.join(root, "artifacts-e2e");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".zip") || f.endsWith(".xpi"));
  if (!files.length) throw new Error("No hay paquete en artifacts/. Ejecuta npm run test:e2e.");
  return path.join(dir, files.sort().at(-1));
}

async function shot(driver, name) {
  await mkdir(outDir, { recursive: true });
  const png = await driver.takeScreenshot();
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, png, "base64");
  return file;
}

/** Configura la extensión vía el puente postMessage que solo existe en el build dist-e2e. */
async function configure(driver, payload) {
  return driver.executeAsyncScript(
    "const done = arguments[arguments.length - 1];" +
      "const onMsg = (e) => { if (e.data && e.data.__dictadoE2EDone) { removeEventListener('message', onMsg); done(e.data.__dictadoE2EDone); } };" +
      "addEventListener('message', onMsg);" +
      "postMessage({ __dictadoE2E: arguments[0] }, '*');" +
      "setTimeout(() => done(null), 8000);",
    payload,
  );
}

/** Coordenadas del botón flotante (shadow DOM cerrado: se calcula desde el viewport). */
async function buttonPoint(driver) {
  const [vw, vh] = await driver.executeScript(
    "return [document.documentElement.clientWidth, document.documentElement.clientHeight]",
  );
  const size = 44;
  return { x: Math.round(vw - 24 - size / 2), y: Math.round(vh - 24 - size / 2) };
}

async function clickButton(driver) {
  const { x, y } = await buttonPoint(driver);
  await driver.actions({ async: true }).move({ x, y, origin: "viewport" }).press().release().perform();
}

/** Lo que hay pintado en el punto del botón (el host de la UI si está visible). */
async function hostAtButton(driver) {
  const { x, y } = await buttonPoint(driver);
  return driver.executeScript(
    "const el = document.elementFromPoint(arguments[0], arguments[1]);" +
      "return el ? (el.hasAttribute('data-dictado-flotante') ? 'ui' : el.tagName) : null;",
    x,
    y,
  );
}

async function waitFor(fn, timeoutMs = 10000, every = 150) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  return last;
}

let dictations = 0;

/** Enfoca un campo, dicta (clic, espera, clic) y devuelve el valor resultante. */
async function dictateInto(driver, focusScript, readScript, { waitMs = 2400 } = {}) {
  const n = ++dictations;
  await driver.executeScript(focusScript);
  await sleep(400);
  await shot(driver, `d${n}-a-antes`);
  await clickButton(driver); // empezar
  await sleep(waitMs);
  await shot(driver, `d${n}-b-grabando`);
  await clickButton(driver); // parar y transcribir
  const result = await waitFor(async () => {
    const v = await driver.executeScript(readScript);
    return v && v.includes("prueba automática") ? v : null;
  }, 8000);
  if (!result) await shot(driver, `d${n}-c-fallo`);
  return result;
}

// ---------- Escenarios ----------
async function run() {
  const pagesServer = await startServer(5173);
  const mockServer = await startMockStt();
  const xpi = await findXpi();

  const options = new firefox.Options();
  if (!headed) {
    options.addArguments("-headless");
    process.env.MOZ_HEADLESS = "1";
  }
  options.windowSize({ width: 1280, height: 900 });
  options.setPreference("media.navigator.streams.fake", true);
  options.setPreference("media.navigator.permission.disabled", true);
  options.setPreference("extensions.webextensions.uuids", JSON.stringify({ [EXT_ID]: EXT_UUID }));
  options.setPreference("extensions.webextOptionalPermissionPrompts", false);
  options.setPreference("ui.prefersReducedMotion", 1);

  console.log("Arrancando Firefox…");
  const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();
  try {
    const caps = await driver.getCapabilities();
    console.log(`Firefox ${caps.get("browserVersion")} (${headed ? "visible" : "headless"})`);
    console.log("Instalando la extensión…");
    await driver.installAddon(xpi, true);
    console.log("Extensión instalada");
    // La extensión abre su página de opciones al instalarse; Marionette no puede controlarla.
    await sleep(1500);
    const handles = await driver.getAllWindowHandles();
    let mainHandle = handles[0];
    for (const h of handles) {
      await driver.switchTo().window(h);
      const url = await driver.getCurrentUrl().catch(() => "");
      if (url.startsWith("moz-extension://")) record("La página de opciones se abre al instalar", true);
      else mainHandle = h;
    }
    await driver.switchTo().window(mainHandle);

    // --- Configuración mediante el puente del build de pruebas ---
    await driver.get(`${PAGES}/basic.html`);
    await sleep(800);
    const cfg = await configure(driver, {
      apiKey: "clave-de-prueba",
      patch: { provider: { baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1` }, logLevel: "debug", autoStop: { enabled: false } },
    });
    record("Ajustes guardados", cfg?.settings?.provider?.baseUrl === `http://127.0.0.1:${MOCK_PORT}/v1`);
    record("Probar conexión (GET /models)", cfg?.test?.ok === true, JSON.stringify(cfg?.test?.error ?? ""));
    const hostExists = await driver.executeScript("return !!document.querySelector('[data-dictado-flotante]')");
    record("Se monta el host de la UI (Shadow DOM)", hostExists);
    record("Botón oculto sin campo enfocado", (await hostAtButton(driver)) !== "ui");

    await driver.executeScript("document.getElementById('password').focus()");
    await sleep(700);
    record("No aparece en campos de contraseña", (await hostAtButton(driver)) !== "ui");

    await driver.executeScript("document.getElementById('text-input').focus()");
    const visible = await waitFor(async () => (await hostAtButton(driver)) === "ui", 3000);
    record("Aparece al enfocar un input", Boolean(visible));
    await shot(driver, "02-boton-visible");

    // 1) Micrófono simulado de Firefox (getUserMedia real, tono continuo = sin voz)
    await clickButton(driver);
    await sleep(1200);
    await shot(driver, "03-escuchando");
    const focusKept = await driver.executeScript("return document.activeElement && document.activeElement.id");
    record("Pulsar el botón no quita el foco del campo", focusKept === "text-input", `foco: ${focusKept}`);
    await clickButton(driver);
    await sleep(1500);
    await shot(driver, "03b-sin-voz");
    const afterTone = await configure(driver, {});
    record(
      "getUserMedia real: captura con un tono continuo y no lo envía (no es voz)",
      stt.requests.length === 0 &&
        (await driver.executeScript("return document.getElementById('text-input').value")) === "",
      `estrategia usada: ${afterTone?.lastStrategy}`,
    );

    // 2) A partir de aquí, señal sintética con forma de habla
    await configure(driver, { fakeSpeech: true });
    const value = await dictateInto(
      driver,
      "document.getElementById('text-input').focus()",
      "return document.getElementById('text-input').value",
    );
    record("Texto insertado en input", value === TRANSCRIPT, JSON.stringify(value));
    await shot(driver, "04-insertado");
    const events = await driver.executeScript("return window.__eventLog.filter(e => e.endsWith('text-input'))");
    record("Se disparan beforeinput/input", events.includes("beforeinput:text-input") && events.includes("input:text-input"), events.join(","));

    const req = stt.requests[0];
    record(
      "Petición STT correcta",
      Boolean(req && req.bytes > 1000 && req.model === "whisper-large-v3-turbo" && req.language === "es" && req.auth === "Bearer clave-de-prueba"),
      req ? `${req.bytes} bytes, ${req.fileType?.join(" ")}, formato ${req.format}` : "sin petición",
    );

    // Inserción a mitad de texto con formato inteligente
    const mid = await dictateInto(
      driver,
      "const el = document.getElementById('prefilled-input'); el.focus(); el.setSelectionRange(4, 4);",
      "return document.getElementById('prefilled-input').value",
    );
    record("Inserta en la posición del cursor con espacios", mid === "Hola hola desde la prueba automática mundo", JSON.stringify(mid));

    const ta = await dictateInto(
      driver,
      "document.getElementById('textarea').focus()",
      "return document.getElementById('textarea').value",
    );
    record("Texto insertado en textarea", ta === TRANSCRIPT, JSON.stringify(ta));

    const ce = await dictateInto(
      driver,
      "const el = document.getElementById('editable'); el.focus();",
      "return document.getElementById('editable').textContent",
    );
    record("Texto insertado en contenteditable", ce === TRANSCRIPT, JSON.stringify(ce));

    // Deshacer tras execCommand
    await driver.executeScript("document.getElementById('textarea').focus()");
    await driver.actions().keyDown("").sendKeys("z").keyUp("").perform();
    await sleep(300);
    const undone = await driver.executeScript("return document.getElementById('textarea').value");
    record("Ctrl+Z deshace el dictado", undone === "", JSON.stringify(undone));

    // Esc cancela
    await driver.executeScript("document.getElementById('search-input').focus()");
    await sleep(400);
    const before = stt.requests.length;
    await clickButton(driver);
    await sleep(900);
    await driver.actions().sendKeys("").perform();
    await sleep(1200);
    const cancelled = await driver.executeScript("return document.getElementById('search-input').value");
    record("Esc cancela sin transcribir", cancelled === "" && stt.requests.length === before);

    // --- React ---
    await driver.get(`${PAGES}/react/index.html`);
    await driver.wait(until.elementLocated(By.id("react-input")), 5000);
    const reactVal = await dictateInto(
      driver,
      "document.getElementById('react-input').focus()",
      "return document.getElementById('react-input-state').textContent",
    );
    record("React: el estado controlado se actualiza", reactVal === TRANSCRIPT, JSON.stringify(reactVal));
    const reactTa = await dictateInto(
      driver,
      "document.getElementById('react-textarea').focus()",
      "return document.getElementById('react-textarea-state').textContent",
    );
    record("React: textarea controlado", reactTa === TRANSCRIPT, JSON.stringify(reactTa));

    // --- iframes ---
    await driver.get(`${PAGES}/iframes.html`);
    await sleep(1200);
    const ifr = await dictateInto(
      driver,
      "document.getElementById('srcdoc').contentDocument.getElementById('inner-editable').focus()",
      "return document.getElementById('srcdoc').contentDocument.getElementById('inner-editable').textContent",
    );
    record("iframe srcdoc: inserta en el frame enfocado", ifr === TRANSCRIPT, JSON.stringify(ifr));
    const same = await dictateInto(
      driver,
      "document.getElementById('same-origin').contentDocument.getElementById('text-input').focus()",
      "return document.getElementById('same-origin').contentDocument.getElementById('text-input').value",
    );
    record("iframe mismo origen: inserta en el frame enfocado", same === TRANSCRIPT, JSON.stringify(same));

    // --- Shadow DOM ---
    await driver.get(`${PAGES}/shadow-dom.html`);
    await sleep(800);
    const sh = await dictateInto(
      driver,
      "document.getElementById('fancy').shadowRoot.getElementById('shadow-input').focus()",
      "return document.getElementById('fancy').shadowRoot.getElementById('shadow-input').value",
    );
    record("Input dentro de shadow DOM", sh === TRANSCRIPT, JSON.stringify(sh));

    // --- Auto-parada por silencio (micrófono simulado) ---
    await driver.get(`${PAGES}/basic.html`);
    await sleep(800);
    await configure(driver, { patch: { autoStop: { enabled: true, silenceMs: 1000 } } });
    await driver.executeScript("document.getElementById('text-input').focus()");
    await sleep(400);
    const n = stt.requests.length;
    await clickButton(driver);
    const autoStopped = await waitFor(async () => stt.requests.length > n || (await driver.executeScript("return document.getElementById('text-input').value")) !== "", 12000);
    record("Auto-parada con el micrófono simulado", Boolean(autoStopped), autoStopped ? "" : "no se detuvo sola (esperable: el micrófono simulado es un tono continuo)");
    await shot(driver, "05-final");
  } finally {
    await driver.quit();
    pagesServer.close();
    mockServer.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "results.json"), JSON.stringify({ results, stt: stt.requests }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
