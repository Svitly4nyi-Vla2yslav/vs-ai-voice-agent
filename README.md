# VS Web Studio AI Voice Agent

## Current status

**Phase 5D-B4 – explicit outbound sales conversation mode.** A verified task-aware LeadFlow session now selects `OUTBOUND_SALES` server-side. Emma initiates the first turn exactly once in both Live and Realtime, transparently identifies herself as the AI assistant of VS Web Studio, uses the verified Call Brief, and leads with one relevant discovery question. `gpt-live-1` remains the conversational voice model and delegates backend reasoning/tool selection to `gpt-5.4-mini`. The Realtime fallback, Phase 4D Calendar lifecycle, and Phase 5A/5C verified writeback and handoff behavior are preserved.

The registered backend tools are:

- `prepareNextStep` — preparation only for callbacks, information requests, human handoff, and initial meeting normalization.
- `getCalendarAvailability` — reads sanitized Google Calendar free/busy data.
- `bookMeeting` — creates a real consultation event only after explicit confirmation and a final availability re-check.
- `findEmmaMeetings` — finds at most three sanitized Emma-created meeting candidates in a bounded window.
- `rescheduleMeeting` — updates one selected Emma event only after availability is re-checked and the exact change is explicitly confirmed.
- `cancelMeeting` — deletes one selected Emma event only after explicit cancellation confirmation.
- `updateMeetingDetails` — updates context or meeting mode without changing appointment time.
- `syncLeadFlowInteraction` — sends one validated, confirmed interaction fact to LeadFlow without selecting a CRM status.

Callbacks are not Calendar meetings. LeadFlow writeback is implemented; LeadFlow remains the authoritative CRM and alone decides status transitions. Gmail, email sending, Firebase, Twilio, SIP, real calls, automatic lead dialing, lead creation, fuzzy lookup, bulk calling, and human telephone transfer remain unimplemented.

## Architecture

Live uses a server-owned Responses delegation configured in the existing session. The browser relays completed function calls to `POST /api/tools/execute`; the shared Express/Netlify backend performs allowlist checks, Zod validation, Google authentication, availability calculation, and event creation. The browser contains no Google or OpenAI credentials and no business execution logic.

Google access uses one-user OAuth 2.0 offline credentials: client ID, client secret, and refresh token. The official Google client refreshes access tokens as necessary. This is suitable for one calendar controlled by Vladyslav and works in stateless Netlify Functions without credential files or multi-user OAuth infrastructure.

## LeadFlow server-to-server writeback

The browser never receives `LEADFLOW_INTEGRATION_TOKEN` or a raw canonical lead ID during the normal workflow. LeadFlow opens the Voice Agent with `?handoff=<signed-short-lived-token>`. The browser sends that token once to `POST /api/leadflow/handoff`, removes it from the visible URL, and the Voice Agent backend resolves it server-to-server through LeadFlow's `POST /api/integrations/voice-agent/resolve-handoff` endpoint.

The normal handoff accepts only a canonical lead, a canonical `READY` CallTask, and a strict current Call Brief. Unknown nested fields, missing/non-READY tasks, malformed briefs, and mismatched embedded lead identity are rejected. The backend returns only sanitized operator display data and an encrypted, authenticated, 30-minute Voice Agent session token. That sealed version-2 context binds `leadId`, `callTaskId`, company, contact person, and the approved Call Brief fields; it never stores credentials, handoff/integration tokens, raw provider responses, CRM timelines, or messages.

Every future `/api/tools/execute`, Live, and Realtime request revalidates the sealed context server-side. Tool routing receives the canonical lead and task identifiers from that context only. Neither model arguments nor browser tool arguments can supply or override them. `syncLeadFlowInteraction` continues to use the canonical lead ID; the bound task ID is reserved for Phase 5D-C structured task feedback.

The Call Brief is inserted into Emma's operator context as explicitly untrusted business data, not as instructions. `callObjective`, `emmaFocus`, `offerFocus`, and `doNotMention` guide the prepared call. `currentSituation`, `painPoints`, and `auditProblem` remain prior CRM context and must be explored naturally rather than attributed to the customer as confirmed statements. IDs and CRM status never enter conversational prompt text.

LeadFlow remains the authoritative CRM. The sender contract contains no requested CRM status, and the strict tool schema rejects `crmStatus`, `crmStatusAfter`, `status`, `stage`, and every other unknown field. Emma reports confirmed facts only and normally does not expose LeadFlow's internal before/after status names.

With a valid task-aware handoff, the UI shows `LeadFlow: Connected`, the company, `Call: Ready`, contact person when available, and a concise call-objective preview. It does not show phone, email, CRM status, tokens, or internal IDs. Failed handoffs show only a coarse operator-safe state: not configured, unavailable, authentication failed, expired/invalid handoff, unavailable Lead/CallTask, or a generic connection failure. Conversation start/writeback remains disabled. Opening the Voice Agent directly without a handoff says `Open this Voice Agent from a prepared LeadFlow call.` and never invents a lead or enables the production fallback. Each handoff creates a fresh sealed context; no previous lead, task, company, or Call Brief is stored in browser storage or reused.

Lead-only version-1 response validation remains supported for backward compatibility, but the normal browser handoff requires a task-aware response and never invents a CallTask ID. Manual lead entry is a development-only fallback. It is disabled by default and appears only when the server has `LEADFLOW_ALLOW_MANUAL_LEAD_ID=true` and the page is explicitly opened with `?dev=manual-lead-id`. It is never treated as a `READY` task session or used by the normal LeadFlow launch path.

One logical writeback receives one application-generated UUID. A transport retry reuses the exact payload and UUID. An equivalent LeadFlow replay with `duplicate: true` is successful; `409 event_conflict` is controlled and never retried or rewritten under that UUID. Authentication, missing configuration, timeout, unavailability, missing lead, invalid evidence, malformed response, and generic provider errors are returned as sanitized categories. Tokens, raw provider bodies, stack traces, and CRM status values are not returned to the browser.

### Safe LeadFlow diagnostics

`GET /api/leadflow/status` is a no-store, secret-free configuration snapshot. It returns `configured`, `baseUrlConfigured`, `integrationTokenConfigured`, `manualFallbackEnabled`, `environment`, and, only when valid, the normalized public `leadFlowOrigin`. It never returns either integration token, handoff/session tokens, customer data, or raw environment values.

`GET /api/leadflow/diagnostic` performs only a server-side, read-only `GET` to `/api/integrations/voice-agent/health`. Its response is limited to `configured`, `reachable`, `authentication`, and a coarse `reason`. It never creates a handoff or CRM interaction. The current LeadFlow project does not yet implement that health route, so a reachable `404`/`405` is reported honestly as `authentication: "not_checked"` with `reason: "integration_health_unavailable"`. A LeadFlow follow-up must add this authenticated, non-destructive endpoint; until then, a `401`/`403` can identify an authentication failure, but a successful authentication check cannot be claimed.

### Outbound conversation mode

Conversation mode is an internal server-derived property, not a model/tool argument or authoritative browser parameter. A sealed version-2 task-aware LeadFlow session maps to `OUTBOUND_SALES`; legacy version-1 sessions, direct page access, and the developer lead-ID fallback map to no outbound mode. The architecture has one typed mode-selection boundary so a later phase can add `INBOUND_RECEPTION` without changing how verified context reaches Live and Realtime. This phase does not implement inbound calls, SIP, routing, or telephony.

For `OUTBOUND_SALES`, the verified prompt says that Emma initiated the business call and must speak first. Her opening uses a greeting, transparent AI identity, the exact brand `VS Web Studio`, a concise natural reason derived from the Call Brief, and one targeted permission/discovery question. Generic receptionist openings such as `Wie kann ich Ihnen helfen?` are prohibited only in outbound mode. The browser requests one initial `response.create` after the relevant channel/session is ready; a per-conversation guard prevents repeated session/channel events and later tool responses from creating duplicate greetings. No fake customer speech or transcript is inserted.

`callObjective` is the primary call goal, but internal wording is transformed into natural conversation rather than read verbatim. `emmaFocus` and `offerFocus` help choose the first useful question and relevant value. `currentSituation`, `painPoints`, `auditProblem`, `proposedSolution`, `doNotMention`, and `operatorNote` remain untrusted preparation data. They can shape questions but are never treated as customer-confirmed facts. Mode rules are placed before the delimited untrusted JSON; CRM text cannot select or replace the conversation mode.

The outbound progression is guidance rather than an announced script: opening, permission/relevance, discovery, identified need, relevant value, objection handling, one meaningful next step, and closing. Emma asks one question at a time and does not jump immediately to booking. Soft hesitation receives one relevant diagnostic question and an appropriate next step. Existing hard stops remain authoritative: clear disinterest, `Stop`, no-advertising requests, deletion requests, or do-not-call requests end selling immediately.

Writeback happens once when a meaningful result is confirmed, not per utterance. A callback uses `CALLBACK_REQUESTED` only with `followUp.requested=true`, `confirmed=true`, and an unambiguous `date` or `dueAt`; LeadFlow decides whether that evidence changes CRM status. A meeting uses `MEETING_BOOKED` only after Google returns `bookMeeting status=confirmed`; `calendar.eventId`, `start`, `end`, and `meetingMode` are copied from that verified result. Unconfirmed meetings are rejected by the sender schema.

## Calendar behavior

The timezone is `Europe/Berlin`. Luxon handles UTC offsets and daylight-saving transitions. Default appointment policy:

- Monday–Friday
- 09:00–17:00
- 30-minute duration
- 30-minute customer-to-customer buffer
- at most three alternatives

Production requires a dedicated Google Calendar named **VS Web Studio Booking**. Set `GOOGLE_CALENDAR_ID` to that calendar's ID, never `primary`. Production, deploy-preview, and branch-deploy runtimes fail closed with the sanitized reason `dedicated_booking_calendar_required` when `primary` is configured. Every availability check, booking, managed-meeting lookup, reschedule, cancellation, and details update is scoped exclusively to the configured calendar; the application does not additionally read or merge the primary calendar.

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

LEADFLOW_BASE_URL=http://localhost:3001
LEADFLOW_INTEGRATION_TOKEN=<server-side shared secret>
LEADFLOW_ALLOW_MANUAL_LEAD_ID=false

CALENDAR_TIMEZONE=Europe/Berlin
CALENDAR_WORKING_HOURS_START=09:00
CALENDAR_WORKING_HOURS_END=17:00
CALENDAR_DEFAULT_DURATION_MINUTES=30
CALENDAR_BUFFER_MINUTES=30
PORT=3002
```

The application can still start without Google or LeadFlow values. Calendar tools then return a sanitized configuration error; LeadFlow shows `Not configured` and refuses writeback without claiming success. All four Google variables are required for Calendar, and both LeadFlow variables are required for CRM writeback.

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
npm run check:leadflow
npm run check:leadflow-handoff
npm run check:outbound
npm run typecheck
npm run build
npm run check:openai
```

`check:calendar` uses a mock Google gateway. It never calls Google and never creates real events. It covers dedicated-calendar isolation, the exact 30-minute buffer boundary, rich Google Meet/phone/in-person bookings, Meet creation requests, validation, provider-filtered Emma lookup, details updates and mode transitions, ownership rejection, rescheduling with detail preservation, idempotency, cancellation, and repeated cancellation.

`check:google-calendar` is a read-only live diagnostic. It reports only whether the four Google settings are present, a dedicated ID is configured, OAuth authentication succeeds, the configured calendar name/access are available, free/busy works, and the timezone is valid. It never prints IDs, credentials, tokens, or event data and never creates, updates, moves, or deletes events. If `GOOGLE_CALENDAR_ID` is `primary`, it exits with `Dedicated booking calendar required` before making a Google API call. Display-name matching is advisory only; the configured calendar ID remains authoritative if the calendar is renamed.

Run locally with:

```bash
npm run dev
```

Run LeadFlow at `http://localhost:3001` and this Voice Agent at `http://localhost:3002`; fixed separate ports avoid `EADDRINUSE`. Verify `GET http://localhost:3002/health`, then use the browser Voice Quality Lab.

`check:leadflow` is fully mocked and never calls LeadFlow. It covers configuration presence and safe origin normalization, unreachable and authentication-failed diagnostics, absence of secrets in diagnostic results, a valid interaction request, server-side Authorization, secret-safe logging, timeout, 401, 404, 400, 409 without unsafe retry, duplicate acceptance, malformed responses, UTF-8 summaries, forbidden CRM status fields, stable event IDs across transport retry, new IDs for new interactions, verified Calendar mapping, and rejection of unconfirmed meetings.

`check:leadflow-handoff` is fully mocked. It covers strict task-aware resolution, server-side Bearer authentication, canonical lead/task binding, model override rejection, Call Brief prompt injection without IDs, hostile CRM-text hierarchy, tamper/expiry rejection, missing/non-READY tasks, malformed/unknown brief fields, safe optionals, cross-session lead/task/brief isolation, explicit legacy/developer fallback, direct-open guidance, safe browser failure states, and writeback using the resolved lead ID.

`check:outbound` verifies that unbound and future inbound-like contexts do not request an outbound opening, while Live and Realtime each request exactly one initial response even when their ready event repeats. The handoff suite additionally verifies server-derived mode selection, outbound opening instructions, inbound-phrase prohibition, hostile CRM mode-text isolation, Call Brief availability, and absence of lead/task IDs from prompt text.

## Manual automatic-handoff end-to-end test

1. Run LeadFlow at `http://localhost:3001` and the Voice Agent at `http://localhost:3002` with matching integration tokens.
2. Keep `LEADFLOW_ALLOW_MANUAL_LEAD_ID=false` for the normal flow.
3. In LeadFlow, choose the intended lead.
4. Prepare a CallTask with a non-empty call objective and confirm LeadFlow shows it as `READY`.
5. Choose **Emma anrufen / Call with Emma**. Do not copy a UUID and do not enter a CallTask ID.
6. Confirm the Voice Agent opens, immediately removes `?handoff=...` from its visible URL, and shows `LeadFlow: Connected`, the expected company, `Call: Ready`, and the expected call-objective preview.
7. Start the conversation. Confirm Emma uses the objective and known context for natural discovery without claiming unconfirmed CRM assumptions came from the customer.
8. Confirm one meaningful outcome and verify the interaction appears on that exact LeadFlow client; task feedback/completion is intentionally not written yet.
9. Modify one character of a newly generated handoff token and verify `LeadFlow connection failed` with Start disabled. Repeat with an expired token and confirm no prior company, lead, task, or Call Brief appears.

LeadFlow owns ID creation. The Voice Agent only consumes the canonical lead and CallTask IDs returned by verified handoff resolution. Emma never guesses, creates, asks for, or speaks either ID.

### Exact production handoff test

1. Redeploy both Netlify sites after verifying the production variables below.
2. Open `https://vs-ai-voice-agent.netlify.app/api/leadflow/status`. Confirm both configuration flags and `configured` are `true`, `environment` is `production`, the optional origin is the expected public LeadFlow origin, and no token appears.
3. Open `https://vs-ai-voice-agent.netlify.app/api/leadflow/diagnostic`. Confirm it returns only coarse fields. Until LeadFlow adds the authenticated health route, expect `reachable: true`, `authentication: "not_checked"`, and `reason: "integration_health_unavailable"`; `authentication_failure` instead means the shared secrets do not match.
4. Open `https://vs-ai-voice-agent.netlify.app/` directly. Confirm the page says `Open this Voice Agent from a prepared LeadFlow call.` and **Start conversation** stays disabled.
5. In production LeadFlow, select a safe test lead and prepare one `READY` CallTask with a non-empty objective.
6. Choose **Emma anrufen / Call with Emma**. Confirm the new Voice Agent tab removes the handoff query, shows `Connected`, the expected company/task context, and enables **Start conversation**.
7. Generate a fresh handoff, alter one token character before navigation, and confirm `Handoff expired or invalid`, no lead/task context, and a disabled start button.
8. For authentication-failure testing, do not rotate production secrets casually. If intentionally tested in a maintenance window, change one site only, redeploy it, confirm the coarse authentication error, then immediately restore the matching secret and redeploy both sites.

### Phase 5D-B4 manual outbound scenarios

**Scenario A — Website lead.** Prepare a `READY` task with `callObjective` `Bedarf für eine bessere Webseite prüfen und Beratung anbieten` and `offerFocus` `Website, KI-Assistent und Social Media`. Launch Emma from LeadFlow. Without customer speech, Emma must greet first, identify herself as the AI assistant calling for VS Web Studio, briefly explain the relevant reason, and ask one website-related question. She must not ask `Wie kann ich Ihnen helfen?`.

**Scenario B — Interested customer.** Reply `Ja, unsere Webseite ist schon etwas alt.` Emma should explore one relevant point, reflect only what was actually said, explain one relevant benefit, and guide toward a consultation without immediately booking.

**Scenario C — Soft objection.** Reply `Wir haben schon eine Webseite.` Emma should acknowledge that and ask one useful diagnostic question, such as whether more inquiries or a simpler contact process would be valuable, rather than immediately ending.

**Scenario D — Hard stop.** Reply `Kein Interesse. Bitte rufen Sie nicht mehr an.` Emma must stop selling immediately, ask no further sales question, close politely, and make no unsupported CRM-storage claim.

**Scenario E — Meeting.** Show genuine interest. Emma should gather enough context, check real Calendar availability, offer only verified slots, repeat the chosen time/mode, and call `bookMeeting` only after explicit confirmation. Success may be stated only after the tool returns `status=confirmed` and `externalActionPerformed=true`.

## Manual LeadFlow integration test

Start LeadFlow locally on port 3001, set `LEADFLOW_BASE_URL` and `LEADFLOW_INTEGRATION_TOKEN` in the Voice Agent `.env`, and copy a real canonical lead ID from LeadFlow. Then run:

```bash
npm run leadflow:test -- --lead-id=<canonical-lead-id> --confirm-write
```

The script refuses to write unless both flags are present, sends one German UTF-8 `CALL_COMPLETED` interaction, and never prints the token. It performs a real CRM write, so use a development lead. Automated tests do not call LeadFlow. Do not consider the real integration verified until Vladyslav performs this manual end-to-end test.

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

### Phase 4E dedicated-calendar manual scenarios

**Personal-calendar isolation:**

1. In Vladyslav's personal calendar, create or retain `14:00â€“14:30 Duolingo`.
2. Keep `14:00â€“14:30` free in **VS Web Studio Booking**.
3. Tell Emma: `14 Uhr passt mir.`
4. Expected: Emma considers 14:00 available and may book it only after explicit confirmation. The Duolingo event remains untouched and is never mentioned to the customer.

**Customer-to-customer conflict:**

1. In **VS Web Studio Booking**, place Customer A at `14:00â€“14:30`.
2. Have Customer B ask for 14:00.
3. Expected: Emma reports that the slot is unavailable and proposes only alternatives returned by the backend. The configured customer-to-customer buffer still applies.

Additional lifecycle scenarios:

- **A — Customer priority:** choose a time busy only in Vladyslav's personal calendar. Emma should allow it because only **VS Web Studio Booking** is queried.
- **B — Customer conflict:** place a booking-calendar event at 14:00–14:30. A 14:45 request must be unavailable; 15:00 must be available with the 30-minute buffer.
- **C — Google Meet:** book `GOOGLE_MEET`; verify the event has its own Google Meet conference and Emma states a URL only when Google returned it.
- **D — Phone:** book `PHONE`; verify the confirmed callback number and telephone mode appear in the structured description.
- **E — In person:** book `IN_PERSON`; verify the confirmed location appears in the Calendar location field and description.
- **F — Post-booking note:** ask Emma to add that automation should also be discussed; verify `updateMeetingDetails` changes the real description without changing the time or conference.

### Optional Google Appointment Schedule

Google Appointment Schedule is separate from Emma's API flow and is not required. If used for public self-booking, configure it for **VS Web Studio Booking**, Monday–Friday 09:00–17:00, 30-minute duration, and a 30-minute buffer. Emma's server-side policy remains authoritative for voice bookings.

## Netlify configuration

In **Project configuration → Environment variables**, add every OpenAI, Google, and LeadFlow variable shown above except `PORT`. For the Voice Agent Netlify site, verify exactly:

```dotenv
LEADFLOW_BASE_URL=https://<PRODUCTION-LEADFLOW-ORIGIN>
LEADFLOW_INTEGRATION_TOKEN=<shared-secret>
LEADFLOW_ALLOW_MANUAL_LEAD_ID=false
```

For the LeadFlow Netlify site, verify exactly:

```dotenv
VOICE_AGENT_APP_URL=https://vs-ai-voice-agent.netlify.app
VOICE_AGENT_INTEGRATION_TOKEN=<same-shared-secret>
```

`LEADFLOW_BASE_URL` must be the deployed LeadFlow origin. `LEADFLOW_INTEGRATION_TOKEN` must exactly match LeadFlow's production `VOICE_AGENT_INTEGRATION_TOKEN`; mark both values secret in their respective Netlify sites. Never upload OAuth JSON files and never put secrets in `netlify.toml` or `public`.

After saving the variables, redeploy both sites. Verify `/health`, `/api/leadflow/status`, and `/api/leadflow/diagnostic`, then run the browser voice scenarios against the deployed origin. Netlify Functions need outbound HTTPS access to LeadFlow and Google APIs, which is part of normal Netlify operation.

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
- A callback writeback records confirmed facts in LeadFlow, but LeadFlow alone decides whether the evidence changes CRM status.
- Normal LeadFlow launches resolve the canonical lead automatically. Manual ID entry remains disabled unless the explicit development-only flag and URL mode are both enabled.
- `INBOUND_RECEPTION` is reserved for a later phase; inbound receiving, SIP routing, and telephony are not implemented.
- Real LeadFlow connectivity is not proven by automated tests and requires Vladyslav's explicit manual integration test.

## Requirements for Phase 5D-C

Phase 5D-C can add structured feedback writeback to the bound CallTask. It must use the authenticated session's canonical `callTaskId` (never a model/browser ID), define a strict versioned feedback contract, preserve idempotency and canonical `leadId` writeback, validate that the task still belongs to the lead, and let LeadFlow own task lifecycle transitions. Feedback should preserve the server-derived conversation mode and distinguish prepared outbound evidence without allowing the model/browser to choose a mode or task. It should add explicit outcome/evidence validation, sanitized failure behavior, task/lead mismatch tests, replay/conflict tests, hard-stop/DO_NOT_CONTACT evidence tests, and manual verification. Twilio/SIP, dialing, `DIALING` transition, automatic task completion, bulk calls, Gmail, fuzzy lookup, lead creation, and inbound reception remain out of scope.
