# Adeli sample messages

> **Illustrative payloads.** These envelopes are synthesized from the documented
> event shapes, with made-up ids. Replace them with payloads captured from a
> development Adeli (`node apps/web/scripts/webhook-receiver.mjs --secret whsec_…`)
> and scrubbed, before the `1.0.0` release.

Every delivery is a `POST` with these headers:

```http
Content-Type: application/json
Adeli-Signature: t=1793959200,v1=5f2b0c3e9d8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c
Adeli-Event-Id: evt_3b2f6a1c8d9e4f70
Adeli-Event-Type: message.created
```

`v1` is the hex HMAC-SHA256 of `<t>.<raw body>`, keyed with the webhook's signing secret.

## `message.created`: Instagram DM

Becomes a DM thread `adeli:dm:<accountId>:<base64url("instagram:17841400000000001")>` and fires `onNewMention` (or `onSubscribedMessage` once subscribed).

```json
{
  "id": "evt_3b2f6a1c8d9e4f70",
  "type": "message.created",
  "createdAt": "2026-11-06T10:00:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "instagram",
  "accountId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  "test": false,
  "data": {
    "messageId": "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAwMDAwMDAwMDAx",
    "conversationKey": "instagram:17841400000000001",
    "from": { "id": "17841400000000001", "username": null },
    "text": "Hi! Do you ship to Canada?",
    "attachments": [],
    "replyTo": null,
    "isEcho": false
  }
}
```

## `message.created`: attachment-only Facebook DM

`text` is null; `message.text` is `""` and `message.attachments` holds the image.

```json
{
  "id": "evt_8c1d2e3f4a5b6c7d",
  "type": "message.created",
  "createdAt": "2026-11-06T10:05:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "facebook",
  "accountId": "9e8d7c6b-5a49-4382-a716-05f4e3d2c1b0",
  "test": false,
  "data": {
    "messageId": "m_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "conversationKey": "facebook:24680135792468013",
    "from": { "id": "24680135792468013", "username": null },
    "text": null,
    "attachments": [{ "type": "image", "url": "https://scontent.xx.fbcdn.net/v/t1.15752-9/example.jpg" }],
    "replyTo": null,
    "isEcho": false
  }
}
```

## `message.created`: WhatsApp DM

The counterparty id is the `wa_id`, digits only. Replies go to `+15555550123`.

```json
{
  "id": "evt_1a2b3c4d5e6f7a8b",
  "type": "message.created",
  "createdAt": "2026-11-06T10:10:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "whatsapp",
  "accountId": "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  "test": false,
  "data": {
    "messageId": "wamid.HBgLMTU1NTU1NTAxMjMVAgASGBQzQUFCQ0RFRjAxMjM0NTY3ODkA",
    "conversationKey": "whatsapp:15555550123",
    "from": { "id": "15555550123", "username": null },
    "text": "Is my table still booked for 7?",
    "attachments": [],
    "replyTo": { "messageId": "wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI5QTlCOEM3RDZFNUY0QTNCMkMA" },
    "isEcho": false
  }
}
```

## `comment.created`: Instagram top-level comment

Becomes a comment thread rooted at `commentId` and fires `onNewMention`.

```json
{
  "id": "evt_5d4c3b2a1f0e9d8c",
  "type": "comment.created",
  "createdAt": "2026-11-06T11:00:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "instagram",
  "accountId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  "test": false,
  "data": {
    "commentId": "17900000000000101",
    "mediaId": "17900000000000001",
    "parentId": null,
    "text": "How much is the blue one?",
    "from": { "id": "17841400000000002", "username": "jane.doe" },
    "isSelf": false
  }
}
```

## `comment.created`: Instagram reply by the account itself

`parentId` puts it in the root comment's thread. `isSelf: true` makes `author.isMe` true, so Chat SDK does not dispatch it.

```json
{
  "id": "evt_6e5d4c3b2a1f0e9d",
  "type": "comment.created",
  "createdAt": "2026-11-06T11:01:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "instagram",
  "accountId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  "test": false,
  "data": {
    "commentId": "17900000000000102",
    "mediaId": "17900000000000001",
    "parentId": "17900000000000101",
    "text": "It's $45, and it ships this week!",
    "from": { "id": "17841499999999999", "username": "example.shop" },
    "isSelf": true
  }
}
```

## `comment.created`: TikTok reply

TikTok's `from` adds `displayName`; any of its fields can be null.

```json
{
  "id": "evt_7f6e5d4c3b2a1f0e",
  "type": "comment.created",
  "createdAt": "2026-11-06T12:00:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "tiktok",
  "accountId": "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  "test": false,
  "data": {
    "commentId": "7301234567890123457",
    "mediaId": "7301234567890000000",
    "parentId": "7301234567890123456",
    "text": "where can I buy this??",
    "from": { "id": "-000AbCdEfGhIjKlMnOpQrStUvWxYz", "username": "tiktoker123", "displayName": "Tik Toker" },
    "isSelf": false
  }
}
```

## `message.postback`: Instagram button tap

`payload` is the card button's `id`, a newline, and its `value`. It becomes `onAction` with `actionId: "track"` and `value: "order-42"`, in the DM thread with `senderId`.

```json
{
  "id": "evt_8a7f6e5d4c3b2a1f",
  "type": "message.postback",
  "createdAt": "2026-11-06T13:00:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "instagram",
  "accountId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  "test": false,
  "data": {
    "senderId": "17841400000000001",
    "payload": "track\norder-42",
    "title": "Yes please",
    "messageId": "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAwMDAwMDAwMDAy"
  }
}
```

## Test event

Sent by **Send test event**. Verified, then acknowledged with `200` without reaching any handler.

```json
{
  "id": "evt_test_9b8a7f6e5d4c3b2a",
  "type": "comment.created",
  "createdAt": "2026-11-06T14:00:00.000Z",
  "profileId": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  "platform": "tiktok",
  "accountId": "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  "test": true,
  "data": {
    "commentId": "test_comment",
    "mediaId": "test_media",
    "parentId": null,
    "text": "This is a test comment from Adeli.",
    "from": { "id": "test_user", "username": "adeli_test", "displayName": "Adeli Test" },
    "isSelf": false
  }
}
```
