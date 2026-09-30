import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createFirstSpeechGate,
  FIRST_SPEECH_TIMEOUT_MS,
  OUTBOUND_SALES_MODE,
} from "../../public/outbound-opening.js";

let scheduledTimeout;
let clearedTimeout;
let firstSpeechCount = 0;
let timeoutCount = 0;
const gate = createFirstSpeechGate({
  conversationMode: OUTBOUND_SALES_MODE,
  onFirstSpeech: () => {
    firstSpeechCount += 1;
  },
  onTimeout: () => {
    timeoutCount += 1;
  },
  setTimer: (callback, delay) => {
    assert.equal(delay, FIRST_SPEECH_TIMEOUT_MS);
    scheduledTimeout = callback;
    return 42;
  },
  clearTimer: (timer) => {
    clearedTimeout = timer;
  },
});
assert.equal(gate.start(), true);
assert.equal(firstSpeechCount, 0, "session start must not greet");
assert.equal(gate.observeTranscript("   \n"), false);
assert.equal(firstSpeechCount, 0, "whitespace/noise must not unlock");
assert.equal(gate.observeTranscript("Guten Tag"), true);
assert.equal(firstSpeechCount, 1);
assert.equal(clearedTimeout, 42, "first speech must cancel the timeout");
assert.equal(gate.observeTranscript("Noch einmal"), false);
assert.equal(firstSpeechCount, 1, "greeting must unlock only once");
scheduledTimeout();
assert.equal(timeoutCount, 0, "cancelled timeout must not close the session");

let silentTimeout;
const silentGate = createFirstSpeechGate({
  conversationMode: OUTBOUND_SALES_MODE,
  onFirstSpeech: () => assert.fail("no sales action before first speech"),
  onTimeout: () => {
    timeoutCount += 1;
  },
  setTimer: (callback) => {
    silentTimeout = callback;
    return 7;
  },
  clearTimer: () => {},
});
silentGate.start();
silentTimeout();
assert.equal(timeoutCount, 1, "30-second silence must close through the gate");

const [liveSource, realtimeSource, instructionSource, realtimeRouteSource] = await Promise.all([
  readFile(new URL("../../public/live-client.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../agent/instructions.ts", import.meta.url), "utf8"),
  readFile(new URL("../routes/realtime.ts", import.meta.url), "utf8"),
]);
assert.doesNotMatch(liveSource, /session\.started[\s\S]{0,300}response\.create/);
assert.match(realtimeSource, /firstSpeechGate\.observeTranscript/);
assert.match(realtimeRouteSource, /create_response: false/);
assert.match(instructionSource, /HARTE STOPPS/);
assert.match(instructionSource, /Bitte rufen Sie nicht mehr an/);
assert.match(instructionSource, /CONVERSATION MODE: OUTBOUND_SALES/);
assert.match(instructionSource, /Emma hat diesen vorbereiteten Geschaeftsanruf initiiert/);
assert.match(instructionSource, /Beginne diesen ausgehenden Anruf niemals/);
assert.match(instructionSource, /automatisch transkribiert/);
assert.doesNotMatch(instructionSource, /Audio wird aufgezeichnet/);

console.log(
  "First-speech checks passed (silent startup, transcript-only unlock, exactly-once greeting, timeout cancellation/closure, and hard-stop preservation).",
);
