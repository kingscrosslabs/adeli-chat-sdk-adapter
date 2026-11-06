import { ValidationError } from "@chat-adapter/shared";
import { AdeliAdapter } from "./adapter";
import { ADAPTER_NAME } from "./thread-id";
import type { AdeliAdapterConfig } from "./types";

/**
 * Create an Adeli adapter. Each field falls back to an environment variable:
 * `apiKey` to `ADELI_API_KEY`, `webhookSecret` to `ADELI_WEBHOOK_SECRET`,
 * `profileId` to `ADELI_PROFILE_ID` and `baseURL` to `ADELI_BASE_URL`.
 * `apiKey` and `webhookSecret` also accept a function, called per use.
 */
export function createAdeliAdapter(config?: Partial<AdeliAdapterConfig>): AdeliAdapter {
  const env = globalThis.process?.env ?? {};
  const apiKey = config?.apiKey ?? env.ADELI_API_KEY;
  const webhookSecret = config?.webhookSecret ?? env.ADELI_WEBHOOK_SECRET;
  const profileId = config?.profileId ?? env.ADELI_PROFILE_ID;
  const baseURL = config?.baseURL ?? env.ADELI_BASE_URL;

  if (!apiKey) {
    throw new ValidationError(
      ADAPTER_NAME,
      "Adeli apiKey is required. Pass it in config or set ADELI_API_KEY.",
    );
  }
  if (!webhookSecret) {
    throw new ValidationError(
      ADAPTER_NAME,
      "Adeli webhookSecret is required. Pass it in config or set ADELI_WEBHOOK_SECRET.",
    );
  }

  return new AdeliAdapter({
    ...config,
    apiKey,
    webhookSecret,
    ...(profileId ? { profileId } : {}),
    ...(baseURL ? { baseURL } : {}),
  });
}
