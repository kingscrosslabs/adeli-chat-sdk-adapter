import { type CommentCreatedEvent, type MessageCreatedEvent, parseWebhookEvent } from "@adeli/sdk/helpers";
import { describe, expect, it } from "vitest";
import { rawFromCommentCreated, rawFromCommentRecord, rawFromMessageCreated } from "./events";
import {
  ACCOUNT_ID,
  commentCreatedEvent,
  commentRecord,
  createTestAdapter,
  IGSID,
  messageCreatedEvent,
} from "./test-utils";
import type { AdeliRawDirectMessage } from "./types";

const { adapter } = createTestAdapter();

function dmRaw(overrides: Parameters<typeof messageCreatedEvent>[0] = {}): AdeliRawDirectMessage {
  const event = messageCreatedEvent(overrides);
  return rawFromMessageCreated(parseWebhookEvent(JSON.stringify(event)) as MessageCreatedEvent);
}

function commentRaw(overrides: Parameters<typeof commentCreatedEvent>[0] = {}) {
  return rawFromCommentCreated(commentCreatedEvent(overrides) as unknown as CommentCreatedEvent);
}

describe("parseMessage", () => {
  it("parses an Instagram DM as a mention from the scoped id", () => {
    const raw = dmRaw({ text: "Do you ship to Canada?", messageId: "mid.abc" });
    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("mid.abc");
    expect(message.text).toBe("Do you ship to Canada?");
    expect(message.author).toMatchObject({ userId: IGSID, userName: "unknown", isMe: false, isBot: false });
    expect(message.isMention).toBe(true);
    expect(message.metadata.dateSent.toISOString()).toBe("2026-11-06T10:00:00.000Z");
    expect(message.raw).toBe(raw);
    expect(adapter.decodeThreadId(message.threadId)).toEqual({
      kind: "dm",
      accountId: ACCOUNT_ID,
      platform: "instagram",
      conversationKey: `instagram:${IGSID}`,
    });
  });

  it("parses a WhatsApp DM", () => {
    const message = adapter.parseMessage(dmRaw({ platform: "whatsapp", counterpartyId: "15555550123" }));
    expect(message.author.userId).toBe("15555550123");
    expect(adapter.decodeThreadId(message.threadId)).toMatchObject({ platform: "whatsapp", conversationKey: "whatsapp:15555550123" });
  });

  it("parses an attachment-only DM", () => {
    const message = adapter.parseMessage(
      dmRaw({
        text: null,
        attachments: [
          { type: "image", url: "https://cdn.example.com/a.jpg" },
          { type: "audio", url: null },
          { type: "file", url: "https://cdn.example.com/s.pdf" },
        ],
      }),
    );
    expect(message.text).toBe("");
    expect(message.attachments).toEqual([
      { type: "image", url: "https://cdn.example.com/a.jpg" },
      { type: "audio" },
      { type: "file", url: "https://cdn.example.com/s.pdf" },
    ]);
  });

  it("parses a top-level comment as a mention", () => {
    const message = adapter.parseMessage(commentRaw({ commentId: "c1", text: "How much?" }));
    expect(message.id).toBe("c1");
    expect(message.text).toBe("How much?");
    expect(message.author).toMatchObject({ userId: IGSID, userName: "jane.doe", fullName: "jane.doe", isMe: false });
    expect(message.isMention).toBe(true);
    expect(adapter.decodeThreadId(message.threadId)).toMatchObject({ kind: "comment", rootCommentId: "c1" });
  });

  it("leaves isMention unset on a reply so the text fallback applies", () => {
    const message = adapter.parseMessage(commentRaw({ commentId: "c2", parentId: "c1" }));
    expect(message.isMention).toBeUndefined();
    expect(adapter.decodeThreadId(message.threadId)).toMatchObject({ kind: "comment", rootCommentId: "c1" });
  });

  it("marks the account's own comment as me", () => {
    const message = adapter.parseMessage(commentRaw({ isSelf: true }));
    expect(message.author.isMe).toBe(true);
    expect(message.author.isBot).toBe("unknown");
  });

  it("parses a TikTok comment with a display name", () => {
    const message = adapter.parseMessage(commentRaw({ platform: "tiktok", username: "tiktoker" }));
    expect(message.author).toMatchObject({ userId: "tt_user_1", userName: "tiktoker", fullName: "Tik Toker" });
    expect(adapter.decodeThreadId(message.threadId)).toMatchObject({ platform: "tiktok" });
  });

  it("falls back to unknown for a comment author with no id or username", () => {
    const raw = commentRaw({ username: null });
    raw.from.id = null;
    const message = adapter.parseMessage(raw);
    expect(message.author.userId).toBe("unknown");
    expect(message.author.userName).toBe("unknown");
  });

  it("parses REST comment records like webhook comments", () => {
    const raw = rawFromCommentRecord(commentRecord({ id: "c9", parentId: "c1", isCreator: true, authorFullName: "Shop" }), {
      accountId: ACCOUNT_ID,
      platform: "instagram",
    });
    const message = adapter.parseMessage(raw);
    expect(message.author).toMatchObject({ isMe: true, fullName: "Shop" });
    expect(adapter.decodeThreadId(message.threadId)).toMatchObject({ rootCommentId: "c1" });
  });
});
