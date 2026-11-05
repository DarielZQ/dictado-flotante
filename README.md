# Dictado Flotante

Extensión para **Firefox** que añade un botón flotante de dictado por voz. Al enfocar un campo de texto aparece el botón; lo pulsas, hablas y el texto transcrito se inserta donde estaba el cursor. Funciona en inputs, textareas y editores enriquecidos (Gmail, Notion, WhatsApp Web, Slack, GitHub…).

- Transcripción con Whisper a través del **plan gratuito de Groq** (o cualquier API compatible con OpenAI).
- Parada automática al dejar de hablar, atajo de teclado y botón arrastrable.
- La clave API se guarda solo en tu perfil local de Firefox y nunca llega a las páginas web.

## Requisitos

- Firefox 140 o superior (escritorio).
- Una clave gratuita de Groq: [console.groq.com](https://console.groq.com/keys) → **API Keys** → *Create API Key*.
- Para compilar: Node.js 20 o superior.

## Instalación para desarrollo

```bash
npm install
npm run build
```

Después, en Firefox:

1. Abre `about:debugging` → **Este Firefox** → **Cargar complemento temporal…**
2. Elige `dist/manifest.json`.
3. Se abrirá la página de opciones: pega la clave, pulsa **Guardar** y **Probar conexión**.
4. En **Micrófono**, pulsa **Conceder acceso al micrófono** y marca *Recordar esta decisión*.

Los complementos temporales se eliminan al cerrar Firefox. Alternativa: `npm run dev` abre un Firefox nuevo con la extensión cargada y la recarga al recompilar (`npm run watch` en otra terminal).

## Instalación permanente (firma gratuita "unlisted")

Firefox estable solo instala de forma permanente extensiones firmadas por Mozilla. La firma *unlisted* es gratuita y la extensión **no se publica**.

1. Crea una cuenta en [addons.mozilla.org](https://addons.mozilla.org) → *Herramientas para desarrolladores* → **Gestionar credenciales de API**.
2. En PowerShell, define las credenciales solo para esa sesión:

   ```powershell
   $env:WEB_EXT_API_KEY = "user:XXXXXXXX:XXX"
   $env:WEB_EXT_API_SECRET = "XXXXXXXXXXXXXXXX"
   ```

3. Firma:

   ```bash
   npm run build
   ```

   ```bash
   npm run sign
   ```

4. Arrastra el `.xpi` generado en `artifacts/` a una ventana de Firefox.

Cada nueva firma necesita subir `version` en `src/manifest.json`.

## Uso

| Acción | Cómo |
|---|---|
| Empezar a dictar | Clic en el botón o <kbd>Alt</kbd>+<kbd>Mayús</kbd>+<kbd>D</kbd> |
| Parar y transcribir | Otro clic, el atajo o callarte 2,5 s |
| Cancelar | <kbd>Esc</kbd>, o clic mientras transcribe |
| Mover el botón | Arrástralo (la posición se recuerda por sitio) |
| Ocultarlo en un sitio | Clic derecho → *Ocultar en este sitio* |
| Cambiar el atajo | `about:addons` → engranaje → *Administrar atajos de extensiones* |

Si el texto no se puede insertar (algún editor muy cerrado), se copia al portapapeles y aparece un aviso para pegarlo con <kbd>Ctrl</kbd>+<kbd>V</kbd>.

## Permisos

| Permiso | Para qué |
|---|---|
| Acceso a todos los sitios | Mostrar el botón en cualquier web |
| `storage` | Ajustes, clave API y posiciones del botón |
| `activeTab` + `scripting` | Dictar desde el popup o el atajo aunque retires el acceso a todos los sitios |
| `clipboardWrite` | Copiar el texto cuando no se puede insertar |
| `api.groq.com` | Enviar el audio a transcribir |

El audio solo existe en memoria durante el dictado y se envía únicamente al proveedor configurado. No hay telemetría.

## Solución de problemas

- **«Permiso de micrófono denegado»**: en Opciones → *Conceder acceso al micrófono*. Si lo denegaste antes, cámbialo con el icono del micrófono de la barra de direcciones de la página de opciones.
- **El botón no aparece**: comprueba en el popup que el sitio no esté oculto y que la extensión tenga acceso a los sitios (`about:addons` → Dictado Flotante → *Permisos*). No funciona en páginas internas (`about:`), en addons.mozilla.org ni en el visor de PDF.
- **«Límite del plan gratuito alcanzado»**: espera el tiempo indicado; los límites exactos están en la consola de Groq.
- **El micrófono no para solo**: ajusta el silencio en Opciones o para con un clic.

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila a `dist/` |
| `npm run watch` | Compila al guardar |
| `npm run typecheck` | Comprueba tipos |
| `npm test` | Tests unitarios (vitest + jsdom) |
| `npm run lint` | Validador oficial de Mozilla (`web-ext lint`) |
| `npm run package` | Genera el `.zip` en `artifacts/` |
| `npm run test:e2e` | Prueba de extremo a extremo en Firefox real con Selenium (micrófono y servicio de transcripción simulados) |
| `npm run test:groq` | Transcribe con Groq real los audios de `tests/audio/` (clave en `.env.local`, ver `.env.example`) |
| `npm run serve:test-pages` | Sirve las páginas de prueba en `http://127.0.0.1:5173` |

Para generar frases de prueba con una voz de Windows (Configuración → Hora e idioma → Voz → Agregar voces → Español):

```powershell
powershell -ExecutionPolicy Bypass -File tools/make-test-audio.ps1 -Language es
```

Documentación técnica en [`docs/`](docs/): decisiones de arquitectura, plan de pruebas y el diseño para dictar fuera del navegador.

## Licencia

MIT
