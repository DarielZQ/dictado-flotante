import type { EditableKind } from "../shared/messages";
import { classifyEditable, resolveDeepActiveElement } from "./editable";
import { snapshotOf, type TargetSnapshot } from "./target-snapshot";

export interface FocusTrackerEvents {
  onChange(editable: boolean, kind: EditableKind | null): void;
}

/**
 * Sigue el campo editable enfocado en este frame y guarda en todo momento
 * la última instantánea válida (elemento + selección).
 */
export class FocusTracker {
  private lastKind: EditableKind | null = null;
  private lastElement: Element | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private latest: TargetSnapshot | null = null;

  constructor(
    private readonly events: FocusTrackerEvents,
    private readonly win: Window = window,
  ) {
    const doc = win.document;
    win.addEventListener("focusin", this.onFocusEvent, true);
    win.addEventListener("focusout", this.onFocusEvent, true);
    doc.addEventListener("selectionchange", this.onSelection, true);
    // Estado inicial (p. ej. un campo con autofocus).
    this.evaluate();
  }

  /** Última instantánea válida (puede ser de un campo que ya perdió el foco). */
  get lastSnapshot(): TargetSnapshot | null {
    return this.latest;
  }

  private onFocusEvent = (): void => {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.evaluate(), 100);
  };

  private onSelection = (): void => {
    const active = resolveDeepActiveElement(this.win.document);
    if (active && active === this.lastElement && this.lastKind) {
      this.latest = snapshotOf(active as HTMLElement, this.lastKind);
    }
  };

  evaluate(): void {
    const active = resolveDeepActiveElement(this.win.document);
    const kind = classifyEditable(active, this.win);
    if (active && kind) this.latest = snapshotOf(active as HTMLElement, kind);
    const changed = kind !== this.lastKind || (kind !== null && active !== this.lastElement);
    this.lastKind = kind;
    this.lastElement = kind ? active : null;
    if (changed) this.events.onChange(kind !== null, kind);
  }

  /** Vuelve a notificar el estado actual aunque no haya cambiado. */
  forceReport(): void {
    this.evaluate();
    this.events.onChange(this.lastKind !== null, this.lastKind);
  }

  destroy(): void {
    this.win.removeEventListener("focusin", this.onFocusEvent, true);
    this.win.removeEventListener("focusout", this.onFocusEvent, true);
    this.win.document.removeEventListener("selectionchange", this.onSelection, true);
  }
}
