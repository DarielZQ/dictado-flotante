import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertText } from "../../src/content/inject/insert";
import { snapshotOf } from "../../src/content/target-snapshot";

beforeEach(() => {
  document.body.replaceChildren();
});

function input(value = ""): HTMLInputElement {
  const el = document.createElement("input");
  el.value = value;
  document.body.appendChild(el);
  return el;
}

describe("insertText en input/textarea", () => {
  it("cae a setRangeText (jsdom no tiene execCommand) y dispara beforeinput, input y change", async () => {
    const el = input();
    el.focus();
    const events: string[] = [];
    for (const t of ["beforeinput", "input", "change"]) el.addEventListener(t, () => events.push(t));
    const res = await insertText(snapshotOf(el, "input"), "Hola mundo.", { smartFormatting: true });
    expect(res).toEqual({ inserted: true, strategy: "setRangeText", copiedToClipboard: false });
    expect(el.value).toBe("Hola mundo.");
    expect(events).toEqual(["beforeinput", "input", "change"]);
  });

  it("inserta en la posición del cursor guardada aunque el foco se haya movido", async () => {
    const el = input("Hola mundo");
    el.focus();
    el.setSelectionRange(4, 4);
    const snap = snapshotOf(el, "input");
    const other = input();
    other.focus();
    el.setSelectionRange(0, 0); // la página movió el cursor
    await insertText(snap, "Qué tal", { smartFormatting: true });
    expect(el.value).toBe("Hola qué tal mundo");
    expect(document.activeElement).toBe(el);
  });

  it("reemplaza la selección", async () => {
    const el = input("Hola XXX adiós");
    el.focus();
    el.setSelectionRange(5, 8);
    await insertText(snapshotOf(el, "input"), "Mundo", { smartFormatting: true });
    expect(el.value).toBe("Hola mundo adiós");
  });

  it("si la página cancela beforeinput, no modifica y lo considera gestionado", async () => {
    const el = input();
    el.focus();
    el.addEventListener("beforeinput", (e) => e.preventDefault());
    const res = await insertText(snapshotOf(el, "input"), "Hola", { smartFormatting: false });
    expect(res.inserted).toBe(true);
    expect(el.value).toBe("");
  });

  it("si el campo desaparece y no hay otro, copia al portapapeles", async () => {
    const el = input();
    el.focus();
    const snap = snapshotOf(el, "input");
    el.remove();
    const copy = vi.fn(async () => true);
    const res = await insertText(snap, "Texto perdido", { smartFormatting: true, copyToClipboard: copy });
    expect(res).toEqual({ inserted: false, strategy: "clipboard", copiedToClipboard: true });
    expect(copy).toHaveBeenCalledWith("Texto perdido");
  });

  it("si ninguna estrategia funciona, copia al portapapeles", async () => {
    const el = input();
    el.focus();
    const copy = vi.fn(async () => true);
    const res = await insertText(snapshotOf(el, "input"), "Hola", {
      smartFormatting: true,
      copyToClipboard: copy,
      order: { input: ["execCommand"] },
    });
    expect(res.copiedToClipboard).toBe(true);
    expect(copy).toHaveBeenCalledWith("Hola");
  });

  it("textarea multilínea", async () => {
    const el = document.createElement("textarea");
    el.value = "Primera línea.\n";
    document.body.appendChild(el);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    await insertText(snapshotOf(el, "textarea"), "segunda línea.", { smartFormatting: true });
    expect(el.value).toBe("Primera línea.\nSegunda línea.");
  });
});
