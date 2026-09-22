import assert from "node:assert/strict";

import {
  leadFlowHandoffResponseSchema,
  syncLeadFlowInteractionInputSchema,
} from "../contracts/leadflow.js";
import {
  createLeadFlowSessionToken,
  readLeadFlowSessionToken,
  resolveLeadFlowToolContext,
} from "../services/leadflow-session.js";
import { LeadFlowClient } from "../services/leadflow.js";
import { syncLeadFlowInteraction } from "../tools/leadflow.js";

const secret = "test-integration-secret-with-at-least-32-characters";
const resolvedLead = {
  ok: true as const,
  lead: {
    id: "canonical-lead-123",
    company: "Muster GmbH",
    contactPerson: "Max Mustermann",
    phone: "+49 511 123456",
    email: "max@example.com",
    crmStatus: "CONTACTED" as const,
  },
};

const requiredLeadFields = {
  id: "canonical-lead-123",
  company: "Muster GmbH",
  crmStatus: "CONTACTED" as const,
};

const populatedContacts = leadFlowHandoffResponseSchema.parse(resolvedLead);
assert.deepEqual(populatedContacts.lead, resolvedLead.lead);

const nullContacts = leadFlowHandoffResponseSchema.parse({
  ok: true,
  lead: {
    ...requiredLeadFields,
    contactPerson: null,
    phone: null,
    email: null,
  },
});
assert.deepEqual(
  {
    contactPerson: nullContacts.lead.contactPerson,
    phone: nullContacts.lead.phone,
    email: nullContacts.lead.email,
  },
  { contactPerson: null, phone: null, email: null },
  "explicit null contact fields remain null",
);

const omittedContacts = leadFlowHandoffResponseSchema.parse({
  ok: true,
  lead: requiredLeadFields,
});
assert.deepEqual(
  {
    contactPerson: omittedContacts.lead.contactPerson,
    phone: omittedContacts.lead.phone,
    email: omittedContacts.lead.email,
  },
  { contactPerson: null, phone: null, email: null },
  "omitted contact fields normalize to null",
);

assert.equal(
  leadFlowHandoffResponseSchema.safeParse({
    ok: true,
    lead: { ...requiredLeadFields, email: "not-an-email" },
  }).success,
  false,
  "invalid present email is rejected",
);
for (const requiredField of ["id", "company", "crmStatus"] as const) {
  const lead = { ...requiredLeadFields } as Record<string, unknown>;
  delete lead[requiredField];
  assert.equal(
    leadFlowHandoffResponseSchema.safeParse({ ok: true, lead }).success,
    false,
    `missing ${requiredField} is rejected`,
  );
}

let capturedAuthorization = "";
let capturedRequestBody: unknown;
const client = new LeadFlowClient({
  baseUrl: "http://localhost:3001",
  token: secret,
  maxTransportRetries: 0,
  fetchImplementation: async (_url, init) => {
    capturedAuthorization =
      new Headers(init?.headers).get("authorization") ?? "";
    capturedRequestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(resolvedLead), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});

const resolution = await client.resolveHandoff("signed-short-lived-token");
assert.equal(resolution.ok, true, "valid handoff resolves");
if (!resolution.ok) throw new Error("Expected valid handoff");
assert.equal(resolution.data.lead.id, "canonical-lead-123");
assert.equal(capturedAuthorization, `Bearer ${secret}`, "Bearer token is server-side");
assert.deepEqual(capturedRequestBody, {
  handoffToken: "signed-short-lived-token",
});

const issuedAt = new Date("2026-09-22T12:00:00.000Z");
const sessionToken = createLeadFlowSessionToken(
  {
    leadId: resolution.data.lead.id,
    company: resolution.data.lead.company,
    contactPerson: resolution.data.lead.contactPerson,
  },
  secret,
  issuedAt,
);
const sessionContext = readLeadFlowSessionToken(
  sessionToken,
  secret,
  new Date("2026-09-22T12:05:00.000Z"),
);
assert.equal(sessionContext?.leadId, "canonical-lead-123", "canonical ID is bound");
assert.equal(sessionToken.includes("canonical-lead-123"), false, "raw ID is not exposed");
assert.equal(
  syncLeadFlowInteractionInputSchema.safeParse({
    leadId: "model-invented-lead",
    outcome: "CALL_COMPLETED",
    summary: "Kunde bestätigte Interesse.",
  }).success,
  false,
  "model cannot override leadId through tool arguments",
);

const modifiedToken = `${sessionToken.slice(0, -1)}${sessionToken.endsWith("A") ? "B" : "A"}`;
assert.equal(
  readLeadFlowSessionToken(modifiedToken, secret, new Date("2026-09-22T12:05:00.000Z")),
  undefined,
  "modified session token fails",
);
assert.equal(
  readLeadFlowSessionToken(sessionToken, secret, new Date("2026-09-22T12:31:00.000Z")),
  undefined,
  "expired session token fails",
);

const handoffFailure = async (status: number, error: string) =>
  await new LeadFlowClient({
    baseUrl: "http://localhost:3001",
    token: secret,
    maxTransportRetries: 0,
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  }).resolveHandoff("untrusted-token");

assert.deepEqual(await handoffFailure(400, "invalid_handoff"), {
  ok: false,
  error: "handoff_invalid",
});
assert.deepEqual(await handoffFailure(410, "handoff_expired"), {
  ok: false,
  error: "handoff_expired",
});
assert.deepEqual(await handoffFailure(404, "lead_not_found"), {
  ok: false,
  error: "lead_not_found",
});
assert.deepEqual(await handoffFailure(401, "unauthorized"), {
  ok: false,
  error: "authentication_failure",
});

const malformedResponse = await new LeadFlowClient({
  baseUrl: "http://localhost:3001",
  token: secret,
  maxTransportRetries: 0,
  fetchImplementation: async () =>
    new Response(JSON.stringify({ ok: true, lead: { id: "incomplete" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
}).resolveHandoff("signed-token");
assert.deepEqual(malformedResponse, { ok: false, error: "provider_error" });

assert.equal(
  resolveLeadFlowToolContext({}, { secret, allowManualLeadId: false }),
  undefined,
  "missing handoff invents no context",
);
assert.equal(
  resolveLeadFlowToolContext(
    { devLeadId: "manual-lead" },
    { secret, allowManualLeadId: false },
  ),
  undefined,
  "manual ID is disabled by default",
);
assert.deepEqual(
  resolveLeadFlowToolContext(
    { devLeadId: "manual-lead" },
    { secret, allowManualLeadId: true },
  ),
  { leadId: "manual-lead" },
  "manual development fallback is explicitly separate",
);

const secondSessionToken = createLeadFlowSessionToken(
  { leadId: "canonical-lead-456", company: "Andere GmbH", contactPerson: null },
  secret,
  issuedAt,
);
assert.equal(
  resolveLeadFlowToolContext(
    { leadFlowSession: secondSessionToken },
    {
      secret,
      allowManualLeadId: false,
      now: new Date("2026-09-22T12:05:00.000Z"),
    },
  )?.leadId,
  "canonical-lead-456",
  "a new session resolves only its own lead",
);
assert.equal(
  resolveLeadFlowToolContext({}, { secret, allowManualLeadId: false }),
  undefined,
  "no previous lead leaks into a context-free session",
);

const resolvedToolContext = resolveLeadFlowToolContext(
  { leadFlowSession: sessionToken },
  {
    secret,
    allowManualLeadId: false,
    now: new Date("2026-09-22T12:05:00.000Z"),
  },
);
let syncedLeadId = "";
const syncResult = await syncLeadFlowInteraction(
  {
    outcome: "CALL_COMPLETED",
    summary: "Kunde bestätigte Interesse an einer Beratung.",
  },
  resolvedToolContext?.leadId,
  {
    send: async (leadId) => {
      syncedLeadId = leadId;
      return {
        ok: true,
        eventId: "44444444-4444-4444-8444-444444444444",
        data: {
          ok: true,
          duplicate: false,
          interactionId: "interaction-1",
          leadId,
          crmStatusBefore: "NEW",
          crmStatusAfter: "CALL",
          appliedChanges: ["message_added"],
        },
      };
    },
  },
);
assert.equal(syncedLeadId, "canonical-lead-123", "sync uses resolved canonical ID");
assert.equal(syncResult.status, "synced");

console.log("LeadFlow handoff checks passed (resolution, sealed context, isolation, fallback, and sync binding).");
