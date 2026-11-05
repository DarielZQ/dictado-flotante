import { beforeEach, describe, expect, it } from "vitest";
import { classifyEditable, resolveDeepActiveElement, UI_HOST_ATTR } from "../../src/content/editable";

beforeEach(() => {
  document.body.replaceChildren();
});

function make(html: string): HTMLElement {
  document.body.insertAdjacentHTML("beforeend", html);
  return document.body.lastElementChild as HTMLElement;
}

describe("classifyEditable", () => {
  it.each([
    ['<input type="text">', "input"],
    ["<input>", "input"],
    ['<input type="search">', "input"],
    ['<input type="email">', "input"],
    ["<textarea></textarea>", "textarea"],
  ])("%s → %s", (html, kind) => {
    expect(classifyEditable(make(html))).toBe(kind);
  });

  it.each([
    '<input type="password">',
    '<input type="number">',
    '<input type="checkbox">',
    '<input type="text" readonly>',
    '<input type="text" disabled>',
    "<textarea readonly></textarea>",
    '<input type="text" aria-readonly="true">',
    "<div></div>",
  ])("%s → null", (html) => {
    expect(classifyEditable(make(html))).toBeNull();
  });

  it("contenteditable (jsdom no implementa isContentEditable: se simula)", () => {
    const div = make('<div contenteditable="true"></div>');
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(classifyEditable(div)).toBe("contenteditable");
  });

  it("ignora elementos dentro de la propia UI", () => {
    const host = make(`<div ${UI_HOST_ATTR}><input></div>`);
    expect(classifyEditable(host.querySelector("input"))).toBeNull();
  });

  it("null para null", () => {
    expect(classifyEditable(null)).toBeNull();
  });
});

describe("resolveDeepActiveElement", () => {
  it("atraviesa shadow roots abiertos", () => {
    const host = make("<div></div>");
    const root = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    root.appendChild(input);
    input.focus();
    expect(resolveDeepActiveElement()).toBe(input);
  });
});
