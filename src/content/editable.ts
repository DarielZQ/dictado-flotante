import type { EditableKind } from "../shared/messages";

export const UI_HOST_ATTR = "data-dictado-flotante";
const SUPPORTED_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel"]);

export function isSupportedInputType(input: HTMLInputElement): boolean {
  const type = (input.getAttribute("type") ?? "").toLowerCase();
  return SUPPORTED_INPUT_TYPES.has(type);
}

/** Atraviesa shadow roots abiertos hasta el elemento realmente enfocado. */
export function resolveDeepActiveElement(doc: Document = document): Element | null {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Sube por los ancestros (cruzando shadow roots) mientras sigan siendo editables. */
export function getEditingHost(el: HTMLElement): HTMLElement {
  let host = el;
  for (;;) {
    const parent = host.parentElement ?? ((host.getRootNode() as ShadowRoot).host as HTMLElement | undefined);
    if (parent instanceof HTMLElement && parent.isContentEditable) host = parent;
    else return host;
  }
}

function isInsideOwnUi(el: Element): boolean {
  let node: Node | null = el;
  while (node) {
    if (node instanceof Element && node.hasAttribute(UI_HOST_ATTR)) return true;
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return false;
}

function isGoogleDocsEventFrame(win: Window): boolean {
  try {
    return win !== win.top && win.parent.location.hostname === "docs.google.com";
  } catch {
    return false;
  }
}

/** Determina si `el` es un campo donde se puede dictar, y de qué tipo. */
export function classifyEditable(el: Element | null, win: Window = window): EditableKind | null {
  const realm = (el?.ownerDocument.defaultView ?? win) as Window & typeof globalThis;
  if (!el || !(el instanceof realm.HTMLElement)) return null;
  const html = el as HTMLElement;
  if (isInsideOwnUi(html)) return null;
  if (html.getAttribute("aria-readonly") === "true" || html.getAttribute("aria-disabled") === "true") return null;

  let kind: EditableKind | null = null;
  if (html.tagName === "INPUT") {
    const input = html as HTMLInputElement;
    if (!isSupportedInputType(input) || input.readOnly || input.disabled) return null;
    kind = "input";
  } else if (html.tagName === "TEXTAREA") {
    const area = html as HTMLTextAreaElement;
    if (area.readOnly || area.disabled) return null;
    kind = "textarea";
  } else if (html.isContentEditable) {
    kind = "contenteditable";
  } else if (html.tagName === "BODY" && html.ownerDocument.designMode === "on") {
    kind = "contenteditable";
  }
  if (kind === "contenteditable" && isGoogleDocsEventFrame(win)) return "google-docs";
  return kind;
}

/** Elemento sobre el que se insertará: el propio input/textarea o el editing host. */
export function insertionElement(el: HTMLElement, kind: EditableKind): HTMLElement {
  return kind === "contenteditable" || kind === "google-docs" ? getEditingHost(el) : el;
}
