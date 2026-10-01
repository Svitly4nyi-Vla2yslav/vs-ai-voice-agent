// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createTranscriptCheckpointManager } from "../../public/transcript-checkpoint.js";
import { createTranscriptCollector } from "../../public/transcript-collector.js";
import {
  voiceAgentTranscriptCheckpointInputSchema,
  voiceAgentTranscriptV1Schema,
} from "../contracts/leadflow.js";
import { LeadFlowClient } from "../services/leadflow.js";

const collector = createTranscriptCollector({
  now: () => new Date("2026-09-30T10:00:00.000Z"),
});
collector.markStarted();
collector.addCustomerFragment({ delta: "Guten ", startMs: 100, endMs: 200 });
collector.addCustomerFragment({ delta: "Tag", startMs: 200, endMs: 300 });
assert.deepEqual(collector.snapshot().segments, [
  { speaker: "CUSTOMER", delta: "Guten Tag", startMs: 100, endMs: 300 },
]);
assert.equal(collector.getTotalTextSize(), "Guten Tag".length);

const pausedCollector = createTranscriptCollector();
pausedCollector.markStarted("2026-09-30T10:00:00.000Z");
pausedCollector.addCustomerFragment({ delta: "Erster Satz.", startMs: 0, endMs: 900 });
pausedCollector.addCustomerFragment({ delta: "Neuer Gedanke.", startMs: 2_200, endMs: 3_000 });
assert.equal(pausedCollector.snapshot().segments.length, 2, "a meaningful pause creates a new readable turn");

const realtime = createTranscriptCollector();
realtime.markStarted("2026-09-30T10:00:00.000Z");
realtime.registerRealtimeItem("customer-1", null);
realtime.registerRealtimeItem("emma-1", "customer-1");
realtime.addRealtimeCustomerFragment("customer-1", "Hal");
realtime.addRealtimeCustomerFragment("customer-1", "lo");
realtime.finalizeRealtimeTurn("CUSTOMER", "customer-1", "Hallo");
realtime.addRealtimeEmmaFragment("emma-1", "Guten Tag");
assert.deepEqual(realtime.snapshot().segments, [
  { speaker: "CUSTOMER", delta: "Hallo" },
  { speaker: "EMMA", delta: "Guten Tag" },
]);

const checkpointPayloads = [];
const statuses = [];
let intervalCallback;
const checkpoints = createTranscriptCheckpointManager({
  collector: realtime,
  leadFlowSession: "encrypted-session-token",
  onStatus: (status) => statuses.push(status),
  fetchImplementation: async (_url, init) => {
    checkpointPayloads.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ status: "persisted", calendarMirrorStatus: "not_requested" }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    );
  },
  setIntervalImplementation: (callback, delay) => {
    assert.equal(delay, 20_000);
    intervalCallback = callback;
    return 10;
  },
  clearIntervalImplementation: () => {},
});
checkpoints.start();
intervalCallback();
await checkpoints.checkpoint();
assert.equal(checkpointPayloads[0].state, "PARTIAL");
assert.equal(statuses.length, 0, "PARTIAL checkpoints stay quiet in the customer UI");
await checkpoints.finalize({ keepalive: true });
assert.equal(checkpointPayloads.at(-1).state, "FINAL");
assert.ok(checkpointPayloads.at(-1).endedAt);
assert.equal(statuses.at(-1), "Transcript saved");

const emptyCollector = createTranscriptCollector();
const emptyRequests = [];
const emptyCheckpoints = createTranscriptCheckpointManager({
  collector: emptyCollector,
  leadFlowSession: "encrypted-session-token",
  fetchImplementation: async (...args) => {
    emptyRequests.push(args);
    return new Response(null, { status: 202 });
  },
});
await emptyCheckpoints.finalize();
assert.equal(emptyRequests.length, 0, "empty silence must not create transcript records");

const diagnosticStatuses = [];
const failingCheckpoints = createTranscriptCheckpointManager({
  collector,
  leadFlowSession: "encrypted-session-token",
  onStatus: (status) => diagnosticStatuses.push(status),
  fetchImplementation: async () => new Response(
    JSON.stringify({ status: "call_task_mismatch" }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  ),
});
await failingCheckpoints.checkpoint();
assert.equal(
  diagnosticStatuses.length,
  0,
  "PARTIAL failures are diagnostic-only and do not present a hard customer-facing error",
);

const unavailableStatuses = [];
const unavailableCheckpoints = createTranscriptCheckpointManager({
  collector,
  leadFlowSession: "encrypted-session-token",
  onStatus: (status) => unavailableStatuses.push(status),
  fetchImplementation: async () => {
    throw new Error("network body intentionally hidden");
  },
});
await unavailableCheckpoints.checkpoint();
assert.equal(
  unavailableStatuses.length,
  0,
  "temporary PARTIAL transport failures stay quiet",
);

const retryCollector = createTranscriptCollector();
retryCollector.markStarted("2026-09-30T10:00:00.000Z");
retryCollector.addCustomerFragment({ delta: "Bitte speichern." });
let finalAttempts = 0;
const retryDelays = [];
const retryStatuses = [];
const retryingFinal = createTranscriptCheckpointManager({
  collector: retryCollector,
  leadFlowSession: "encrypted-session-token",
  onStatus: (status) => retryStatuses.push(status),
  onDiagnostic: () => {},
  delayImplementation: async (delay) => { retryDelays.push(delay); },
  fetchImplementation: async () => {
    finalAttempts += 1;
    if (finalAttempts < 3) throw new Error("temporary transport failure");
    return new Response(JSON.stringify({ status: "persisted" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  },
});
assert.equal(await retryingFinal.finalize(), true);
assert.equal(finalAttempts, 3);
assert.deepEqual(retryDelays, [450, 900]);
assert.equal(retryStatuses.at(-1), "Transcript saved");

const fixedEventId = "00000000-0000-4000-8000-000000000999";
const client = new LeadFlowClient({
  baseUrl: "https://leadflow.example",
  token: "test-token",
  createEventId: () => fixedEventId,
  fetchImplementation: async () => new Response(
    JSON.stringify({ ok: true, duplicate: false }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  ),
});
const canonicalPayload = client.createTranscriptPayload(
  {
    leadId: "lead-canonical",
    callTaskId: "task-canonical",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  {
    revision: 1,
    state: "PARTIAL",
    startedAt: "2026-09-30T10:00:00.000Z",
    segments: [
      { speaker: "CUSTOMER", delta: "Guten " },
      { speaker: "CUSTOMER", delta: "Tag" },
    ],
  },
);
assert.deepEqual(canonicalPayload.segments, [
  { sequence: 0, speaker: "CUSTOMER", text: "Guten " },
  { sequence: 1, speaker: "CUSTOMER", text: "Tag" },
]);
assert.equal(canonicalPayload.segments.map((segment) => segment.text).join(""), "Guten Tag");
assert.equal("source" in canonicalPayload, false);
assert.equal(canonicalPayload.segments.some((segment) => "delta" in segment), false);
assert.equal(voiceAgentTranscriptV1Schema.safeParse(canonicalPayload).success, true);
assert.equal(
  voiceAgentTranscriptV1Schema.safeParse({
    ...canonicalPayload,
    source: "vs-ai-voice-agent",
    segments: [{ speaker: "CUSTOMER", delta: "Guten Tag" }],
  }).success,
  false,
  "the former production payload must fail the canonical compatibility schema",
);
assert.equal(
  voiceAgentTranscriptCheckpointInputSchema.safeParse({
    revision: 1,
    state: "PARTIAL",
    startedAt: "2026-09-30T10:00:00.000Z",
    segments: [{ speaker: "CUSTOMER", delta: "x".repeat(4_001) }],
  }).success,
  false,
  "a collector fragment over 4,000 characters must be rejected",
);
assert.equal(
  voiceAgentTranscriptCheckpointInputSchema.safeParse({
    revision: 1,
    state: "PARTIAL",
    startedAt: "2026-09-30T10:00:00.000Z",
    segments: Array.from({ length: 2_001 }, () => ({
      speaker: "CUSTOMER",
      delta: "x",
    })),
  }).success,
  false,
  "more than 2,000 segments must be rejected",
);
assert.equal(
  voiceAgentTranscriptCheckpointInputSchema.safeParse({
    revision: 1,
    state: "PARTIAL",
    startedAt: "2026-09-30T10:00:00.000Z",
    segments: Array.from({ length: 63 }, () => ({
      speaker: "CUSTOMER",
      delta: "x".repeat(4_000),
    })),
  }).success,
  false,
  "aggregate transcript text over 250,000 characters must be rejected",
);
const finalPayload = client.createTranscriptPayload(
  {
    leadId: "lead-canonical",
    callTaskId: "task-canonical",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  {
    revision: 2,
    state: "FINAL",
    startedAt: "2026-09-30T10:00:00.000Z",
    endedAt: "2026-09-30T10:01:00.000Z",
    segments: [{ speaker: "EMMA", delta: "Auf Wiederhören" }],
  },
);
assert.equal(finalPayload.state, "FINAL");
assert.ok(finalPayload.endedAt);

const mirrorStatuses = [];
const mirrorFailureCheckpoints = createTranscriptCheckpointManager({
  collector: realtime,
  leadFlowSession: "encrypted-session-token",
  onStatus: (status) => mirrorStatuses.push(status),
  fetchImplementation: async () => new Response(
    JSON.stringify({
      status: "persisted",
      calendarMirrorStatus: "calendar_transcript_mirror_failed",
    }),
    { status: 202, headers: { "Content-Type": "application/json" } },
  ),
});
await mirrorFailureCheckpoints.finalize();
assert.equal(
  mirrorStatuses.at(-1),
  "Transcript saved; Calendar mirror failed: calendar_transcript_mirror_failed",
);
assert.doesNotMatch(mirrorStatuses.at(-1), /Transcript failed/);

const responseResult = await client.sendTranscript(
  {
    leadId: "lead-canonical",
    callTaskId: "task-canonical",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  {
    revision: 1,
    state: "PARTIAL",
    startedAt: "2026-09-30T10:00:00.000Z",
    segments: [{ speaker: "CUSTOMER", delta: "Guten Tag" }],
  },
);
assert.equal(responseResult.ok, true, "LeadFlow 2xx response must be accepted");

const [routeSource, leadFlowSource, instructionSource, serviceCatalogSource, outboundSource, stylesSource] =
  await Promise.all([
    readFile(new URL("../routes/leadflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/leadflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../agent/instructions.ts", import.meta.url), "utf8"),
    readFile(new URL("../agent/service-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../../public/outbound-opening.js", import.meta.url), "utf8"),
    readFile(new URL("../../public/styles.css", import.meta.url), "utf8"),
  ]);
assert.match(routeSource, /leadId: session\.leadId/);
assert.match(routeSource, /callTaskId: session\.callTaskId/);
assert.match(routeSource, /conversationId: session\.conversationId/);
assert.ok(
  routeSource.indexOf("sendTranscript(") <
    routeSource.indexOf("mirrorTranscriptToManagedMeeting("),
  "LeadFlow must persist before Calendar mirroring",
);
assert.match(routeSource, /checkpoint\.state === "FINAL"/);
assert.doesNotMatch(
  routeSource,
  /console\.(?:log|info|warn|error)\([^)]*(?:segment\.delta|JSON\.stringify\(checkpoint)/s,
);
assert.match(leadFlowSource, /call-transcript/);
assert.match(leadFlowSource, /text: delta/);
assert.match(leadFlowSource, /sequence\) =>/);
assert.doesNotMatch(instructionSource, /Das Gespräch wird zur Dokumentation automatisch transkribiert/);
assert.match(instructionSource, /VS_WEB_STUDIO_SERVICE_CATALOG/);
assert.match(serviceCatalogSource, /Welcher Bereich ist für Sie gerade am interessantesten/);
assert.match(serviceCatalogSource, /Keine Webseite:/);
assert.match(serviceCatalogSource, /Viele wiederkehrende Kundenfragen:/);
assert.match(serviceCatalogSource, /Manuelles Lead-Chaos:/);
assert.match(serviceCatalogSource, /ein bis drei kurzen gesprochenen Sätzen/);
assert.match(outboundSource, /FIRST_SPEECH_TIMEOUT_MS = 30_000/);
assert.match(outboundSource, /observeTranscript/);
assert.match(stylesSource, /--obsidian:#050505/);
assert.match(stylesSource, /--gold:#e5c477/);
assert.match(stylesSource, /prefers-reduced-motion/);

console.log(
  "Transcript checks passed (collector deltas, canonical sequence/text wire format, limits, spacing, PARTIAL/FINAL, safe diagnostics, LeadFlow-first Calendar order, service policy, no spoken transcript disclosure, and first-speech gate preservation).",
);
