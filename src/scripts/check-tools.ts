import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { DateTime } from "luxon";

// Browser modules are JavaScript; exercise the same relay used by Live.
// @ts-expect-error JavaScript browser module has no declaration file.
import { executeToolRelayRequest } from "../../public/tool-relay.js";

import {
  createToolsRouter,
  toolExecutionRequestSchema,
} from "../routes/tools.js";
import {
  createLeadFlowSessionToken,
  readLeadFlowSessionToken,
} from "../services/leadflow-session.js";
import {
  GoogleCalendarService,
  type CalendarEventDetailsUpdate,
  type CalendarEventToInsert,
  type CalendarGateway,
  type CalendarSettings,
  type StoredCalendarEvent,
} from "../services/google-calendar.js";

import {
  agentTools,
  cancelMeetingInputSchema,
  createAgentToolExecutor,
  executeAgentTool,
  findEmmaMeetingsInputSchema,
  prepareNextStep,
  prepareNextStepInputSchema,
  rescheduleMeetingInputSchema,
  type AgentToolExecutionContext,
  updateMeetingDetailsInputSchema,
} from "../tools/index.js";

const validInput = {
  type: "CALLBACK_REQUESTED",
  date: "2026-09-25",
  time: "15:00",
} as const;

const parsedValidInput = prepareNextStepInputSchema.safeParse(validInput);
assert.equal(parsedValidInput.success, true, "valid input should parse");
if (!parsedValidInput.success) process.exitCode = 1;

assert.equal(
  prepareNextStepInputSchema.safeParse({ type: "NOT_SUPPORTED" }).success,
  false,
  "invalid action type should fail",
);
assert.equal(
  prepareNextStepInputSchema.safeParse({
    ...validInput,
    arbitraryField: "blocked",
  }).success,
  false,
  "unknown fields should fail",
);

const missingDate = await executeAgentTool("prepareNextStep", {
  type: "CALLBACK_REQUESTED",
  time: "15:00",
});
assert.deepEqual(missingDate, {
  status: "needs_clarification",
  action: "CALLBACK_REQUESTED",
  missing: ["date"],
  externalActionPerformed: false,
});

const unknownTool = await executeAgentTool("notRegistered", {});
assert.deepEqual(unknownTool, {
  status: "tool_error",
  error: "unknown_tool",
  externalActionPerformed: false,
});

const executionResult = await executeAgentTool(
  "prepareNextStep",
  JSON.stringify({
    ...validInput,
    contactName: null,
    companyName: null,
    timeWindow: null,
    email: null,
    phone: null,
    reason: null,
    notes: null,
  }),
);
assert.equal(executionResult.status, "prepared_only");
assert.equal(executionResult.externalActionPerformed, false);

const actionInputs = [
  validInput,
  { type: "BOOK_MEETING", date: "2026-09-25", timeWindow: "15:00-16:00" },
  { type: "SEND_INFORMATION", email: "customer@example.com" },
  { type: "HUMAN_HANDOFF" },
] as const;

for (const input of actionInputs) {
  const result = await executeAgentTool("prepareNextStep", input);
  assert.equal(result.externalActionPerformed, false);
}

assert.deepEqual(
  agentTools.map((tool) => tool.name),
  [
    "prepareNextStep",
    "getCalendarAvailability",
    "getNextAvailableMeetingSlots",
    "bookMeeting",
    "findEmmaMeetings",
    "rescheduleMeeting",
    "cancelMeeting",
    "updateMeetingDetails",
    "syncLeadFlowInteraction",
  ],
);
assert.equal(findEmmaMeetingsInputSchema.safeParse({}).success, true);
assert.equal(
  rescheduleMeetingInputSchema.safeParse({
    meetingRef: "emma_bWFuYWdlZC1ldmVudA",
    newStart: "2026-09-28T14:00:00+02:00",
    newEnd: "2026-09-28T14:30:00+02:00",
    timezone: "Europe/Berlin",
    confirmation: true,
    idempotencyKey: "reschedule-test-1",
  }).success,
  true,
);
assert.equal(
  cancelMeetingInputSchema.safeParse({
    meetingRef: "emma_bWFuYWdlZC1ldmVudA",
    confirmation: false,
    idempotencyKey: "cancel-test-1",
  }).success,
  false,
);
assert.equal(
  updateMeetingDetailsInputSchema.safeParse({
    meetingRef: "emma_bWFuYWdlZC1ldmVudA",
    notes: "Discuss automation",
  }).success,
  true,
);

const missingLeadContext = await executeAgentTool("syncLeadFlowInteraction", {
  outcome: "CALL_COMPLETED",
  summary: "Kunde bestätigte einen nächsten Schritt.",
});
assert.deepEqual(missingLeadContext, {
  status: "leadflow_error",
  reason: "invalid_payload",
  externalActionPerformed: false,
});
const forbiddenCrmStatus = await executeAgentTool("syncLeadFlowInteraction", {
  outcome: "CALL_COMPLETED",
  summary: "Kunde bestätigte einen nächsten Schritt.",
  crmStatus: "WON",
});
assert.deepEqual(forbiddenCrmStatus, {
  status: "tool_error",
  error: "invalid_arguments",
  externalActionPerformed: false,
});

class ToolRelayCalendarGateway implements CalendarGateway {
  readonly events = new Map<string, StoredCalendarEvent>();
  readonly busyQueries: Array<{ timeMin: string; timeMax: string }> = [];
  insertionCount = 0;

  async authenticate(): Promise<void> {}

  async checkCalendarAccess(): Promise<{ summary: string }> {
    return { summary: "VS Web Studio Booking" };
  }

  async getBusyPeriods(
    timeMin: string,
    timeMax: string,
  ): Promise<[]> {
    this.busyQueries.push({ timeMin, timeMax });
    return [];
  }

  async getBusyPeriodsExcludingEvent(): Promise<[]> {
    return [];
  }

  async getEvent(eventId: string): Promise<StoredCalendarEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async listManagedEvents(): Promise<StoredCalendarEvent[]> {
    return [...this.events.values()];
  }

  async insertEvent(
    input: CalendarEventToInsert,
  ): Promise<StoredCalendarEvent> {
    this.insertionCount += 1;
    const event: StoredCalendarEvent = {
      id: input.id,
      summary: input.summary,
      description: input.description,
      start: input.start,
      end: input.end,
      timezone: input.timezone,
      ...(input.location ? { location: input.location } : {}),
      ...(input.meetingMode === "GOOGLE_MEET"
        ? { meetUrl: "https://meet.google.com/mock-relay" }
        : {}),
      hasConference: input.meetingMode === "GOOGLE_MEET",
      recurring: false,
      privateProperties: { ...input.privateProperties },
    };
    this.events.set(event.id, event);
    return event;
  }

  async updateEvent(): Promise<StoredCalendarEvent> {
    throw new Error("Unexpected update in tool relay regression");
  }

  async updateEventDetails(
    _eventId: string,
    _update: CalendarEventDetailsUpdate,
  ): Promise<StoredCalendarEvent> {
    throw new Error("Unexpected details update in tool relay regression");
  }

  async deleteEvent(): Promise<void> {
    throw new Error("Unexpected delete in tool relay regression");
  }
}

const relaySecret = "tool-relay-regression-secret";
const leadFlowSession = createLeadFlowSessionToken(
  {
    leadId: "authoritative-lead-4f",
    callTaskId: "authoritative-task-4f",
    company: "Relay Regression GmbH",
    contactPerson: "Ada Test",
    callBrief: { callObjective: "Test the Calendar relay" },
  },
  relaySecret,
);
const authoritativeSession = readLeadFlowSessionToken(
  leadFlowSession,
  relaySecret,
);
assert.equal(authoritativeSession?.version, 2);
if (!authoritativeSession || authoritativeSession.version !== 2) {
  throw new Error("Expected a task-aware LeadFlow session");
}

const availabilityArguments = {
  date: "2026-10-13",
  startTime: "14:00",
  endTime: null,
  timeWindow: null,
  durationMinutes: 30,
  timezone: "Europe/Berlin",
} as const;
const validRelayRequest = {
  name: "getCalendarAvailability",
  arguments: JSON.stringify(availabilityArguments),
  context: { leadFlowSession },
};
assert.equal(
  toolExecutionRequestSchema.safeParse(validRelayRequest).success,
  true,
  "leadFlowSession-only context must remain valid",
);
assert.equal(
  toolExecutionRequestSchema.safeParse({
    ...validRelayRequest,
    context: { leadFlowSession, conversationMode: "OUTBOUND_SALES" },
  }).success,
  false,
  "conversationMode must remain outside the strict server trust boundary",
);

const relayCalendarGateway = new ToolRelayCalendarGateway();
const relayCalendarSettings: CalendarSettings = {
  calendarId: "relay-test-calendar@example.com",
  timezone: "Europe/Berlin",
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00",
  defaultDurationMinutes: 30,
  bufferMinutes: 30,
};
const relayCalendarService = new GoogleCalendarService(
  relayCalendarGateway,
  relayCalendarSettings,
);
let availabilityExecutionCount = 0;
let nextSlotsExecutionCount = 0;
let bookingExecutionCount = 0;
let bookingContext: AgentToolExecutionContext = {};
const relayDispatcher = createAgentToolExecutor({
  getCalendarAvailability: async (input) => {
    availabilityExecutionCount += 1;
    return relayCalendarService.getAvailability(input);
  },
  getNextAvailableMeetingSlots: async (input) => {
    nextSlotsExecutionCount += 1;
    return relayCalendarService.getNextAvailableMeetingSlots(
      input,
      DateTime.fromISO("2026-10-07T10:07:00+02:00", { setZone: true }),
    );
  },
  bookMeeting: async (input, context = {}) => {
    bookingExecutionCount += 1;
    bookingContext = { ...context };
    return relayCalendarService.bookMeeting(input, context);
  },
});

const relayApp = express();
relayApp.use(express.json());
let dispatcherExecutionCount = 0;
let resolvedRouteContext: AgentToolExecutionContext = {};
relayApp.use(
  createToolsRouter({
    leadFlowIntegrationToken: relaySecret,
    allowManualLeadId: false,
    executeTool: async (name, argumentsValue, context) => {
      dispatcherExecutionCount += 1;
      resolvedRouteContext = { ...context };
      return relayDispatcher(name, argumentsValue, context);
    },
  }),
);

const relayServer = await new Promise<Server>((resolve) => {
  const server = relayApp.listen(0, "127.0.0.1", () => resolve(server));
});
try {
  const address = relayServer.address() as AddressInfo;
  const relayOrigin = `http://127.0.0.1:${address.port}`;
  const postTool = (body: unknown): Promise<Response> =>
    fetch(`${relayOrigin}/api/tools/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: relayOrigin,
      },
      body: JSON.stringify(body),
    });

  const availabilityResponse = await postTool(validRelayRequest);
  assert.equal(availabilityResponse.status, 200);
  assert.equal(availabilityResponse.headers.get("cache-control"), "no-store");
  assert.equal(
    ((await availabilityResponse.json()) as { status?: string }).status,
    "available",
  );
  assert.equal(dispatcherExecutionCount, 1);
  assert.equal(availabilityExecutionCount, 1);
  assert.equal(relayCalendarGateway.busyQueries.length, 1);
  assert.deepEqual(resolvedRouteContext, {
    leadId: "authoritative-lead-4f",
    callTaskId: "authoritative-task-4f",
    conversationId: authoritativeSession.conversationId,
  });

  const browserResult = await executeToolRelayRequest({
    name: "getCalendarAvailability",
    arguments: JSON.stringify(availabilityArguments),
    leadFlowContext: {
      leadFlowSession,
      conversationMode: "OUTBOUND_SALES",
      leadId: "browser-must-not-override",
      callTaskId: "browser-must-not-override",
      conversationId: "browser-must-not-override",
      company: "Private browser data",
      phone: "+49 30 123456",
    },
    fetchImplementation: async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.context, { leadFlowSession });
      return fetch(`${relayOrigin}${url}`, {
        ...init,
        headers: { ...init.headers, origin: relayOrigin },
      });
    },
  });
  assert.equal(browserResult.status, "available");
  assert.equal(availabilityExecutionCount, 2);

  const executionsBeforeInvalidRequest = dispatcherExecutionCount;
  const invalidContextResponse = await postTool({
    ...validRelayRequest,
    context: { leadFlowSession, conversationMode: "OUTBOUND_SALES" },
  });
  assert.equal(invalidContextResponse.status, 400);
  assert.equal(
    dispatcherExecutionCount,
    executionsBeforeInvalidRequest,
    "strict-schema rejection must happen before the dispatcher",
  );
  assert.equal(availabilityExecutionCount, 2);

  const nextSlotsResponse = await postTool({
    name: "getNextAvailableMeetingSlots",
    arguments: { durationMinutes: 30, timezone: "Europe/Berlin" },
    context: { leadFlowSession },
  });
  assert.equal(nextSlotsResponse.status, 200);
  assert.equal(
    ((await nextSlotsResponse.json()) as { status?: string }).status,
    "available",
  );
  assert.equal(nextSlotsExecutionCount, 1);

  const bookingResponse = await postTool({
    name: "bookMeeting",
    arguments: {
      contactName: "Ada Test",
      companyName: "Relay Regression GmbH",
      start: "2026-10-13T14:00:00+02:00",
      end: "2026-10-13T14:30:00+02:00",
      timezone: "Europe/Berlin",
      customerEmail: null,
      meetingMode: "GOOGLE_MEET",
      phone: null,
      useCurrentCallNumber: null,
      location: null,
      reason: "Calendar relay regression",
      currentSituation: null,
      desiredOutcome: null,
      notes: null,
      confirmation: true,
      idempotencyKey: "phase-4f-route-booking",
    },
    context: { leadFlowSession },
  });
  assert.equal(bookingResponse.status, 200);
  assert.equal(
    ((await bookingResponse.json()) as { status?: string }).status,
    "confirmed",
  );
  assert.equal(bookingExecutionCount, 1);
  assert.deepEqual(bookingContext, {
    callTaskId: "authoritative-task-4f",
    conversationId: authoritativeSession.conversationId,
  });
  assert.equal(relayCalendarGateway.insertionCount, 1);
  const insertedEvent = [...relayCalendarGateway.events.values()][0];
  assert.ok(insertedEvent);
  assert.equal(
    insertedEvent.privateProperties.vsAiCallTaskRef,
    createHash("sha256")
      .update("call-task:authoritative-task-4f")
      .digest("hex"),
  );
  assert.equal(
    insertedEvent.privateProperties.vsAiConversationRef,
    createHash("sha256")
      .update(`conversation:${authoritativeSession.conversationId}`)
      .digest("hex"),
  );
  assert.equal(
    JSON.stringify(insertedEvent.privateProperties).includes(
      "authoritative-task-4f",
    ),
    false,
  );
} finally {
  await new Promise<void>((resolve, reject) => {
    relayServer.close((error) => (error ? reject(error) : resolve()));
  });
}

console.log(
  "Tool checks passed (registry, strict lifecycle/LeadFlow schemas, server-authoritative relay context, and mocked Calendar execution/booking).",
);
