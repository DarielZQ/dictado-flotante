import { describe, expect, it } from "vitest";
import { formatForInsertion } from "../../src/content/inject/formatting";

describe("formatForInsertion", () => {
  const cases: Array<[string, string, string, string, string]> = [
    // [descripción, texto, antes, después, esperado]
    ["campo vacío", "Hola mundo.", "", "", "Hola mundo."],
    ["tras palabra: espacio y minúscula", "Qué tal.", "Hola", "", " qué tal."],
    ["tras espacio: sin espacio extra", "Qué tal.", "la ", "", "qué tal."],
    ["tras punto: mayúscula conservada", "Nueva frase.", "fin.", "", " Nueva frase."],
    ["tras punto y espacio", "nueva frase.", "in. ", "", "Nueva frase."],
    ["tras signo de apertura ¿", "Vienes mañana?", "¿", "", "vienes mañana?"],
    ["tras paréntesis", "Nota.", "(", "", "nota."],
    ["sigla al inicio se respeta", "ONU aprobó.", "la ", "", "ONU aprobó."],
    ["pronombre I se respeta", "I think so.", "and ", "", "I think so."],
    ["texto seguido de palabra: espacio final", "Hola", "", "mundo", "Hola "],
    ["antes de coma: sin punto final", "Hola.", "", ",", "Hola"],
    ["antes de punto: sin doble punto", "Así es.", "es ", ".", "así es"],
    ["espacios múltiples colapsados", "  Hola    mundo  ", "", "", "Hola mundo"],
    ["tras salto de línea: mayúscula", "Línea nueva.", "a.\n", "", "Línea nueva."],
    ["tras dos puntos: no minúscula", "Lista de cosas.", "s: ", "", "Lista de cosas."],
    ["tras exclamación pegada", "vale.", "ya!", "", " Vale."],
    ["texto vacío", "   ", "abc", "def", ""],
    ["inicio de campo en minúscula", "hola.", "", "", "Hola."],
  ];

  it.each(cases)("%s", (_desc, text, before, after, expected) => {
    expect(formatForInsertion(text, { before, after }, true)).toBe(expected);
  });

  it("sin formato inteligente solo recorta", () => {
    expect(formatForInsertion("  Hola  mundo ", { before: "x", after: "y" }, false)).toBe("Hola mundo");
  });
});
