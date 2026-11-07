# Dictado fuera del navegador (diseño de referencia)

> Solo diseño. No está implementado.

## Por qué la extensión no puede hacerlo

- Los content scripts solo ven el DOM de las páginas web. No hay API para saber qué ventana del sistema tiene el foco ni para escribir en ella.
- No existe una API web que emita pulsaciones de teclado a nivel de sistema (el equivalente a `SendInput` en Windows).
- Los atajos de la API `commands` solo funcionan con Firefox enfocado: no hay atajos globales.

## Opción A: puente con Native Messaging

```
[Atajo global]  →  host nativo  ⇄ stdio ⇄  extensión (graba + Groq)
                        │
                        └→ SendInput / portapapeles + Ctrl+V → ventana activa
```

- Permiso opcional `nativeMessaging` en la extensión.
- Registro del host en Windows: clave `HKCU\Software\Mozilla\NativeMessagingHosts\com.dictado_flotante.host`, cuyo valor por defecto es la ruta a este JSON:

  ```json
  {
    "name": "com.dictado_flotante.host",
    "description": "Host de dictado para aplicaciones de escritorio",
    "path": "C:\\Users\\<Usuario>\\AppData\\Local\\DictadoFlotante\\host.exe",
    "type": "stdio",
    "allowed_extensions": ["{5cdec31d-f472-4fb6-bac6-87363a517f97}"]
  }
  ```

  En macOS: `~/Library/Application Support/Mozilla/NativeMessagingHosts/`; en Linux: `~/.mozilla/native-messaging-hosts/`.
- Protocolo: cada mensaje es JSON UTF-8 precedido de su longitud en 4 bytes (uint32, orden nativo). Del host a la extensión, máximo 1 MB por mensaje.
- Mensajes:

  | Dirección | Mensaje |
  |---|---|
  | host → ext | `{ "type": "hotkey", "action": "toggle" }` |
  | ext → host | `{ "type": "state", "phase": "listening" }` |
  | ext → host | `{ "type": "type-text", "text": "…", "mode": "sendinput" \| "clipboard-paste" }` |
  | host → ext | `{ "type": "typed", "ok": true }` |
  | ambos | `{ "type": "ping" }` / `{ "type": "pong", "version": "0.1.0" }` |

- Flujo: la extensión abre `runtime.connectNative` si el usuario activa la función (el Port abierto mantiene viva la event page). El host registra un atajo global (por ejemplo <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>) con `RegisterHotKey`. La extensión graba con la estrategia `background`, transcribe y envía `type-text`. El host escribe con `SendInput` usando `KEYEVENTF_UNICODE`, o pega con el portapapeles y después restaura el contenido anterior.
- Prototipo en Python 3.11+ (`pynput` o `keyboard` para el atajo, `ctypes` para `SendInput`); versión final en Rust (`global-hotkey` + `enigo`) empaquetada como `host.exe`.
- Limitaciones:
  - Windows (UIPI) bloquea las pulsaciones sintéticas hacia ventanas que se ejecutan como administrador.
  - No se detectan los campos de contraseña.
  - Necesita Firefox abierto.

## Opción B: app de escritorio independiente (Tauri)

- Captura de audio nativa (`cpal`), el mismo cliente de Groq, el plugin `global-shortcut` y `enigo` para escribir.
- No depende del navegador y funciona aunque Firefox esté cerrado.

## Comparativa

| | A: Native Messaging | B: Tauri |
|---|---|---|
| Reutiliza la extensión | Sí (grabación, Groq, ajustes) | No (se reescribe la captura) |
| Requiere Firefox abierto | Sí | No |
| Instalación | Extensión + host + registro | Un instalador |
| Esfuerzo | Bajo | Medio |

**Recomendación:** A como puente rápido; B como producto definitivo si el dictado de escritorio se usa a diario.
