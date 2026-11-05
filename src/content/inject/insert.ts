import { createLogger } from "../../shared/logger";
import type { InsertResult, InsertStrategyName } from "../../shared/messages";
import { restoreSnapshot, takeSnapshot, type TargetSnapshot } from "../target-snapshot";
import { formatForInsertion, type InsertionContext } from "./formatting";
import { STRATEGIES, STRATEGY_ORDER } from "./strategies";
import { probe, waitForChange } from "./verify";

const log = createLogger("insert");

export interface InsertOptions {
  smartFormatting: boolean;
  /** Copia al portapapeles si todas las estrategias fallan. */
  copyToClipboard?: (text: string) => Promise<boolean>;
  order?: Partial<Record<TargetSnapshot["kind"], InsertStrategyName[]>>;
}

/** Caracteres alrededor del cursor para el formato inteligente. */
export function contextOf(s: TargetSnapshot): InsertionContext {
  const el = s.element;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const field = el as HTMLInputElement | HTMLTextAreaElement;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    return { before: field.value.slice(Math.max(0, start - 3), start), after: field.value.slice(end, end + 3) };
  }
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return { before: "", after: "" };
  const range = sel.getRangeAt(0);
  const before =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? (range.startContainer.textContent ?? "").slice(Math.max(0, range.startOffset - 3), range.startOffset)
      : "";
  const after =
    range.endContainer.nodeType === Node.TEXT_NODE
      ? (range.endContainer.textContent ?? "").slice(range.endOffset, range.endOffset + 3)
      : "";
  return { before, after };
}

async function defaultCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Inserta `rawText` en el campo de la instantánea probando estrategias hasta que una funcione. */
export async function insertText(snapshot: TargetSnapshot | null, rawText: string, opts: InsertOptions): Promise<InsertResult> {
  let target = snapshot;
  if (!target || !restoreSnapshot(target)) {
    target = takeSnapshot();
    if (target && !restoreSnapshot(target)) target = null;
  }

  const copy = opts.copyToClipboard ?? defaultCopy;
  if (!target) {
    const copied = await copy(rawText.trim());
    return { inserted: false, strategy: copied ? "clipboard" : "none", copiedToClipboard: copied };
  }

  const text = formatForInsertion(rawText, contextOf(target), opts.smartFormatting);
  const order = opts.order?.[target.kind] ?? STRATEGY_ORDER[target.kind];

  for (const name of order) {
    const strategy = STRATEGIES[name];
    const before = probe(target.element, target.kind);
    let outcome;
    try {
      outcome = await strategy.run(target, text);
    } catch (err) {
      log.debug(`Estrategia ${name} lanzó una excepción`, err);
      continue;
    }
    if (outcome === "skipped") continue;
    if (target.kind === "google-docs" && outcome === "done") {
      return { inserted: true, strategy: name, copiedToClipboard: false };
    }
    if (await waitForChange(target.element, target.kind, before, text, strategy.verifyTimeoutMs)) {
      log.debug("Texto insertado con", name);
      return { inserted: true, strategy: name, copiedToClipboard: false };
    }
    if (outcome === "handled-by-page") {
      // La página aceptó el evento pero no vemos el cambio: no seguir para no duplicar.
      log.debug(`La página gestionó ${name} sin cambio visible; se asume insertado`);
      return { inserted: true, strategy: name, copiedToClipboard: false };
    }
  }

  const copied = await copy(text.trim());
  return { inserted: false, strategy: copied ? "clipboard" : "none", copiedToClipboard: copied };
}
