import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ID, createTestAdapter } from "./test-utils";
import { encodeThreadId, parseConversationKey } from "./thread-id";

const { adapter } = createTestAdapter();

describe("thread ID encoding", () => {
  it("round-trips a DM thread", () => {
    const data = { kind: "dm" as const, accountId: ACCOUNT_ID, platform: "instagram" as const, conversationKey: "instagram:17841400000000001" };
    const encoded = adapter.encodeThreadId(data);
    expect(encoded).toMatch(new RegExp(`^adeli:dm:${ACCOUNT_ID}:[A-Za-z0-9_-]+$`));
    expect(adapter.decodeThreadId(encoded)).toEqual(data);
  });

  it("round-trips Facebook and WhatsApp DM threads", () => {
    for (const conversationKey of ["facebook:2468013579", "whatsapp:15555550123"]) {
      const platform = conversationKey.split(":")[0] as "facebook" | "whatsapp";
      const data = { kind: "dm" as const, accountId: ACCOUNT_ID, platform, conversationKey };
      expect(adapter.decodeThreadId(adapter.encodeThreadId(data))).toEqual(data);
    }
  });

  it("round-trips a comment thread whose ids contain ':' and '_'", () => {
    const data = {
      kind: "comment" as const,
      accountId: ACCOUNT_ID,
      platform: "tiktok" as const,
      mediaId: "video:7300_000:1",
      rootCommentId: "cmt_1:2:3",
    };
    const encoded = adapter.encodeThreadId(data);
    expect(encoded.split(":")).toHaveLength(6);
    expect(adapter.decodeThreadId(encoded)).toEqual(data);
  });

  it("round-trips a DM whose counterparty id contains ':'", () => {
    const data = { kind: "dm" as const, accountId: ACCOUNT_ID, platform: "instagram" as const, conversationKey: "instagram:a:b:c" };
    expect(adapter.decodeThreadId(adapter.encodeThreadId(data))).toEqual(data);
  });

  it("returns the account as the channel", () => {
    const dm = adapter.encodeThreadId({ kind: "dm", accountId: ACCOUNT_ID, platform: "facebook", conversationKey: "facebook:1" });
    const comment = adapter.encodeThreadId({ kind: "comment", accountId: ACCOUNT_ID, platform: "instagram", mediaId: "m", rootCommentId: "c" });
    expect(adapter.channelIdFromThreadId(dm)).toBe(`adeli:${ACCOUNT_ID}`);
    expect(adapter.channelIdFromThreadId(comment)).toBe(`adeli:${ACCOUNT_ID}`);
  });

  it("reports DM threads", () => {
    const dm = adapter.encodeThreadId({ kind: "dm", accountId: ACCOUNT_ID, platform: "whatsapp", conversationKey: "whatsapp:1" });
    const comment = adapter.encodeThreadId({ kind: "comment", accountId: ACCOUNT_ID, platform: "instagram", mediaId: "m", rootCommentId: "c" });
    expect(adapter.isDM(dm)).toBe(true);
    expect(adapter.isDM(comment)).toBe(false);
  });

  it("throws on another adapter's prefix", () => {
    expect(() => adapter.decodeThreadId("slack:C123:1700000000.000100")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("zernio:acc:conv")).toThrow(ValidationError);
  });

  it("throws on bad segment counts and bad segments", () => {
    expect(() => adapter.decodeThreadId("adeli")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId(`adeli:dm:${ACCOUNT_ID}`)).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId(`adeli:dm:${ACCOUNT_ID}:a:b`)).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId(`adeli:comment:${ACCOUNT_ID}:instagram:bQ`)).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId(`adeli:comment:${ACCOUNT_ID}:youtube:bQ:Yw`)).toThrow(/unsupported comment platform/);
    expect(() => adapter.decodeThreadId(`adeli:dm:${ACCOUNT_ID}:not+base64`)).toThrow(/base64url/);
    expect(() => adapter.decodeThreadId(`adeli:dm::${Buffer.from("instagram:1").toString("base64url")}`)).toThrow(/accountId/);
    expect(() => adapter.decodeThreadId(`adeli:dm:${ACCOUNT_ID}:${Buffer.from("x:1").toString("base64url")}`)).toThrow(/conversationKey/);
    expect(() => adapter.decodeThreadId(`adeli:channel:${ACCOUNT_ID}`)).toThrow(/unknown thread kind/);
  });

  it("refuses to encode inconsistent data", () => {
    expect(() =>
      encodeThreadId({ kind: "dm", accountId: ACCOUNT_ID, platform: "facebook", conversationKey: "instagram:1" }),
    ).toThrow(ValidationError);
    expect(() =>
      encodeThreadId({ kind: "dm", accountId: "a:b", platform: "instagram", conversationKey: "instagram:1" }),
    ).toThrow(/accountId/);
    expect(() =>
      encodeThreadId({ kind: "comment", accountId: ACCOUNT_ID, platform: "instagram", mediaId: "", rootCommentId: "c" }),
    ).toThrow(/mediaId/);
    expect(() =>
      encodeThreadId({ kind: "comment", accountId: ACCOUNT_ID, platform: "facebook" as "instagram", mediaId: "m", rootCommentId: "c" }),
    ).toThrow(/unsupported comment platform/);
  });

  it("parses conversation keys", () => {
    expect(parseConversationKey("whatsapp:15555550123")).toEqual({ platform: "whatsapp", counterpartyId: "15555550123" });
    expect(parseConversationKey("instagram:")).toBeUndefined();
    expect(parseConversationKey(":1")).toBeUndefined();
    expect(parseConversationKey("tiktok:1")).toBeUndefined();
  });
});

describe("openDM", () => {
  it("opens an Instagram DM from <accountId>:<scoped id> without a network call", async () => {
    const { adapter: local, fake } = createTestAdapter();
    const threadId = await local.openDM(`${ACCOUNT_ID}:17841400000000009`);
    expect(local.decodeThreadId(threadId)).toEqual({
      kind: "dm",
      accountId: ACCOUNT_ID,
      platform: "instagram",
      conversationKey: "instagram:17841400000000009",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("accepts an explicit platform", async () => {
    const threadId = await adapter.openDM(`${ACCOUNT_ID}:whatsapp:15555550123`);
    expect(adapter.decodeThreadId(threadId)).toMatchObject({ platform: "whatsapp", conversationKey: "whatsapp:15555550123" });
  });

  it("rejects malformed user ids", async () => {
    await expect(adapter.openDM("17841400000000009")).rejects.toThrow(ValidationError);
    await expect(adapter.openDM(`${ACCOUNT_ID}:`)).rejects.toThrow(ValidationError);
    await expect(adapter.openDM(`${ACCOUNT_ID}:tiktok:1`)).rejects.toThrow(/not "<instagram\|facebook\|whatsapp>:<id>"/);
  });
});
