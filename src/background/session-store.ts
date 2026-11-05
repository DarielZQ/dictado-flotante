import type { DictationSession } from "../shared/state";

const KEY = "activeSession";

/** Persiste la sesión activa para detectar interrupciones si la event page se descarga. */
export class SessionStore {
  constructor(private readonly storage: browser.storage.StorageArea | null = browser.storage.session ?? null) {}

  async save(session: DictationSession | null): Promise<void> {
    if (!this.storage) return;
    try {
      if (session) await this.storage.set({ [KEY]: session });
      else await this.storage.remove(KEY);
    } catch {
      // ignorar
    }
  }

  async load(): Promise<DictationSession | null> {
    if (!this.storage) return null;
    try {
      const value = (await this.storage.get(KEY))[KEY] as DictationSession | undefined;
      return value ?? null;
    } catch {
      return null;
    }
  }
}
