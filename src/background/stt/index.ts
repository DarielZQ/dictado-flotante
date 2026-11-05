import { saveSettings, type Settings } from "../../shared/settings";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { SttProvider } from "./provider";

export function createProvider(settings: Settings, apiKey: string): SttProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: settings.provider.baseUrl,
    apiKey,
    model: settings.provider.model,
    responseFormat: settings.provider.responseFormat,
    onResponseFormatFallback: () => {
      void saveSettings({ provider: { responseFormat: "json" } });
    },
  });
}
