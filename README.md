# VS Web Studio AI Voice Agent

AI-powered voice assistant for VS Web Studio.

## Current status

Phase 2C – The Express backend serves a browser WebRTC voice test with a configurable Realtime voice, conversation-style guidance, respectful sales objection handling, and development event logging. The browser receives a short-lived Realtime client credential; the permanent OpenAI API key stays on the server.

The browser voice MVP was manually verified before the Phase 2C changes. Voice quality, interruption behavior, and the updated conversation policy must be manually retested after these changes.

## Architecture roadmap

1. **Phase 1:** Backend foundation
2. **Phase 2:** Browser voice MVP using OpenAI Realtime + WebRTC
3. **Phase 3:** Agent tools / function calling
4. **Phase 4:** Google Calendar + LeadFlow integration
5. **Phase 5:** Twilio / SIP telephone sandbox
6. **Phase 6:** Human handoff and controlled consented callbacks

## Installation

```bash
npm install
```

## Environment setup

Copy `.env.example` to `.env`, then provide your server-side OpenAI API key.

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead.

Never commit `.env` or expose its values to client-side code.

The Realtime settings are server-side environment variables:

```dotenv
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=shimmer
```

`OPENAI_REALTIME_VOICE` defaults to `shimmer`, a softer voice selected for Phase 2C testing. The installed SDK also supports options including `coral` and `marin`. Environment validation rejects unsupported configured values. `nova` is not included because the installed SDK does not list it for the current Realtime client-secret API.

## OpenAI API setup

1. Create `.env` from `.env.example`.
2. Add your server-side `OPENAI_API_KEY` to `.env`.
3. Verify API connectivity and authentication:

```bash
npm run check:openai
```

The check reads the existing environment configuration and OpenAI client. It does not generate a response or start a Realtime session.

## Development

```bash
npm run dev
```

The server starts on the configured `PORT` (default: `3001`). Check it at `GET /health`.

## Browser voice test

1. Start the server with `npm run dev`.
2. Open `http://localhost:3001` in a WebRTC-capable browser.
3. Select **Start conversation** and allow microphone access.
4. Speak in German and observe the simple status display: **Connecting**, **Connected**, **Listening**, or **AI speaking**.
5. Select **End conversation** to close the session.

The permanent OpenAI API key remains on the server. The browser receives only a short-lived Realtime client credential and does not persist it.

For development, the browser console logs selected Realtime lifecycle events such as session creation, detected speech, response start/completion, interruptions, and errors. Logs contain event types and limited status/error metadata only; credentials and full event payloads are not logged.

## Voice and conversation policy

The Phase 2C instructions ask the assistant to:

- identify itself as the VS Web Studio AI assistant at the start of a real customer conversation;
- default to warm, calm, concise, natural German at a medium speaking speed;
- pause naturally, stop speaking when interrupted, and let the customer respond;
- distinguish soft objections from clear hard stops;
- move a qualified or consented sales conversation toward one useful next step without pressure;
- never claim that an email, callback, booking, handoff, or CRM update happened without confirmation from a future tool;
- never conduct unsolicited automated advertising calls.

The conceptual conversation states are `OPENING`, `DISCOVERY`, `NEED_IDENTIFIED`, `OBJECTION`, `NEXT_STEP`, and `CLOSING`. Prepared outcomes are `BOOK_MEETING`, `CALLBACK_REQUESTED`, `SEND_INFORMATION`, `HUMAN_HANDOFF`, `NOT_INTERESTED`, and `DO_NOT_CONTACT`. These values are preparation for future function calling only; they are not persisted or executed.

## Manual German test scenarios

Run each scenario in a fresh or logically appropriate conversation and confirm the expected behavior:

1. Say: **„Guten Tag. Was machen Sie eigentlich?“**
   Expected: AI disclosure and a short explanation of VS Web Studio, without invented company details.
2. Say: **„Ich habe jetzt keine Zeit.“**
   Expected: the assistant acknowledges this and asks for a suitable callback time instead of immediately giving up.
3. Say: **„Wir haben schon eine Webseite.“**
   Expected: one short discovery question about a relevant possible improvement.
4. Say: **„Schicken Sie mir Informationen.“**
   Expected: the assistant accepts this as a next step but does not claim that an email was sent.
5. Say: **„Nein danke, kein Interesse. Bitte nicht mehr anrufen.“**
   Expected: the assistant immediately stops selling, confirms the request politely, and closes.
6. Interrupt the assistant while it is speaking.
   Expected: it stops promptly and listens to the customer.

Also listen for a warm, soft delivery, natural pauses, medium speed, short sentences, and concise answers. Voice quality and microphone/interruption behavior require a human listening test and cannot be established by type checking or API connectivity checks.

## Current limitations

There are no working CRM, database, Google Calendar, email, callback, human-handoff, Twilio, SIP, or telephone tools. No sales outcome is persisted. The application must not describe any of those actions as completed.

## Type checking

```bash
npm run typecheck
```

## Build

```bash
npm run build
```

Run the compiled server with `npm start`.
