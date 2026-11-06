import type { MessageCreatedAttachment } from "@adeli/sdk/helpers";
import type { Logger } from "chat";

/**
 * A credential value: a static string, or a function the adapter calls every
 * time it needs the value. Functions are never cached, so a rotated or
 * short-lived credential is picked up on the next call.
 */
export type CredentialInput = string | (() => string | Promise<string>);

/** Platforms that carry Adeli direct-message threads. */
export type AdeliDmPlatform = "instagram" | "facebook" | "whatsapp";

/** Platforms that carry Adeli comment threads. */
export type AdeliCommentPlatform = "instagram" | "tiktok";

/** Decoded Adeli thread ID for a direct-message conversation. */
export interface AdeliDmThreadId {
  kind: "dm";
  /** Adeli connected-account id (a UUID). */
  accountId: string;
  /** Platform of the conversation. Always the prefix of `conversationKey`. */
  platform: AdeliDmPlatform;
  /**
   * Adeli conversation key, `<platform>:<counterparty id>`: the person's
   * Instagram-scoped id, Facebook page-scoped id, or WhatsApp `wa_id`.
   */
  conversationKey: string;
}

/** Decoded Adeli thread ID for a root comment and its replies on one post. */
export interface AdeliCommentThreadId {
  kind: "comment";
  /** Adeli connected-account id (a UUID). */
  accountId: string;
  /** Platform of the post. */
  platform: AdeliCommentPlatform;
  /** Provider id of the post or video the comment is on. */
  mediaId: string;
  /** Provider id of the top-level comment that starts the thread. */
  rootCommentId: string;
}

/** Decoded components of an `adeli:` thread ID. */
export type AdeliThreadId = AdeliDmThreadId | AdeliCommentThreadId;

/** Configuration for the Adeli adapter. */
export interface AdeliAdapterConfig {
  /**
   * Adeli API key (`rk_live_…`), or a function returning one. A function is
   * called on every outbound API request.
   */
  apiKey: CredentialInput;
  /**
   * Signing secret of the Adeli webhook that delivers to this bot, or a
   * function returning it. A function is called on every inbound webhook.
   * Unsigned or mis-signed deliveries are always rejected.
   */
  webhookSecret: CredentialInput;
  /**
   * Adeli profile id to send with API calls. Only needed when the API key can
   * reach more than one profile.
   */
  profileId?: string;
  /** Adeli API origin. Defaults to `https://app.tryadeli.com`. */
  baseURL?: string;
  /** Bot display name. Defaults to `"adeli-bot"`. */
  userName?: string;
  /**
   * Maximum age, in seconds, of a webhook's signed timestamp. Defaults to 300.
   * Older deliveries are rejected as possible replays.
   */
  webhookToleranceSeconds?: number;
  /** `fetch` implementation for API calls. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Logger. Defaults to the `Chat` instance's logger once initialized. */
  logger?: Logger;
}

/** An attachment on an inbound direct message (the SDK's `message.created` attachment). URLs can expire. */
export type AdeliMessageAttachment = MessageCreatedAttachment;

/**
 * A direct message, normalized from the `message.created` webhook event and
 * from `GET /api/v1/messages` records into one shape.
 */
export interface AdeliRawDirectMessage {
  kind: "dm";
  /** Provider message id: an Instagram or Facebook `mid`, or a WhatsApp `wamid`. */
  id: string;
  /** Adeli's own record id, when the message came from the REST API. */
  adeliId: string | null;
  accountId: string;
  platform: AdeliDmPlatform;
  conversationKey: string;
  direction: "inbound" | "outbound";
  /** Sender. `username` is null on every DM platform today. */
  from: { id: string | null; username: string | null };
  /** Null for an attachment-only message. */
  text: string | null;
  attachments: readonly AdeliMessageAttachment[];
  replyTo: { messageId: string } | null;
  /** ISO 8601 time the message was sent. */
  createdAt: string;
  /** Webhook event id, when the message came from a webhook. */
  eventId: string | null;
}

/**
 * A comment, normalized from the `comment.created` webhook event and from
 * `GET /api/v1/comments` records into one shape.
 */
export interface AdeliRawComment {
  kind: "comment";
  /** Provider comment id. */
  id: string;
  accountId: string;
  platform: AdeliCommentPlatform;
  /** Provider id of the post or video. */
  mediaId: string;
  /** Provider id of the parent comment, or null for a top-level comment. */
  parentId: string | null;
  /** The thread's top-level comment: `parentId` for a reply, `id` otherwise. */
  rootCommentId: string;
  text: string;
  from: { id: string | null; username: string | null; displayName: string | null };
  /** True when the connected account wrote the comment. */
  isSelf: boolean;
  /** ISO 8601 time the comment was created (or received, for webhooks). */
  createdAt: string;
  /** Webhook event id, when the comment came from a webhook. */
  eventId: string | null;
}

/** The `raw` payload on every message this adapter produces. */
export type AdeliRawMessage = AdeliRawDirectMessage | AdeliRawComment;
