# Phase 5D-C2: transcript and nearest-slot architecture

## Runtime behavior

For task-aware `OUTBOUND_SALES` calls, the browser starts a 30-second application timer only after the OpenAI voice session reports that it is ready. Emma remains silent until a non-whitespace customer transcript delta arrives. That first intelligible text permanently opens a one-shot gate; Emma then gives the existing outbound introduction and the configurable text-transcription disclosure. VAD activity by itself never opens the gate. If the timer expires, the browser closes the voice session, data channel, peer connection, and microphone tracks, invokes no sales tool, and shows `No speech detected – conversation ended`.

The disclosure describes automatic text transcription only. The application does not capture or persist raw microphone or remote audio.

## Transcript flow

One shared browser collector accepts exact GPT-Live input/output transcript deltas, including their millisecond bounds, and Realtime input/output transcript events keyed by item order. A completed Realtime input transcript replaces its partial turn instead of being appended a second time. The operator UI renders the normalized snapshot with `textContent` and contains no internal IDs.

The encrypted task-aware LeadFlow session contains a fresh server-generated `conversationId` in addition to the canonical lead and CallTask IDs. The browser carries only that sealed token. `POST /api/leadflow/transcript` validates same-origin input, opens the token, derives all three IDs server-side, assigns a server event UUID, and forwards the strict contract with the server-only LeadFlow credential.

Changed transcripts are checkpointed about every 10 seconds or after 2,000 new characters. A FINAL checkpoint is attempted on operator end, normal close, and appropriate unload paths. Empty transcripts are skipped. LeadFlow persistence completes before any Calendar mirror is attempted and remains the canonical transcript record.

## Nearest-slot scheduling

`getNextAvailableMeetingSlots` uses server time in `Europe/Berlin`, the configured working day, meeting duration and buffer, and only the dedicated booking calendar. It searches quarter-hour starts across at most ten business days and returns at most three earliest valid slots. Weekends and conflicting buffered customer appointments are skipped. Emma proposes the earliest result, but `bookMeeting` still requires the customer to hear and explicitly confirm the exact date, time, and mode.

## Calendar mirror

Bookings made in a task-aware conversation store one-way derived references for the canonical CallTask and conversation in private event properties. Raw IDs are not stored. After successful FINAL LeadFlow persistence, the backend finds the matching event, verifies Emma ownership and the CallTask binding, and replaces one clearly separated transcript section while preserving title, time, mode, and existing context. A content hash makes retries idempotent. No meeting is created solely for a transcript.

Calendar mirroring is best-effort and secondary. A Google rejection, including a description-size rejection, returns/logs only `calendar_transcript_mirror_failed`; the already-persisted LeadFlow transcript is unaffected and the original event is not intentionally shortened or replaced with a truncated transcript.

## Exact production manual test

1. Open the Voice Agent from a safe task-aware `READY` LeadFlow CallTask and start the call.
2. Stay silent for five seconds. Verify Emma does not speak and no backend sales tool runs.
3. Say `Hallo`. Verify Emma introduces herself once as the VS Web Studio AI assistant, naturally states the purpose, and says the conversation is automatically transcribed for documentation without claiming audio recording.
4. In a separate call, remain silent for 30 seconds. Verify all voice resources close, the UI says `No speech detected – conversation ended`, and no empty transcript record is created.
5. Hold a short, interruptible conversation in both GPT-Live and Realtime fallback. Verify the operator-only transcript shows both speakers in order, preserves natural spacing, and contains no internal IDs.
6. Say there is no date preference and ask for the next appointment. Verify Emma offers the earliest server-returned slot, states its exact date/time and mode, and waits for explicit confirmation before booking. This is the only step that creates a real test event; perform it only in an approved production test window.
7. End the call. Verify LeadFlow contains periodic PARTIAL data and one latest FINAL transcript for the canonical lead/task/conversation. Verify the matching managed Calendar event preserves its title/time/context and contains one transcript section.
8. Retry finalization or reload safely and verify the Calendar transcript section is not duplicated. Confirm unrelated or non-Emma events cannot be changed.

## Remaining limitations

- Transcript delivery and the Calendar mirror depend on the browser remaining alive long enough for a checkpoint; periodic checkpoints reduce but cannot eliminate abrupt device/network-loss risk.
- Realtime input transcription is asynchronous and may differ from what the model inferred from audio; the completed transcript is treated as the display/persistence correction for that turn.
- Calendar descriptions have provider size limits. Full text remains in LeadFlow when Calendar rejects the mirror; this phase deliberately does not truncate while claiming completeness.
- The Calendar event search for mirroring is bounded to a practical future window, and only meetings booked with the new conversation binding can be matched safely.
