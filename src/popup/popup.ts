import type { PopupStatus, Result, UiToBackground } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const call = <T>(msg: UiToBackground) => browser.runtime.sendMessage(msg) as Promise<T>;

const PHASE_TEXT: Record<PopupStatus["phase"], string> = {
  idle: "",
  arming: "Abriendo micrófono…",
  listening: "Escuchando…",
  transcribing: "Transcribiendo…",
  inserting: "Insertando…",
  success: "Listo",
  error: "Error",
};

async function init(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  $("options").addEventListener("click", (e) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
    window.close();
  });
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  const status = await call<PopupStatus>({ type: "popup/status", tabId, url: tab.url ?? "" });

  const warn = (text: string) => {
    $("warning").textContent = text;
    $("warning").classList.remove("hidden");
  };
  if (!status.supported) {
    warn("No disponible en esta página.");
    $<HTMLButtonElement>("dictate").disabled = true;
    $("host-row").classList.add("hidden");
  } else if (!status.hasApiKey) {
    warn("Falta la clave API: configúrala en Opciones.");
  } else if (!status.hasAllSitesPermission) {
    warn("Falta el permiso de acceso a los sitios: el botón no aparecerá solo. Concédelo en Opciones.");
  }

  $("phase").textContent = PHASE_TEXT[status.phase];
  $("dictate").textContent = status.phase === "listening" ? "Detener" : "Dictar ahora";
  if (status.host) {
    $("host").textContent = status.host;
    $<HTMLInputElement>("show-here").checked = !status.hidden;
    $("show-here").addEventListener("change", () => {
      void call({
        type: "popup/set-host-hidden",
        host: status.host!,
        hidden: !$<HTMLInputElement>("show-here").checked,
      });
    });
  } else {
    $("host-row").classList.add("hidden");
  }

  $("dictate").addEventListener("click", async () => {
    const res = await call<Result<boolean>>({ type: "popup/start-dictation", tabId });
    if (!res.ok) warn(res.error.message);
    else window.close();
  });
}

void init();
