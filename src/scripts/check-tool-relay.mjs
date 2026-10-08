import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  categorizeToolRelayFailure,
  createToolExecutionContext,
  executeToolRelayRequest,
  TOOL_BACKEND_UNAVAILABLE,
  TOOL_REQUEST_INVALID,
} from "../../public/tool-relay.js";

const leadFlowSession = "signed-session-token";
const taskAwareContext = {
  leadFlowSession,
  devLeadId: "must-not-win-over-session",
  conversationMode: "OUTBOUND_SALES",
  leadId: "lead-123",
  callTaskId: "task-456",
  conversationId: "conversation-789",
  company: "Private Customer GmbH",
  callObjective: "Private objective",
  phone: "+49 30 123456",
};

assert.deepEqual(createToolExecutionContext(taskAwareContext), {
  leadFlowSession,
});
for (const forbiddenKey of [
  "conversationMode",
  "leadId",
  "callTaskId",
  "conversationId",
  "company",
  "callObjective",
  "phone",
  "devLeadId",
]) {
  assert.equal(
    Object.hasOwn(createToolExecutionContext(taskAwareContext), forbiddenKey),
    false,
    `${forbiddenKey} must not cross the browser tool-context boundary`,
  );
}

assert.deepEqual(
  createToolExecutionContext({
    devLeadId: "manual-lead-123",
    conversationMode: "OUTBOUND_SALES",
    company: "Private Customer GmbH",
  }),
  { devLeadId: "manual-lead-123" },
);
assert.equal(createToolExecutionContext(undefined), undefined);
assert.equal(createToolExecutionContext({ conversationMode: "OUTBOUND_SALES" }), undefined);

let capturedRequest;
const calendarArguments = JSON.stringify({
  date: "2026-10-13",
  startTime: "14:00",
  endTime: "14:30",
  durationMinutes: 30,
  timezone: "Europe/Berlin",
});
const availableResult = {
  status: "available",
  externalActionPerformed: false,
};
const relayedResult = await executeToolRelayRequest({
  name: "getCalendarAvailability",
  arguments: calendarArguments,
  leadFlowContext: taskAwareContext,
  fetchImplementation: async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => availableResult,
    };
  },
});

assert.deepEqual(relayedResult, availableResult);
assert.equal(capturedRequest.url, "/api/tools/execute");
assert.equal(capturedRequest.options.method, "POST");
assert.deepEqual(JSON.parse(capturedRequest.options.body), {
  name: "getCalendarAvailability",
  arguments: calendarArguments,
  context: { leadFlowSession },
});

assert.equal(categorizeToolRelayFailure(400), TOOL_REQUEST_INVALID);
assert.equal(categorizeToolRelayFailure(503), TOOL_BACKEND_UNAVAILABLE);
assert.equal(categorizeToolRelayFailure(undefined), TOOL_BACKEND_UNAVAILABLE);

const serverFailureResult = await executeToolRelayRequest({
  name: "getCalendarAvailability",
  arguments: calendarArguments,
  leadFlowContext: taskAwareContext,
  fetchImplementation: async () => ({ ok: false, status: 503 }),
  logError: () => {},
});
assert.deepEqual(serverFailureResult, {
  status: "tool_error",
  error: TOOL_BACKEND_UNAVAILABLE,
  externalActionPerformed: false,
});

const invalidRequestLogs = [];
const invalidRequestResult = await executeToolRelayRequest({
  name: "getCalendarAvailability",
  arguments: calendarArguments,
  leadFlowContext: taskAwareContext,
  fetchImplementation: async () => ({ ok: false, status: 400 }),
  logError: (message, details) => invalidRequestLogs.push({ message, details }),
});
assert.deepEqual(invalidRequestResult, {
  status: "tool_error",
  error: TOOL_REQUEST_INVALID,
  externalActionPerformed: false,
});
assert.deepEqual(invalidRequestLogs, [
  {
    message: "[Agent Tool] relay failed",
    details: {
      tool: "getCalendarAvailability",
      httpStatus: 400,
      category: TOOL_REQUEST_INVALID,
    },
  },
]);

const backendFailureLogs = [];
const backendFailureResult = await executeToolRelayRequest({
  name: "getCalendarAvailability",
  arguments: calendarArguments,
  leadFlowContext: taskAwareContext,
  fetchImplementation: async () => {
    throw new Error("network details that must not be logged");
  },
  logError: (message, details) => backendFailureLogs.push({ message, details }),
});
assert.deepEqual(backendFailureResult, {
  status: "tool_error",
  error: TOOL_BACKEND_UNAVAILABLE,
  externalActionPerformed: false,
});
assert.deepEqual(backendFailureLogs, [
  {
    message: "[Agent Tool] relay failed",
    details: {
      tool: "getCalendarAvailability",
      category: TOOL_BACKEND_UNAVAILABLE,
    },
  },
]);

const serializedLogs = JSON.stringify([
  ...invalidRequestLogs,
  ...backendFailureLogs,
]);
for (const privateValue of [
  leadFlowSession,
  calendarArguments,
  taskAwareContext.company,
  taskAwareContext.phone,
]) {
  assert.equal(serializedLogs.includes(privateValue), false);
}
assert.equal(
  backendFailureResult.status === "unavailable" ||
    backendFailureResult.status === "slot_no_longer_available",
  false,
  "technical relay failures must not masquerade as Calendar conflicts",
);

const [liveSource, realtimeSource] = await Promise.all([
  readFile(new URL("../../public/live-client.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/app.js", import.meta.url), "utf8"),
]);
assert.match(liveSource, /executeToolRelayRequest\(\{/);
assert.doesNotMatch(liveSource, /context:\s*leadFlowContext/);
assert.doesNotMatch(
  realtimeSource,
  /fetch\(["']\/api\/tools\/execute["']/,
  "Realtime fallback currently has no separate tool relay to sanitize",
);

console.log(
  "Browser tool-relay checks passed (strict context allowlist, session preference, production Calendar request, privacy-safe error categories, and technical-failure semantics).",
);
