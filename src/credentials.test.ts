import type { ChatInstance } from "chat";
import { describe, expect, it, vi } from "vitest";
import { resolveCredential } from "./client";
import {
  ACCOUNT_ID,
  createTestAdapter,
  IGSID,
  messageCreatedEvent,
  sentMessage,
  signedRequest,
  silentLogger,
} from "./test-utils";

const dmThread = { kind: "dm", accountId: ACCOUNT_ID, platform: "instagram", conversationKey: `instagram:${IGSID}` } as const;
const chat = {
  getLogger: () => silentLogger,
  processMessage: async () => undefined,
  getState: () => ({ get: async () => null, set: async () => undefined }),
} as unknown as ChatInstance;

describe("apiKey resolver", () => {
  it("is called for every outbound request and never cached", async () => {
    let n = 0;
    const apiKey = vi.fn(() => `adeli_sk_rotating_${++n}`);
    const { adapter, fake } = createTestAdapter({ apiKey });
    fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "x") }));
    fake.on("GET", "/api/v1/messages", () => ({ status: 200, body: { status: "complete", messages: [], errors: [], nextCursor: null } }));

    // Constructing the adapter resolves nothing.
    expect(apiKey).not.toHaveBeenCalled();

    await adapter.initialize(chat);
    const threadId = adapter.encodeThreadId(dmThread);
    await adapter.postMessage(threadId, "one");
    await adapter.postMessage(threadId, "two");
    await adapter.fetchMessages(threadId);

    expect(apiKey).toHaveBeenCalledTimes(4);
    expect(fake.calls.map((call) => call.authorization)).toEqual([
      "Bearer adeli_sk_rotating_1",
      "Bearer adeli_sk_rotating_2",
      "Bearer adeli_sk_rotating_3",
      "Bearer adeli_sk_rotating_4",
    ]);
  });

  it("supports async resolvers", async () => {
    const apiKey = vi.fn(async () => "adeli_sk_async");
    const { adapter, fake } = createTestAdapter({ apiKey });
    fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "x") }));
    await adapter.postMessage(adapter.encodeThreadId(dmThread), "hi");
    expect(fake.calls[0]?.authorization).toBe("Bearer adeli_sk_async");
  });

  it("surfaces a failing or empty resolver as an AuthenticationError without sending", async () => {
    const failing = createTestAdapter({ apiKey: async () => { throw new Error("vault down"); } });
    await expect(failing.adapter.postMessage(failing.adapter.encodeThreadId(dmThread), "hi")).rejects.toMatchObject({
      name: "AuthenticationError",
    });
    expect(failing.fake.calls).toHaveLength(0);
    const empty = createTestAdapter({ apiKey: () => "" });
    await expect(empty.adapter.postMessage(empty.adapter.encodeThreadId(dmThread), "hi")).rejects.toThrow(/apiKey is empty/);
    expect(empty.fake.calls).toHaveLength(0);
  });

  it("sends a static key unchanged", async () => {
    const { adapter, fake } = createTestAdapter({ apiKey: "adeli_sk_static" });
    fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "x") }));
    await adapter.postMessage(adapter.encodeThreadId(dmThread), "hi");
    expect(fake.calls[0]?.authorization).toBe("Bearer adeli_sk_static");
  });
});

describe("webhookSecret resolver", () => {
  it("is called once per webhook and a rotated secret applies immediately", async () => {
    let current = "whsec_old";
    const webhookSecret = vi.fn(() => current);
    const { adapter } = createTestAdapter({ webhookSecret });
    await adapter.initialize(chat);

    expect((await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { secret: "whsec_old" }))).status).toBe(200);
    current = "whsec_new";
    expect((await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { secret: "whsec_old" }))).status).toBe(401);
    expect((await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { secret: "whsec_new" }))).status).toBe(200);
    expect(webhookSecret).toHaveBeenCalledTimes(3);
  });

  it("is not called for a request with no signature", async () => {
    const webhookSecret = vi.fn(() => "whsec_x");
    const { adapter } = createTestAdapter({ webhookSecret });
    await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { signature: null }));
    expect(webhookSecret).not.toHaveBeenCalled();
  });
});

describe("resolveCredential", () => {
  it("returns static and resolved values and rejects blanks", async () => {
    await expect(resolveCredential("a", "apiKey")).resolves.toBe("a");
    await expect(resolveCredential(async () => "b", "apiKey")).resolves.toBe("b");
    await expect(resolveCredential("  ", "apiKey")).rejects.toThrow(/apiKey is empty/);
    await expect(resolveCredential(() => undefined as unknown as string, "webhookSecret")).rejects.toThrow(/webhookSecret/);
  });
});
