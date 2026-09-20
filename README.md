# VS Web Studio AI Voice Agent

## Current status

**Phase 4B – Google Calendar Integration.** `gpt-live-1` remains the conversational voice model and delegates backend reasoning/tool selection to `gpt-5.4-mini`. The Realtime fallback remains `gpt-realtime-2.1-mini`.

The registered backend tools are:

- `prepareNextStep` — preparation only for callbacks, information requests, human handoff, and initial meeting normalization.
- `getCalendarAvailability` — reads sanitized Google Calendar free/busy data.
- `bookMeeting` — creates a real consultation event only after explicit confirmation and a final availability re-check.

Callbacks are not Calendar meetings. Gmail, email sending, CRM, Firebase, LeadFlow, Twilio, SIP, calls, and human telephone transfer remain unimplemented.

## Architecture

Live uses a server-owned Responses delegation configured in the existing session. The browser relays completed function calls to `POST /api/tools/execute`; the shared Express/Netlify backend performs allowlist checks, Zod validation, Google authentication, availability calculation, and event creation. The browser contains no Google or OpenAI credentials and no business execution logic.

Google access uses one-user OAuth 2.0 offline credentials: client ID, client secret, and refresh token. The official Google client refreshes access tokens as necessary. This is suitable for one calendar controlled by Vladyslav and works in stateless Netlify Functions without credential files or multi-user OAuth infrastructure.

## Calendar behavior

The timezone is `Europe/Berlin`. Luxon handles UTC offsets and daylight-saving transitions. Default appointment policy:

- Monday–Friday
- 10:30–18:00
- 30-minute duration
- 15-minute buffer around existing events
- at most three alternatives

Hours, default duration, and buffer are server configuration. Dates must be resolved to `YYYY-MM-DD`; ambiguous relative dates must be clarified conversationally.

Availability uses Google Calendar `freebusy.query`. Existing titles, descriptions, attendees, addresses, and event IDs are never returned. Only requested-slot status and sanitized alternative intervals enter the Live tool flow.

Booking requires an exact start, end, `Europe/Berlin`, literal explicit confirmation, and an idempotency key. The service checks the slot again immediately before insertion. Created events are private, opaque/busy, send no attendee updates, and do not store customer email or phone. Descriptions contain only supplied contact/company/business context and the Emma source marker.

## Duplicate-call protection

The browser ignores repeated Live events with the same function `call_id`. For durable protection, `bookMeeting` derives a deterministic Google event ID from the calendar and idempotency key and stores a hash of the booking request in private extended properties.

- Same key and same request: returns the existing confirmed event with `duplicate: true`.
- Same key and different request: returns `duplicate_conflict` and creates nothing.
- Concurrent insert conflict: reloads the deterministic event and verifies the private request hash.

This works across cold Netlify instances because Google Calendar holds the identifier and metadata. A narrow race remains possible if two genuinely different idempotency keys target the same slot between the final free/busy check and their inserts; Google Calendar does not provide an atomic free/busy-and-insert transaction.

## Environment

Copy `.env.example` to `.env`; do not commit `.env`.

```dotenv
OPENAI_API_KEY=<server-side secret>
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=marin
OPENAI_LIVE_MODEL=gpt-live-1
OPENAI_AGENT_MODEL=gpt-5.4-mini

GOOGLE_CALENDAR_ID=<calendar ID or primary>
GOOGLE_CLIENT_ID=<OAuth web client ID>
GOOGLE_CLIENT_SECRET=<OAuth web client secret>
GOOGLE_REFRESH_TOKEN=<offline refresh token>

CALENDAR_TIMEZONE=Europe/Berlin
CALENDAR_WORKING_HOURS_START=10:30
CALENDAR_WORKING_HOURS_END=18:00
CALENDAR_DEFAULT_DURATION_MINUTES=30
CALENDAR_BUFFER_MINUTES=15
PORT=3001
```

The application can still start without Google values; Calendar tools then return a sanitized `calendar_error` with reason `configuration`. All four Google variables are required before Calendar integration can work.

## One-time Google setup

1. Create or select a Google Cloud project and enable **Google Calendar API**.
2. Configure the Google Auth consent screen. For a Google Workspace organization, prefer an Internal app. For a personal account, add Vladyslav as a test user or publish the app when appropriate. Google testing-mode refresh tokens for external apps may expire after seven days.
3. Create an OAuth 2.0 **Web application** client.
4. Temporarily add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
5. Open the official OAuth 2.0 Playground, open its settings, enable **Use your own OAuth credentials**, select **Offline** access and consent prompting, then enter the client ID and secret.
6. Authorize these scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
7. Exchange the authorization code and copy the refresh token into `GOOGLE_REFRESH_TOKEN`.
8. Set `GOOGLE_CALENDAR_ID` to `primary` for the authorized account’s primary calendar, or use the exact ID of another calendar that account can edit.
9. Store all values only in local `.env` and the Netlify environment. Remove the Playground redirect URI afterward if it is no longer needed.

## Development and automated checks

```bash
npm install
npm run check:tools
npm run check:calendar
npm run typecheck
npm run build
npm run check:openai
```

`check:calendar` uses a mock Google gateway. It never calls Google and never creates real events. It covers available/busy slots, alternatives, sanitized output, Berlin DST, working hours, buffers, explicit confirmation, duplicate keys, duplicate insertion prevention, and the pre-insert race check.

Run locally with:

```bash
npm run dev
```

Verify `GET http://localhost:3001/health`, then use the browser Voice Quality Lab.

## Explicit manual Calendar test

No build or automated check performs a Calendar write. After configuring credentials, choose a future weekday slot inside the configured hours and explicitly run:

```bash
npm run calendar:test -- --confirm-write --start=2026-09-25T15:00:00+02:00 --end=2026-09-25T15:30:00+02:00
```

Use the correct Berlin offset for the selected date (`+01:00` or `+02:00`). The script validates the interval, re-checks availability, and creates only an event titled **[TEST] VS Web Studio – AI Agent**. It prints a sanitized result and the event ID for the operator. Run the identical command again to confirm `duplicate: true` and that no second event appears. Delete the `[TEST]` event manually in Google Calendar afterward.

Then manually test the voice sequence:

1. Offer a tentative date/time and confirm Emma checks availability without booking.
2. Let Emma offer only returned free alternatives.
3. Confirm that “15 Uhr wäre gut” still causes Emma to ask whether it should be firmly entered.
4. Say “Ja, bitte” and verify booking occurs only then.
5. Confirm Emma states success only after `status=confirmed` and repeats the final date/time.
6. Repeat the delegated booking call and verify no duplicate event.
7. Make the slot busy between availability and confirmation and verify `slot_no_longer_available`.

## Netlify configuration

In **Project configuration → Environment variables**, add every OpenAI and Google variable shown above except `PORT`. Add the Calendar policy variables if their defaults should be overridden. Never upload OAuth JSON files and never put secrets in `netlify.toml` or `public`.

After saving the variables, trigger a new deploy. Verify `/health`, then run the browser voice scenarios against the deployed origin. Netlify Functions need outbound HTTPS access to Google APIs, which is part of normal Netlify operation.

## Failure and privacy behavior

Authentication failures, revoked tokens, rate limiting, provider outages, invalid arguments, changed availability, duplicate conflicts, and missing confirmation return controlled statuses. Emma must not expose technical details and must never claim success unless `bookMeeting` returns both `status: "confirmed"` and `externalActionPerformed: true`.

Logs contain tool names, coarse statuses, and action types only. They do not contain OAuth tokens, client secrets, customer email, phone, tool arguments, private event details, transcripts, or SDP.

## Current limitations

- Credentials and the real Google account are not automatically provisioned or tested.
- The real Calendar write requires Vladyslav’s explicit manual integration test.
- There is no atomic Google transaction combining free/busy checking with insertion for different booking keys.
- No cancellation, rescheduling, recurring meetings, attendee invitations, conferencing links, or customer email notifications are implemented.
- Prepared callbacks and other Phase 4A actions remain non-persistent.

## Recommended Phase 4C

Add explicit rescheduling and cancellation for events created by Emma only, protected by the stored private source/idempotency metadata and customer confirmation. Do not expand into Gmail, CRM, or telephone calling in that phase.
