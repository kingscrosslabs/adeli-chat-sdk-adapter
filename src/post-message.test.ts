import { ValidationError } from "@chat-adapter/shared";
import { type CardElement, type ChatInstance, NotImplementedError } from "chat";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ID, commentRecord, createTestAdapter, IGSID, PROFILE_ID, sentMessage, silentLogger } from "./test-utils";

const dm = (platform: "instagram" | "facebook" | "whatsapp", id: string) =>
  ({ kind: "dm", accountId: ACCOUNT_ID, platform, conversationKey: `${platform}:${id}` }) as const;
const comment = (platform: "instagram" | "tiktok") =>
  ({ kind: "comment", accountId: ACCOUNT_ID, platform, mediaId: "media_1", rootCommentId: "root_1" }) as const;

describe("postMessage to DMs", () => {
  it("sends Instagram text to the scoped id", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "Hello") }));
    const threadId = adapter.encodeThreadId(dm("instagram", IGSID));
    const result = await adapter.postMessage(threadId, { markdown: "**Hello**" });
    expect(fake.callsTo("POST", "/api/v1/messages/instagram")[0]?.body).toEqual({
      accountId: ACCOUNT_ID,
      recipient: { id: IGSID },
      text: "Hello",
    });
    expect(result.threadId).toBe(threadId);
    expect(result.id).toMatch(/^mid\.sent\./);
    expect(result.raw).toMatchObject({ kind: "dm", direction: "outbound", conversationKey: `instagram:${IGSID}` });
  });

  it("sends a card's buttons as Instagram postback and URL buttons", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "x") }));
    const card: CardElement = {
      type: "card",
      title: "Confirm your order?",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "confirm", label: "Confirm", value: "order-42" },
            { type: "link-button", label: "View", url: "https://shop.example.com/o/42" },
          ],
        },
      ],
    };
    await adapter.postMessage(adapter.encodeThreadId(dm("instagram", IGSID)), { card });
    expect(fake.callsTo("POST", "/api/v1/messages/instagram")[0]?.body).toEqual({
      accountId: ACCOUNT_ID,
      recipient: { id: IGSID },
      text: "Confirm your order?",
      buttons: [
        { type: "postback", title: "Confirm", payload: "confirm\norder-42" },
        { type: "url", title: "View", url: "https://shop.example.com/o/42" },
      ],
    });
  });

  it("sends a card without buttons as plain text", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "x") }));
    await adapter.postMessage(adapter.encodeThreadId(dm("instagram", IGSID)), {
      type: "card",
      title: "Hours",
      children: [{ type: "text", content: "9 to 5" }],
    });
    expect(fake.callsTo("POST", "/api/v1/messages/instagram")[0]?.body).toEqual({
      accountId: ACCOUNT_ID,
      recipient: { id: IGSID },
      text: "Hours\n9 to 5",
    });
  });

  it("rejects more than three Instagram buttons without calling the API", async () => {
    const { adapter, fake } = createTestAdapter();
    const buttons = ["a", "b", "c", "d"].map((id) => ({ type: "button" as const, id, label: id }));
    await expect(
      adapter.postMessage(adapter.encodeThreadId(dm("instagram", IGSID)), {
        type: "card",
        title: "Pick",
        children: [{ type: "actions", children: buttons }],
      }),
    ).rejects.toThrow(ValidationError);
    expect(fake.calls).toHaveLength(0);
  });

  it("sends Facebook text, with cards falling back to text", async () => {
    const { adapter, fake } = createTestAdapter({ profileId: PROFILE_ID });
    fake.on("POST", "/api/v1/messages", () => ({ status: 201, body: sentMessage("facebook", "2468", "x") }));
    await adapter.postMessage(adapter.encodeThreadId(dm("facebook", "2468")), {
      type: "card",
      title: "Hi",
      children: [{ type: "actions", children: [{ type: "button", id: "a", label: "A" }] }],
    });
    expect(fake.callsTo("POST", "/api/v1/messages")[0]?.body).toEqual({
      platform: "facebook",
      accountId: ACCOUNT_ID,
      profileId: PROFILE_ID,
      recipient: "2468",
      text: "Hi",
    });
  });

  it("sends WhatsApp free text to the E.164 number", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages", () => ({ status: 201, body: sentMessage("whatsapp", "+15555550123", "x") }));
    await adapter.postMessage(adapter.encodeThreadId(dm("whatsapp", "15555550123")), "Your table is ready");
    expect(fake.callsTo("POST", "/api/v1/messages")[0]?.body).toEqual({
      platform: "whatsapp",
      accountId: ACCOUNT_ID,
      recipient: "+15555550123",
      text: "Your table is ready",
    });
  });

  it("uses the Adeli id when the provider id is missing", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages", () => ({ status: 201, body: { ...sentMessage("facebook", "1", "x"), id: "msg_x", providerId: null } }));
    const result = await adapter.postMessage(adapter.encodeThreadId(dm("facebook", "1")), "x");
    expect(result.id).toBe("msg_x");
  });

  it("rejects an empty message", async () => {
    const { adapter, fake } = createTestAdapter();
    await expect(adapter.postMessage(adapter.encodeThreadId(dm("facebook", "1")), "  ")).rejects.toThrow(/empty/);
    await expect(
      adapter.postMessage(adapter.encodeThreadId(dm("instagram", "1")), {
        type: "card",
        children: [{ type: "actions", children: [{ type: "button", id: "a", label: "A" }] }],
      }),
    ).rejects.toThrow(/empty/);
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects file uploads", async () => {
    const { adapter } = createTestAdapter();
    await expect(
      adapter.postMessage(adapter.encodeThreadId(dm("instagram", "1")), {
        markdown: "see file",
        files: [{ data: Buffer.from("x"), filename: "a.txt" }],
      }),
    ).rejects.toThrow(/not supported/);
  });
});

describe("postMessage to comment threads", () => {
  it("replies to the root Instagram comment", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/comments", () => ({
      status: 201,
      body: { platform: "instagram", accountId: ACCOUNT_ID, profileId: PROFILE_ID, comment: commentRecord({ id: "reply_1", parentId: "root_1", isCreator: true }) },
    }));
    const threadId = adapter.encodeThreadId(comment("instagram"));
    const result = await adapter.postMessage(threadId, { markdown: "Thanks *so* much!" });
    expect(fake.callsTo("POST", "/api/v1/comments")[0]?.body).toEqual({
      platform: "instagram",
      accountId: ACCOUNT_ID,
      parentId: "root_1",
      message: "Thanks so much!",
    });
    expect(result).toMatchObject({ id: "reply_1", threadId, raw: { kind: "comment", isSelf: true, rootCommentId: "root_1" } });
  });

  it("sends the video id with a TikTok reply", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/comments", () => ({
      status: 201,
      body: { platform: "tiktok", accountId: ACCOUNT_ID, profileId: PROFILE_ID, comment: commentRecord({ parentId: "root_1" }) },
    }));
    await adapter.postMessage(adapter.encodeThreadId(comment("tiktok")), "Thanks!");
    expect(fake.callsTo("POST", "/api/v1/comments")[0]?.body).toEqual({
      platform: "tiktok",
      accountId: ACCOUNT_ID,
      parentId: "root_1",
      postId: "media_1",
      message: "Thanks!",
    });
  });
});

describe("stream", () => {
  it("buffers the whole stream and posts once", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages", () => ({ status: 201, body: sentMessage("facebook", "1", "x") }));
    async function* chunks() {
      yield "Hello ";
      yield { type: "markdown_text" as const, text: "**world**" };
      yield { type: "task_update" as const, id: "t", title: "ignored", status: "complete" as const };
      yield "!";
    }
    await adapter.stream(adapter.encodeThreadId(dm("facebook", "1")), chunks());
    const sends = fake.callsTo("POST", "/api/v1/messages");
    expect(sends).toHaveLength(1);
    expect(sends[0]?.body).toMatchObject({ text: "Hello world!" });
  });

  it("stops reading when the signal aborts", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("POST", "/api/v1/messages", () => ({ status: 201, body: sentMessage("facebook", "1", "x") }));
    const controller = new AbortController();
    async function* chunks() {
      yield "first";
      controller.abort();
      yield " second";
    }
    await adapter.stream(adapter.encodeThreadId(dm("facebook", "1")), chunks(), { signal: controller.signal });
    expect(fake.callsTo("POST", "/api/v1/messages")[0]?.body).toMatchObject({ text: "first" });
  });
});

describe("unsupported operations", () => {
  const { adapter } = createTestAdapter();
  const dmThread = adapter.encodeThreadId(dm("instagram", "1"));

  it("throws NotImplementedError for edits, reactions and DM deletes", async () => {
    await expect(adapter.editMessage()).rejects.toThrow(NotImplementedError);
    await expect(adapter.addReaction(dmThread, "m", "thumbs_up")).rejects.toThrow(NotImplementedError);
    await expect(adapter.removeReaction(dmThread, "m", "thumbs_up")).rejects.toThrow(NotImplementedError);
    await expect(adapter.deleteMessage(dmThread, "m")).rejects.toThrow(NotImplementedError);
  });

  it("treats startTyping as a no-op without calling the API", async () => {
    const { adapter: local, fake } = createTestAdapter();
    await expect(local.startTyping(local.encodeThreadId(dm("instagram", "1")))).resolves.toBeUndefined();
    expect(fake.calls.filter((call) => !call.path.endsWith("/api/v1/me"))).toHaveLength(0);
  });

  it("deletes the account's own comment", async () => {
    const { adapter: local, fake } = createTestAdapter();
    fake.on("DELETE", "/api/v1/comments/reply_1", () => ({ status: 204 }));
    await local.deleteMessage(local.encodeThreadId(comment("tiktok")), "reply_1");
    const call = fake.callsTo("DELETE", "/api/v1/comments/reply_1")[0];
    expect(call?.query.get("platform")).toBe("tiktok");
    expect(call?.query.get("accountId")).toBe(ACCOUNT_ID);
  });
});

describe("fetchThread and formatting", () => {
  const { adapter } = createTestAdapter();

  it("describes a DM thread", async () => {
    const threadId = adapter.encodeThreadId(dm("whatsapp", "1"));
    expect(await adapter.fetchThread(threadId)).toEqual({
      id: threadId,
      channelId: `adeli:${ACCOUNT_ID}`,
      isDM: true,
      metadata: { platform: "whatsapp", accountId: ACCOUNT_ID, kind: "dm" },
    });
  });

  it("describes a comment thread", async () => {
    const info = await adapter.fetchThread(adapter.encodeThreadId(comment("tiktok")));
    expect(info).toMatchObject({ isDM: false, metadata: { platform: "tiktok", kind: "comment" } });
  });

  it("renders formatted content as plain text", () => {
    expect(adapter.renderFormatted({ type: "root", children: [{ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: "hi" }] }] }] })).toBe("hi");
  });
});

describe("initialize", () => {
  const chat = { getLogger: () => silentLogger } as unknown as ChatInstance;

  it("validates the API key with GET /me", async () => {
    const { adapter, fake } = createTestAdapter({ profileId: PROFILE_ID });
    await adapter.initialize(chat);
    expect(fake.callsTo("GET", "/api/v1/me")[0]?.query.get("profileId")).toBe(PROFILE_ID);
  });

  it("fails on a rejected key", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("GET", "/api/v1/me", () => ({ status: 401, body: { error: { code: "unauthorized", message: "Invalid API key" } } }));
    await expect(adapter.initialize(chat)).rejects.toThrow(/Invalid API key/);
  });

  it("tolerates an outage", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("GET", "/api/v1/me", () => ({ status: 503, body: { error: { code: "unavailable", message: "down" } } }));
    await expect(adapter.initialize(chat)).resolves.toBeUndefined();
  });

  it("uses the Chat logger unless one was configured", async () => {
    const { adapter } = createTestAdapter({ logger: undefined });
    let asked = "";
    await adapter.initialize({ getLogger: (prefix: string) => ((asked = prefix), silentLogger) } as unknown as ChatInstance);
    expect(asked).toBe("adeli");
  });
});
