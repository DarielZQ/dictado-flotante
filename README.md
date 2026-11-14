# Dictado Flotante

Extensión para **Firefox** que añade un botón flotante de dictado por voz. Al enfocar un campo de texto aparece el botón: lo pulsas, hablas y el texto transcrito se inserta donde estaba el cursor. Funciona en inputs, textareas y editores enriquecidos (Gmail, Notion, WhatsApp Web, Slack, GitHub…).

- Transcripción con Whisper a través del **plan gratuito de Groq** (o cualquier API compatible con OpenAI).
- Español, inglés y un modo **mixto español + inglés** que transcribe tal cual cuando mezclas idiomas.
- Parada automática al dejar de hablar, atajo de teclado y botón arrastrable.
- Cada persona usa **su propia clave**, que se guarda solo en su perfil de Firefox y nunca llega a las páginas web.

## Guía rápida

Necesitas Firefox 140 o superior (escritorio).

### 1. Instala la extensión

1. Descarga el archivo `.xpi` de la última versión en **[Releases](../../releases/latest)**.
2. Arrástralo a una ventana de Firefox (o abre `about:addons` → engranaje → *Instalar complemento desde archivo…*).
3. Acepta los permisos. Se abrirá la página de **Opciones**.

La extensión está firmada por Mozilla: queda instalada para siempre y se mantiene al reiniciar Firefox.

> Si todavía no hay ninguna versión publicada en Releases, compílala tú mismo siguiendo la sección [Desarrollo](#desarrollo): puedes cargarla como complemento temporal o [firmar tu propia copia](#firmar-tu-propia-copia).

### 2. Consigue tu clave gratuita de Groq

1. Entra en [console.groq.com](https://console.groq.com) e inicia sesión (con Google, GitHub o correo).
2. Menú **API Keys** → **Create API Key** → ponle un nombre → copia la clave (empieza por `gsk_`).
3. En **Opciones → 1. Proveedor**, pégala, pulsa **Guardar** y luego **Probar conexión**.

La clave es personal: no la compartas. Si se filtra, bórrala en la consola de Groq y crea otra.

### 3. Concede el micrófono

En **Opciones → 2. Micrófono**, pulsa **Conceder acceso al micrófono**, acepta y marca **Recordar esta decisión**. Hazlo una sola vez. Así las páginas web no te pedirán permiso cada vez.

### 4. Dicta

Haz clic en cualquier campo de texto, pulsa el botón azul del micrófono (o <kbd>Alt</kbd>+<kbd>Mayús</kbd>+<kbd>D</kbd>), habla y calla 2,5 segundos: el texto aparece solo.

## Uso

| Acción | Cómo |
|---|---|
| Empezar a dictar | Clic en el botón o <kbd>Alt</kbd>+<kbd>Mayús</kbd>+<kbd>D</kbd> |
| Parar y transcribir | Otro clic, el atajo o callarte 2,5 s |
| Cancelar | <kbd>Esc</kbd>, o clic mientras transcribe |
| Cambiar el idioma | Clic derecho en el botón, o el icono de la extensión en la barra |
| Mover el botón | Arrástralo (la posición se recuerda por sitio) |
| Ocultarlo en un sitio | Clic derecho → *Ocultar en este sitio* |
| Cambiar el atajo | `about:addons` → engranaje → *Administrar atajos de extensiones* |

Si el texto no se puede insertar (algún editor muy cerrado), se copia al portapapeles y aparece un aviso para pegarlo con <kbd>Ctrl</kbd>+<kbd>V</kbd>.

### Idiomas

La etiqueta sobre el botón (`ES`, `EN`, `ES+EN`…) indica el idioma activo.

- **Español**, **Inglés**, etc.: transcribe en ese idioma. Las palabras sueltas en inglés dentro de una frase en español («mándame el *link* del *meeting*») se respetan.
- **Español + Inglés (mixto)**: para cuando cambias de idioma entre frases. Transcribe cada parte en el idioma en que la dijiste, sin traducir.
- **Detección automática**: elige un solo idioma por dictado.

En **Opciones → 3. Dictado** puedes añadir vocabulario (nombres propios, términos técnicos) para mejorar la precisión.

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

- **Una web me pide permiso de micrófono**: la extensión no tiene concedido el suyo. Ve a Opciones → *Conceder acceso al micrófono* y marca *Recordar esta decisión*. El popup de la extensión avisa cuando falta.
- **«Permiso de micrófono denegado»**: si lo denegaste antes, cámbialo con el icono del micrófono de la barra de direcciones en la página de Opciones.
- **El botón no aparece**: comprueba en el popup que el sitio no esté oculto y que la extensión tenga acceso a los sitios (`about:addons` → Dictado Flotante → *Permisos*). No funciona en páginas internas (`about:`), en addons.mozilla.org ni en el visor de PDF.
- **«Límite del plan gratuito alcanzado»**: espera el tiempo indicado; los límites exactos están en la consola de Groq.
- **El micrófono no para solo**: ajusta el silencio en Opciones o para con un clic.
- **Traduce lo que digo en inglés**: cambia al modo *Español + Inglés* o a *Inglés*.

## Desarrollo

Requiere Node.js 20 o superior.

```bash
npm install
npm run build
```

Para probar sin firmar: `about:debugging` → **Este Firefox** → **Cargar complemento temporal…** → elige `dist/manifest.json`. Los complementos temporales se eliminan al cerrar Firefox y pierden el permiso del micrófono en cada carga. También puedes usar `npm run dev`, que abre un Firefox nuevo con la extensión y la recarga al recompilar (`npm run watch` en otra terminal).

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila a `dist/` |
| `npm run watch` | Compila al guardar |
| `npm run typecheck` | Comprueba tipos |
| `npm test` | Tests unitarios (vitest + jsdom) |
| `npm run lint` | Validador oficial de Mozilla (`web-ext lint`) |
| `npm run package` | Genera el `.zip` en `artifacts/` |
| `npm run test:e2e` | Prueba de extremo a extremo en Firefox real con Selenium (micrófono y servicio de transcripción simulados) |
| `npm run test:groq` | Transcribe con Groq real los audios de `tests/audio/` |
| `npm run sign` | Firma la extensión en Mozilla como *unlisted* y deja el `.xpi` en `artifacts/` |
| `npm run serve:test-pages` | Sirve las páginas de prueba en `http://127.0.0.1:5173` |

Los scripts leen las claves de `.env.local` (copia `.env.example`; está excluido de git).

### Firmar tu propia copia

Firefox estable solo instala de forma permanente extensiones firmadas por Mozilla. La firma *unlisted* es gratuita y la extensión no se publica en la tienda.

1. Cambia el `id` de `browser_specific_settings.gecko` en `src/manifest.json` por un GUID nuevo (el actual pertenece a otra cuenta).
2. Genera tus credenciales en [addons.mozilla.org → Gestionar credenciales de API](https://addons.mozilla.org/developers/addon/api/key/) y ponlas en `.env.local` como `WEB_EXT_API_KEY` y `WEB_EXT_API_SECRET`.
3. Haz commit de tus cambios y ejecuta `npm run sign`. Compila, sube el código fuente para la revisión y deja el `.xpi` firmado en `artifacts/`.

Cada nueva firma necesita subir `version` en `src/manifest.json`.

### Audios de prueba con voces de Windows

`tools/make-test-audio.ps1` genera frases en WAV para `npm run test:groq`. Necesita una voz del idioma (Configuración → Hora e idioma → Voz → Agregar voces → Español):

```powershell
powershell -ExecutionPolicy Bypass -File tools/make-test-audio.ps1 -Language es
```

Documentación técnica en [`docs/`](docs/): decisiones de arquitectura, plan de pruebas y el diseño para dictar fuera del navegador.

## Licencia

MIT
