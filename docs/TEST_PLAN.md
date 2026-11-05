# Plan de pruebas

## Automáticas

| Comando | Qué cubre | Estado |
|---|---|---|
| `npm test` | 93 tests: formato inteligente, detección de voz, filtro de alucinaciones, cliente Groq (errores, 429, reintentos, cancelación), ajustes, clasificación de campos, inserción y máquina de estados | ✔ |
| `npm run test:e2e` | 23 comprobaciones en **Firefox real** (Selenium, headless): ver tabla siguiente | ✔ 23/23 |
| `npm run test:groq` | Transcripción real con tu clave de Groq sobre los audios de `tests/audio/` | Pendiente de clave |

### Qué comprueba `test:e2e`

- La extensión se instala y abre su página de opciones.
- El botón se monta en Shadow DOM, aparece al enfocar un campo y no aparece en contraseñas.
- Pulsar el botón no quita el foco del campo.
- `getUserMedia` real con el micrófono simulado: el tono continuo no se envía (no es voz).
- Petición correcta al servicio de transcripción: `webm/opus`, modelo, idioma, `verbose_json` y cabecera `Authorization`.
- Inserción en input, input a mitad de texto (con espacios y minúscula), textarea, contenteditable, React (input y textarea controlados), iframe `srcdoc`, iframe del mismo origen y shadow DOM.
- Eventos `beforeinput`/`input`; <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshace el dictado.
- <kbd>Esc</kbd> cancela sin transcribir; auto-parada por silencio.

Las capturas de cada paso quedan en `tests/e2e/output/`.

## Manuales (con tu Firefox y tu voz)

Carga la extensión (ver README) y pon tu clave en Opciones.

### Fase 0: permiso real del micrófono

| # | Paso | Resultado |
|---|---|---|
| 1 | Opciones → **Conceder acceso al micrófono** → acepta y marca *Recordar esta decisión*. ¿Se mueve el medidor al hablar? | |
| 2 | Abre cualquier web, enfoca un campo y pulsa el botón. ¿Graba **sin** volver a preguntar? | |
| 3 | Repite el paso 2 en github.com y en web.whatsapp.com. | |
| 4 | Cierra y abre Firefox (con la extensión firmada, o recargándola en `about:debugging`). ¿Sigue sin preguntar? | |
| 5 | Si en el paso 2 falló: Opciones → Estrategia **Marco de la extensión** y repite. ¿Qué diálogo aparece? | |

### Sitios reales

Para cada sitio: enfoca el campo, dicta una frase y comprueba que el texto aparece donde estaba el cursor y que el sitio lo «ve» (por ejemplo, que se activa el botón Enviar).

| Sitio | Campo | Resultado |
|---|---|---|
| Gmail | Cuerpo de un correo nuevo | |
| Gmail | Asunto | |
| WhatsApp Web | Caja de mensaje | |
| Notion | Bloque de texto | |
| Google Docs | Documento (modo *best-effort*: si falla, debe copiarse al portapapeles) | |
| GitHub | Comentario de un issue | |
| Buscador (Google/DuckDuckGo) | Caja de búsqueda | |
| Slack o Discord web | Caja de mensaje | |

### Comportamiento

| Caso | Esperado | Resultado |
|---|---|---|
| Callarse 2,5 s | Para solo y transcribe | |
| No hablar nada | A los 8 s cancela con «No se detectó voz» | |
| Cambiar de campo mientras transcribe | El texto va al campo original | |
| Arrastrar el botón y recargar | Mantiene la posición en ese sitio | |
| Clic derecho → Ocultar en este sitio | Desaparece; se recupera desde el popup | |
| <kbd>Alt</kbd>+<kbd>Mayús</kbd>+<kbd>D</kbd> | Empieza y para | |
| Sin conexión | Mensaje «Sin conexión…» | |
