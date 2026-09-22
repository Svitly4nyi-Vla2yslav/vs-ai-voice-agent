import assert from "node:assert/strict";

import { syncLeadFlowInteractionInputSchema } from "../contracts/leadflow.js";
import { LeadFlowClient } from "../services/leadflow.js";

const fixedEventId = "11111111-1111-4111-8111-111111111111";
const successBody = {
  ok: true,
  duplicate: false,
  interactionId: "interaction-1",
  leadId: "lead-1",
  crmStatusBefore: "NEW",
  crmStatusAfter: "CONTACTED",
  appliedChanges: ["message_added"],
};
const input = {
  outcome: "CALL_COMPLETED" as const,
  summary: "Kunde wünscht eine Beratung für eine neue Webseite.",
  nextAction: {
    type: "HUMAN_HANDOFF" as const,
    confirmed: true,
    note: "Vladyslav soll sich melden.",
  },
};

const missingConfiguration = await new LeadFlowClient({
  baseUrl: "",
  token: "",
  createEventId: () => fixedEventId,
}).send("lead-1", input);
assert.deepEqual(missingConfiguration, {
  ok: false,
  error: "configuration_missing",
  eventId: fixedEventId,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let capturedUrl = "";
let capturedInit: RequestInit | undefined;
const client = new LeadFlowClient({
  baseUrl: "http://localhost:3001///",
  token: "server-secret-token",
  createEventId: () => fixedEventId,
  now: () => new Date("2026-09-22T10:00:00.000Z"),
  maxTransportRetries: 0,
  fetchImplementation: async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return jsonResponse(successBody, 201);
  },
});

const valid = await client.send("lead-1", input);
assert.equal(valid.ok, true, "valid request succeeds");
assert.equal(
  capturedUrl,
  "http://localhost:3001/api/integrations/voice-agent/interactions",
);
assert.equal(
  new Headers(capturedInit?.headers).get("authorization"),
  "Bearer server-secret-token",
  "Authorization header is server-side",
);
const validPayload = JSON.parse(String(capturedInit?.body));
assert.equal(validPayload.eventId, fixedEventId);
assert.equal(validPayload.interaction.summary, input.summary, "UTF-8 survives JSON encoding");
assert.equal(validPayload.crmStatus, undefined, "sender does not add CRM status");

assert.equal(
  syncLeadFlowInteractionInputSchema.safeParse({ ...input, crmStatus: "WON" }).success,
  false,
  "crmStatus is rejected",
);
for (const forbidden of ["crmStatusAfter", "status", "stage"]) {
  assert.equal(
    syncLeadFlowInteractionInputSchema.safeParse({ ...input, [forbidden]: "CALL" }).success,
    false,
    `${forbidden} is rejected`,
  );
}

const errors = [
  [401, "authentication_failure"],
  [404, "lead_not_found"],
  [400, "invalid_payload"],
  [409, "event_conflict"],
] as const;
for (const [status, expected] of errors) {
  const result = await new LeadFlowClient({
    baseUrl: "https://leadflow.example",
    token: "secret",
    maxTransportRetries: 0,
    createEventId: () => fixedEventId,
    fetchImplementation: async () => jsonResponse({ error: expected }, status),
  }).send("lead-1", input);
  assert.deepEqual(result, { ok: false, error: expected, eventId: fixedEventId });
}

const timeoutResult = await new LeadFlowClient({
  baseUrl: "https://leadflow.example",
  token: "secret",
  timeoutMs: 5,
  maxTransportRetries: 0,
  createEventId: () => fixedEventId,
  fetchImplementation: async (_url, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }),
}).send("lead-1", input);
assert.deepEqual(timeoutResult, { ok: false, error: "timeout", eventId: fixedEventId });

const authValues: string[] = [];
const originalInfo = console.info;
const logs: string[] = [];
console.info = (...values: unknown[]) => logs.push(JSON.stringify(values));
try {
  await new LeadFlowClient({
    baseUrl: "https://leadflow.example",
    token: "never-log-this-token",
    maxTransportRetries: 0,
    createEventId: () => fixedEventId,
    fetchImplementation: async (_url, init) => {
      authValues.push(new Headers(init?.headers).get("authorization") ?? "");
      return jsonResponse(successBody);
    },
  }).send("lead-1", input);
} finally {
  console.info = originalInfo;
}
assert.equal(logs.join(" ").includes("never-log-this-token"), false, "token is never logged");
assert.equal(authValues[0], "Bearer never-log-this-token");

const duplicate = await new LeadFlowClient({
  baseUrl: "https://leadflow.example",
  token: "secret",
  maxTransportRetries: 0,
  createEventId: () => fixedEventId,
  fetchImplementation: async () => jsonResponse({ ...successBody, duplicate: true }),
}).send("lead-1", input);
assert.equal(duplicate.ok && duplicate.data.duplicate, true, "duplicate is successful");

const malformed = await new LeadFlowClient({
  baseUrl: "https://leadflow.example",
  token: "secret",
  maxTransportRetries: 0,
  createEventId: () => fixedEventId,
  fetchImplementation: async () => jsonResponse({ ok: true, duplicate: false }),
}).send("lead-1", input);
assert.deepEqual(malformed, { ok: false, error: "provider_error", eventId: fixedEventId });

const retryBodies: string[] = [];
let retryCalls = 0;
const retried = await new LeadFlowClient({
  baseUrl: "https://leadflow.example",
  token: "secret",
  createEventId: () => fixedEventId,
  fetchImplementation: async (_url, init) => {
    retryBodies.push(String(init?.body));
    retryCalls += 1;
    if (retryCalls === 1) throw new Error("temporary network error");
    return jsonResponse(successBody);
  },
}).send("lead-1", input);
assert.equal(retried.ok, true);
assert.equal(retryBodies.length, 2);
assert.equal(
  JSON.parse(retryBodies[0] as string).eventId,
  JSON.parse(retryBodies[1] as string).eventId,
  "eventId remains stable across transport retry",
);

let sequence = 0;
const eventIds: string[] = [];
const newInteractionClient = new LeadFlowClient({
  baseUrl: "https://leadflow.example",
  token: "secret",
  maxTransportRetries: 0,
  createEventId: () =>
    sequence++ === 0
      ? "22222222-2222-4222-8222-222222222222"
      : "33333333-3333-4333-8333-333333333333",
  fetchImplementation: async (_url, init) => {
    eventIds.push(JSON.parse(String(init?.body)).eventId);
    return jsonResponse({ ...successBody, interactionId: `interaction-${eventIds.length}` });
  },
});
await newInteractionClient.send("lead-1", input);
await newInteractionClient.send("lead-1", input);
assert.notEqual(eventIds[0], eventIds[1], "new interaction gets a new eventId");

const calendarInput = syncLeadFlowInteractionInputSchema.parse({
  outcome: "MEETING_BOOKED",
  summary: "Beratung per Google Meet am 29.09. um 15:00 bestätigt.",
  calendar: {
    confirmed: true,
    eventId: "google-event-1",
    start: "2026-09-29T15:00:00+02:00",
    end: "2026-09-29T15:30:00+02:00",
    meetingMode: "GOOGLE_MEET",
  },
});
const calendarPayload = client.createPayload("lead-1", calendarInput);
assert.deepEqual(calendarPayload.calendar, calendarInput.calendar, "confirmed calendar maps exactly");
assert.equal(
  syncLeadFlowInteractionInputSchema.safeParse({
    outcome: "MEETING_BOOKED",
    summary: "Termin nur besprochen.",
    calendar: { confirmed: false },
  }).success,
  false,
  "unconfirmed meeting cannot be sent as MEETING_BOOKED",
);

assert.equal(
  syncLeadFlowInteractionInputSchema.safeParse({
    outcome: "CALLBACK_REQUESTED",
    summary: "Kunde bittet um Rückruf am 30.09.",
    followUp: {
      requested: true,
      confirmed: true,
      date: "2026-09-30",
      reason: "Beratung zur Webseite",
    },
  }).success,
  true,
  "confirmed callback maps with a concrete date",
);
assert.equal(
  syncLeadFlowInteractionInputSchema.safeParse({
    outcome: "CALLBACK_REQUESTED",
    summary: "Kunde bittet irgendwann um Rückruf.",
    followUp: { requested: true, confirmed: true },
  }).success,
  false,
  "ambiguous confirmed callback is rejected",
);

console.log("LeadFlow checks passed (client, contract, idempotency, errors, and Calendar mapping).");
