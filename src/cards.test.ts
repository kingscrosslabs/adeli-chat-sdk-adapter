import { ValidationError } from "@chat-adapter/shared";
import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import {
  cardButtons,
  cardToInstagramButtons,
  decodePostbackPayload,
  encodePostbackPayload,
  linkButtonLines,
  POSTBACK_PAYLOAD_MAX_LENGTH,
} from "./cards";

describe("postback payload encoding", () => {
  it("round-trips an id and a value", () => {
    const payload = encodePostbackPayload("approve", "order-42");
    expect(payload).toBe("approve\norder-42");
    expect(decodePostbackPayload(payload)).toEqual({ actionId: "approve", value: "order-42" });
  });

  it("encodes an undefined or empty value as the bare id", () => {
    expect(encodePostbackPayload("help")).toBe("help");
    expect(encodePostbackPayload("help", "")).toBe("help");
    expect(decodePostbackPayload("help")).toEqual({ actionId: "help", value: undefined });
  });

  it("splits on the first newline only", () => {
    expect(decodePostbackPayload("note\nline 1\nline 2")).toEqual({ actionId: "note", value: "line 1\nline 2" });
  });

  it("fits Chat SDK's 21-character callback token", () => {
    const token = "__cb:0123456789abcdef";
    expect(decodePostbackPayload(encodePostbackPayload("buy", token))).toEqual({ actionId: "buy", value: token });
  });

  it("throws ValidationError past 1,000 characters", () => {
    const value = "x".repeat(POSTBACK_PAYLOAD_MAX_LENGTH);
    expect(() => encodePostbackPayload("id", value)).toThrow(ValidationError);
    expect(() => encodePostbackPayload("id", "x".repeat(POSTBACK_PAYLOAD_MAX_LENGTH - 3))).not.toThrow();
  });

  it("rejects an empty id or an id with a newline", () => {
    expect(() => encodePostbackPayload("")).toThrow(ValidationError);
    expect(() => encodePostbackPayload("a\nb")).toThrow(ValidationError);
  });
});

const card = (children: CardElement["children"]): CardElement => ({ type: "card", title: "Order", children });

describe("card buttons", () => {
  it("maps buttons and link buttons, including inside sections", () => {
    const element = card([
      { type: "text", content: "Ready?" },
      { type: "actions", children: [{ type: "button", id: "yes", label: "Yes", value: "1" }] },
      {
        type: "section",
        children: [{ type: "actions", children: [{ type: "link-button", label: "Track", url: "https://example.com/t" }] }],
      },
    ]);
    expect(cardButtons(element)).toHaveLength(2);
    expect(cardToInstagramButtons(element)).toEqual([
      { type: "postback", title: "Yes", payload: "yes\n1" },
      { type: "url", title: "Track", url: "https://example.com/t" },
    ]);
    expect(linkButtonLines(element)).toEqual(["Track: https://example.com/t"]);
  });

  it("ignores selects", () => {
    const element = card([
      { type: "actions", children: [{ type: "select", id: "s", label: "Pick", options: [] } as never] },
    ]);
    expect(cardToInstagramButtons(element)).toEqual([]);
  });

  it("throws ValidationError for more than three buttons", () => {
    const buttons = ["a", "b", "c", "d"].map((id) => ({ type: "button" as const, id, label: id }));
    expect(() => cardToInstagramButtons(card([{ type: "actions", children: buttons }]))).toThrow(/at most 3 buttons/);
  });
});
