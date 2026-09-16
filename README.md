# VS Web Studio AI Voice Agent

AI-powered voice assistant for VS Web Studio.

## Current status

Phase 3B – Live Voice Polish. After manual comparison, Vladyslav selected OpenAI Live over the Realtime baseline. The preferred/default test stack is `gpt-live-1` over WebRTC with the built-in `marin` voice. `gpt-realtime-2.1-mini` remains available as a fallback and debugging comparison.

Live conversation delivery now has dedicated guidance for warmer vocal energy, human rhythm, natural pauses, restrained conversational markers, and professional German. These subjective improvements and the new playback level still require a manual listening test.

## Architecture roadmap

1. **Phase 1:** Backend foundation
2. **Phase 2:** Browser voice MVP using OpenAI Realtime + WebRTC
3. **Phase 3A:** Voice Quality Lab with Realtime and Live WebRTC comparison
4. **Phase 3B:** Live voice polish
5. **Phase 3C:** Agent tools / function calling
6. **Phase 4:** Google Calendar + LeadFlow integration
7. **Phase 5:** Twilio / SIP telephone sandbox
8. **Phase 6:** Human handoff and controlled consented callbacks

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
OPENAI_REALTIME_VOICE=marin
OPENAI_LIVE_MODEL=gpt-live-1
```

The UI defaults to Live with `marin`. `OPENAI_REALTIME_VOICE` is the server-side fallback for direct Realtime requests and also defaults to `marin`. The lab still permits `shimmer`, `coral`, and `marin` for comparisons. Every submitted voice is validated against a server-side allowlist. `nova` remains unavailable because the installed SDK does not list it for either current API.

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

## Voice Quality Lab

1. Start the server with `npm run dev`.
2. Open `http://localhost:3001` in a WebRTC-capable browser.
3. Confirm the default **Live — preferred**, `gpt-live-1`, and `marin` settings. Realtime remains selectable as a fallback.
4. Set **Output volume**. It defaults to `70%`; `0%` mutes remote playback. The selected percentage is stored locally between reloads when `localStorage` is available.
5. Select **Start conversation** and allow microphone access.
6. Run the German script below.
7. Select **End conversation** when finished.

The stable Realtime path creates a short-lived credential on the backend and exchanges SDP directly with the Realtime calls endpoint. The experimental Live path sends the browser's SDP offer to the local backend, which creates a `gpt-live-1` session through `POST /v1/live/sessions` and returns only the SDP answer. The permanent OpenAI API key remains on the backend in both cases.

The visible UI reports provider/model, voice, output volume, and lifecycle status. Playback uses only the remote `<audio>` element and its standard `volume` property. No parallel Web Audio playback or compressor is active, so audio is not duplicated. Browser console diagnostics contain only allowlisted lifecycle event names, final Live usage seconds, and limited status/error codes. Permanent keys, ephemeral credentials, SDP payloads, transcripts, and full protocol events are not logged.

## Voice and conversation policy

The preserved sales instructions and Live-specific delivery guidance ask the assistant to:

- identify itself as the VS Web Studio AI assistant at the start of a real customer conversation;
- use exceptionally warm, gentle, grounded vocal energy without shouting, sharp emphasis, or theatrical enthusiasm;
- vary sentence length and rhythm, use brief human pauses, and avoid long sequences of perfectly formed sentences;
- use subtle markers such as „Mhm“, „Okay“ or „Verstehe“ only when natural and never in every response;
- remain professional, use polite German and address customers as „Sie“ by default;
- understand non-native German by prioritizing intended meaning over grammar and never correcting it unless asked;
- ask one short confirmation question when an important detail is unclear and explicitly confirm phone numbers, email addresses, dates, times, and prices;
- pause naturally, stop speaking when interrupted, and let the customer respond;
- distinguish soft objections from clear hard stops;
- move a qualified or consented sales conversation toward one useful next step without pressure;
- never claim that an email, callback, booking, handoff, or CRM update happened without confirmation from a future tool;
- never conduct unsolicited automated advertising calls.

The conceptual conversation states are `OPENING`, `DISCOVERY`, `NEED_IDENTIFIED`, `OBJECTION`, `NEXT_STEP`, and `CLOSING`. Prepared outcomes are `BOOK_MEETING`, `CALLBACK_REQUESTED`, `SEND_INFORMATION`, `HUMAN_HANDOFF`, `NOT_INTERESTED`, and `DO_NOT_CONTACT`. These values are preparation for future function calling only; they are not persisted or executed.

## Manual Live voice test

Use the same microphone, browser, room, laptop volume, and application output-volume setting. Start a new Live/`marin` conversation and say:

1. **„Guten Tag. Wer bist du und was machst du?“**
2. **„Ich habe eigentlich schon eine Webseite.“**
3. **„Hm ... ich weiß nicht. Im Moment habe ich nicht so viel Zeit.“**
4. **„Was würden Sie mir denn konkret empfehlen?“**
5. **„Ich habe Webseite, aber ich bin nicht sicher, was dort muss besser machen.“**
6. Interrupt the assistant while it is speaking.

Evaluate warmth, naturalness, pauses, filler frequency, loudness, harsh vocal peaks, interruption behavior, and understanding of the intentionally imperfect fifth sentence. Repeat once at `70%` and, if peaks remain harsh, at a lower output level. Voice character and audio quality cannot be established by compilation or API checks.

## Development pricing note

As verified on September 16, 2026, OpenAI documents `gpt-live-1` voice sessions at **$0.05 per minute, billed per second**. Backend delegated model and tool usage is billed separately. This is documentation only, is not hardcoded into application logic, and is subject to provider changes. Check the current [official GPT-Live 1 model page](https://developers.openai.com/api/docs/models/gpt-live-1) before budgeting.

## Future operator-controlled calling

Outbound calling is not implemented. The intended future workflow is operator controlled:

1. Vladyslav manually chooses one specific lead or customer.
2. Vladyslav explicitly starts one AI-assisted call.
3. The command includes the phone number, company/contact, call objective, relevant context, allowed contact mode, and optional notes.
4. The system verifies the required permission or consent and never autonomously starts bulk outbound calls.

Future tools may include `scheduleMeeting`, `createCallback`, `saveCallSummary`, `draftEmail`, `sendApprovedEmail`, `updateLead`, and `transferToHuman`. None of these tools exists in Phase 3B.

## Current limitations

There are no working CRM, database, Google Calendar, Gmail, email, LeadFlow, Firebase, callback, human-handoff, Twilio, SIP, outbound calling, or other telephone tools. No sales outcome is persisted. The application must not describe any of those actions as completed. Playback uses simple volume attenuation rather than a compressor; final warmth, peak harshness, microphone behavior, and interruption quality require Vladyslav's listening test.

## Type checking

```bash
npm run typecheck
```

## Build

```bash
npm run build
```

Run the compiled server with `npm start`.
