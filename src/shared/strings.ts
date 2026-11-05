import type { ErrorCode } from "./errors";

/** Textos de error visibles para el usuario. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  "mic-permission-denied": "Permiso de micrófono denegado. Concédelo en Opciones.",
  "mic-not-found": "No se encontró ningún micrófono.",
  "mic-busy": "El micrófono está en uso por otra aplicación.",
  "mic-blocked-by-site": "Este sitio bloquea el micrófono. Cambia la estrategia de captura en Opciones.",
  "no-speech": "No se detectó voz.",
  "missing-api-key": "Falta la clave API. Configúrala en Opciones.",
  "invalid-api-key": "La clave API no es válida.",
  "rate-limited": "Límite del plan gratuito alcanzado. Reintenta en {n} s.",
  "payload-too-large": "La grabación es demasiado grande.",
  "bad-request": "El servicio de transcripción rechazó la petición.",
  "provider-unavailable": "El servicio de transcripción no está disponible ahora.",
  network: "Sin conexión con el servicio de transcripción.",
  timeout: "El servicio de transcripción tardó demasiado.",
  "no-target": "El campo de texto ya no existe.",
  "insert-failed": "No se pudo insertar automáticamente. Texto copiado: pulsa Ctrl+V.",
  "unsupported-page": "El dictado no está disponible en esta página.",
  internal: "Error interno del dictado.",
};

export const UI_STRINGS = {
  labelIdle: "Empezar dictado",
  labelArming: "Abriendo micrófono…",
  labelListening: "Detener y transcribir",
  labelTranscribing: "Transcribiendo… pulsa para cancelar",
  labelInserting: "Insertando texto…",
  labelSuccess: "Texto insertado",
  labelError: "Error en el dictado",
  menuHide: "Ocultar en este sitio",
  menuOptions: "Opciones",
  toastFocusField: "Enfoca un campo de texto para dictar.",
  toastCopied: "Texto copiado al portapapeles: pulsa Ctrl+V.",
  toastInterrupted: "El dictado se interrumpió. Vuelve a intentarlo.",
  toastHidden: "Botón oculto en este sitio. Puedes mostrarlo desde el icono de la extensión.",
} as const;
