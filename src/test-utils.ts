/**
 * Shared test helpers. No network: every API call goes through `FakeAdeli`,
 * a `fetch` stub passed to the SDK.
 */
import { createHmac } from "node:crypto";
import { createMemoryState } from "@chat-adapter/state-memory";
import { type ActionEvent, Chat, type Message, type Thread } from "chat";
import { AdeliAdapter } from "./adapter";
import type { AdeliAdapterConfig, AdeliRawMessage } from "./types";

export const API_KEY = "adeli_sk_test_key";
export const WEBHOOK_SECRET = "whsec_test_secret";
export const ACCOUNT_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
export const PROFILE_ID = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
export const IGSID = "17841400000000001";
export const BASE_URL = "https://app.tryadeli.com";

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | null;
  body: unknown;
}

type Route = (call: RecordedCall) => { status: number; body?: unknown; headers?: Record<string, string> };

/** A `fetch` stub that answers Adeli API routes and records every call. */
export class FakeAdeli {
  readonly calls: RecordedCall[] = [];
  private readonly routes = new Map<string, Route>();

  constructor() {
    this.on("GET", "/api/v1/me", () => ({
      status: 200,
      body: { message: "ok", you: { name: null, organization: null, profile: { id: PROFILE_ID, name: "Test" } } },
    }));
  }

  on(method: string, path: string, route: Route): this {
    this.routes.set(`${method} ${path}`, route);
    return this;
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && call.path === path);
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const call: RecordedCall = {
      method,
      path: url.pathname,
      query: url.searchParams,
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    this.calls.push(call);
    const route = this.routes.get(`${method} ${url.pathname}`);
    if (!route) {
      return Response.json({ error: { code: "not_found", message: `No route for ${method} ${url.pathname}` } }, { status: 404 });
    }
    const result = route(call);
    if (result.status === 204) return new Response(null, { status: 204 });
    return Response.json(result.body ?? {}, { status: result.status, headers: result.headers ?? {} });
  };
}

export function createTestAdapter(
  overrides: Partial<AdeliAdapterConfig> = {},
  fake: FakeAdeli = new FakeAdeli(),
): { adapter: AdeliAdapter; fake: FakeAdeli } {
  const adapter = new AdeliAdapter({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
    fetch: fake.fetch,
    logger: silentLogger,
    ...overrides,
  });
  return { adapter, fake };
}

export const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

export function sign(body: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export function signedRequest(
  payload: unknown,
  options: { secret?: string; timestamp?: number; signature?: string | null } = {},
): Request {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature = options.signature === undefined ? sign(body, options.secret, options.timestamp) : options.signature;
  if (signature !== null) headers["adeli-signature"] = signature;
  return new Request("https://bot.example.com/api/webhooks/adeli", { method: "POST", headers, body });
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}${++counter}`;

export function messageCreatedEvent(
  overrides: {
    platform?: "instagram" | "facebook" | "whatsapp";
    counterpartyId?: string;
    text?: string | null;
    messageId?: string;
    attachments?: { type: string; url: string | null }[];
    test?: boolean;
    isEcho?: boolean;
  } = {},
) {
  const platform = overrides.platform ?? "instagram";
  const counterpartyId = overrides.counterpartyId ?? IGSID;
  const messageId = overrides.messageId ?? nextId("mid.");
  return {
    id: `evt_${platform}-message:${messageId}`,
    type: "message.created",
    createdAt: "2026-11-06T10:00:00.000Z",
    profileId: PROFILE_ID,
    platform,
    accountId: ACCOUNT_ID,
    test: overrides.test ?? false,
    data: {
      messageId,
      conversationKey: `${platform}:${counterpartyId}`,
      from: { id: counterpartyId, username: null },
      text: overrides.text === undefined ? "Hi there" : overrides.text,
      attachments: overrides.attachments ?? [],
      replyTo: null,
      isEcho: overrides.isEcho ?? false,
    },
  };
}

export function commentCreatedEvent(
  overrides: {
    platform?: "instagram" | "tiktok";
    commentId?: string;
    mediaId?: string;
    parentId?: string | null;
    text?: string;
    isSelf?: boolean;
    fromId?: string;
    username?: string | null;
  } = {},
) {
  const platform = overrides.platform ?? "instagram";
  const commentId = overrides.commentId ?? nextId("1790000000000");
  const from =
    platform === "tiktok"
      ? { id: overrides.fromId ?? "tt_user_1", username: overrides.username ?? "tiktoker", displayName: "Tik Toker" }
      : { id: overrides.fromId ?? IGSID, username: overrides.username === undefined ? "jane.doe" : overrides.username };
  return {
    id: `evt_${platform}-comment:${commentId}`,
    type: "comment.created",
    createdAt: "2026-11-06T10:00:00.000Z",
    profileId: PROFILE_ID,
    platform,
    accountId: ACCOUNT_ID,
    test: false,
    data: {
      commentId,
      mediaId: overrides.mediaId ?? "17900000000000001",
      parentId: overrides.parentId ?? null,
      text: overrides.text ?? "Love this!",
      from,
      isSelf: overrides.isSelf ?? false,
    },
  };
}

export function postbackEvent(payload: string, overrides: { senderId?: string; messageId?: string | null } = {}) {
  return {
    id: nextId("evt_instagram-postback:"),
    type: "message.postback",
    createdAt: "2026-11-06T10:00:00.000Z",
    profileId: PROFILE_ID,
    platform: "instagram",
    accountId: ACCOUNT_ID,
    test: false,
    data: {
      senderId: overrides.senderId ?? IGSID,
      payload,
      title: "Yes",
      messageId: overrides.messageId === undefined ? "mid.button" : overrides.messageId,
    },
  };
}

/** A sent-message record as returned by the send endpoints. */
export function sentMessage(platform: "instagram" | "facebook" | "whatsapp", recipient: string, body: string) {
  return {
    id: nextId("msg_"),
    providerId: nextId("mid.sent."),
    platform,
    accountId: ACCOUNT_ID,
    profileId: PROFILE_ID,
    direction: "outbound",
    type: "text",
    recipient,
    sender: "17841499999999999",
    body,
    status: "sent",
    occurredAt: "2026-11-06T10:00:01.000Z",
    createdAt: "2026-11-06T10:00:01.000Z",
  };
}

export function commentRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: nextId("1790000000000"),
    mediaId: "17900000000000001",
    parentId: null,
    authorName: "jane.doe",
    authorFullName: null,
    authorHandle: "jane.doe",
    avatarUrl: null,
    profileUrl: null,
    body: "Love this!",
    likeCount: 0,
    isCreator: false,
    isHidden: false,
    createdAt: "2026-11-06T10:00:00.000Z",
    authorId: IGSID,
    ...overrides,
  };
}

interface WaitUntilTracker {
  waitUntil: (task: Promise<unknown>) => void;
  waitForAll: () => Promise<void>;
}

function createWaitUntilTracker(): WaitUntilTracker {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (task) => {
      tasks.push(task);
    },
    waitForAll: async () => {
      while (tasks.length > 0) await Promise.all(tasks.splice(0));
    },
  };
}

/** A real `Chat` with in-memory state wired to an Adeli adapter. */
export function createAdeliTestContext(
  handlers: {
    onMention?: (thread: Thread, message: Message) => void | Promise<void>;
    onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
    onAction?: (event: ActionEvent) => void | Promise<void>;
  },
  overrides: Partial<AdeliAdapterConfig> = {},
) {
  const fake = new FakeAdeli();
  const { adapter } = createTestAdapter(overrides, fake);
  const state = createMemoryState();
  const chat = new Chat({ userName: "adeli-bot", adapters: { adeli: adapter }, state, logger: "error" });
  const captured = {
    mentions: [] as Message<AdeliRawMessage>[],
    followUps: [] as Message<AdeliRawMessage>[],
    actions: [] as ActionEvent[],
  };
  chat.onNewMention(async (thread, message) => {
    captured.mentions.push(message as Message<AdeliRawMessage>);
    await handlers.onMention?.(thread, message);
  });
  chat.onSubscribedMessage(async (thread, message) => {
    captured.followUps.push(message as Message<AdeliRawMessage>);
    await handlers.onSubscribed?.(thread, message);
  });
  chat.onAction(async (event) => {
    captured.actions.push(event);
    await handlers.onAction?.(event);
  });
  const tracker = createWaitUntilTracker();
  return {
    chat,
    adapter,
    fake,
    state,
    captured,
    sendWebhook: async (payload: unknown): Promise<Response> => {
      const response = await chat.webhooks.adeli(signedRequest(payload), { waitUntil: tracker.waitUntil });
      await tracker.waitForAll();
      return response;
    },
  };
}
