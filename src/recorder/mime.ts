import { DictationError } from "../shared/errors";

export const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/ogg",
] as const;

export function pickMimeType(
  isSupported: (mime: string) => boolean = (m) => MediaRecorder.isTypeSupported(m),
): string {
  for (const mime of PREFERRED_MIME_TYPES) {
    if (isSupported(mime)) return mime;
  }
  throw new DictationError("internal", "Ningún formato de audio compatible con MediaRecorder");
}

export function extensionForMime(mime: string): "webm" | "ogg" {
  return mime.includes("ogg") ? "ogg" : "webm";
}
