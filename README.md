# VS Web Studio AI Voice Agent

AI-powered voice assistant for VS Web Studio.

## Current status

**Phase 4A – Agent Tool Calling Foundation.** `gpt-live-1` remains the preferred conversational voice model over WebRTC, using `marin` by default. `gpt-realtime-2.1-mini` remains available as the fallback and debugging comparison.

Live uses a server-owned Responses delegation with `gpt-5.4-mini` as the default backend model. The only registered Phase 4A business tool is `prepareNextStep`. It validates and normalizes a requested meeting, callback, information request, or human handoff. It does not perform or persist the action. Every result has `externalActionPerformed: false`.

There is no Calendar, Gmail, email sending, Firebase, LeadFlow, CRM, callback, human-transfer, Twilio, SIP, or telephone integration.

## Architecture

The browser sends its SDP offer to `POST /api/live/session`. The shared Express backend creates a `gpt-live-1` WebRTC session and configures `delegation.type: "responses"` with the backend model, backend-only prompt, strict tool definition, `tool_choice: "auto"`, and `parallel_tool_calls: false`.

When the delegated Responses model requests `prepareNextStep`, Live exposes the completed function-call item as a nested `response.event` on the WebRTC data channel. The browser relays only the tool name and arguments to `POST /api/tools/execute`. The server checks same-origin policy, accepts only a registered name, validates arguments with Zod, executes the local implementation, and returns a JSON-safe result. The browser then sends the authoritative result to Live with `response.item.create` using a `function_call_output` item, followed by `response.create`.

This relay works with both local Express and Netlify Functions. It does not require a permanent application-server WebSocket. The browser contains no business execution logic or credentials and cannot select arbitrary server functions.

## Tool contract

`prepareNextStep` supports exactly these actions:

- `BOOK_MEETING`
- `CALLBACK_REQUESTED`
- `SEND_INFORMATION`
- `HUMAN_HANDOFF`

Accepted fields are `type`, `contactName`, `companyName`, `date`, `time`, `timeWindow`, `email`, `phone`, `reason`, and `notes`. Extra fields, invalid action values, malformed dates/times, and invalid email addresses are rejected. Empty optional strings normalize to missing values.

Meetings and callbacks require a date plus either a time or time window. Information requests require an email address. Missing critical values produce `needs_clarification`; valid requests produce `prepared_only`. Neither result represents a completed external action.

## Installation and environment

```bash
npm install
```

Copy `.env.example` to `.env`, then add the server-side API key. Do not commit `.env` or expose its values in client code.

```dotenv
OPENAI_API_KEY=<server-side secret>
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=marin
OPENAI_LIVE_MODEL=gpt-live-1
OPENAI_AGENT_MODEL=gpt-5.4-mini
PORT=3001
```

`OPENAI_AGENT_MODEL` controls only the delegated Responses backend. It is not exposed to the browser.

## Development and checks

```bash
npm run dev
npm run check:tools
npm run typecheck
npm run build
npm run check:openai
```

The server listens on `PORT` (default `3001`). Verify it at `GET /health`. `check:openai` verifies API authentication without generating a response or starting a voice session. `check:tools` exercises strict validation, missing-data handling, the tool allowlist, and the invariant that no external action is performed.

## Netlify deployment

Netlify serves `public` and runs the shared Express application through `netlify/functions/api.ts`. Existing rewrites keep `/api/*` and `/health` stable. Configure these variables in **Project configuration → Environment variables**:

```dotenv
OPENAI_API_KEY=<server-side secret>
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=marin
OPENAI_LIVE_MODEL=gpt-live-1
OPENAI_AGENT_MODEL=gpt-5.4-mini
```

`PORT` is needed only for the local server. Never put `OPENAI_API_KEY` in `netlify.toml`, Git, or `public`.

## Security controls

- The permanent OpenAI key and backend model configuration remain server-side.
- Live data-channel permissions expose only the events required for lifecycle, transcripts, and the delegated tool-result cycle.
- `/api/tools/execute` uses the existing same-origin check.
- The dispatcher accepts only `prepareNextStep`; unknown tools return a controlled failure.
- Zod validates all arguments at runtime and rejects extra fields.
- Tool and relay errors are sanitized; stack traces and secrets are not returned.
- Logs include only tool name, status, and action type. Email addresses, phone numbers, arguments, transcripts, credentials, and SDP are not logged.
- No external action or persistence exists in Phase 4A.

## Development UI

The Voice Quality Lab defaults to Live/`gpt-live-1` with `marin`; Realtime remains selectable. The **Last tool activity** field shows only `None`, a tool request/completion, `Clarification required`, or `Tool error`. It never displays customer data.

## Manual Phase 4A voice tests

These scenarios require Vladyslav to run them in a WebRTC-capable browser. Compilation and API authentication do not validate spoken behavior.

1. **Callback:** Say “Rufen Sie mich bitte am Freitag um 15 Uhr zurück.” Confirm `CALLBACK_REQUESTED`, `externalActionPerformed: false`, and wording that the request was captured/prepared—not scheduled.
2. **Missing date:** Say “Rufen Sie mich später zurück.” Emma should ask for a useful date/time and must not claim a scheduled callback.
3. **Information:** Say “Schicken Sie mir bitte Informationen per E-Mail.” Emma should request the email address if unknown, then prepare `SEND_INFORMATION` without claiming an email was sent.
4. **Meeting:** Say “Freitag um 15 Uhr können wir einen Termin machen.” Confirm `BOOK_MEETING` is prepared and no confirmed booking is claimed.
5. **Human:** Say “Ich möchte lieber mit Vladyslav sprechen.” Confirm `HUMAN_HANDOFF` is prepared and no transfer is claimed.
6. **Hard stop:** Say “Nein danke. Bitte rufen Sie mich nicht mehr an.” Emma should close politely, make no `prepareNextStep` sales-action call, preserve the `DO_NOT_CONTACT` conversation policy, and not claim CRM persistence.

Also verify interruption behavior, audio quality, fallback Realtime compilation, and that `GET /health` still responds.

## Current limitations

The backend model may normalize a relative date such as “Freitag” from session context, but ambiguous critical values must trigger a clarification rather than a guess. Phase 4A does not check real availability or create records. A `prepared_only` result exists only in the active conversation and disappears when the session ends.

## Next phase

Recommended Phase 4B: implement one real, explicitly confirmed Calendar availability-and-booking workflow with OAuth, timezone-aware validation, idempotency, and a truthful success/failure contract, while retaining `prepareNextStep` as the non-performing preparation boundary until the real tool confirms the external action.
