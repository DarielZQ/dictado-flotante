import { createLogger } from "../shared/logger";

const log = createLogger("clipboard");

/** Escribe texto en el portapapeles desde el background (requiere clipboardWrite). */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    log.warn("navigator.clipboard.writeText falló en background", err);
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (err) {
    log.warn("execCommand('copy') falló en background", err);
    return false;
  }
}
