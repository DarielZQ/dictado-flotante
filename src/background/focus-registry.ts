import type { EditableKind } from "../shared/messages";

export interface FocusRecord {
  frameId: number;
  kind: EditableKind;
  at: number;
}

const STORAGE_KEY = "focusRegistry";

/**
 * Último frame con un campo editable enfocado, por pestaña.
 * Se replica en storage.session porque la event page puede descargarse.
 */
export class FocusRegistry {
  private map = new Map<number, FocusRecord>();
  private loaded: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storage: browser.storage.StorageArea | null = browser.storage.session ?? null) {}

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      if (!this.storage) return;
      try {
        const raw = (await this.storage.get(STORAGE_KEY))[STORAGE_KEY] as Record<string, FocusRecord> | undefined;
        if (raw) for (const [tab, rec] of Object.entries(raw)) this.map.set(Number(tab), rec);
      } catch {
        // storage.session no disponible: solo memoria
      }
    })();
    return this.loaded;
  }

  private persist(): void {
    if (!this.storage) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.storage?.set({ [STORAGE_KEY]: Object.fromEntries(this.map) }).catch(() => undefined);
    }, 200);
  }

  /** Devuelve true si cambia lo que debe ver el frame superior. */
  async update(tabId: number, frameId: number, editable: boolean, kind: EditableKind | null, at: number): Promise<{
    visible: boolean;
    kind: EditableKind | null;
  }> {
    await this.load();
    const prev = this.map.get(tabId);
    if (editable && kind) {
      if (!prev || at >= prev.at || prev.frameId === frameId) {
        this.map.set(tabId, { frameId, kind, at });
        this.persist();
      }
    } else if (prev && prev.frameId === frameId && at >= prev.at) {
      this.map.delete(tabId);
      this.persist();
    }
    const current = this.map.get(tabId);
    return { visible: Boolean(current), kind: current?.kind ?? null };
  }

  async get(tabId: number): Promise<FocusRecord | undefined> {
    await this.load();
    return this.map.get(tabId);
  }

  async remove(tabId: number): Promise<void> {
    await this.load();
    if (this.map.delete(tabId)) this.persist();
  }
}
