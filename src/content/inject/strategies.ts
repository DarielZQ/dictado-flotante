import type { EditableKind, InsertStrategyName } from "../../shared/messages";
import type { TargetSnapshot } from "../target-snapshot";

export type StrategyOutcome = "done" | "handled-by-page" | "skipped";

export interface InsertStrategy {
  name: InsertStrategyName;
  run(target: TargetSnapshot, text: string): StrategyOutcome | Promise<StrategyOutcome>;
  verifyTimeoutMs: number;
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

function inputEvent(type: "beforeinput" | "input", text: string, cancelable: boolean, win: Win): InputEvent {
  return new win.InputEvent(type, { inputType: "insertText", data: text, bubbles: true, cancelable, composed: true });
}

type Win = Window & typeof globalThis;

function winOf(el: HTMLElement): Win {
  return (el.ownerDocument.defaultView ?? window) as Win;
}

/** 1. execCommand: conserva deshacer y Firefox dispara beforeinput/input nativos. */
export const execCommandStrategy: InsertStrategy = {
  name: "execCommand",
  verifyTimeoutMs: 60,
  run(target, text) {
    const doc = target.element.ownerDocument;
    if (typeof doc.execCommand !== "function") return "skipped";
    try {
      return doc.execCommand("insertText", false, text) ? "done" : "skipped";
    } catch {
      return "skipped";
    }
  },
};

/** 2. setRangeText + eventos: React/Vue/Angular sincronizan su estado con el "input". */
export const setRangeTextStrategy: InsertStrategy = {
  name: "setRangeText",
  verifyTimeoutMs: 60,
  run(target, text) {
    const el = target.element as TextField;
    const win = winOf(el);
    if (!el.dispatchEvent(inputEvent("beforeinput", text, true, win))) return "handled-by-page";
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(inputEvent("input", text, false, win));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    return "done";
  },
};

/** 3. beforeinput sintético: editores como Lexical o Slate lo procesan y lo cancelan. */
export const beforeInputStrategy: InsertStrategy = {
  name: "beforeInput",
  verifyTimeoutMs: 150,
  run(target, text) {
    const ev = inputEvent("beforeinput", text, true, winOf(target.element));
    target.element.dispatchEvent(ev);
    return ev.defaultPrevented ? "handled-by-page" : "skipped";
  },
};

function dispatchSyntheticPaste(el: HTMLElement, text: string): boolean {
  const win = winOf(el);
  const dt = new win.DataTransfer();
  dt.setData("text/plain", text);
  const ev = new win.ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/** 4. paste sintético: ProseMirror, Draft.js y similares leen clipboardData. */
export const syntheticPasteStrategy: InsertStrategy = {
  name: "syntheticPaste",
  verifyTimeoutMs: 250,
  run(target, text) {
    try {
      return dispatchSyntheticPaste(target.element, text) ? "handled-by-page" : "skipped";
    } catch {
      return "skipped";
    }
  },
};

/** 5. Inserción directa con Range (último recurso para contenteditable simples). */
export const rangeInsertStrategy: InsertStrategy = {
  name: "rangeInsert",
  verifyTimeoutMs: 60,
  run(target, text) {
    const doc = target.element.ownerDocument;
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return "skipped";
    const range = sel.getRangeAt(0);
    if (!target.element.contains(range.commonAncestorContainer)) return "skipped";
    range.deleteContents();
    const node = doc.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    target.element.dispatchEvent(inputEvent("input", text, false, winOf(target.element)));
    return "done";
  },
};

/** Google Docs: paste sobre el iframe de eventos de texto (best-effort, no verificable). */
export const googleDocsPasteStrategy: InsertStrategy = {
  name: "googleDocsPaste",
  verifyTimeoutMs: 0,
  run(target, text) {
    try {
      return dispatchSyntheticPaste(target.element, text) ? "done" : "skipped";
    } catch {
      return "skipped";
    }
  },
};

export const STRATEGIES: Record<InsertStrategyName, InsertStrategy> = {
  execCommand: execCommandStrategy,
  setRangeText: setRangeTextStrategy,
  beforeInput: beforeInputStrategy,
  syntheticPaste: syntheticPasteStrategy,
  rangeInsert: rangeInsertStrategy,
  googleDocsPaste: googleDocsPasteStrategy,
};

export const STRATEGY_ORDER: Record<EditableKind, InsertStrategyName[]> = {
  input: ["execCommand", "setRangeText"],
  textarea: ["execCommand", "setRangeText"],
  contenteditable: ["execCommand", "beforeInput", "syntheticPaste", "rangeInsert"],
  "google-docs": ["googleDocsPaste", "execCommand"],
};
