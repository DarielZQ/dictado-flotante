import type { UserFacingError } from "../../shared/errors";
import { findLanguage, QUICK_LANGUAGES, shortLabel } from "../../shared/languages";
import type { DictationPhase } from "../../shared/state";
import { UI_STRINGS } from "../../shared/strings";
import { clampToViewport, fromPct, makeDraggable, toPct, type Position } from "./drag";
import { iconFor } from "./icons";
import { UI_CSS } from "./styles";

export interface FloatingButtonDeps {
  root: ShadowRoot;
  initialPosition: Position | null;
  sizePx: number;
  language: string;
  onActivate(): void;
  onSelectLanguage(code: string): void;
  onHideForSite(): void;
  onOpenOptions(): void;
  onPositionChange(pos: Position): void;
}

const LABELS: Record<DictationPhase, string> = {
  idle: UI_STRINGS.labelIdle,
  arming: UI_STRINGS.labelArming,
  listening: UI_STRINGS.labelListening,
  transcribing: UI_STRINGS.labelTranscribing,
  inserting: UI_STRINGS.labelInserting,
  success: UI_STRINGS.labelSuccess,
  error: UI_STRINGS.labelError,
};

const SUCCESS_MS = 800;
const ERROR_MS = 4000;
const TOAST_MS = 3500;

/** Aplica estilos al shadow root sin depender de la CSP de la página. */
export function applyStyles(root: ShadowRoot, css: string = UI_CSS): "adopted" | "style-element" {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    return "adopted";
  } catch {
    const style = root.ownerDocument.createElement("style");
    style.textContent = css;
    root.appendChild(style);
    return "style-element";
  }
}

export class FloatingButton {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly container: HTMLDivElement;
  private readonly button: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private readonly badge: HTMLSpanElement;
  private language: string;
  private phase: DictationPhase = "idle";
  private visible = false;
  private left = 0;
  private top = 0;
  private revertTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: UserFacingError | null = null;
  private cleanupDrag: () => void;

  constructor(private readonly deps: FloatingButtonDeps) {
    this.doc = deps.root.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    applyStyles(deps.root);

    this.container = this.el("div", "df-root");
    this.button = this.el("div", "df-btn");
    this.button.setAttribute("role", "button");
    this.button.setAttribute("tabindex", "-1");
    this.button.setAttribute("data-testid", "dictado-button");
    this.button.style.setProperty("--df-size", `${deps.sizePx}px`);
    this.tooltip = this.el("div", "df-tooltip df-hidden");
    this.toastEl = this.el("div", "df-toast df-hidden");
    this.toastEl.setAttribute("data-testid", "dictado-toast");
    this.menu = this.el("div", "df-menu df-hidden");
    this.live = this.el("div", "df-sr");
    this.live.setAttribute("aria-live", "polite");
    this.badge = this.el("span", "df-badge");
    this.badge.setAttribute("aria-hidden", "true");
    this.badge.setAttribute("data-testid", "dictado-language");
    this.language = deps.language;

    this.buildMenu();
    this.menu.addEventListener("pointerdown", (e) => e.preventDefault());
    this.container.append(this.button, this.tooltip, this.toastEl, this.menu, this.live);
    deps.root.appendChild(this.container);

    this.initPosition(deps.initialPosition);
    this.render();

    this.cleanupDrag = makeDraggable(this.button, {
      onClick: () => this.handleClick(),
      onMove: (l, t) => this.moveTo(l, t),
      onDrop: (l, t) => {
        this.moveTo(l, t);
        this.schedulePositionSave();
      },
    });
    // El clic derecho tampoco debe quitar el foco al campo (si no, el botón y el menú se ocultan).
    this.button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) e.preventDefault();
    });
    this.button.addEventListener("contextmenu", this.onContextMenu);
    this.win.addEventListener("resize", this.onResize);
    this.doc.addEventListener("pointerdown", this.onDocPointerDown, true);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    node.className = className;
    return node;
  }

  private buildMenu(): void {
    const title = this.el("div", "df-menu-title");
    title.textContent = UI_STRINGS.menuLanguage;
    const codes = QUICK_LANGUAGES.includes(this.language) ? QUICK_LANGUAGES : [...QUICK_LANGUAGES, this.language];
    const langButtons = codes.map((code) => {
      const item = this.el("button", "df-lang");
      const active = code === this.language;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(active));
      item.dataset.lang = code;
      item.textContent = `${active ? "✓ " : ""}${findLanguage(code)?.label ?? code}`;
      item.addEventListener("click", (e) => {
        e.preventDefault();
        this.closeMenu();
        if (code !== this.language) {
          this.setLanguage(code);
          this.deps.onSelectLanguage(code);
        }
      });
      return item;
    });
    const sep = this.el("div", "df-menu-sep");
    const hide = this.el("button", "");
    hide.textContent = UI_STRINGS.menuHide;
    hide.addEventListener("click", (e) => {
      e.preventDefault();
      this.closeMenu();
      this.deps.onHideForSite();
    });
    const options = this.el("button", "");
    options.textContent = UI_STRINGS.menuOptions;
    options.addEventListener("click", (e) => {
      e.preventDefault();
      this.closeMenu();
      this.deps.onOpenOptions();
    });
    this.menu.replaceChildren(title, ...langButtons, sep, hide, options);
  }

  /** Actualiza el idioma mostrado en la etiqueta y en el menú. */
  setLanguage(code: string): void {
    if (code === this.language) return;
    this.language = code;
    this.buildMenu();
    this.render();
  }

  // ---------- Posición ----------

  private viewport(): [number, number] {
    const de = this.doc.documentElement;
    return [de.clientWidth || this.win.innerWidth, de.clientHeight || this.win.innerHeight];
  }

  private initPosition(pos: Position | null): void {
    const [vw, vh] = this.viewport();
    const size = this.deps.sizePx;
    if (pos) {
      const [l, t] = fromPct(pos, vw, vh);
      this.moveTo(l, t);
    } else {
      this.moveTo(vw - size - 24, vh - size - 24);
    }
  }

  private moveTo(left: number, top: number): void {
    const [vw, vh] = this.viewport();
    [this.left, this.top] = clampToViewport(left, top, this.deps.sizePx, vw, vh);
    this.button.style.left = `${this.left}px`;
    this.button.style.top = `${this.top}px`;
    this.positionPopups();
  }

  private positionPopups(): void {
    const size = this.deps.sizePx;
    const [vw] = this.viewport();
    const rightSide = this.left > vw / 2;
    for (const pop of [this.tooltip, this.toastEl, this.menu]) {
      pop.style.top = `${Math.max(8, this.top - 8)}px`;
      pop.style.transform = "translateY(-100%)";
      if (rightSide) {
        pop.style.left = "";
        pop.style.right = `${Math.max(8, vw - this.left - size)}px`;
      } else {
        pop.style.right = "";
        pop.style.left = `${this.left}px`;
      }
    }
  }

  private schedulePositionSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const [vw, vh] = this.viewport();
      this.deps.onPositionChange(toPct(this.left, this.top, vw, vh));
    }, 300);
  }

  private onResize = (): void => this.moveTo(this.left, this.top);

  // ---------- Estado ----------

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.render();
  }

  setPhase(phase: DictationPhase, error?: UserFacingError): void {
    if (this.revertTimer) clearTimeout(this.revertTimer);
    this.revertTimer = null;
    this.phase = phase;
    this.lastError = error ?? null;
    if (phase === "success") {
      this.revertTimer = setTimeout(() => this.setPhase("idle"), SUCCESS_MS);
    } else if (phase === "error") {
      this.revertTimer = setTimeout(() => this.setPhase("idle"), ERROR_MS);
    }
    if (phase !== "listening") this.setLevel(0);
    this.render();
    this.live.textContent = phase === "error" && error ? error.message : LABELS[phase];
  }

  get currentPhase(): DictationPhase {
    return this.phase;
  }

  setLevel(level: number): void {
    this.button.style.setProperty("--df-level", String(Math.min(1, Math.max(0, level))));
  }

  showToast(message: string, variant: "info" | "error" | "success" = "info"): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.dataset.variant = variant;
    this.toastEl.classList.remove("df-hidden");
    this.live.textContent = message;
    this.positionPopups();
    this.toastTimer = setTimeout(() => this.toastEl.classList.add("df-hidden"), TOAST_MS);
  }

  /** Visible si hay campo enfocado o si hay una sesión en marcha / feedback pendiente. */
  private shouldShow(): boolean {
    return this.visible || this.phase !== "idle";
  }

  private render(): void {
    this.button.dataset.phase = this.phase;
    this.button.classList.toggle("df-visible", this.shouldShow());
    const langLabel = findLanguage(this.language)?.label ?? this.language;
    this.button.setAttribute("aria-label", `${LABELS[this.phase]} (${langLabel})`);
    this.button.setAttribute("aria-pressed", String(this.phase === "listening"));
    this.button.title =
      this.phase === "error" && this.lastError ? this.lastError.message : `${LABELS[this.phase]} · ${langLabel}`;
    this.badge.textContent = shortLabel(this.language);
    this.button.replaceChildren(iconFor(this.phase, this.doc), this.badge);

    if (this.phase === "error" && this.lastError) {
      this.tooltip.textContent = this.lastError.message;
      this.tooltip.classList.remove("df-hidden");
      this.positionPopups();
    } else {
      this.tooltip.classList.add("df-hidden");
    }
    if (!this.shouldShow()) this.closeMenu();
  }

  private handleClick(): void {
    if (this.phase === "error" && this.lastError?.action === "open-options") {
      this.deps.onOpenOptions();
      return;
    }
    // Durante el check verde o el aviso de error, un clic empieza un dictado nuevo.
    if (this.phase === "inserting") return;
    this.deps.onActivate();
  }

  // ---------- Menú contextual ----------

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.menu.classList.remove("df-hidden");
    this.positionPopups();
  };

  private onDocPointerDown = (e: PointerEvent): void => {
    if (this.menu.classList.contains("df-hidden")) return;
    if (!e.composedPath().includes(this.menu)) this.closeMenu();
  };

  closeMenu(): void {
    this.menu.classList.add("df-hidden");
  }

  destroy(): void {
    this.cleanupDrag();
    this.win.removeEventListener("resize", this.onResize);
    this.doc.removeEventListener("pointerdown", this.onDocPointerDown, true);
    if (this.revertTimer) clearTimeout(this.revertTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.container.remove();
  }
}
