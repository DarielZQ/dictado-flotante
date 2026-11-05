// Stub mínimo de la API `browser` para los módulos que la importan en tests.
import { vi } from "vitest";

function memoryArea() {
  let data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key?: string | string[] | null) => {
      if (key == null) return { ...data };
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      data = { ...data, ...structuredClone(items) };
    }),
    remove: vi.fn(async (key: string | string[]) => {
      for (const k of Array.isArray(key) ? key : [key]) delete data[k];
    }),
    clear: vi.fn(async () => {
      data = {};
    }),
  };
}

(globalThis as unknown as { browser: unknown }).browser = {
  storage: { local: memoryArea(), session: memoryArea(), onChanged: { addListener: vi.fn() } },
  runtime: {
    id: "test@extension",
    sendMessage: vi.fn(async () => undefined),
    getURL: (p: string) => `moz-extension://test/${p}`,
    onMessage: { addListener: vi.fn() },
  },
};
