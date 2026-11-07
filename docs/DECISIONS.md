# Registro de decisiones

## Producto (cerradas)

| # | Decisión |
|---|---|
| D1 | Extensión nativa de Firefox, Manifest V3, mínimo Firefox 140 (ESR vigente; primera versión que entiende `data_collection_permissions`). |
| D2 | Motor STT: API compatible con OpenAI; por defecto Groq gratis con `whisper-large-v3-turbo`. URL, modelo y clave configurables. |
| D3 | Respaldo local (Whisper en el navegador) en una fase futura detrás de la interfaz `SttProvider`. |
| D4 | Grabar y transcribir al parar; sin streaming. |
| D5 | Clic o <kbd>Alt</kbd>+<kbd>Mayús</kbd>+<kbd>D</kbd> alterna; <kbd>Esc</kbd> cancela. |
| D6 | Auto-parada: 2,5 s de silencio tras detectar voz, máximo 120 s, cancelación a los 8 s sin voz. Configurable. |
| D7 | Botón visible solo con un campo editable enfocado; arrastrable; posición por sitio; ocultable por sitio; Shadow DOM cerrado. |
| D8 | Idioma configurable, español por defecto. |
| D9 | Sin comandos de voz ni limpieza con LLM en el MVP; solo formato inteligente. |
| D10 | Clave en `storage.local`; solo la usa el background. |
| D11 | Desarrollo con carga temporal; uso diario con firma *unlisted* gratuita. |

## Técnicas

### T1 — Dónde se captura el micrófono (Fase 0)

Tres estrategias tras la interfaz `CaptureHost`; con `captureStrategy: "auto"` se prueban en este orden y se pasa a la siguiente si la anterior falla por permiso o política del sitio:

1. **`background`**: `getUserMedia` en la event page. Requiere conceder el micrófono una vez desde la página de opciones (origen `moz-extension://`).
2. **`extension-iframe`**: iframe oculto de la extensión dentro de la página, con `allow="microphone"`.
3. **`content-script`**: `getUserMedia` en el content script; Firefox pide permiso por sitio.

**Resultados en Firefox 159 (automatizado, con el micrófono simulado de Firefox y el permiso aprobado por preferencias):**

| Prueba | `background` |
|---|---|
| Abre el micrófono y graba (`audio/webm;codecs=opus`) | ✔ |
| AudioContext activo en la event page (nivel y detección de voz funcionan) | ✔ |
| Libera el micrófono al parar o cancelar | ✔ (sin errores; el indicador no se puede ver en modo headless) |

**Pendiente de validar a mano** (necesita diálogos reales de permiso, que la automatización salta):

- ¿El permiso concedido en la página de opciones con «Recordar» permite al background abrir el micrófono sin diálogo en cualquier web?
- ¿Se mantiene tras reiniciar Firefox?
- Si `background` falla, ¿qué pide el iframe de la extensión y qué pasa en sitios con `Permissions-Policy: microphone=()`?

La lista de comprobación está en [TEST_PLAN.md](TEST_PLAN.md#fase-0-permiso-real-del-micrófono). El resultado se anotará aquí.

### T2 — Configuración en las pruebas automatizadas

Firefox 159 no permite que WebDriver (Marionette) navegue ni ejecute comandos en páginas `moz-extension://`. Por eso existe un **build de pruebas** (`node build.mjs --e2e` → `dist-e2e/`) con:

- Un puente `postMessage` → content script → background (`e2e/configure`) para fijar ajustes y clave de prueba.
- Una señal sintética con forma de habla (`src/recorder/fake-speech.ts`): el micrófono simulado de Firefox emite un tono continuo que, con razón, el detector de voz trata como ruido.

Ambos dependen de la constante de compilación `__E2E__`. En el build normal valen `false`, esbuild los elimina, y se verifica que `dist/` no contiene `e2e/configure` ni `__dictadoFakeSpeech`.

### T3 — Clic durante el check verde

Durante los 800 ms del estado `success` el botón ignoraba los clics. Las pruebas en Firefox revelaron que un segundo dictado inmediato perdía el clic. Ahora un clic en `success` o `error` empieza un dictado nuevo; solo se ignora durante `inserting`.

### T4 — Punto final a mitad de frase

Si después del cursor la frase continúa en minúscula, se quita el punto final que añade Whisper («Hola ~~desde aquí.~~ desde aquí mundo»).

### T5 — Advertencia de `web-ext lint`

Queda una advertencia por `data_collection_permissions` en Firefox para Android (requiere 142). La extensión es solo de escritorio; no se declara `gecko_android`.

### T6 — Modo mixto español + inglés

Whisper admite un solo `language` por petición. Se calibró con frases generadas con voces de Windows (español puro, inglés puro, *spanglish* y frases que cambian de idioma) contra Groq `whisper-large-v3-turbo`:

| Ajuste | Español | Inglés | *Spanglish* | Inglés → español |
|---|---|---|---|---|
| `language=es` | ✔ | ✘ (traduce mal) | ✔ | ✘ (traduce el inglés) |
| automático | ✔ | ✔ | ✔ | ✘ (traduce el inglés) |
| `language=es` + pista bilingüe | ✔ | ✔ | ✔ | ✔ |
| automático + pista bilingüe | ✔ | ✔ | ✔ | ✔ |

La pista (`prompt`) es un ejemplo que empieza en inglés y cambia al español. El modo mixto (`es+en`) envía `language=es` con esa pista: da el mismo resultado que el automático y evita que en frases cortas se detecte un idioma parecido (portugués, gallego). Si con poco audio Whisper devuelve un trozo de la pista, el filtro de alucinaciones lo descarta.

### T7 — Permiso de micrófono por página

La estrategia `background` usa el permiso de micrófono de la propia extensión (origen `moz-extension://<uuid>`). Un complemento temporal recibe un UUID nuevo en cada carga y pierde ese permiso, así que el modo `auto` pasa al respaldo y la página pide su propio permiso. Con la extensión instalada y firmada el UUID es estable: basta concederlo una vez en Opciones. El popup y Opciones avisan cuando falta.
