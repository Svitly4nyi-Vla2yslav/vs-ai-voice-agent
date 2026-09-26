import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createOutboundOpeningRequester,
  OUTBOUND_SALES_MODE,
} from "../../public/outbound-opening.js";

const liveEvents = [];
const liveOpening = createOutboundOpeningRequester((event) => {
  liveEvents.push(event);
});
assert.equal(liveOpening.request(OUTBOUND_SALES_MODE), true);
assert.equal(liveOpening.request(OUTBOUND_SALES_MODE), false);
assert.equal(liveOpening.request(OUTBOUND_SALES_MODE), false);
assert.deepEqual(liveEvents, [{ type: "response.create" }]);

const realtimeEvents = [];
const realtimeOpening = createOutboundOpeningRequester((event) => {
  realtimeEvents.push(event);
});
assert.equal(realtimeOpening.request(undefined), false);
assert.equal(realtimeOpening.request("INBOUND_RECEPTION"), false);
assert.equal(realtimeOpening.request(OUTBOUND_SALES_MODE), true);
assert.equal(realtimeOpening.request(OUTBOUND_SALES_MODE), false);
assert.deepEqual(realtimeEvents, [{ type: "response.create" }]);

const [liveSource, realtimeSource, instructionSource] = await Promise.all([
  readFile(new URL("../../public/live-client.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../agent/instructions.ts", import.meta.url), "utf8"),
]);
assert.match(liveSource, /outboundOpening\.request\(leadFlowContext\?\.conversationMode\)/);
assert.match(realtimeSource, /outboundOpening\.request\(leadFlowContext\.conversationMode\)/);
assert.match(instructionSource, /HARTE STOPPS/);
assert.match(instructionSource, /Bitte rufen Sie nicht mehr an/);
assert.match(instructionSource, /CONVERSATION MODE: OUTBOUND_SALES/);
assert.match(instructionSource, /Emma hat diesen vorbereiteten Geschaeftsanruf initiiert/);
assert.match(instructionSource, /Beginne diesen ausgehenden Anruf niemals/);

console.log(
  "Outbound mode checks passed (unbound safety, exactly-once Live/Realtime opening, and hard-stop preservation).",
);
