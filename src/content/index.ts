// Content script: corre en todos los frames. La UI solo se monta en el frame superior.
import { createLogger } from "../shared/logger";
import type { BackgroundToContent, ContentToBackground, InsertResult } from "../shared/messages";
import type { PublicSettings } from "../shared/settings";
import { ACTIVE_PHASES } from "../shared/state";
import { UI_STRINGS } from "../shared/strings";
import { connectRemoteRecorder } from "../recorder/remote-recorder";
import { UI_HOST_ATTR } from "./editable";
import { FocusTracker } from "./focus-tracker";
import { insertText } from "./inject/insert";
import { takeSnapshot, type TargetSnapshot } from "./target-snapshot";
import { FloatingButton } from "./ui/floating-button";

const log = createLogger("content");
const GUARD = "__dictadoFlotanteLoaded";
const HIDE_DELAY_MS = 400;
const HEARTBEAT_MS = 10000;

type GuardedWindow = Window & { [GUARD]?: boolean };

function send(msg: ContentToBackground): Promise<unknown> {
  return browser.runtime.sendMessage(msg).catch((err: unknown) => {
    log.debug("Mensaje no entregado", msg.type, err);
    return undefined;
  });
}

function hostKey(): string {
  return location.hostname || (location.protocol === "file:" ? "file" : location.protocol.replace(":", ""));
}

function main(): void {
  const isTop = window.top === window;
  let settings: PublicSettings | null = null;
  let frozen: { sessionId: string; snapshot: TargetSnapshot | null } | null = null;
  let activeSessionId: string | null = null;

  const tracker = new FocusTracker({
    onChange(editable, kind) {
      void send({ type: "focus/changed", editable, kind, at: Date.now() });
    },
  });

  // ----- Esc cancela el dictado (en cualquier frame, solo con sesión activa) -----
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !activeSessionId) return;
      e.preventDefault();
      e.stopPropagation();
      void send({ type: "dictation/cancel" });
    },
    true,
  );

  // ----- UI (solo frame superior) -----
  let button: FloatingButton | null = null;
  let uiRoot: ShadowRoot | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let recorderFrame: HTMLIFrameElement | null = null;
  let fieldFocused = false;

  const isHiddenHere = () => Boolean(settings?.ui.hiddenHosts.includes(hostKey()));

  function mountUi(s: PublicSettings): void {
    const host = document.createElement("div");
    host.setAttribute(UI_HOST_ATTR, "");
    host.style.cssText =
      "all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; " +
      "width: 0 !important; height: 0 !important; z-index: 2147483647 !important;";
    // Abierto solo en el build de pruebas, para que Selenium pueda leer la UI.
    uiRoot = host.attachShadow({ mode: __E2E__ ? "open" : "closed" });
    (document.documentElement ?? document.body).appendChild(host);

    // Algunos sitios reconstruyen el DOM: vuelve a insertar el host si desaparece.
    let reinserts = 0;
    let windowStart = Date.now();
    new MutationObserver(() => {
      if (host.isConnected) return;
      if (Date.now() - windowStart > 60000) {
        windowStart = Date.now();
        reinserts = 0;
      }
      if (reinserts++ < 5) document.documentElement.appendChild(host);
    }).observe(document.documentElement, { childList: true });

    button = new FloatingButton({
      root: uiRoot,
      initialPosition: s.ui.positions[hostKey()] ?? null,
      sizePx: s.ui.buttonSizePx,
      language: s.language,
      onActivate: () => void send({ type: "dictation/toggle" }),
      onSelectLanguage: (language) => void send({ type: "ui/set-language", language }),
      onHideForSite: () => {
        void send({ type: "ui/hide-host", host: hostKey() });
        button?.setVisible(false);
      },
      onOpenOptions: () => void send({ type: "open-options" }),
      onPositionChange: (pos) => void send({ type: "ui/save-position", host: hostKey(), ...pos }),
    });
  }

  function setFieldFocused(visible: boolean): void {
    fieldFocused = visible;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    if (!button) return;
    if (visible && !isHiddenHere()) {
      button.setVisible(true);
    } else {
      hideTimer = setTimeout(() => button?.setVisible(false), HIDE_DELAY_MS);
    }
  }

  function setHeartbeat(sessionId: string | null): void {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (sessionId) {
      heartbeat = setInterval(() => void send({ type: "session/heartbeat", sessionId }), HEARTBEAT_MS);
    }
  }

  function mountRecorder(sessionId: string, mode: "iframe" | "content"): void {
    if (mode === "content") {
      connectRemoteRecorder(sessionId);
      return;
    }
    unmountRecorder();
    const frame = document.createElement("iframe");
    frame.src = browser.runtime.getURL(`recorder/recorder.html?session=${encodeURIComponent(sessionId)}`);
    frame.setAttribute("allow", "microphone");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
    (uiRoot ?? document.documentElement).appendChild(frame);
    recorderFrame = frame;
  }

  function unmountRecorder(): void {
    recorderFrame?.remove();
    recorderFrame = null;
  }

  // ----- Mensajes del background -----
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const msg = raw as BackgroundToContent;
    switch (msg?.type) {
      case "ping":
        return isTop ? Promise.resolve("pong") : undefined;

      case "session/active":
        activeSessionId = msg.active ? msg.sessionId : null;
        if (isTop) setHeartbeat(activeSessionId);
        return undefined;

      case "target/snapshot":
        frozen = { sessionId: msg.sessionId, snapshot: takeSnapshot() ?? tracker.lastSnapshot };
        return undefined;

      case "inject/text": {
        const snapshot = frozen?.sessionId === msg.sessionId ? frozen.snapshot : tracker.lastSnapshot;
        frozen = null;
        const copyToClipboard = async (text: string): Promise<boolean> => {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch {
            return Boolean(await send({ type: "clipboard/write", text }));
          }
        };
        return insertText(snapshot, msg.text, {
          smartFormatting: settings?.smartFormatting ?? true,
          copyToClipboard,
        }).catch((err: unknown): InsertResult => {
          log.warn("Fallo al insertar", err);
          return { inserted: false, strategy: "none", copiedToClipboard: false };
        });
      }
    }

    if (!isTop) return undefined;
    switch (msg?.type) {
      case "ui/focus-state":
        setFieldFocused(msg.visible);
        return undefined;
      case "ui/state":
        button?.setPhase(msg.phase, msg.error);
        if (!ACTIVE_PHASES.has(msg.phase)) unmountRecorder();
        return undefined;
      case "ui/level":
        button?.setLevel(msg.level);
        return undefined;
      case "ui/toast":
        button?.showToast(msg.message, msg.variant);
        return undefined;
      case "ui/settings-changed":
        settings = msg.settings;
        button?.setLanguage(msg.settings.language);
        if (isHiddenHere()) button?.setVisible(false);
        else if (fieldFocused) button?.setVisible(true);
        return undefined;
      case "recorder/mount":
        mountRecorder(msg.sessionId, msg.mode);
        return Promise.resolve(true);
      case "recorder/unmount":
        unmountRecorder();
        return undefined;
    }
    return undefined;
  });

  // Solo en el build de pruebas (dist-e2e): puente para que Selenium configure la extensión.
  if (__E2E__ && isTop) {
    window.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { __dictadoE2E?: unknown } | null;
      if (e.source !== window || !data || typeof data !== "object" || !("__dictadoE2E" in data)) return;
      void browser.runtime
        .sendMessage({ type: "e2e/configure", ...(data.__dictadoE2E as object) })
        .then((result: unknown) => window.postMessage({ __dictadoE2EDone: JSON.parse(JSON.stringify(result)) }, "*"));
    });
  }

  if (isTop) {
    void (send({ type: "settings/get-public" }) as Promise<PublicSettings | undefined>).then((s) => {
      if (!s) return;
      settings = s;
      mountUi(s);
      // Puede que el campo ya estuviera enfocado antes de montar la UI.
      tracker.forceReport();
      if (isHiddenHere()) log.debug(UI_STRINGS.toastHidden);
    });
  } else {
    void (send({ type: "settings/get-public" }) as Promise<PublicSettings | undefined>).then((s) => {
      if (s) settings = s;
    });
  }
}

const w = window as GuardedWindow;
if (!w[GUARD]) {
  w[GUARD] = true;
  try {
    main();
  } catch (err) {
    log.error("No se pudo iniciar Dictado Flotante", err);
  }
}
