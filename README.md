# VS Web Studio AI Voice Agent

## Current status

**Phase 4D – Client-First Booking Experience.** `gpt-live-1` remains the conversational voice model and delegates backend reasoning/tool selection to `gpt-5.4-mini`. The Realtime fallback remains `gpt-realtime-2.1-mini`.

The registered backend tools are:

- `prepareNextStep` — preparation only for callbacks, information requests, human handoff, and initial meeting normalization.
- `getCalendarAvailability` — reads sanitized Google Calendar free/busy data.
- `bookMeeting` — creates a real consultation event only after explicit confirmation and a final availability re-check.
- `findEmmaMeetings` — finds at most three sanitized Emma-created meeting candidates in a bounded window.
- `rescheduleMeeting` — updates one selected Emma event only after availability is re-checked and the exact change is explicitly confirmed.
- `cancelMeeting` — deletes one selected Emma event only after explicit cancellation confirmation.
- `updateMeetingDetails` — updates context or meeting mode without changing appointment time.

Callbacks are not Calendar meetings. Gmail, email sending, CRM, Firebase, LeadFlow, Twilio, SIP, calls, and human telephone transfer remain unimplemented.

## Architecture

Live uses a server-owned Responses delegation configured in the existing session. The browser relays completed function calls to `POST /api/tools/execute`; the shared Express/Netlify backend performs allowlist checks, Zod validation, Google authentication, availability calculation, and event creation. The browser contains no Google or OpenAI credentials and no business execution logic.

Google access uses one-user OAuth 2.0 offline credentials: client ID, client secret, and refresh token. The official Google client refreshes access tokens as necessary. This is suitable for one calendar controlled by Vladyslav and works in stateless Netlify Functions without credential files or multi-user OAuth infrastructure.

## Calendar behavior

The timezone is `Europe/Berlin`. Luxon handles UTC offsets and daylight-saving transitions. Default appointment policy:

- Monday–Friday
- 09:00–17:00
- 30-minute duration
- 30-minute customer-to-customer buffer
- at most three alternatives

Production should use a dedicated Google Calendar named **VS Web Studio Booking**. Set `GOOGLE_CALENDAR_ID` to that calendar's ID, not `primary`. Every availability check, booking, managed-meeting lookup, reschedule, and cancellation is scoped exclusively to the configured calendar; the application does not additionally read the primary calendar.

This intentionally means personal appointments and tasks do not block VS Web Studio customer appointments. Only busy events in the dedicated booking calendar participate in customer availability, while customer appointments in that calendar continue to block one another.

Hours, default duration, and buffer are server configuration. Dates must be resolved to `YYYY-MM-DD`; ambiguous relative dates must be clarified conversationally.

Availability uses Google Calendar `freebusy.query`. Existing titles, descriptions, attendees, addresses, and event IDs are never returned. Only requested-slot status and sanitized alternative intervals enter the Live tool flow.

Meeting lookup uses Google Calendar `events.list` with the official `privateExtendedProperty=vsAiSource=emma` filter and a bounded date range (by default 30 days back through 180 days ahead). The service returns at most three sanitized candidates and represents the Google event ID as an opaque `meetingRef`. Optional contact/company matching happens only within the already provider-filtered Emma event set. Two or three candidates require conversational clarification; Emma may never guess.

Booking requires an exact start, end, `Europe/Berlin`, a synchronous meeting mode, literal explicit confirmation, and an idempotency key. Emma normally asks two to four concise discovery questions before booking, without repeating known information or turning the conversation into a questionnaire. Before mutation she summarizes the exact time, meeting mode, and core reason and asks for explicit confirmation.

Supported modes are `GOOGLE_MEET`, `PHONE`, and `IN_PERSON`. Email is not a meeting mode and remains the non-sending `SEND_INFORMATION` preparation flow. Google Meet bookings request a unique conference through `conferenceDataVersion=1`; a Meet URL is returned only after Google supplies one. Phone meetings require a confirmed callback number in the browser MVP. In-person meetings require a confirmed location; Emma never invents an address.

Created events are private and opaque/busy and send no attendee updates. Their visible title uses company, then contact, then `VS Web Studio – Beratung` without a generic “Customer” label. The structured description includes only supplied contact, company, meeting mode, phone/location where applicable, reason, current situation, desired outcome, notes, and source. Customer email is not stored in the event.

Before every reschedule or cancellation, the backend fetches the selected event again and requires `extendedProperties.private.vsAiSource=emma`. Missing/different ownership returns `not_managed_by_emma`; recurring events are also rejected. Rescheduling patches the existing event, preserving its identity, description, and private metadata. Its final availability check internally lists overlapping events and excludes only the selected event ID, so the current appointment does not block itself while any other overlapping event still does. No raw event contents enter the model or visible UI.

`updateMeetingDetails` applies the same ownership and recurring-event protection and never accepts start/end fields. It preserves booking and reschedule metadata. Notes-only updates preserve existing conference data. Mode changes create a new unique Meet request when moving to Google Meet, clear obsolete Meet data when moving away, and clear misleading phone/location fields as appropriate.

## Duplicate-call protection

The browser ignores repeated Live events with the same function `call_id`. For durable protection, `bookMeeting` derives a deterministic Google event ID from the calendar and idempotency key and stores a hash of the booking request in private extended properties.

- Same key and same request: returns the existing confirmed event with `duplicate: true`.
- Same key and different request: returns `duplicate_conflict` and creates nothing.
- Concurrent insert conflict: reloads the deterministic event and verifies the private request hash.

This works across cold Netlify instances because Google Calendar holds the identifier and metadata. A narrow race remains possible if two genuinely different idempotency keys target the same slot between the final free/busy check and their inserts; Google Calendar does not provide an atomic free/busy-and-insert transaction.

Rescheduling stores `vsAiLastMutationKey` and `vsAiLastMutationHash` in the same private metadata while preserving `vsAiSource` and the booking hash. The same key/request returns `duplicate: true` without another patch; the same key with a different target returns `duplicate_conflict`. Repeated cancellation returns `not_found_or_already_cancelled` after the event is gone. Fully durable cancellation idempotency is not possible without an external mutation ledger, which is intentionally out of scope.

## Environment

Copy `.env.example` to `.env`; do not commit `.env`.

```dotenv
OPENAI_API_KEY=<server-side secret>
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=marin
OPENAI_LIVE_MODEL=gpt-live-1
OPENAI_AGENT_MODEL=gpt-5.4-mini

GOOGLE_CALENDAR_ID=<dedicated VS Web Studio Booking calendar ID>
GOOGLE_CLIENT_ID=<OAuth web client ID>
GOOGLE_CLIENT_SECRET=<OAuth web client secret>
GOOGLE_REFRESH_TOKEN=<offline refresh token>

CALENDAR_TIMEZONE=Europe/Berlin
CALENDAR_WORKING_HOURS_START=09:00
CALENDAR_WORKING_HOURS_END=17:00
CALENDAR_DEFAULT_DURATION_MINUTES=30
CALENDAR_BUFFER_MINUTES=30
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
8. Create a dedicated calendar named **VS Web Studio Booking** and set `GOOGLE_CALENDAR_ID` to its exact calendar ID. Do not use `primary` for production customer booking because personal busy events would block customer availability.
9. Store all values only in local `.env` and the Netlify environment. Remove the Playground redirect URI afterward if it is no longer needed.

## Development and automated checks

```bash
npm install
npm run check:tools
npm run check:calendar
npm run check:google-calendar
npm run typecheck
npm run build
npm run check:openai
```

`check:calendar` uses a mock Google gateway. It never calls Google and never creates real events. It covers dedicated-calendar isolation, the exact 30-minute buffer boundary, rich Google Meet/phone/in-person bookings, Meet creation requests, validation, provider-filtered Emma lookup, details updates and mode transitions, ownership rejection, rescheduling with detail preservation, idempotency, cancellation, and repeated cancellation.

`check:google-calendar` is a read-only live diagnostic. It reports only whether the four Google settings are present, OAuth authentication succeeds, the configured calendar name/access are available, free/busy works, and the timezone is valid. It never prints IDs, credentials, tokens, or event data and never creates, updates, moves, or deletes events. If `GOOGLE_CALENDAR_ID` is `primary`, it prints a warning without failing the application.

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

For the complete operator-only lifecycle flow, choose two free future weekday slots inside working hours and run:

```bash
npm run calendar:lifecycle-test -- --confirm-write --start=2026-09-25T15:00:00+02:00 --end=2026-09-25T15:30:00+02:00 --new-start=2026-09-28T14:00:00+02:00 --new-end=2026-09-28T14:30:00+02:00
```

Without `--confirm-write` the script refuses all writes. With the flag it creates **[TEST] VS Web Studio – AI Lifecycle**, verifies the Emma marker, finds it through the managed lookup, reschedules and verifies it, cancels it, and verifies it no longer exists. This is the only verification that touches a real Calendar; automated checks remain mocked.

### Phase 4D manual scenarios

- **A — Customer priority:** choose a time busy only in Vladyslav's personal calendar. Emma should allow it because only **VS Web Studio Booking** is queried.
- **B — Customer conflict:** place a booking-calendar event at 14:00–14:30. A 14:45 request must be unavailable; 15:00 must be available with the 30-minute buffer.
- **C — Google Meet:** book `GOOGLE_MEET`; verify the event has its own Google Meet conference and Emma states a URL only when Google returned it.
- **D — Phone:** book `PHONE`; verify the confirmed callback number and telephone mode appear in the structured description.
- **E — In person:** book `IN_PERSON`; verify the confirmed location appears in the Calendar location field and description.
- **F — Post-booking note:** ask Emma to add that automation should also be discussed; verify `updateMeetingDetails` changes the real description without changing the time or conference.

### Optional Google Appointment Schedule

Google Appointment Schedule is separate from Emma's API flow and is not required. If used for public self-booking, configure it for **VS Web Studio Booking**, Monday–Friday 09:00–17:00, 30-minute duration, and a 30-minute buffer. Emma's server-side policy remains authoritative for voice bookings.

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
- Recurring meetings cannot be modified; lifecycle operations intentionally reject them.
- Cancellation idempotency cannot distinguish an already-cancelled event from a never-valid reference without an external mutation ledger.
- Google Meet generation depends on the configured account/calendar supporting `hangoutsMeet`; a confirmed URL can remain temporarily absent while Google processes the asynchronous request.
- The browser has no verified current caller number, so phone meetings require the customer to provide and confirm a callback number.
- Attendee invitations and customer email notifications are not implemented.
- Prepared callbacks and other Phase 4A actions remain non-persistent.

## Recommended next phase

Manually verify the Phase 4D booking-mode, buffer, customer-priority, and details-update scenarios in the deployed environment. After that, define the next business phase separately; Gmail, CRM/Firebase, Twilio/SIP, bulk calling, and human call transfer remain explicitly out of scope here.
