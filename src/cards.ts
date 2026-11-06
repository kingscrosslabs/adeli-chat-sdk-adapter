import { ValidationError } from "@chat-adapter/shared";
import type { ButtonElement, CardChild, CardElement, LinkButtonElement } from "chat";
import { ADAPTER_NAME } from "./thread-id";

/** Separates the action id from the value in an Instagram postback payload. */
export const POSTBACK_DELIMITER = "\n";
/** Instagram's postback payload limit. */
export const POSTBACK_PAYLOAD_MAX_LENGTH = 1000;
/** Instagram's limit on buttons in one message. */
export const MAX_INSTAGRAM_BUTTONS = 3;

/**
 * Encode a card button as an Instagram postback payload: `id`, then `\n` and
 * the value when there is one. Throws `ValidationError` past 1,000 characters
 * rather than truncating.
 */
export function encodePostbackPayload(actionId: string, value?: string): string {
  if (actionId === "") throw new ValidationError(ADAPTER_NAME, "A button needs a non-empty id");
  if (actionId.includes(POSTBACK_DELIMITER)) {
    throw new ValidationError(ADAPTER_NAME, `Button id "${actionId}" must not contain a newline`);
  }
  const payload = value === undefined || value === "" ? actionId : `${actionId}${POSTBACK_DELIMITER}${value}`;
  if (payload.length > POSTBACK_PAYLOAD_MAX_LENGTH) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Button "${actionId}" encodes to ${payload.length} characters; Instagram allows ${POSTBACK_PAYLOAD_MAX_LENGTH}`,
    );
  }
  return payload;
}

/** Decode a postback payload on its first `\n`. Values may contain newlines. */
export function decodePostbackPayload(payload: string): { actionId: string; value: string | undefined } {
  const index = payload.indexOf(POSTBACK_DELIMITER);
  if (index === -1) return { actionId: payload, value: undefined };
  return { actionId: payload.slice(0, index), value: payload.slice(index + 1) };
}

export type InstagramButton =
  | { type: "postback"; title: string; payload: string }
  | { type: "url"; title: string; url: string };

function collectButtons(children: readonly CardChild[], out: (ButtonElement | LinkButtonElement)[]): void {
  for (const child of children) {
    if (child.type === "actions") {
      for (const element of child.children) {
        if (element.type === "button" || element.type === "link-button") out.push(element);
      }
    } else if (child.type === "section") {
      collectButtons(child.children, out);
    }
  }
}

/** Every `<Button>` and `<LinkButton>` in a card, in order, including inside sections. */
export function cardButtons(card: CardElement): (ButtonElement | LinkButtonElement)[] {
  const out: (ButtonElement | LinkButtonElement)[] = [];
  collectButtons(card.children, out);
  return out;
}

/**
 * Map a card's buttons to Instagram postback and URL buttons. Throws
 * `ValidationError` for more than three, Instagram's limit.
 */
export function cardToInstagramButtons(card: CardElement): InstagramButton[] {
  const buttons = cardButtons(card);
  if (buttons.length > MAX_INSTAGRAM_BUTTONS) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Instagram messages allow at most ${MAX_INSTAGRAM_BUTTONS} buttons; this card has ${buttons.length}`,
    );
  }
  return buttons.map((button) =>
    button.type === "link-button"
      ? { type: "url", title: button.label, url: button.url }
      : { type: "postback", title: button.label, payload: encodePostbackPayload(button.id, button.value) },
  );
}

/** `label: url` lines for a card's link buttons, for platforms without buttons. */
export function linkButtonLines(card: CardElement): string[] {
  return cardButtons(card)
    .filter((button): button is LinkButtonElement => button.type === "link-button")
    .map((button) => `${button.label}: ${button.url}`);
}
