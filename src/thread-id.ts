import { ValidationError } from "@chat-adapter/shared";
import type {
  AdeliCommentPlatform,
  AdeliDmPlatform,
  AdeliThreadId,
} from "./types";

export const ADAPTER_NAME = "adeli";

const DM_PLATFORMS: readonly AdeliDmPlatform[] = ["instagram", "facebook", "whatsapp"];
const COMMENT_PLATFORMS: readonly AdeliCommentPlatform[] = ["instagram", "tiktok"];
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function isDmPlatform(value: unknown): value is AdeliDmPlatform {
  return typeof value === "string" && (DM_PLATFORMS as readonly string[]).includes(value);
}

export function isCommentPlatform(value: unknown): value is AdeliCommentPlatform {
  return typeof value === "string" && (COMMENT_PLATFORMS as readonly string[]).includes(value);
}

function invalid(threadId: string, reason: string): never {
  throw new ValidationError(ADAPTER_NAME, `Invalid Adeli thread ID "${threadId}": ${reason}`);
}

function encodeSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeSegment(threadId: string, segment: string | undefined, name: string): string {
  if (!segment || !BASE64URL.test(segment)) invalid(threadId, `${name} is not base64url`);
  const value = Buffer.from(segment, "base64url").toString("utf8");
  // Reject non-canonical encodings so every thread has exactly one ID.
  if (value === "" || encodeSegment(value) !== segment) invalid(threadId, `${name} is not base64url`);
  return value;
}

function checkAccountId(accountId: string, where: string): void {
  if (!accountId || accountId.includes(":")) {
    throw new ValidationError(ADAPTER_NAME, `${where}: accountId must be a non-empty id without ":"`);
  }
}

/**
 * Split a conversation key into its platform and counterparty id, or return
 * undefined when it is not `<instagram|facebook|whatsapp>:<id>`.
 */
export function parseConversationKey(
  conversationKey: string,
): { platform: AdeliDmPlatform; counterpartyId: string } | undefined {
  const separator = conversationKey.indexOf(":");
  if (separator <= 0) return undefined;
  const platform = conversationKey.slice(0, separator);
  const counterpartyId = conversationKey.slice(separator + 1);
  if (!isDmPlatform(platform) || counterpartyId === "") return undefined;
  return { platform, counterpartyId };
}

/**
 * Encode a thread:
 * - `adeli:dm:<accountId>:<base64url(conversationKey)>`
 * - `adeli:comment:<accountId>:<platform>:<base64url(mediaId)>:<base64url(rootCommentId)>`
 */
export function encodeThreadId(data: AdeliThreadId): string {
  checkAccountId(data.accountId, "encodeThreadId");
  if (data.kind === "dm") {
    const parsed = parseConversationKey(data.conversationKey);
    if (!parsed || parsed.platform !== data.platform) {
      throw new ValidationError(
        ADAPTER_NAME,
        `encodeThreadId: conversationKey "${data.conversationKey}" must start with "${data.platform}:"`,
      );
    }
    return `${ADAPTER_NAME}:dm:${data.accountId}:${encodeSegment(data.conversationKey)}`;
  }
  if (!isCommentPlatform(data.platform)) {
    throw new ValidationError(ADAPTER_NAME, `encodeThreadId: unsupported comment platform "${String(data.platform)}"`);
  }
  if (!data.mediaId || !data.rootCommentId) {
    throw new ValidationError(ADAPTER_NAME, "encodeThreadId: mediaId and rootCommentId are required");
  }
  return `${ADAPTER_NAME}:comment:${data.accountId}:${data.platform}:${encodeSegment(data.mediaId)}:${encodeSegment(data.rootCommentId)}`;
}

/** Decode an `adeli:` thread ID. Throws `ValidationError` for anything else. */
export function decodeThreadId(threadId: string): AdeliThreadId {
  const parts = threadId.split(":");
  if (parts[0] !== ADAPTER_NAME) invalid(threadId, `expected the "${ADAPTER_NAME}:" prefix`);
  const kind = parts[1];
  const accountId = parts[2] ?? "";
  if (kind === "dm") {
    if (parts.length !== 4) invalid(threadId, "a DM thread has 4 segments");
    if (!accountId) invalid(threadId, "accountId is empty");
    const conversationKey = decodeSegment(threadId, parts[3], "conversationKey");
    const parsed = parseConversationKey(conversationKey);
    if (!parsed) invalid(threadId, `unsupported conversationKey "${conversationKey}"`);
    return { kind: "dm", accountId, platform: parsed.platform, conversationKey };
  }
  if (kind === "comment") {
    if (parts.length !== 6) invalid(threadId, "a comment thread has 6 segments");
    if (!accountId) invalid(threadId, "accountId is empty");
    const platform = parts[3];
    if (!isCommentPlatform(platform)) invalid(threadId, `unsupported comment platform "${platform}"`);
    return {
      kind: "comment",
      accountId,
      platform,
      mediaId: decodeSegment(threadId, parts[4], "mediaId"),
      rootCommentId: decodeSegment(threadId, parts[5], "rootCommentId"),
    };
  }
  return invalid(threadId, `unknown thread kind "${kind ?? ""}"`);
}

/** A channel is one connected account: `adeli:<accountId>`. */
export function channelIdFromThreadId(threadId: string): string {
  return `${ADAPTER_NAME}:${decodeThreadId(threadId).accountId}`;
}
