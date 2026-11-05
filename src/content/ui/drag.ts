export interface Position {
  xPct: number;
  yPct: number;
}

export interface DragCallbacks {
  onClick(): void;
  onMove(left: number, top: number): void;
  onDrop(left: number, top: number): void;
}

export const DRAG_THRESHOLD_PX = 5;
const MARGIN = 8;

/** Limita una posición en px para que el botón quede dentro del viewport. */
export function clampToViewport(left: number, top: number, size: number, vw: number, vh: number): [number, number] {
  return [
    Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - size - MARGIN)),
    Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - size - MARGIN)),
  ];
}

export function toPct(left: number, top: number, vw: number, vh: number): Position {
  return { xPct: (left / Math.max(1, vw)) * 100, yPct: (top / Math.max(1, vh)) * 100 };
}

export function fromPct(pos: Position, vw: number, vh: number): [number, number] {
  return [(pos.xPct / 100) * vw, (pos.yPct / 100) * vh];
}

/**
 * Arrastre con Pointer Events. Un movimiento menor que el umbral cuenta como clic.
 * pointerdown se cancela para que el campo de texto no pierda el foco.
 */
export function makeDraggable(el: HTMLElement, cb: DragCallbacks): () => void {
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let dragging = false;
  let pointerId: number | null = null;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    dragging = false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignorar
    }
  };

  const onMove = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    el.classList.add("df-dragging");
    cb.onMove(originLeft + dx, originTop + dy);
  };

  const onUp = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // ignorar
    }
    e.preventDefault();
    e.stopPropagation();
    if (dragging) {
      el.classList.remove("df-dragging");
      cb.onDrop(originLeft + (e.clientX - startX), originTop + (e.clientY - startY));
    } else {
      cb.onClick();
    }
    dragging = false;
  };

  const onCancel = () => {
    pointerId = null;
    dragging = false;
    el.classList.remove("df-dragging");
  };

  // mousedown también se cancela: algunos sitios enfocan con él.
  const stopMouse = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onCancel);
  el.addEventListener("mousedown", stopMouse);
  el.addEventListener("click", stopMouse);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onCancel);
    el.removeEventListener("mousedown", stopMouse);
    el.removeEventListener("click", stopMouse);
  };
}
