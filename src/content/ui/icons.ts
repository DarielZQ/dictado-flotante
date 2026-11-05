import type { DictationPhase } from "../../shared/state";

const SVG_NS = "http://www.w3.org/2000/svg";

type Shape = [tag: string, attrs: Record<string, string>];

const MIC: Shape[] = [
  ["rect", { x: "9", y: "3", width: "6", height: "11", rx: "3", fill: "currentColor" }],
  ["path", { d: "M5.5 11a6.5 6.5 0 0 0 13 0", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" }],
  ["path", { d: "M12 17.5V21M9 21h6", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" }],
];
const STOP: Shape[] = [["rect", { x: "7", y: "7", width: "10", height: "10", rx: "2", fill: "currentColor" }]];
const SPINNER: Shape[] = [
  ["circle", { cx: "12", cy: "12", r: "8", fill: "none", stroke: "currentColor", "stroke-opacity": ".3", "stroke-width": "2.5" }],
  ["path", { d: "M12 4a8 8 0 0 1 8 8", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", class: "df-spinner" }],
];
const CHECK: Shape[] = [
  ["path", { d: "M5 12.5l4.5 4.5L19 7.5", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" }],
];
const ALERT: Shape[] = [
  ["path", { d: "M12 6v7", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round" }],
  ["circle", { cx: "12", cy: "17.5", r: "1.5", fill: "currentColor" }],
];

const BY_PHASE: Record<DictationPhase, Shape[]> = {
  idle: MIC,
  arming: MIC,
  listening: STOP,
  transcribing: SPINNER,
  inserting: SPINNER,
  success: CHECK,
  error: ALERT,
};

/** Construye el SVG con la API DOM (sin innerHTML). */
export function iconFor(phase: DictationPhase, doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of BY_PHASE[phase]) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}
