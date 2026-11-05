import { asUserFacing, isUserFacingError } from "../shared/errors";
import type { Result, UiToBackground } from "../shared/messages";
import { LANGUAGES, normalizeBaseUrl, GROQ_BASE_URL, type Settings } from "../shared/settings";
import { AudioRecorder } from "../recorder/recorder";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function call<T>(msg: UiToBackground): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

function setStatus(id: string, text: string, kind: "ok" | "err" | "" = ""): void {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

let settings: Settings;

async function refreshKeyStatus(): Promise<void> {
  const has = await call<boolean>({ type: "secret/has-api-key" });
  $("key-status").textContent = has ? "Clave guardada ✓" : "Todavía no hay ninguna clave guardada.";
}

async function refreshPermissionBanner(): Promise<void> {
  const granted = await browser.permissions.contains({ origins: ["<all_urls>"] });
  $("banner-permission").classList.toggle("hidden", granted);
}

function fill(s: Settings): void {
  $<HTMLInputElement>("base-url").value = s.provider.baseUrl;
  $<HTMLInputElement>("model").value = s.provider.model;
  $<HTMLSelectElement>("response-format").value = s.provider.responseFormat;
  $<HTMLSelectElement>("capture-strategy").value = s.captureStrategy;
  $<HTMLSelectElement>("language").value = s.language;
  $<HTMLTextAreaElement>("prompt").value = s.prompt;
  $<HTMLInputElement>("auto-stop").checked = s.autoStop.enabled;
  $<HTMLInputElement>("silence-ms").value = String(s.autoStop.silenceMs);
  $<HTMLInputElement>("max-ms").value = String(s.autoStop.maxDurationMs);
  $<HTMLInputElement>("no-speech-ms").value = String(s.autoStop.noSpeechTimeoutMs);
  $<HTMLInputElement>("smart").checked = s.smartFormatting;
  $<HTMLInputElement>("hallucination").checked = s.hallucinationFilter;
  $<HTMLInputElement>("button-size").value = String(s.ui.buttonSizePx);
  renderHiddenHosts(s.ui.hiddenHosts);
}

function renderHiddenHosts(hosts: string[]): void {
  const list = $("hidden-hosts");
  list.replaceChildren();
  $("no-hidden").classList.toggle("hidden", hosts.length > 0);
  for (const host of hosts) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = host;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary";
    btn.textContent = "Mostrar de nuevo";
    btn.addEventListener("click", async () => {
      await call({ type: "popup/set-host-hidden", host, hidden: false });
      settings = await call<Settings>({ type: "settings/get" });
      renderHiddenHosts(settings.ui.hiddenHosts);
    });
    li.append(name, btn);
    list.appendChild(li);
  }
}

async function saveProvider(): Promise<void> {
  setStatus("provider-status", "Guardando…");
  const keyInput = $<HTMLInputElement>("api-key");
  const baseUrl = normalizeBaseUrl($<HTMLInputElement>("base-url").value);

  // Otro proveedor: pedir permiso de acceso a su origen (gesto del usuario).
  if (new URL(baseUrl).origin !== new URL(GROQ_BASE_URL).origin) {
    const granted = await browser.permissions.request({ origins: [`${new URL(baseUrl).origin}/*`] });
    if (!granted) {
      setStatus("provider-status", "Sin permiso para acceder a ese proveedor.", "err");
      return;
    }
  }
  if (keyInput.value.trim()) {
    await call({ type: "secret/set-api-key", apiKey: keyInput.value.trim() });
    keyInput.value = "";
    keyInput.type = "password";
    $("toggle-key").textContent = "Mostrar";
  }
  settings = await call<Settings>({
    type: "settings/save",
    patch: {
      provider: {
        baseUrl,
        model: $<HTMLInputElement>("model").value.trim(),
        responseFormat: $<HTMLSelectElement>("response-format").value as Settings["provider"]["responseFormat"],
      },
    },
  });
  fill(settings);
  await refreshKeyStatus();
  setStatus("provider-status", "Guardado ✓", "ok");
}

async function testProvider(): Promise<void> {
  setStatus("provider-status", "Probando conexión…");
  const res = await call<Result<boolean>>({ type: "provider/test" });
  if (res.ok) setStatus("provider-status", "Conexión correcta: la clave funciona ✓", "ok");
  else setStatus("provider-status", res.error.message, "err");
}

async function saveDictation(): Promise<void> {
  const num = (id: string) => Number($<HTMLInputElement>(id).value);
  settings = await call<Settings>({
    type: "settings/save",
    patch: {
      language: $<HTMLSelectElement>("language").value,
      prompt: $<HTMLTextAreaElement>("prompt").value,
      autoStop: {
        enabled: $<HTMLInputElement>("auto-stop").checked,
        silenceMs: num("silence-ms"),
        maxDurationMs: num("max-ms"),
        noSpeechTimeoutMs: num("no-speech-ms"),
      },
      smartFormatting: $<HTMLInputElement>("smart").checked,
      hallucinationFilter: $<HTMLInputElement>("hallucination").checked,
      ui: { buttonSizePx: num("button-size") },
    },
  });
  fill(settings);
  setStatus("dictation-status", "Guardado ✓", "ok");
}

// ---------- Micrófono ----------

async function listDevices(): Promise<void> {
  const select = $<HTMLSelectElement>("device");
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  select.replaceChildren();
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Micrófono predeterminado";
  select.appendChild(def);
  devices.forEach((d, i) => {
    if (!d.deviceId || d.deviceId === "default") return;
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Micrófono ${i + 1}`;
    select.appendChild(opt);
  });
  select.value = settings.deviceId;
}

async function grantMic(): Promise<void> {
  setStatus("mic-status", "Esperando permiso… acepta y marca «Recordar esta decisión».");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const meter = $<HTMLMeterElement>("mic-level");
    const started = performance.now();
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-5);
      meter.value = Math.min(1, Math.max(0, (db + 60) / 50));
      if (performance.now() - started < 5000) requestAnimationFrame(tick);
      else {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        meter.value = 0;
      }
    };
    tick();
    setStatus("mic-status", "Micrófono concedido ✓ Habla para ver el nivel durante 5 s.", "ok");
    await listDevices();
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    setStatus(
      "mic-status",
      name === "NotAllowedError"
        ? "Permiso denegado. Puedes cambiarlo con el icono del micrófono en la barra de direcciones."
        : `No se pudo abrir el micrófono (${name || "error"}).`,
      "err",
    );
  }
}

// ---------- Prueba de dictado ----------

let testRecorder: AudioRecorder | null = null;

async function stopTest(): Promise<void> {
  const rec = testRecorder;
  testRecorder = null;
  const btn = $<HTMLButtonElement>("test-record");
  btn.textContent = "Empezar a grabar";
  if (!rec) return;
  btn.disabled = true;
  setStatus("test-status", "Transcribiendo…");
  try {
    const audio = await rec.stop();
    const res = await call<Result<string>>({
      type: "stt/transcribe-test",
      audio: await audio.blob.arrayBuffer(),
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      speechMs: audio.speechMs,
    });
    if (res.ok) {
      $<HTMLTextAreaElement>("test-output").value = res.data;
      setStatus("test-status", "Listo ✓", "ok");
    } else {
      setStatus("test-status", res.error.message, "err");
    }
  } catch (err) {
    setStatus("test-status", (isUserFacingError(err) ? err : asUserFacing(err)).message, "err");
  } finally {
    btn.disabled = false;
  }
}

async function toggleTest(): Promise<void> {
  if (testRecorder) return stopTest();
  const meter = $<HTMLMeterElement>("mic-level");
  testRecorder = new AudioRecorder({
    onLevel: (l) => (meter.value = l),
    onAutoStop: (reason) => {
      if (reason === "no-speech") {
        testRecorder?.cancel();
        testRecorder = null;
        $("test-record").textContent = "Empezar a grabar";
        setStatus("test-status", "No se detectó voz.", "err");
      } else void stopTest();
    },
  });
  try {
    await testRecorder.start({
      autoStop: settings.autoStop,
      ...(settings.deviceId ? { deviceId: settings.deviceId } : {}),
    });
    $("test-record").textContent = "Detener y transcribir";
    setStatus("test-status", "Grabando… habla ahora.");
  } catch (err) {
    testRecorder = null;
    setStatus("test-status", asUserFacing(err).message, "err");
  }
}

// ---------- Inicio ----------

async function init(): Promise<void> {
  const langSelect = $<HTMLSelectElement>("language");
  for (const { code, label } of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    langSelect.appendChild(opt);
  }
  settings = await call<Settings>({ type: "settings/get" });
  fill(settings);
  await Promise.all([refreshKeyStatus(), refreshPermissionBanner(), listDevices()]);

  $("toggle-key").addEventListener("click", () => {
    const input = $<HTMLInputElement>("api-key");
    input.type = input.type === "password" ? "text" : "password";
    $("toggle-key").textContent = input.type === "password" ? "Mostrar" : "Ocultar";
  });
  $("save-provider").addEventListener("click", () => void saveProvider());
  $("test-provider").addEventListener("click", () => void testProvider());
  $("save-dictation").addEventListener("click", () => void saveDictation());
  $("grant-mic").addEventListener("click", () => void grantMic());
  $("test-record").addEventListener("click", () => void toggleTest());
  $("device").addEventListener("change", async () => {
    settings = await call<Settings>({
      type: "settings/save",
      patch: { deviceId: $<HTMLSelectElement>("device").value },
    });
  });
  $("capture-strategy").addEventListener("change", async () => {
    settings = await call<Settings>({
      type: "settings/save",
      patch: { captureStrategy: $<HTMLSelectElement>("capture-strategy").value as Settings["captureStrategy"] },
    });
  });
  $("grant-sites").addEventListener("click", async () => {
    await browser.permissions.request({ origins: ["<all_urls>"] });
    await refreshPermissionBanner();
  });
}

void init();
