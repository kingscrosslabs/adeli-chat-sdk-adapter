/**
 * The only module that constructs an `@adeli/sdk` client or touches its
 * errors. Everything else calls `AdeliClient.call()`.
 */
import {
  Adeli,
  AdeliApiError,
  type ApiResponse,
  ConfigurationError as SdkConfigurationError,
  NetworkError as SdkNetworkError,
  TimeoutError as SdkTimeoutError,
} from "@adeli/sdk";
import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import { ADAPTER_NAME } from "./thread-id";
import type { CredentialInput } from "./types";

/**
 * Resolve a credential for one use. Functions are called every time and the
 * result is never cached.
 */
export async function resolveCredential(input: CredentialInput, field: string): Promise<string> {
  const value = typeof input === "function" ? await input() : input;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AuthenticationError(ADAPTER_NAME, `The Adeli ${field} is empty`);
  }
  return value;
}

export interface AdeliClientOptions {
  apiKey: CredentialInput;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/** What a failed call was doing, for error messages. */
export interface CallContext {
  /** Verb phrase, e.g. "send an Instagram message". */
  action: string;
  resourceType?: string;
  resourceId?: string;
}

export class AdeliClient {
  private readonly sdk: Adeli;

  constructor(options: AdeliClientOptions) {
    const apiKey = options.apiKey;
    // The SDK calls this resolver before every request attempt and never
    // caches its result, so the adapter's `apiKey` is resolved per call.
    this.sdk = new Adeli({
      apiKey: () => resolveCredential(apiKey, "apiKey"),
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  /** Run one SDK call and map any failure to a `@chat-adapter/shared` error. */
  async call<T>(context: CallContext, run: (sdk: Adeli) => Promise<ApiResponse<T>>): Promise<T> {
    try {
      const response = await run(this.sdk);
      return response.data;
    } catch (error) {
      throw toAdapterError(error, context);
    }
  }

  /** Do not serialize the client or its credentials. */
  toJSON(): Record<string, never> {
    return {};
  }
}

function withCause<E extends Error>(error: E, cause: unknown): E {
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const header = headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function secondsUntil(details: unknown): number | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const resetsAt = (details as { resetsAt?: unknown }).resetsAt;
  if (typeof resetsAt !== "string") return undefined;
  const time = Date.parse(resetsAt);
  if (Number.isNaN(time)) return undefined;
  return Math.max(0, Math.ceil((time - Date.now()) / 1000));
}

function missingPermissions(details: unknown): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const list = (details as { missingPermissions?: unknown; requiredPermissions?: unknown }).missingPermissions
    ?? (details as { requiredPermissions?: unknown }).requiredPermissions;
  if (!Array.isArray(list)) return undefined;
  const codes = list
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { code?: unknown }).code : undefined))
    .filter((code): code is string => typeof code === "string");
  return codes.length > 0 ? codes.join(", ") : undefined;
}

/**
 * Map an `@adeli/sdk` failure to the error classes Chat SDK expects:
 * `409 window_closed` → `AdapterError` (code `window_closed`),
 * `402 usage_limit_reached` and `429` → `AdapterRateLimitError`,
 * `403` → `PermissionError`, `401` → `AuthenticationError`,
 * `404` → `ResourceNotFoundError`, `400`/`422` → `ValidationError`,
 * `5xx`, network failures and timeouts → `NetworkError`.
 */
export function toAdapterError(error: unknown, context: CallContext): Error {
  if (error instanceof AdapterError) return error;
  if (error instanceof AdeliApiError) {
    const { status, code } = error;
    const message = `Adeli could not ${context.action}: ${error.message}`;
    if (code === "window_closed") {
      return withCause(
        new AdapterError(
          `Adeli could not ${context.action}: the 24-hour messaging window has closed. The person must message the account first (or, on WhatsApp, send an approved template with @adeli/sdk).`,
          ADAPTER_NAME,
          "window_closed",
        ),
        error,
      );
    }
    if (code === "usage_limit_reached") {
      return withCause(new AdapterRateLimitError(ADAPTER_NAME, secondsUntil(error.details)), error);
    }
    if (status === 429) return withCause(new AdapterRateLimitError(ADAPTER_NAME, retryAfterSeconds(error.headers)), error);
    if (status === 401) return withCause(new AuthenticationError(ADAPTER_NAME, message), error);
    if (status === 403) {
      return withCause(new PermissionError(ADAPTER_NAME, context.action, missingPermissions(error.details)), error);
    }
    if (status === 404) {
      return withCause(new ResourceNotFoundError(ADAPTER_NAME, context.resourceType ?? "resource", context.resourceId), error);
    }
    if (status === 400 || status === 422) return withCause(new ValidationError(ADAPTER_NAME, message), error);
    if (status >= 500) return withCause(new NetworkError(ADAPTER_NAME, message, error), error);
    return withCause(new AdapterError(message, ADAPTER_NAME, code), error);
  }
  if (error instanceof SdkNetworkError || error instanceof SdkTimeoutError) {
    return withCause(new NetworkError(ADAPTER_NAME, `Adeli could not ${context.action}: ${error.message}`, error), error);
  }
  if (error instanceof SdkConfigurationError) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof AdapterError) return cause;
    return withCause(new AuthenticationError(ADAPTER_NAME, error.message), error);
  }
  const message = error instanceof Error ? error.message : String(error);
  return withCause(new AdapterError(`Adeli could not ${context.action}: ${message}`, ADAPTER_NAME), error);
}
