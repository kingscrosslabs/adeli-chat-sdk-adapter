import type { MessagesQuery } from "@adeli/sdk";
import {
  type CommentCreatedEvent,
  type MessageCreatedEvent,
  type MessagePostbackEvent,
  parseWebhookEvent,
  verifyWebhookSignature,
  type WebhookEvent,
} from "@adeli/sdk/helpers";
import {
  AuthenticationError,
  extractCard,
  extractFiles,
  extractPostableAttachments,
  ValidationError,
} from "@chat-adapter/shared";
import {
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type Author,
  type ChatInstance,
  ConsoleLogger,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type Logger,
  Message,
  NotImplementedError,
  type RawMessage,
  type StreamChunk,
  type StreamOptions,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";
import { decodePostbackPayload, cardToInstagramButtons, type InstagramButton } from "./cards";
import { AdeliClient, resolveCredential } from "./client";
import {
  type CommentRecord,
  rawFromCommentCreated,
  rawFromCommentRecord,
  rawFromMessageCreated,
  rawFromMessageRecord,
} from "./events";
import { AdeliFormatConverter } from "./format-converter";
import {
  ADAPTER_NAME,
  channelIdFromThreadId,
  decodeThreadId,
  encodeThreadId,
  parseConversationKey,
} from "./thread-id";
import type {
  AdeliAdapterConfig,
  AdeliCommentThreadId,
  AdeliDmThreadId,
  AdeliRawComment,
  AdeliRawDirectMessage,
  AdeliRawMessage,
  AdeliThreadId,
} from "./types";

const SIGNATURE_HEADER = "adeli-signature";
const DEFAULT_FETCH_LIMIT = 50;
const MAX_FETCH_LIMIT = 100;
/** Upper bound for `direction: "forward"` reads, which page through the whole conversation. */
const MAX_FORWARD_MESSAGES = 1000;
/** How long a sent message id is remembered, to recognize it if it comes back. */
const SENT_ID_TTL_MS = 24 * 60 * 60 * 1000;

/** Chat SDK adapter for Adeli: DMs and comments across connected social accounts. */
export class AdeliAdapter implements Adapter<AdeliThreadId, AdeliRawMessage> {
  readonly name = ADAPTER_NAME;
  readonly userName: string;
  /** Adeli stores history server-side; `fetchMessages` reads it. */
  readonly persistThreadHistory = false;

  private chat: ChatInstance | null = null;
  private logger: Logger;
  private readonly hasCustomLogger: boolean;
  private readonly config: AdeliAdapterConfig;
  private readonly client: AdeliClient;
  private readonly converter = new AdeliFormatConverter();

  constructor(config: AdeliAdapterConfig) {
    this.config = config;
    this.userName = config.userName ?? "adeli-bot";
    this.hasCustomLogger = config.logger !== undefined;
    this.logger = config.logger ?? new ConsoleLogger("info", ADAPTER_NAME);
    this.client = new AdeliClient({
      apiKey: config.apiKey,
      ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
      ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    });
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    if (!this.hasCustomLogger) this.logger = chat.getLogger(ADAPTER_NAME);
    try {
      const profileId = this.config.profileId;
      await this.client.call({ action: "validate the API key" }, (sdk) =>
        sdk.getMe(profileId === undefined ? {} : { query: { profileId } }),
      );
    } catch (error) {
      // A rejected key will never work, so fail loudly. Anything else (a
      // network blip) must not wedge the Chat instance, which caches init.
      if (error instanceof AuthenticationError) throw error;
      this.logger.warn("Could not reach Adeli to validate the API key", { error });
    }
  }

  // ---------------------------------------------------------------------------
  // Thread IDs
  // ---------------------------------------------------------------------------

  encodeThreadId(platformData: AdeliThreadId): string {
    return encodeThreadId(platformData);
  }

  decodeThreadId(threadId: string): AdeliThreadId {
    return decodeThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return channelIdFromThreadId(threadId);
  }

  isDM(threadId: string): boolean {
    return decodeThreadId(threadId).kind === "dm";
  }

  /** Locks and dedupe are scoped to the configured profile, when there is one. */
  getConcurrencyScope(): string | undefined {
    return this.config.profileId === undefined ? undefined : `profile:${this.config.profileId}`;
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const header = request.headers.get(SIGNATURE_HEADER);
    if (!header) return new Response("Missing Adeli-Signature", { status: 401 });

    const body = new Uint8Array(await request.arrayBuffer());
    let secret: string;
    try {
      secret = await resolveCredential(this.config.webhookSecret, "webhookSecret");
    } catch (error) {
      this.logger.error("Could not resolve the Adeli webhook secret", { error });
      return new Response("Webhook secret unavailable", { status: 500 });
    }
    const verified = verifyWebhookSignature({
      payload: body,
      header,
      secret,
      ...(this.config.webhookToleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: this.config.webhookToleranceSeconds }),
    });
    if (!verified) {
      this.logger.warn("Rejected an Adeli webhook with an invalid or expired signature");
      return new Response("Invalid signature", { status: 401 });
    }

    let event: WebhookEvent;
    try {
      event = parseWebhookEvent(body);
    } catch (error) {
      this.logger.warn("Rejected a malformed Adeli webhook", { error });
      return new Response("Malformed event", { status: 400 });
    }
    if (event.test) return new Response("OK", { status: 200 });
    if (!this.chat) return new Response("Adapter not initialized", { status: 500 });

    try {
      switch (event.type) {
        case "message.created":
          this.dispatchMessageCreated(event, options);
          break;
        case "comment.created":
          this.dispatchCommentCreated(event, options);
          break;
        case "message.postback":
          this.dispatchPostback(event, options);
          break;
        default:
          this.logger.debug("Ignoring an Adeli event type this adapter does not handle", { type: event.eventType });
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        this.logger.warn("Rejected a malformed Adeli webhook", { error });
        return new Response("Malformed event", { status: 400 });
      }
      throw error;
    }
    return new Response("OK", { status: 200 });
  }

  private dispatchMessageCreated(event: MessageCreatedEvent, options?: WebhookOptions): void {
    // The contract never emits echoes; drop one if it ever does.
    if (event.data.isEcho) return;
    const raw = rawFromMessageCreated(event);
    const threadId = this.threadIdFor(raw);
    void this.chat?.processMessage(this, threadId, () => this.inboundMessage(raw), options);
  }

  private dispatchCommentCreated(event: CommentCreatedEvent, options?: WebhookOptions): void {
    const raw = rawFromCommentCreated(event);
    const threadId = this.threadIdFor(raw);
    void this.chat?.processMessage(this, threadId, () => this.inboundMessage(raw), options);
  }

  private dispatchPostback(event: MessagePostbackEvent, options?: WebhookOptions): void {
    const { actionId, value } = decodePostbackPayload(event.data.payload);
    const threadId = encodeThreadId({
      kind: "dm",
      accountId: event.accountId,
      platform: "instagram",
      conversationKey: `instagram:${event.data.senderId}`,
    });
    const user: Author = {
      userId: event.data.senderId,
      userName: "unknown",
      fullName: "",
      isBot: false,
      isMe: false,
    };
    void this.chat?.processAction(
      {
        adapter: this,
        actionId,
        ...(value === undefined ? {} : { value }),
        messageId: event.data.messageId ?? event.id,
        threadId,
        user,
        raw: event,
      },
      options,
    );
  }

  /** Parse a webhook message and mark it as ours if this runtime sent it. */
  private async inboundMessage(raw: AdeliRawMessage): Promise<Message<AdeliRawMessage>> {
    const sentByUs = await this.wasSentByUs(raw.accountId, raw.id);
    return this.toMessage(raw, sentByUs);
  }

  private sentKey(accountId: string, messageId: string): string {
    return `adeli:sent:${accountId}:${messageId}`;
  }

  private async rememberSent(accountId: string, messageId: string): Promise<void> {
    if (!this.chat) return;
    try {
      await this.chat.getState().set(this.sentKey(accountId, messageId), true, SENT_ID_TTL_MS);
    } catch (error) {
      this.logger.warn("Could not record a sent Adeli message id", { error });
    }
  }

  private async wasSentByUs(accountId: string, messageId: string): Promise<boolean> {
    if (!this.chat) return false;
    try {
      return (await this.chat.getState().get(this.sentKey(accountId, messageId))) === true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  private threadIdFor(raw: AdeliRawMessage): string {
    return raw.kind === "dm"
      ? encodeThreadId({ kind: "dm", accountId: raw.accountId, platform: raw.platform, conversationKey: raw.conversationKey })
      : encodeThreadId({
          kind: "comment",
          accountId: raw.accountId,
          platform: raw.platform,
          mediaId: raw.mediaId,
          rootCommentId: raw.rootCommentId,
        });
  }

  parseMessage(raw: AdeliRawMessage): Message<AdeliRawMessage> {
    return this.toMessage(raw, false);
  }

  private toMessage(raw: AdeliRawMessage, sentByUs: boolean): Message<AdeliRawMessage> {
    return raw.kind === "dm" ? this.dmToMessage(raw, sentByUs) : this.commentToMessage(raw, sentByUs);
  }

  private dmToMessage(raw: AdeliRawDirectMessage, sentByUs: boolean): Message<AdeliRawMessage> {
    // The connected account is the bot's identity, so its own sends are "me".
    const isMe = sentByUs || raw.direction === "outbound";
    const attachments: Attachment[] = raw.attachments.map((attachment) =>
      attachment.url === null ? { type: attachment.type } : { type: attachment.type, url: attachment.url },
    );
    return new Message<AdeliRawMessage>({
      id: raw.id,
      threadId: this.threadIdFor(raw),
      ...this.converter.parseIncoming(raw.text ?? ""),
      raw,
      author: {
        userId: raw.from.id ?? "unknown",
        userName: raw.from.username ?? "unknown",
        fullName: raw.from.username ?? "",
        isBot: sentByUs ? true : isMe ? "unknown" : false,
        isMe,
      },
      metadata: { dateSent: new Date(raw.createdAt), edited: false },
      attachments,
      // Every inbound DM is addressed to the account, and so to the bot.
      ...(isMe ? {} : { isMention: true }),
    });
  }

  private commentToMessage(raw: AdeliRawComment, sentByUs: boolean): Message<AdeliRawMessage> {
    const isMe = sentByUs || raw.isSelf;
    return new Message<AdeliRawMessage>({
      id: raw.id,
      threadId: this.threadIdFor(raw),
      ...this.converter.parseIncoming(raw.text),
      raw,
      author: {
        userId: raw.from.id ?? "unknown",
        userName: raw.from.username ?? "unknown",
        fullName: raw.from.displayName ?? raw.from.username ?? "",
        isBot: sentByUs ? true : isMe ? "unknown" : false,
        isMe,
      },
      metadata: { dateSent: new Date(raw.createdAt), edited: false },
      attachments: [],
      // A top-level comment on the account's post is addressed to the bot. A
      // reply is left unset so the SDK's @-mention text fallback applies.
      ...(raw.parentId === null ? { isMention: true } : {}),
    });
  }

  async postMessage(threadId: string, message: AdapterPostableMessage): Promise<RawMessage<AdeliRawMessage>> {
    const thread = decodeThreadId(threadId);
    if (extractFiles(message).length > 0 || extractPostableAttachments(message).length > 0) {
      throw new ValidationError(ADAPTER_NAME, "File and media uploads are not supported by the Adeli adapter");
    }
    const sent = thread.kind === "dm" ? await this.sendDm(thread, message) : await this.sendComment(thread, message);
    await this.rememberSent(thread.accountId, sent.id);
    return { id: sent.id, threadId, raw: sent };
  }

  private profileField(): { profileId?: string } {
    return this.config.profileId === undefined ? {} : { profileId: this.config.profileId };
  }

  private requireText(text: string): string {
    if (text.trim() === "") throw new ValidationError(ADAPTER_NAME, "Cannot send an empty message");
    return text;
  }

  private async sendDm(thread: AdeliDmThreadId, message: AdapterPostableMessage): Promise<AdeliRawDirectMessage> {
    const parsed = parseConversationKey(thread.conversationKey);
    if (!parsed) throw new ValidationError(ADAPTER_NAME, `Unsupported conversationKey "${thread.conversationKey}"`);
    const recipient = parsed.counterpartyId;

    if (thread.platform === "instagram") {
      const card = extractCard(message);
      let text: string;
      let buttons: InstagramButton[] = [];
      if (card) {
        buttons = cardToInstagramButtons(card);
        text = buttons.length > 0 ? this.converter.cardBodyText(card) : this.converter.renderPostable(message);
      } else {
        text = this.converter.renderPostable(message);
      }
      const record = await this.client.call(
        { action: "send an Instagram message", resourceType: "conversation", resourceId: thread.conversationKey },
        (sdk) =>
          sdk.messages.sendInstagramMessage({
            body: {
              accountId: thread.accountId,
              ...this.profileField(),
              recipient: { id: recipient },
              text: this.requireText(text),
              ...(buttons.length > 0 ? { buttons } : {}),
            },
          }),
      );
      return rawFromMessageRecord(record, thread.conversationKey);
    }

    const text = this.requireText(this.converter.renderPostable(message));
    if (thread.platform === "facebook") {
      const record = await this.client.call(
        { action: "send a Facebook message", resourceType: "conversation", resourceId: thread.conversationKey },
        (sdk) =>
          sdk.messages.sendMessage({
            body: { platform: "facebook", accountId: thread.accountId, ...this.profileField(), recipient, text },
          }),
      );
      return rawFromMessageRecord(record, thread.conversationKey);
    }

    const record = await this.client.call(
      { action: "send a WhatsApp message", resourceType: "conversation", resourceId: thread.conversationKey },
      (sdk) =>
        sdk.messages.sendMessage({
          body: {
            platform: "whatsapp",
            accountId: thread.accountId,
            ...this.profileField(),
            // WhatsApp wants E.164; the conversation key carries the bare wa_id.
            recipient: `+${recipient}`,
            text,
          },
        }),
    );
    return rawFromMessageRecord(record, thread.conversationKey);
  }

  private async sendComment(thread: AdeliCommentThreadId, message: AdapterPostableMessage): Promise<AdeliRawComment> {
    const text = this.requireText(this.converter.renderPostable(message));
    const response = await this.client.call(
      { action: `reply to a ${thread.platform} comment`, resourceType: "comment", resourceId: thread.rootCommentId },
      (sdk) =>
        sdk.comments.createComment({
          body: {
            platform: thread.platform,
            accountId: thread.accountId,
            ...this.profileField(),
            parentId: thread.rootCommentId,
            // TikTok replies need the video id; Instagram's do not.
            ...(thread.platform === "tiktok" ? { postId: thread.mediaId } : {}),
            message: text,
          },
        }),
    );
    return rawFromCommentRecord(response.comment, { accountId: thread.accountId, platform: thread.platform });
  }

  /**
   * None of Adeli's platforms can edit a sent DM or comment, so the stream is
   * buffered and posted once when it ends.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions,
  ): Promise<RawMessage<AdeliRawMessage>> {
    let text = "";
    for await (const chunk of textStream) {
      if (options?.signal?.aborted) break;
      if (typeof chunk === "string") text += chunk;
      else if (chunk.type === "markdown_text") text += chunk.text;
    }
    return this.postMessage(threadId, { markdown: text });
  }

  async editMessage(): Promise<RawMessage<AdeliRawMessage>> {
    throw new NotImplementedError("Adeli's platforms cannot edit a sent message", "editMessage");
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const thread = decodeThreadId(threadId);
    if (thread.kind === "dm") {
      throw new NotImplementedError("Adeli cannot delete a sent direct message", "deleteMessage");
    }
    await this.client.call(
      { action: `delete a ${thread.platform} comment`, resourceType: "comment", resourceId: messageId },
      (sdk) =>
        sdk.comments.deleteComment({
          path: { commentId: messageId },
          query: { platform: thread.platform, accountId: thread.accountId, ...this.profileField() },
        }),
    );
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string): Promise<void> {
    throw new NotImplementedError("Adeli does not support reactions", "addReaction");
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string): Promise<void> {
    throw new NotImplementedError("Adeli does not support reactions", "removeReaction");
  }

  /**
   * No-op: Adeli has no typing-indicator operation. Resolving quietly keeps
   * portable bots that call `thread.startTyping()` working on Adeli.
   */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    return;
  }

  // ---------------------------------------------------------------------------
  // History and threads
  // ---------------------------------------------------------------------------

  async fetchMessages(threadId: string, options: FetchOptions = {}): Promise<FetchResult<AdeliRawMessage>> {
    const thread = decodeThreadId(threadId);
    return thread.kind === "dm" ? this.fetchDmMessages(thread, options) : this.fetchCommentMessages(thread, options);
  }

  private async fetchDmPage(
    thread: AdeliDmThreadId,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ messages: AdeliRawDirectMessage[]; nextCursor: string | undefined }> {
    const query: MessagesQuery = {
      accountId: thread.accountId,
      conversationKey: thread.conversationKey,
      ...this.profileField(),
      ...(cursor === undefined ? {} : { cursor }),
      limit,
    };
    const data = await this.client.call(
      { action: "list messages", resourceType: "conversation", resourceId: thread.conversationKey },
      (sdk) => sdk.messages.listMessages({ query }),
    );
    const messages = data.messages
      .filter((record) => (record.conversationKey ?? thread.conversationKey) === thread.conversationKey)
      .map((record) => rawFromMessageRecord(record, thread.conversationKey));
    return { messages, nextCursor: data.nextCursor ?? undefined };
  }

  private async fetchDmMessages(
    thread: AdeliDmThreadId,
    options: FetchOptions,
  ): Promise<FetchResult<AdeliRawMessage>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_FETCH_LIMIT), 1), MAX_FETCH_LIMIT);
    if (options.direction === "forward") {
      // Adeli pages backward only. Read the conversation (bounded) and return
      // it oldest first in one page.
      const pages: AdeliRawDirectMessage[][] = [];
      let cursor: string | undefined;
      let total = 0;
      do {
        const page = await this.fetchDmPage(thread, cursor, MAX_FETCH_LIMIT);
        pages.push(page.messages);
        total += page.messages.length;
        cursor = page.nextCursor;
      } while (cursor !== undefined && total < MAX_FORWARD_MESSAGES);
      const all = pages.reverse().flat();
      return { messages: all.map((raw) => this.parseMessage(raw)) };
    }
    const page = await this.fetchDmPage(thread, options.cursor, limit);
    return {
      messages: page.messages.map((raw) => this.parseMessage(raw)),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  private async fetchCommentMessages(
    thread: AdeliCommentThreadId,
    options: FetchOptions,
  ): Promise<FetchResult<AdeliRawMessage>> {
    const data = await this.client.call(
      { action: `list ${thread.platform} comments`, resourceType: "post", resourceId: thread.mediaId },
      (sdk) =>
        sdk.comments.listComments({
          query: {
            platform: thread.platform,
            accountId: thread.accountId,
            ...this.profileField(),
            postId: thread.mediaId,
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          },
        }),
    );
    const seen = new Set<string>();
    const comments = (data.comments as CommentRecord[])
      .filter((comment) => comment.id === thread.rootCommentId || comment.parentId === thread.rootCommentId)
      .filter((comment) => (seen.has(comment.id) ? false : (seen.add(comment.id), true)))
      .map((comment) => rawFromCommentRecord(comment, { accountId: thread.accountId, platform: thread.platform }))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const limited =
      options.limit === undefined
        ? comments
        : options.direction === "forward"
          ? comments.slice(0, options.limit)
          : comments.slice(-options.limit);
    return {
      messages: limited.map((raw) => this.parseMessage(raw)),
      ...(data.nextCursor ? { nextCursor: data.nextCursor } : {}),
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const thread = decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: channelIdFromThreadId(threadId),
      isDM: thread.kind === "dm",
      metadata: { platform: thread.platform, accountId: thread.accountId, kind: thread.kind },
    };
  }

  /**
   * Return the DM thread for `"<accountId>:<scoped id>"` (an Instagram user)
   * or `"<accountId>:<platform>:<id>"`, without a network call. The first
   * `post()` sends; Meta's 24-hour window still applies.
   */
  async openDM(userId: string): Promise<string> {
    const separator = userId.indexOf(":");
    const accountId = separator > 0 ? userId.slice(0, separator) : "";
    const rest = separator > 0 ? userId.slice(separator + 1) : "";
    if (!accountId || !rest) {
      throw new ValidationError(
        ADAPTER_NAME,
        `openDM expects "<accountId>:<scoped id>" or "<accountId>:<platform>:<id>", got "${userId}"`,
      );
    }
    if (!rest.includes(":")) {
      return encodeThreadId({ kind: "dm", accountId, platform: "instagram", conversationKey: `instagram:${rest}` });
    }
    const explicit = parseConversationKey(rest);
    if (!explicit) {
      throw new ValidationError(ADAPTER_NAME, `openDM: "${rest}" is not "<instagram|facebook|whatsapp>:<id>"`);
    }
    return encodeThreadId({ kind: "dm", accountId, platform: explicit.platform, conversationKey: rest });
  }

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }
}
