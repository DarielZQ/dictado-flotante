// Punto de entrada del background (event page no persistente de Firefox MV3).
// Todos los listeners se registran de forma síncrona en el nivel superior.
import { asUserFacing, DictationError, toUserFacing } from "../shared/errors";
import { createLogger, setLogLevel } from "../shared/logger";
import {
  fail,
  isBackgroundMessage,
  ok,
  PRIVILEGED_TYPES,
  type AnyToBackground,
  type BackgroundToContent,
  type PopupStatus,
  type Result,
} from "../shared/messages";
import {
  getApiKey,
  loadSettings,
  saveSettings,
  setApiKey,
  toPublic,
  type Settings,
} from "../shared/settings";
import { createCaptureHost, handleRecorderPort } from "./capture";
import { writeClipboard } from "./clipboard";
import { DictationController } from "./controller";
import { FocusRegistry } from "./focus-registry";
import { SessionStore } from "./session-store";
import { createProvider } from "./stt";

const log = createLogger("background");
const focus = new FocusRegistry();
const sessions = new SessionStore();

let settingsCache: Promise<Settings> | null = null;
function getSettings(): Promise<Settings> {
  settingsCache ??= loadSettings().then((s) => {
    setLogLevel(s.logLevel);
    return s;
  });
  return settingsCache;
}

function sendToFrame(tabId: number, frameId: number, msg: BackgroundToContent): Promise<unknown> {
  return browser.tabs.sendMessage(tabId, msg, { frameId });
}

function broadcast(tabId: number, msg: BackgroundToContent): Promise<unknown> {
  return browser.tabs.sendMessage(tabId, msg);
}

const controller = new DictationController({
  getSettings,
  getApiKey,
  getFocus: (tabId) => focus.get(tabId),
  sendToFrame,
  broadcast,
  createCaptureHost: (strategy, tabId) =>
    createCaptureHost(strategy, tabId, (t, msg) => sendToFrame(t, 0, msg)),
  createProvider,
  writeClipboard,
  saveSession: (s) => sessions.save(s),
  newId: () => crypto.randomUUID(),
});

// Si la event page se reinició a mitad de un dictado, avisa y limpia.
void sessions.load().then((stale) => controller.recoverInterrupted(stale));

// ---------- Utilidades ----------

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:" ? u.hostname || "file" : null;
  } catch {
    return null;
  }
}

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (!/^(https?|file):/.test(url)) return false;
  return !/^https:\/\/(addons\.mozilla\.org|accounts-static\.cdn\.mozilla\.net)\//.test(url);
}

/** Comprueba que el content script responde; si no, lo inyecta (activeTab + scripting). */
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, { type: "ping" } satisfies BackgroundToContent, { frameId: 0 });
    return true;
  } catch {
    try {
      await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content/index.js"] });
      return true;
    } catch (err) {
      log.warn("No se pudo inyectar el content script", err);
      return false;
    }
  }
}

async function broadcastSettings(): Promise<void> {
  const s = await getSettings();
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !isSupportedUrl(tab.url)) continue;
    void browser.tabs
      .sendMessage(tab.id, { type: "ui/settings-changed", settings: toPublic(s) } satisfies BackgroundToContent, {
        frameId: 0,
      })
      .catch(() => undefined);
  }
}

async function updateSettings(patch: Parameters<typeof saveSettings>[0]): Promise<Settings> {
  const next = await saveSettings(patch);
  settingsCache = Promise.resolve(next);
  setLogLevel(next.logLevel);
  void broadcastSettings();
  return next;
}

// ---------- Mensajes ----------

async function handle(msg: AnyToBackground, sender: browser.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;

  switch (msg.type) {
    // ----- desde content scripts -----
    case "focus/changed": {
      if (tabId === undefined) return null;
      const state = await focus.update(tabId, frameId, msg.editable, msg.kind, msg.at);
      void sendToFrame(tabId, 0, { type: "ui/focus-state", ...state }).catch(() => undefined);
      return null;
    }
    case "dictation/toggle":
      if (tabId !== undefined) await controller.toggle(tabId);
      return null;
    case "dictation/cancel":
      if (tabId !== undefined && controller.current?.tabId === tabId) controller.cancel("user");
      return null;
    case "session/heartbeat":
      return null; // recibir el evento basta para mantener viva la event page
    case "settings/get-public":
      return toPublic(await getSettings());
    case "ui/hide-host": {
      const s = await getSettings();
      await updateSettings({ ui: { hiddenHosts: [...new Set([...s.ui.hiddenHosts, msg.host])] } });
      return null;
    }
    case "ui/save-position": {
      const s = await getSettings();
      await updateSettings({
        ui: { positions: { ...s.ui.positions, [msg.host]: { xPct: msg.xPct, yPct: msg.yPct } } },
      });
      return null;
    }
    case "clipboard/write":
      return writeClipboard(msg.text);
    case "open-options":
      await browser.runtime.openOptionsPage();
      return null;

    // ----- desde páginas de la extensión -----
    case "settings/get":
      return getSettings();
    case "settings/save":
      return updateSettings(msg.patch);
    case "secret/set-api-key":
      await setApiKey(msg.apiKey);
      return true;
    case "secret/has-api-key":
      return (await getApiKey()).length > 0;
    case "provider/test": {
      const provider = createProvider(await getSettings(), await getApiKey());
      try {
        await provider.testConnection(AbortSignal.timeout(15000));
        return ok(true);
      } catch (err) {
        return fail(asUserFacing(err));
      }
    }
    case "stt/transcribe-test": {
      try {
        const text = await controller.transcribeStandalone({
          blob: new Blob([msg.audio], { type: msg.mimeType }),
          mimeType: msg.mimeType,
          durationMs: msg.durationMs,
          speechMs: msg.speechMs,
        });
        return ok(text) satisfies Result<string>;
      } catch (err) {
        return fail(asUserFacing(err));
      }
    }
    case "popup/status": {
      const s = await getSettings();
      const host = hostOf(msg.url);
      const status: PopupStatus = {
        phase: controller.current?.tabId === msg.tabId ? controller.current.phase : "idle",
        host,
        hidden: host ? s.ui.hiddenHosts.includes(host) : false,
        supported: isSupportedUrl(msg.url),
        hasApiKey: (await getApiKey()).length > 0,
        hasAllSitesPermission: await browser.permissions.contains({ origins: ["<all_urls>"] }),
      };
      return status;
    }
    case "popup/start-dictation": {
      if (!(await ensureContentScript(msg.tabId))) return fail(toUserFacing("unsupported-page"));
      await controller.toggle(msg.tabId);
      return ok(true);
    }
    case "popup/set-host-hidden": {
      const s = await getSettings();
      const set = new Set(s.ui.hiddenHosts);
      if (msg.hidden) set.add(msg.host);
      else set.delete(msg.host);
      await updateSettings({ ui: { hiddenHosts: [...set] } });
      return null;
    }
  }
}

browser.runtime.onMessage.addListener((raw: unknown, sender: browser.runtime.MessageSender) => {
  if (sender.id !== browser.runtime.id) return undefined;
  if (!isBackgroundMessage(raw)) return undefined;
  // Los mensajes privilegiados solo se aceptan de páginas de la extensión, nunca de content scripts.
  if (PRIVILEGED_TYPES.has(raw.type) && sender.tab && !sender.url?.startsWith(browser.runtime.getURL(""))) {
    log.warn("Mensaje privilegiado rechazado desde un content script", raw.type);
    return undefined;
  }
  return handle(raw, sender).catch((err) => {
    log.error("Error manejando", raw.type, err);
    return fail(err instanceof DictationError ? err.toUserFacing() : asUserFacing(err));
  });
});

browser.runtime.onConnect.addListener((port) => {
  if (handleRecorderPort(port)) return;
  port.disconnect();
});

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-dictation") return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !isSupportedUrl(tab.url)) return;
  if (await ensureContentScript(tab.id)) await controller.toggle(tab.id);
});

browser.tabs.onRemoved.addListener((tabId) => {
  if (controller.current?.tabId === tabId) controller.cancel("tab-closed");
  void focus.remove(tabId);
});

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void browser.runtime.openOptionsPage();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) settingsCache = null;
});
