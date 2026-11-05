import type { EditableKind } from "../shared/messages";
import { classifyEditable, insertionElement, resolveDeepActiveElement } from "./editable";

export interface TargetSnapshot {
  /** input/textarea o editing host del contenteditable. */
  element: HTMLElement;
  kind: EditableKind;
  selectionStart?: number;
  selectionEnd?: number;
  range?: Range;
  takenAt: number;
}

function isTextField(el: HTMLElement): el is HTMLInputElement | HTMLTextAreaElement {
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA";
}

/** Selección actual dentro de un editing host (incluido el caso de shadow DOM). */
function currentRangeWithin(host: HTMLElement): Range | undefined {
  const root = host.getRootNode() as Document | ShadowRoot;
  const sel = (root as unknown as { getSelection?: () => Selection | null }).getSelection?.() ?? host.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return undefined;
  const range = sel.getRangeAt(0);
  return host.contains(range.commonAncestorContainer) ? range.cloneRange() : undefined;
}

export function snapshotOf(el: HTMLElement, kind: EditableKind): TargetSnapshot {
  const element = insertionElement(el, kind);
  const snap: TargetSnapshot = { element, kind, takenAt: Date.now() };
  if (isTextField(element)) {
    snap.selectionStart = element.selectionStart ?? element.value.length;
    snap.selectionEnd = element.selectionEnd ?? snap.selectionStart;
  } else {
    const range = currentRangeWithin(element);
    if (range) snap.range = range;
  }
  return snap;
}

/** Instantánea del campo enfocado ahora mismo, o null si no hay uno compatible. */
export function takeSnapshot(doc: Document = document): TargetSnapshot | null {
  const active = resolveDeepActiveElement(doc);
  const kind = classifyEditable(active, doc.defaultView ?? window);
  if (!active || !kind) return null;
  return snapshotOf(active as HTMLElement, kind);
}

/** Devuelve el foco y la selección guardados. */
export function restoreSnapshot(s: TargetSnapshot): boolean {
  if (!s.element.isConnected) return false;
  try {
    s.element.focus({ preventScroll: true });
    if (isTextField(s.element)) {
      const len = s.element.value.length;
      const start = Math.min(s.selectionStart ?? len, len);
      const end = Math.min(s.selectionEnd ?? start, len);
      s.element.setSelectionRange(start, end);
    } else if (s.range && s.element.contains(s.range.commonAncestorContainer)) {
      const sel = s.element.ownerDocument.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(s.range);
    } else {
      // Sin selección guardada: cursor al final del contenido.
      const sel = s.element.ownerDocument.getSelection();
      const range = s.element.ownerDocument.createRange();
      range.selectNodeContents(s.element);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return true;
  } catch {
    return false;
  }
}
