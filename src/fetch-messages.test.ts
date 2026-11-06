import { describe, expect, it } from "vitest";
import { ACCOUNT_ID, commentRecord, createTestAdapter, IGSID, PROFILE_ID } from "./test-utils";

function record(index: number, direction: "inbound" | "outbound" = "inbound") {
  return {
    id: `msg_${index}`,
    providerId: `mid.${index}`,
    platform: "instagram",
    accountId: ACCOUNT_ID,
    profileId: PROFILE_ID,
    direction,
    type: "text",
    recipient: direction === "inbound" ? "17841499999999999" : IGSID,
    sender: direction === "inbound" ? IGSID : "17841499999999999",
    body: `message ${index}`,
    status: "received",
    occurredAt: new Date(Date.UTC(2026, 10, 6, 10, index)).toISOString(),
    createdAt: new Date(Date.UTC(2026, 10, 6, 10, index)).toISOString(),
    conversationKey: `instagram:${IGSID}`,
  };
}

const dmThread = { kind: "dm", accountId: ACCOUNT_ID, platform: "instagram", conversationKey: `instagram:${IGSID}` } as const;

describe("fetchMessages for a DM", () => {
  it("lists one conversation with cursor and limit, oldest first", async () => {
    const { adapter, fake } = createTestAdapter({ profileId: PROFILE_ID });
    fake.on("GET", "/api/v1/messages", () => ({
      status: 200,
      body: { status: "complete", messages: [record(1), record(2, "outbound")], errors: [], nextCursor: "older_1" },
    }));
    const result = await adapter.fetchMessages(adapter.encodeThreadId(dmThread), { cursor: "c0", limit: 2 });
    const query = fake.callsTo("GET", "/api/v1/messages")[0]?.query;
    expect(Object.fromEntries(query ?? [])).toEqual({
      accountId: ACCOUNT_ID,
      conversationKey: `instagram:${IGSID}`,
      profileId: PROFILE_ID,
      cursor: "c0",
      limit: "2",
    });
    expect(result.nextCursor).toBe("older_1");
    expect(result.messages.map((m) => m.id)).toEqual(["mid.1", "mid.2"]);
    expect(result.messages[0]?.author).toMatchObject({ userId: IGSID, isMe: false });
    expect(result.messages[1]?.author.isMe).toBe(true);
    expect(result.messages[1]?.isMention).toBeUndefined();
  });

  it("defaults and clamps the limit, and omits a null cursor", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("GET", "/api/v1/messages", () => ({ status: 200, body: { status: "complete", messages: [], errors: [], nextCursor: null } }));
    const threadId = adapter.encodeThreadId(dmThread);
    const first = await adapter.fetchMessages(threadId);
    await adapter.fetchMessages(threadId, { limit: 500 });
    await adapter.fetchMessages(threadId, { limit: 0 });
    const limits = fake.callsTo("GET", "/api/v1/messages").map((call) => call.query.get("limit"));
    expect(limits).toEqual(["50", "100", "1"]);
    expect(first.nextCursor).toBeUndefined();
  });

  it("drops records from another conversation", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("GET", "/api/v1/messages", () => ({
      status: 200,
      body: { status: "complete", messages: [record(1), { ...record(2), conversationKey: "instagram:other" }], errors: [] },
    }));
    const result = await adapter.fetchMessages(adapter.encodeThreadId(dmThread));
    expect(result.messages).toHaveLength(1);
  });

  it("reads forward by paging back through the whole conversation", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("GET", "/api/v1/messages", (call) =>
      call.query.get("cursor") === "older"
        ? { status: 200, body: { status: "complete", messages: [record(1), record(2)], errors: [], nextCursor: null } }
        : { status: 200, body: { status: "complete", messages: [record(3), record(4)], errors: [], nextCursor: "older" } },
    );
    const result = await adapter.fetchMessages(adapter.encodeThreadId(dmThread), { direction: "forward" });
    expect(result.messages.map((m) => m.id)).toEqual(["mid.1", "mid.2", "mid.3", "mid.4"]);
    expect(result.nextCursor).toBeUndefined();
  });
});

describe("fetchMessages for a comment thread", () => {
  const thread = { kind: "comment", accountId: ACCOUNT_ID, platform: "tiktok", mediaId: "video_1", rootCommentId: "root" } as const;

  it("returns the root and its replies, deduplicated, oldest first", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("GET", "/api/v1/comments", () => ({
      status: 200,
      body: {
        platform: "tiktok",
        accountId: ACCOUNT_ID,
        profileId: PROFILE_ID,
        postId: "video_1",
        posts: [],
        comments: [
          commentRecord({ id: "reply_2", parentId: "root", createdAt: "2026-11-06T10:02:00.000Z", isCreator: true }),
          commentRecord({ id: "root", createdAt: "2026-11-06T10:00:00.000Z" }),
          commentRecord({ id: "other", createdAt: "2026-11-06T10:01:00.000Z" }),
          commentRecord({ id: "reply_1", parentId: "root", createdAt: "2026-11-06T10:01:00.000Z" }),
          commentRecord({ id: "reply_1", parentId: "root", createdAt: "2026-11-06T10:01:00.000Z" }),
        ],
        nextCursor: "page_2",
        complete: false,
        syncedAt: null,
      },
    }));
    const threadId = adapter.encodeThreadId(thread);
    const result = await adapter.fetchMessages(threadId, { cursor: "page_1" });
    const query = fake.callsTo("GET", "/api/v1/comments")[0]?.query;
    expect(query?.get("platform")).toBe("tiktok");
    expect(query?.get("postId")).toBe("video_1");
    expect(query?.get("cursor")).toBe("page_1");
    expect(result.messages.map((m) => m.id)).toEqual(["root", "reply_1", "reply_2"]);
    expect(result.messages[2]?.author.isMe).toBe(true);
    expect(result.nextCursor).toBe("page_2");

    expect((await adapter.fetchMessages(threadId, { limit: 2 })).messages.map((m) => m.id)).toEqual(["reply_1", "reply_2"]);
    expect((await adapter.fetchMessages(threadId, { limit: 2, direction: "forward" })).messages.map((m) => m.id)).toEqual(["root", "reply_1"]);
  });

  it("has no cursor when the API returns none", async () => {
    const { adapter, fake } = createTestAdapter();
    fake.on("GET", "/api/v1/comments", () => ({
      status: 200,
      body: { platform: "instagram", accountId: ACCOUNT_ID, profileId: PROFILE_ID, postId: "m", posts: [], comments: [], nextCursor: null, complete: true, syncedAt: null },
    }));
    const result = await adapter.fetchMessages(adapter.encodeThreadId({ ...thread, platform: "instagram" }));
    expect(result).toEqual({ messages: [] });
  });
});
