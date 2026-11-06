import { AdeliApiError, ConfigurationError, NetworkError as SdkNetworkError, TimeoutError } from "@adeli/sdk";
import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import { toAdapterError } from "./client";
import { ACCOUNT_ID, createTestAdapter, sentMessage } from "./test-utils";

const context = { action: "send a message", resourceType: "conversation", resourceId: "instagram:1" };
const apiError = (status: number, code?: string, details?: unknown, headers?: Record<string, string>) =>
  new AdeliApiError(`failed ${status}`, {
    status,
    ...(code === undefined ? {} : { code }),
    details,
    headers: new Headers(headers ?? {}),
  });

describe("toAdapterError", () => {
  it("maps 409 window_closed to an AdapterError with a 24-hour message", () => {
    const error = toAdapterError(apiError(409, "window_closed"), context);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe("window_closed");
    expect(error.message).toMatch(/24-hour messaging window/);
  });

  it("maps 402 usage_limit_reached to AdapterRateLimitError with the reset time", () => {
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    const error = toAdapterError(apiError(402, "usage_limit_reached", { resetsAt }), context);
    expect(error).toBeInstanceOf(AdapterRateLimitError);
    expect((error as AdapterRateLimitError).retryAfter).toBeGreaterThan(3500);
    const noReset = toAdapterError(apiError(402, "usage_limit_reached", { resetsAt: "never" }), context);
    expect((noReset as AdapterRateLimitError).retryAfter).toBeUndefined();
  });

  it("maps 429 to AdapterRateLimitError with Retry-After", () => {
    expect((toAdapterError(apiError(429, "rate_limited", undefined, { "retry-after": "7" }), context) as AdapterRateLimitError).retryAfter).toBe(7);
    const date = new Date(Date.now() + 10_000).toUTCString();
    const fromDate = toAdapterError(apiError(429, "rate_limited", undefined, { "retry-after": date }), context) as AdapterRateLimitError;
    expect(fromDate.retryAfter).toBeGreaterThan(0);
    expect((toAdapterError(apiError(429, "rate_limited", undefined, { "retry-after": "soon" }), context) as AdapterRateLimitError).retryAfter).toBeUndefined();
    expect((toAdapterError(apiError(429), context) as AdapterRateLimitError).retryAfter).toBeUndefined();
  });

  it("maps 403 permission_required to PermissionError with the missing permissions", () => {
    const error = toAdapterError(
      apiError(403, "permission_required", { missingPermissions: [{ code: "instagram_manage_messages", label: "Messages" }] }),
      context,
    );
    expect(error).toBeInstanceOf(PermissionError);
    expect((error as PermissionError).requiredScope).toBe("instagram_manage_messages");
    expect((toAdapterError(apiError(403, "permission_required", "x"), context) as PermissionError).requiredScope).toBeUndefined();
    expect((toAdapterError(apiError(403, "permission_required", { missingPermissions: [] }), context) as PermissionError).requiredScope).toBeUndefined();
  });

  it("maps 401, 404, 400, 422 and 5xx", () => {
    expect(toAdapterError(apiError(401, "unauthorized"), context)).toBeInstanceOf(AuthenticationError);
    const notFound = toAdapterError(apiError(404, "account_not_found"), context) as ResourceNotFoundError;
    expect(notFound).toBeInstanceOf(ResourceNotFoundError);
    expect(notFound.resourceId).toBe("instagram:1");
    expect(toAdapterError(apiError(404), { action: "x" })).toBeInstanceOf(ResourceNotFoundError);
    expect(toAdapterError(apiError(400, "invalid_request"), context)).toBeInstanceOf(ValidationError);
    expect(toAdapterError(apiError(422, "unsupported_for_platform"), context)).toBeInstanceOf(ValidationError);
    expect(toAdapterError(apiError(502, "provider_error"), context)).toBeInstanceOf(NetworkError);
    const other = toAdapterError(apiError(402, "billing_required"), context) as AdapterError;
    expect(other).toBeInstanceOf(AdapterError);
    expect(other.code).toBe("billing_required");
  });

  it("maps SDK network failures and timeouts to NetworkError", () => {
    expect(toAdapterError(new SdkNetworkError("offline"), context)).toBeInstanceOf(NetworkError);
    expect(toAdapterError(new TimeoutError("slow"), context)).toBeInstanceOf(NetworkError);
  });

  it("unwraps an adapter error from a failed key resolver", () => {
    const inner = new AuthenticationError("adeli", "The Adeli apiKey is empty");
    expect(toAdapterError(new ConfigurationError("resolver failed", { cause: inner }), context)).toBe(inner);
    expect(toAdapterError(new ConfigurationError("bad key"), context)).toBeInstanceOf(AuthenticationError);
  });

  it("passes adapter errors through and wraps anything else", () => {
    const existing = new ValidationError("adeli", "x");
    expect(toAdapterError(existing, context)).toBe(existing);
    expect(toAdapterError(new Error("boom"), context).message).toMatch(/boom/);
    expect(toAdapterError("weird", context)).toBeInstanceOf(AdapterError);
  });
});

describe("errors surface from adapter calls", () => {
  it("throws the window_closed error from postMessage", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages", () => ({
      status: 409,
      body: { error: { code: "window_closed", message: "The 24-hour window has closed" } },
    }));
    const threadId = adapter.encodeThreadId({ kind: "dm", accountId: ACCOUNT_ID, platform: "whatsapp", conversationKey: "whatsapp:1" });
    await expect(adapter.postMessage(threadId, "hi")).rejects.toMatchObject({ code: "window_closed" });
  });

  it("throws NetworkError when fetch itself fails", async () => {
    const { adapter } = createTestAdapter({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const threadId = adapter.encodeThreadId({ kind: "dm", accountId: ACCOUNT_ID, platform: "facebook", conversationKey: "facebook:1" });
    await expect(adapter.postMessage(threadId, "hi")).rejects.toBeInstanceOf(NetworkError);
  });

  it("does not fail a send when the sent id cannot be recorded", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages", () => ({ status: 201, body: sentMessage("facebook", "1", "x") }));
    await adapter.initialize({
      getLogger: () => ({ debug() {}, info() {}, warn() {}, error() {}, child() { return this; } }),
      getState: () => ({ set: async () => { throw new Error("state down"); } }),
    } as never);
    const threadId = adapter.encodeThreadId({ kind: "dm", accountId: ACCOUNT_ID, platform: "facebook", conversationKey: "facebook:1" });
    await expect(adapter.postMessage(threadId, "hi")).resolves.toMatchObject({ threadId });
  });
});
