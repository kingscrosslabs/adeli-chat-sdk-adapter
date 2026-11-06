import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  commentCreatedEvent,
  commentRecord,
  createAdeliTestContext,
  IGSID,
  messageCreatedEvent,
  PROFILE_ID,
  postbackEvent,
  sentMessage,
} from "./test-utils";

describe("Adeli adapter integration", () => {
  it("fires onNewMention for a DM and replies in the same conversation", async () => {
    const ctx = createAdeliTestContext({
      onMention: async (thread) => {
        await thread.post("Thanks for reaching out!");
      },
    });
    ctx.fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "x") }));

    const response = await ctx.sendWebhook(messageCreatedEvent({ text: "Do you have this in blue?" }));
    expect(response.status).toBe(200);
    expect(ctx.captured.mentions).toHaveLength(1);
    expect(ctx.captured.mentions[0]?.text).toBe("Do you have this in blue?");
    expect(ctx.fake.callsTo("POST", "/api/v1/messages/instagram")[0]?.body).toEqual({
      accountId: ACCOUNT_ID,
      recipient: { id: IGSID },
      text: "Thanks for reaching out!",
    });
  });

  it("routes a follow-up in a subscribed DM to onSubscribedMessage", async () => {
    const ctx = createAdeliTestContext({
      onMention: async (thread) => {
        await thread.subscribe();
      },
    });
    await ctx.sendWebhook(messageCreatedEvent({ platform: "facebook", counterpartyId: "2468", text: "hello" }));
    await ctx.sendWebhook(messageCreatedEvent({ platform: "facebook", counterpartyId: "2468", text: "are you there?" }));
    expect(ctx.captured.mentions).toHaveLength(1);
    expect(ctx.captured.followUps.map((m) => m.text)).toEqual(["are you there?"]);
  });

  it("deduplicates a redelivered event", async () => {
    const ctx = createAdeliTestContext({});
    const event = messageCreatedEvent({ messageId: "mid.same" });
    await ctx.sendWebhook(event);
    await ctx.sendWebhook(event);
    expect(ctx.captured.mentions).toHaveLength(1);
  });

  it("fires onAction for an Instagram postback with the button's id and value", async () => {
    const ctx = createAdeliTestContext({
      onAction: async (event) => {
        await event.thread?.post(`You chose ${event.value}`);
      },
    });
    ctx.fake.on("POST", "/api/v1/messages/instagram", () => ({ status: 201, body: sentMessage("instagram", IGSID, "x") }));
    await ctx.sendWebhook(postbackEvent("size\nmedium"));
    expect(ctx.captured.actions).toHaveLength(1);
    expect(ctx.captured.actions[0]).toMatchObject({ actionId: "size", value: "medium", user: { userId: IGSID } });
    expect(ctx.fake.callsTo("POST", "/api/v1/messages/instagram")[0]?.body).toMatchObject({ text: "You chose medium" });
  });

  it("ignores the account's own comment", async () => {
    const ctx = createAdeliTestContext({});
    await ctx.sendWebhook(commentCreatedEvent({ isSelf: true, text: "Thanks everyone!" }));
    expect(ctx.captured.mentions).toHaveLength(0);
    expect(ctx.captured.followUps).toHaveLength(0);
  });

  it("replies to a TikTok comment on the comments endpoint with the video id", async () => {
    const ctx = createAdeliTestContext({
      onMention: async (thread) => {
        await thread.subscribe();
        await thread.post({ markdown: "Glad you **like** it!" });
      },
    });
    ctx.fake.on("POST", "/api/v1/comments", () => ({
      status: 201,
      body: { platform: "tiktok", accountId: ACCOUNT_ID, profileId: PROFILE_ID, comment: commentRecord({ id: "reply_1", parentId: "c_root", isCreator: true }) },
    }));
    await ctx.sendWebhook(commentCreatedEvent({ platform: "tiktok", commentId: "c_root", mediaId: "video_9" }));
    expect(ctx.fake.callsTo("POST", "/api/v1/comments")[0]?.body).toEqual({
      platform: "tiktok",
      accountId: ACCOUNT_ID,
      parentId: "c_root",
      postId: "video_9",
      message: "Glad you like it!",
    });

    // The bot's own reply comes back as a comment.created: it is not a follow-up.
    await ctx.sendWebhook(commentCreatedEvent({ platform: "tiktok", commentId: "reply_1", parentId: "c_root", mediaId: "video_9" }));
    // A customer's reply is.
    await ctx.sendWebhook(commentCreatedEvent({ platform: "tiktok", commentId: "c_3", parentId: "c_root", mediaId: "video_9", text: "when?" }));
    expect(ctx.captured.followUps.map((m) => m.text)).toEqual(["when?"]);
  });

  it("validates the key once on first webhook", async () => {
    const ctx = createAdeliTestContext({});
    await ctx.sendWebhook(messageCreatedEvent());
    await ctx.sendWebhook(messageCreatedEvent());
    expect(ctx.fake.callsTo("GET", "/api/v1/me")).toHaveLength(1);
  });
});
