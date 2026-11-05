/**
 * SOLO para el build de pruebas (dist-e2e): genera una señal con forma de habla
 * (0,5 s de silencio, ~1,5 s de "sílabas" y después silencio) para ejercitar
 * la detección de voz, la auto-parada y MediaRecorder sin un micrófono real.
 */
export function createFakeSpeechStream(): { stream: MediaStream; close: () => void } {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => undefined);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 180;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const t0 = ctx.currentTime + 0.5;
  for (let i = 0; i < 5; i++) {
    const start = t0 + i * 0.3;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.5, start + 0.03);
    gain.gain.setValueAtTime(0.5, start + 0.22);
    gain.gain.linearRampToValueAtTime(0, start + 0.25);
  }
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  return {
    stream: dest.stream,
    close: () => {
      osc.stop();
      void ctx.close().catch(() => undefined);
    },
  };
}
