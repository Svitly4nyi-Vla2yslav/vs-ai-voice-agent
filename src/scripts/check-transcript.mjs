import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createTranscriptCheckpointManager } from "../../public/transcript-checkpoint.js";
import { createTranscriptCollector } from "../../public/transcript-collector.js";

const collector = createTranscriptCollector({
  now: () => new Date("2026-09-30T10:00:00.000Z"),
});
collector.markStarted();
collector.addCustomerFragment({ delta: "Guten", startMs: 100, endMs: 200 });
collector.addEmmaFragment({ delta: "Hallo", startMs: 300, endMs: 400 });
collector.addCustomerFragment({ delta: " Tag", startMs: 200, endMs: 300 });
assert.deepEqual(collector.snapshot().segments, [
  { speaker: "CUSTOMER", delta: "Guten", startMs: 100, endMs: 200 },
  { speaker: "CUSTOMER", delta: " Tag", startMs: 200, endMs: 300 },
  { speaker: "EMMA", delta: "Hallo", startMs: 300, endMs: 400 },
]);
assert.equal(collector.getTotalTextSize(), "Guten TagHallo".length);

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
let intervalCallback;
const checkpoints = createTranscriptCheckpointManager({
  collector: realtime,
  leadFlowSession: "encrypted-session-token",
  fetchImplementation: async (_url, init) => {
    checkpointPayloads.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ status: "persisted" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  },
  setIntervalImplementation: (callback, delay) => {
    assert.equal(delay, 10_000);
    intervalCallback = callback;
    return 10;
  },
  clearIntervalImplementation: () => {},
});
checkpoints.start();
intervalCallback();
await checkpoints.checkpoint();
assert.equal(checkpointPayloads[0].state, "PARTIAL");
assert.equal(checkpointPayloads[0].segments.length, 2);
await checkpoints.finalize({ keepalive: true });
assert.equal(checkpointPayloads.at(-1).state, "FINAL");
assert.ok(checkpointPayloads.at(-1).endedAt);

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

const [routeSource, leadFlowSource] = await Promise.all([
  readFile(new URL("../routes/leadflow.ts", import.meta.url), "utf8"),
  readFile(new URL("../services/leadflow.ts", import.meta.url), "utf8"),
]);
assert.match(routeSource, /leadId: session\.leadId/);
assert.match(routeSource, /callTaskId: session\.callTaskId/);
assert.match(routeSource, /conversationId: session\.conversationId/);
assert.ok(
  routeSource.indexOf("leadFlowClient.sendTranscript") <
    routeSource.indexOf("mirrorTranscriptToManagedMeeting"),
  "LeadFlow must persist the final transcript before the Calendar mirror runs",
);
assert.doesNotMatch(
  routeSource,
  /console\.(?:log|info|warn|error)\([^)]*(?:segment\.delta|JSON\.stringify\(checkpoint)/s,
);
assert.match(leadFlowSource, /call-transcript/);
assert.match(leadFlowSource, /const eventId = this\.#options\.createEventId\(\)/);

console.log(
  "Transcript checks passed (Live/Realtime capture, exact deltas/timestamps, completed-turn replacement, ordered snapshots, partial/final checkpoints, canonical session IDs, empty suppression, and privacy-safe logging).",
);
