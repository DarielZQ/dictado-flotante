import type { EditableKind } from "../../shared/messages";

export interface ContentProbe {
  length: number;
  text: string;
}

export function probe(el: HTMLElement, kind: EditableKind): ContentProbe {
  const text =
    kind === "input" || kind === "textarea" ? (el as HTMLInputElement | HTMLTextAreaElement).value : el.textContent ?? "";
  return { length: text.length, text };
}

function normalize(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim().toLowerCase();
}

/** ¿El contenido creció e incluye el principio del texto insertado? */
export function changedWith(before: ContentProbe, after: ContentProbe, inserted: string): boolean {
  if (after.length <= before.length) return false;
  const needle = normalize(inserted).slice(0, 20);
  return needle === "" || normalize(after.text).includes(needle);
}

export function nextFrame(win: Window = window): Promise<void> {
  return new Promise((resolve) => {
    const done = () => queueMicrotask(resolve);
    if (typeof win.requestAnimationFrame === "function") {
      // rAF no corre en pestañas ocultas: tope de seguridad con setTimeout.
      const t = setTimeout(done, 50);
      win.requestAnimationFrame(() => {
        clearTimeout(t);
        done();
      });
    } else {
      setTimeout(done, 16);
    }
  });
}

/** Sondea cada frame hasta ver el cambio o agotar el tiempo. */
export async function waitForChange(
  el: HTMLElement,
  kind: EditableKind,
  before: ContentProbe,
  inserted: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  do {
    if (changedWith(before, probe(el, kind), inserted)) return true;
    await nextFrame(el.ownerDocument.defaultView ?? window);
  } while (performance.now() < deadline);
  return changedWith(before, probe(el, kind), inserted);
}
