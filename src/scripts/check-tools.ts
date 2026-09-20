import assert from "node:assert/strict";

import {
  executeAgentTool,
  prepareNextStep,
  prepareNextStepInputSchema,
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

console.log("Tool checks passed (6 assertions/groups).");
