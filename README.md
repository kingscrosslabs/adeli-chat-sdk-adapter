# @adeli/chat-sdk-adapter

[![npm version](https://img.shields.io/npm/v/@adeli/chat-sdk-adapter)](https://www.npmjs.com/package/@adeli/chat-sdk-adapter)
[![license](https://img.shields.io/npm/l/@adeli/chat-sdk-adapter)](https://github.com/kingscrosslabs/adeli-chat-sdk-adapter/blob/main/LICENSE)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2ea44f?logo=npm)](https://www.npmjs.com/package/@adeli/chat-sdk-adapter#provenance)

This [Adeli](https://www.tryadeli.com) adapter for [Chat SDK](https://chat-sdk.dev/docs) lets one bot answer Instagram, Facebook and WhatsApp DMs, and reply to Instagram and TikTok comments, with one Adeli API key.

Your users connect their accounts in the Adeli dashboard, so your bot doesn't need its own Meta app, App Review, or TikTok developer access.

## Installation

```bash
npm install chat @adeli/chat-sdk-adapter @chat-adapter/state-memory
```

## Usage

```typescript
// lib/bot.ts
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createAdeliAdapter } from "@adeli/chat-sdk-adapter";

export const bot = new Chat({
  userName: "shopbot",
  adapters: {
    adeli: createAdeliAdapter({
      apiKey: process.env.ADELI_API_KEY!,
      webhookSecret: process.env.ADELI_WEBHOOK_SECRET!,
    }),
  },
  state: createMemoryState(),
});

// A new DM, or a new top-level comment on one of the account's posts.
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`Thanks for reaching out! You said: ${message.text}`);
});

// Later messages in a DM, or replies under the same comment.
bot.onSubscribedMessage(async (thread, message) => {
  await thread.post("Got it. A teammate will follow up shortly.");
});
```

```typescript
// app/api/webhooks/adeli/route.ts (Next.js App Router)
import { after } from "next/server";
import { bot } from "@/lib/bot";

export async function POST(request: Request) {
  return bot.webhooks.adeli(request, { waitUntil: (task) => after(() => task) });
}
```

Use a persistent state adapter such as `@chat-adapter/redis` in production; `createMemoryState()` forgets subscriptions on every restart.

### Buttons (Instagram)

On Instagram DMs, a card's `<Button>` and `<LinkButton>` elements become native Instagram buttons, up to three per message. A tap arrives as `onAction` with the button's `id` and `value`:

```tsx
import { Actions, Button, Card, CardText, LinkButton } from "chat";

bot.onNewMention(async (thread) => {
  await thread.post(
    <Card title="Track your order?">
      <CardText>We can send you shipping updates here.</CardText>
      <Actions>
        <Button id="track" value="order-42">Yes please</Button>
        <LinkButton url="https://shop.example.com/orders/42">View order</LinkButton>
      </Actions>
    </Card>,
  );
});

bot.onAction("track", async (event) => {
  await event.thread?.post(`Tracking ${event.value} for you.`);
});
```

On Facebook, WhatsApp and comment threads, cards are sent as plain text, with each link button written as `label: url`.

### Starting a DM

`openDM` takes `"<accountId>:<scoped id>"` for an Instagram user, or `"<accountId>:<platform>:<id>"` for any DM platform. It makes no network call; the first post sends the message. Use it to follow up with someone outside the webhook that brought them in, for example from a job queue:

```typescript
const adeli = bot.getAdapter("adeli");
const threadId = await adeli.openDM(`${accountId}:whatsapp:15555550123`);
await bot.thread(threadId).post("Your order has shipped.");
```

Meta's messaging rules still apply: Instagram, Facebook and WhatsApp accept a free-text message only within 24 hours of the person's last message to the account. A send outside the window throws `AdapterError` with code `window_closed`.

### Rotating credentials

`apiKey` and `webhookSecret` each accept a function instead of a string. The adapter calls `apiKey` before every API request and `webhookSecret` on every webhook, and never caches the result:

```typescript
createAdeliAdapter({
  apiKey: async () => (await secrets.get("adeli-api-key")).value,
  webhookSecret: () => process.env.ADELI_WEBHOOK_SECRET!,
});
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADELI_API_KEY` | Yes | Adeli API key (`rk_live_…`), from **API keys** in the Adeli dashboard |
| `ADELI_WEBHOOK_SECRET` | Yes | Signing secret of the Adeli webhook that delivers to your bot (`whsec_…`) |
| `ADELI_PROFILE_ID` | No | Adeli profile id. Only needed when the key can reach more than one profile |
| `ADELI_BASE_URL` | No | Adeli API origin. Defaults to `https://app.tryadeli.com` |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string \| () => string \| Promise<string>` | `ADELI_API_KEY` | Adeli API key, or a function returning it. Resolved per request |
| `webhookSecret` | `string \| () => string \| Promise<string>` | `ADELI_WEBHOOK_SECRET` | Webhook signing secret, or a function returning it. Resolved per webhook |
| `profileId` | `string` | `ADELI_PROFILE_ID` | Profile id sent with API calls. Also scopes Chat SDK locks and dedupe |
| `baseURL` | `string` | `ADELI_BASE_URL`, then `https://app.tryadeli.com` | Adeli API origin |
| `userName` | `string` | `"adeli-bot"` | Bot display name |
| `webhookToleranceSeconds` | `number` | `300` | Maximum age of a webhook's signed timestamp |
| `fetch` | `typeof fetch` | `globalThis.fetch` | `fetch` implementation for API calls |
| `logger` | `Logger` | The `Chat` instance's logger | Custom logger |

## Platform setup

1. Sign in at [app.tryadeli.com](https://app.tryadeli.com), open **API keys**, create a key, and set it as `ADELI_API_KEY`.
2. On the **Accounts** page, connect the Instagram, Facebook Page, WhatsApp Business or TikTok accounts the bot should answer for. Each connected account is one Chat SDK channel, `adeli:<accountId>`.
3. Deploy the webhook route from [Usage](#usage), for example at `https://bot.example.com/api/webhooks/adeli`. It must be `https`.
4. Register the webhook for `message.created`, `message.postback` and `comment.created`. In the dashboard, open **Webhooks**, click **Add webhook**, and enter the URL. Or use the API:

   ```bash
   curl https://app.tryadeli.com/api/v1/webhooks \
     -H "Authorization: Bearer $ADELI_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "profileId": "<your profile id>",
       "url": "https://bot.example.com/api/webhooks/adeli",
       "events": ["message.created", "message.postback", "comment.created"]
     }'
   ```

   Or `@adeli/sdk`:

   ```typescript
   import { Adeli } from "@adeli/sdk";

   const adeli = new Adeli({ apiKey: process.env.ADELI_API_KEY });
   const { data } = await adeli.webhooks.createWebhook({
     body: {
       profileId: "<your profile id>",
       url: "https://bot.example.com/api/webhooks/adeli",
       events: ["message.created", "message.postback", "comment.created"],
     },
   });
   console.log(data.secret); // shown once
   ```

   Replace `<your profile id>` with your Adeli profile id (see [List profiles](https://www.tryadeli.com/docs/api/profiles/list-profiles)).

5. Store the signing secret the response returns as `ADELI_WEBHOOK_SECRET`. It is shown only once. To rotate it, delete the webhook and create it again.
6. Send a test event from the webhook's row in the dashboard. Test events (`"test": true`) are verified and acknowledged without reaching your handlers.

Every delivery is signed with `Adeli-Signature` (HMAC-SHA256 with a timestamp). The adapter rejects unsigned, mis-signed and stale (over 300 seconds) deliveries with `401`, answers `200` at once, and runs your handlers in `waitUntil`. Adeli retries failed deliveries for about nine hours with the same event id. Chat SDK drops redelivered messages and comments that arrive within its dedupe window (`dedupeTtlMs`, 10 minutes by default); button taps (`message.postback`) are not deduplicated.

See the [Adeli webhooks docs](https://www.tryadeli.com/docs/api/webhooks) for the event payloads, and [`sample-messages.md`](https://github.com/kingscrosslabs/adeli-chat-sdk-adapter/blob/v1.0.1/sample-messages.md) for examples.

## Features

| Feature | Instagram DM | Facebook DM | WhatsApp DM | Instagram comments | TikTok comments |
|---------|:-:|:-:|:-:|:-:|:-:|
| Receive messages (`onNewMention`, `onSubscribedMessage`) | Yes | Yes | Yes | Yes | Yes |
| Post messages and replies | Yes | Yes | Yes | Yes | Yes |
| Buttons and link buttons (`onAction`) | Yes, up to 3 | Text fallback | Text fallback | Text fallback | Text fallback |
| Streaming | Buffered, posted once | Buffered | Buffered | Buffered | Buffered |
| Fetch history (`fetchMessages`) | Yes | Yes | Yes | Yes | Yes |
| Delete a sent message | No | No | No | Yes, own comments | Yes, own comments |
| `openDM` | Yes | Yes | Yes | n/a | n/a |
| Inbound attachments | Yes | Yes | Yes | n/a | n/a |

- A DM thread is one conversation between a connected account and one person. A comment thread is a top-level comment and its replies. Unless you register `onDirectMessage`, every inbound DM reaches `onNewMention`, as does every new top-level comment; replies under a comment reach `onSubscribedMessage` once the thread is subscribed.
- All five surfaces show plain text, so the adapter flattens Markdown: it drops emphasis markers, writes links as `text (url)`, and starts list items with `- `.
- `message.raw` is an `AdeliRawMessage`: `kind`, `accountId`, `platform`, the provider message or comment id, and the sender. `message.id` is the provider's id (an Instagram `mid`, a WhatsApp `wamid`, a comment id).

### Limitations

- Instagram, Facebook and WhatsApp accept free-text messages only within 24 hours of the person's last message. Outside it, a post throws `AdapterError` with code `window_closed`. To open a WhatsApp conversation, send an approved template with [`@adeli/sdk`](https://www.npmjs.com/package/@adeli/sdk) `messages.sendMessage({ body: { platform: "whatsapp", template } })`; Chat SDK messages cannot carry templates.
- Bots can't edit messages, react or show typing. `editMessage`, `addReaction` and `removeReaction` throw `NotImplementedError`; `startTyping` resolves without doing anything, so portable bots keep working. `deleteMessage` works only on the account's own comments.
- Instagram accounts connected through a Facebook Page before Unified Login, and TikTok accounts connected without comment access, send no events until reconnected in the Adeli dashboard.
- Instagram allows three buttons per message. A card with more throws `ValidationError`. A button's `id` and `value` must fit Instagram's 1,000-character postback payload.
- Posting files or attachments throws `ValidationError`.
- DM history pages backward. `fetchMessages` with `direction: "forward"` on a DM reads up to 1,000 messages and returns them in one page.
- A workspace without billing that has used its free monthly sends gets `AdapterRateLimitError` (with `retryAfter` set to the reset time). Provider rate limits (`429`) map to the same error.
- `401` maps to `AuthenticationError`, `403` to `PermissionError` (for `permission_required`, reconnect the account with the missing permission), `404` to `ResourceNotFoundError`, `400`/`422` to `ValidationError`, and `5xx` or network failures to `NetworkError`, all from `@chat-adapter/shared`.

## License

MIT
