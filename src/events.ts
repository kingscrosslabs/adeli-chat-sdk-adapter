/**
 * Normalizes Adeli webhook events and REST records into the adapter's raw
 * message shapes, so webhook and history messages look the same.
 */
import type { Message as MessageRecord } from "@adeli/sdk";
import type { CommentCreatedEvent, MessageCreatedEvent } from "@adeli/sdk/helpers";
import { ValidationError } from "@chat-adapter/shared";
import { ADAPTER_NAME, parseConversationKey } from "./thread-id";
import type { AdeliCommentPlatform, AdeliRawComment, AdeliRawDirectMessage } from "./types";

/**
 * A `message.created` event, already validated by the SDK's `parseWebhookEvent`.
 * Throws `ValidationError` for an empty message id or a conversation key that
 * does not match the event's platform.
 */
export function rawFromMessageCreated(event: MessageCreatedEvent): AdeliRawDirectMessage {
  if (event.data.messageId === "") {
    throw new ValidationError(ADAPTER_NAME, "Malformed message.created event: data.messageId is empty");
  }
  const parsed = parseConversationKey(event.data.conversationKey);
  if (!parsed || parsed.platform !== event.platform) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Malformed message.created event: data.conversationKey must start with "${event.platform}:"`,
    );
  }
  return {
    kind: "dm",
    id: event.data.messageId,
    adeliId: null,
    accountId: event.accountId,
    platform: event.platform,
    conversationKey: event.data.conversationKey,
    direction: "inbound",
    from: { id: event.data.from.id, username: event.data.from.username },
    text: event.data.text,
    attachments: event.data.attachments,
    replyTo: event.data.replyTo,
    createdAt: event.createdAt,
    eventId: event.id,
  };
}

export function rawFromCommentCreated(event: CommentCreatedEvent): AdeliRawComment {
  const { data } = event;
  return {
    kind: "comment",
    id: data.commentId,
    accountId: event.accountId,
    platform: event.platform,
    mediaId: data.mediaId,
    parentId: data.parentId,
    rootCommentId: data.parentId ?? data.commentId,
    text: data.text,
    from: {
      id: data.from.id,
      username: data.from.username,
      displayName: "displayName" in data.from ? data.from.displayName : null,
    },
    isSelf: data.isSelf,
    createdAt: event.createdAt,
    eventId: event.id,
  };
}

/** A `GET /api/v1/messages` (or send-response) record in a known conversation. */
export function rawFromMessageRecord(
  record: Pick<MessageRecord, "id" | "providerId" | "accountId" | "direction" | "sender" | "body" | "occurredAt">,
  conversationKey: string,
): AdeliRawDirectMessage {
  const parsed = parseConversationKey(conversationKey);
  if (!parsed) throw new ValidationError(ADAPTER_NAME, `Unsupported conversationKey "${conversationKey}"`);
  return {
    kind: "dm",
    id: record.providerId ?? record.id,
    adeliId: record.id,
    accountId: record.accountId,
    platform: parsed.platform,
    conversationKey,
    direction: record.direction,
    from: { id: record.sender, username: null },
    text: record.body === "" ? null : record.body,
    attachments: [],
    replyTo: null,
    createdAt: record.occurredAt,
    eventId: null,
  };
}

/** The `Comment` shape returned by `GET /api/v1/comments` and `POST /api/v1/comments`. */
export interface CommentRecord {
  id: string;
  mediaId: string;
  parentId: string | null;
  authorName: string;
  authorFullName: string | null;
  authorHandle: string;
  body: string;
  isCreator: boolean;
  createdAt: string;
  authorId?: string | null;
}

export function rawFromCommentRecord(
  record: CommentRecord,
  context: { accountId: string; platform: AdeliCommentPlatform },
): AdeliRawComment {
  return {
    kind: "comment",
    id: record.id,
    accountId: context.accountId,
    platform: context.platform,
    mediaId: record.mediaId,
    parentId: record.parentId,
    rootCommentId: record.parentId ?? record.id,
    text: record.body,
    from: {
      id: record.authorId ?? null,
      username: record.authorHandle === "" ? null : record.authorHandle,
      displayName: record.authorFullName ?? (record.authorName === "" ? null : record.authorName),
    },
    isSelf: record.isCreator,
    createdAt: record.createdAt,
    eventId: null,
  };
}
