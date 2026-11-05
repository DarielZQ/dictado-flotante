import { asUserFacing } from "../shared/errors";
import { createLogger } from "../shared/logger";
import { RECORDER_PORT_PREFIX, type RecorderCommand, type RecorderEvent } from "../shared/messages";
import { AudioRecorder } from "./recorder";

const log = createLogger("remote-recorder");

/**
 * Lado "remoto" del grabador: corre en el iframe de la extensión o en el content script.
 * Abre un Port hacia el background y obedece sus órdenes start/stop/cancel.
 */
export function connectRemoteRecorder(sessionId: string, onDone?: () => void): void {
  const port = browser.runtime.connect({ name: RECORDER_PORT_PREFIX + sessionId });
  let lastLevelAt = 0;
  const post = (msg: RecorderEvent) => {
    try {
      port.postMessage(msg);
    } catch (err) {
      log.warn("No se pudo enviar al background", err);
    }
  };

  const recorder = new AudioRecorder({
    onLevel(level) {
      const now = performance.now();
      if (now - lastLevelAt < 66) return; // ≤ 15 Hz
      lastLevelAt = now;
      post({ type: "recorder/level", sessionId, level });
    },
    onAutoStop(reason) {
      post({ type: "recorder/auto-stop", sessionId, reason });
    },
  });

  const finish = () => {
    recorder.cancel();
    try {
      port.disconnect();
    } catch {
      // ya desconectado
    }
    onDone?.();
  };

  port.onMessage.addListener(async (raw: unknown) => {
    const msg = raw as RecorderCommand;
    if (msg.sessionId !== sessionId) return;
    try {
      switch (msg.type) {
        case "recorder/start":
          await recorder.start(msg.options);
          post({ type: "recorder/started", sessionId });
          break;
        case "recorder/stop": {
          const audio = await recorder.stop();
          const buffer = await audio.blob.arrayBuffer();
          post({
            type: "recorder/audio",
            sessionId,
            audio: buffer,
            mimeType: audio.mimeType,
            durationMs: audio.durationMs,
            speechMs: audio.speechMs,
          });
          finish();
          break;
        }
        case "recorder/cancel":
          finish();
          break;
      }
    } catch (err) {
      post({ type: "recorder/error", sessionId, error: asUserFacing(err) });
      finish();
    }
  });

  port.onDisconnect.addListener(() => {
    recorder.cancel();
    onDone?.();
  });

  post({ type: "recorder/ready", sessionId });
}
