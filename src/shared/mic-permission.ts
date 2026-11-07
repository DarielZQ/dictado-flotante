/**
 * Estado del permiso de micrófono de la propia extensión (solo páginas de la extensión).
 * Si no está concedido, la captura en segundo plano falla y se usa el respaldo a través
 * de la página, que hace que cada web pida su propio permiso.
 */
export async function extensionMicState(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}
