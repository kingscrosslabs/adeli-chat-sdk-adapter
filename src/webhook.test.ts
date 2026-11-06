import type { ChatInstance } from "chat";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_ID,
  commentCreatedEvent,
  createTestAdapter,
  messageCreatedEvent,
  postbackEvent,
  sign,
  signedRequest,
  silentLogger,
  WEBHOOK_SECRET,
} from "./test-utils";

function fakeChat() {
  const store = new Map<string, unknown>();
  const chat = {
    processMessage: vi.fn(async () => undefined),
    processAction: vi.fn(async () => undefined),
    getLogger: () => silentLogger,
    getState: () => ({
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => void store.set(key, value),
    }),
  };
  return chat;
}

async function initializedAdapter(overrides: Parameters<typeof createTestAdapter>[0] = {}) {
  const { adapter, fake } = createTestAdapter(overrides);
  const chat = fakeChat();
  await adapter.initialize(chat as unknown as ChatInstance);
  return { adapter, fake, chat };
}

describe("handleWebhook signature verification", () => {
  it("returns 401 when the signature header is missing", async () => {
    const { adapter, chat } = await initializedAdapter();
    const response = await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { signature: null }));
    expect(response.status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature is wrong", async () => {
    const { adapter, chat } = await initializedAdapter();
    const response = await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { secret: "whsec_other" }));
    expect(response.status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed signature header", async () => {
    const { adapter } = await initializedAdapter();
    const response = await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { signature: "invalid" }));
    expect(response.status).toBe(401);
  });

  it("returns 401 when the signed timestamp has expired", async () => {
    const { adapter } = await initializedAdapter();
    const old = Math.floor(Date.now() / 1000) - 301;
    const response = await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { timestamp: old }));
    expect(response.status).toBe(401);
  });

  it("honours a custom tolerance", async () => {
    const { adapter } = await initializedAdapter({ webhookToleranceSeconds: 10 });
    const old = Math.floor(Date.now() / 1000) - 30;
    expect((await adapter.handleWebhook(signedRequest(messageCreatedEvent(), { timestamp: old }))).status).toBe(401);
  });

  it("returns 401 when the body was altered after signing", async () => {
    const { adapter } = await initializedAdapter();
    const body = JSON.stringify(messageCreatedEvent());
    const request = new Request("https://bot.example.com/api/webhooks/adeli", {
      method: "POST",
      headers: { "adeli-signature": sign(body) },
      body: body.replace("Hi there", "Hi thera"),
    });
    expect((await adapter.handleWebhook(request)).status).toBe(401);
  });

  it("returns 200 for a valid signature and dispatches the message", async () => {
    const { adapter, chat } = await initializedAdapter();
    const response = await adapter.handleWebhook(signedRequest(messageCreatedEvent()));
    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for a test event without calling a handler", async () => {
    const { adapter, chat } = await initializedAdapter();
    const response = await adapter.handleWebhook(signedRequest(messageCreatedEvent({ test: true })));
    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(chat.processAction).not.toHaveBeenCalled();
  });

  it("calls a resolver-form webhookSecret once per request", async () => {
    const secret = vi.fn(async () => WEBHOOK_SECRET);
    const { adapter } = await initializedAdapter({ webhookSecret: secret });
    await adapter.handleWebhook(signedRequest(messageCreatedEvent()));
    expect(secret).toHaveBeenCalledTimes(1);
    await adapter.handleWebhook(signedRequest(messageCreatedEvent()));
    expect(secret).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when the secret resolver fails or returns nothing", async () => {
    const failing = await initializedAdapter({ webhookSecret: async () => { throw new Error("vault down"); } });
    expect((await failing.adapter.handleWebhook(signedRequest(messageCreatedEvent()))).status).toBe(500);
    const empty = await initializedAdapter({ webhookSecret: () => "" });
    expect((await empty.adapter.handleWebhook(signedRequest(messageCreatedEvent()))).status).toBe(500);
  });
});

describe("handleWebhook dispatch", () => {
  it("returns 400 for a signed body that is not an event", async () => {
    const { adapter } = await initializedAdapter();
    expect((await adapter.handleWebhook(signedRequest("not json"))).status).toBe(400);
    expect((await adapter.handleWebhook(signedRequest({ hello: "world" }))).status).toBe(400);
  });

  it("returns 400 for a malformed message.created", async () => {
    const { adapter, chat } = await initializedAdapter();
    const bad = messageCreatedEvent();
    (bad.data as Record<string, unknown>).conversationKey = "facebook:1";
    expect((await adapter.handleWebhook(signedRequest(bad))).status).toBe(400);
    const noData = { ...messageCreatedEvent(), data: "x" };
    expect((await adapter.handleWebhook(signedRequest(noData))).status).toBe(400);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for each malformed message.created field", async () => {
    const { adapter, chat } = await initializedAdapter();
    const cases: Record<string, unknown>[] = [
      { messageId: "" },
      { conversationKey: 42 },
      { from: { id: 1 } },
      { from: null },
      { text: 5 },
      { attachments: "x" },
      { attachments: [{ type: 1 }] },
      { replyTo: { id: "x" } },
    ];
    for (const patch of cases) {
      const event = messageCreatedEvent();
      Object.assign(event.data, patch);
      expect((await adapter.handleWebhook(signedRequest(event))).status, JSON.stringify(patch)).toBe(400);
    }
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("acknowledges message.created on a platform the SDK does not know, without dispatching", async () => {
    const { adapter, chat } = await initializedAdapter();
    const tiktok = { ...messageCreatedEvent(), platform: "tiktok" };
    expect((await adapter.handleWebhook(signedRequest(tiktok))).status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("keeps replyTo and accepts an attachment-only message with null text", async () => {
    const { adapter, chat } = await initializedAdapter();
    const event = messageCreatedEvent();
    const data = event.data as Record<string, unknown>;
    data.replyTo = { messageId: "mid.parent" };
    data.attachments = [];
    data.text = null;
    (data.from as Record<string, unknown>).username = null;
    expect((await adapter.handleWebhook(signedRequest(event))).status).toBe(200);
    const factory = chat.processMessage.mock.calls[0]?.[2] as unknown as () => Promise<{ raw: Record<string, unknown> }>;
    const message = await factory();
    expect(message.raw).toMatchObject({ replyTo: { messageId: "mid.parent" }, attachments: [], text: null });
  });

  it("returns 500 if a webhook arrives before initialize", async () => {
    const { adapter } = createTestAdapter();
    expect((await adapter.handleWebhook(signedRequest(messageCreatedEvent()))).status).toBe(500);
  });

  it("acknowledges event types it does not handle", async () => {
    const { adapter, chat } = await initializedAdapter();
    const other = { ...messageCreatedEvent(), type: "post.published", data: {} };
    expect((await adapter.handleWebhook(signedRequest(other))).status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("drops echoes", async () => {
    const { adapter, chat } = await initializedAdapter();
    expect((await adapter.handleWebhook(signedRequest(messageCreatedEvent({ isEcho: true })))).status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("routes a comment reply into its root comment's thread", async () => {
    const { adapter, chat } = await initializedAdapter();
    await adapter.handleWebhook(signedRequest(commentCreatedEvent({ commentId: "c2", parentId: "c1", mediaId: "m1" })));
    const threadId = chat.processMessage.mock.calls[0]?.[1] as unknown as string;
    expect(adapter.decodeThreadId(threadId)).toEqual({
      kind: "comment",
      accountId: ACCOUNT_ID,
      platform: "instagram",
      mediaId: "m1",
      rootCommentId: "c1",
    });
  });

  it("decodes a postback payload into processAction", async () => {
    const { adapter, chat } = await initializedAdapter();
    await adapter.handleWebhook(signedRequest(postbackEvent("approve\norder-42", { messageId: null })));
    expect(chat.processAction).toHaveBeenCalledTimes(1);
    const [event] = chat.processAction.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(event.actionId).toBe("approve");
    expect(event.value).toBe("order-42");
    expect(String(event.messageId)).toMatch(/^evt_instagram-postback:/);
    expect(adapter.decodeThreadId(event.threadId as string)).toMatchObject({ kind: "dm", conversationKey: "instagram:17841400000000001" });
  });
});
