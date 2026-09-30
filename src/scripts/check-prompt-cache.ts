import assert from "node:assert/strict";

import {
  BACKEND_MODEL_BASELINE,
  BACKEND_MODEL_EXPERIMENT,
  backendModelEnvironmentSchema,
} from "../agent/backend-models.js";
import {
  BACKEND_SESSION_CONTEXT_BOUNDARY,
  STATIC_BACKEND_INSTRUCTIONS,
  composeBackendInstructions,
} from "../agent/instructions.js";
import {
  leadFlowConversationContext,
  type TaskAwareLeadFlowSessionContext,
} from "../services/leadflow-session.js";
import { cacheHitRate } from "../services/prompt-cache.js";
import { agentTools, serializedAgentTools } from "../tools/index.js";

const context = (
  company: string,
  callObjective: string,
  leadId: string,
  callTaskId: string,
): TaskAwareLeadFlowSessionContext => ({
  version: 2,
  sessionKind: "task-aware",
  leadId,
  callTaskId,
  conversationId: "00000000-0000-4000-8000-000000000001",
  company,
  contactPerson: "Test Contact",
  callBrief: { callObjective },
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_001_800,
});

const leadA = context(
  "Cache Test Company Alpha",
  "Cache objective alpha",
  "lead-cache-alpha",
  "task-cache-alpha",
);
const leadB = context(
  "Cache Test Company Beta",
  "Cache objective beta",
  "lead-cache-beta",
  "task-cache-beta",
);

const promptA = composeBackendInstructions(leadFlowConversationContext(leadA));
const promptB = composeBackendInstructions(leadFlowConversationContext(leadB));
const boundary = `\n\n${BACKEND_SESSION_CONTEXT_BOUNDARY}\n`;
const stablePart = (prompt: string): string => prompt.split(boundary)[0] ?? "";

assert.equal(stablePart(promptA), STATIC_BACKEND_INSTRUCTIONS);
assert.equal(stablePart(promptB), STATIC_BACKEND_INSTRUCTIONS);
assert.equal(stablePart(promptA), stablePart(promptB));
assert.ok(promptA.startsWith(`${STATIC_BACKEND_INSTRUCTIONS}${boundary}`));

for (const customerValue of [
  leadA.company,
  leadA.callBrief.callObjective,
  leadA.leadId,
  leadA.callTaskId,
  leadB.company,
  leadB.callBrief.callObjective,
  leadB.leadId,
  leadB.callTaskId,
]) {
  assert.equal(
    STATIC_BACKEND_INSTRUCTIONS.includes(customerValue),
    false,
    "customer/session values must not occur in the stable prefix",
  );
}

assert.ok(promptA.indexOf(leadA.company) > promptA.indexOf(boundary));
assert.ok(
  promptA.indexOf(leadA.callBrief.callObjective) > promptA.indexOf(boundary),
);
assert.equal(
  /\b\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?)?\b/.test(
    STATIC_BACKEND_INSTRUCTIONS,
  ),
  false,
  "stable prefix must not contain a generated date or timestamp",
);
assert.equal(/\b(?:leadId|callTaskId)\b/.test(STATIC_BACKEND_INSTRUCTIONS), false);

assert.equal(JSON.stringify(agentTools), serializedAgentTools);
assert.equal(JSON.stringify(agentTools), JSON.stringify(agentTools));
assert.equal(Object.isFrozen(agentTools), true);

const assertCanonicalObjectKeys = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(assertCanonicalObjectKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  const keys = Object.keys(value);
  assert.deepEqual(
    keys,
    [...keys].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
  Object.values(value).forEach(assertCanonicalObjectKeys);
};
assertCanonicalObjectKeys(agentTools);

assert.equal(cacheHitRate(6_400, 5_100), 5_100 / 6_400);
assert.equal(cacheHitRate(0, 0), undefined);
assert.equal(cacheHitRate(6_400, undefined), undefined);

assert.equal(
  backendModelEnvironmentSchema.parse(BACKEND_MODEL_BASELINE),
  BACKEND_MODEL_BASELINE,
);
assert.equal(
  backendModelEnvironmentSchema.parse(BACKEND_MODEL_EXPERIMENT),
  BACKEND_MODEL_EXPERIMENT,
);

console.log("Prompt cache checks passed:");
console.log("- stable backend prefix is identical across different leads");
console.log("- customer/session context begins only after the stable boundary");
console.log("- company and call-objective changes do not alter the prefix");
console.log("- tool definitions and JSON Schema key ordering are byte-stable");
console.log("- stable prefix contains no generated date, timestamp, or session IDs");
console.log("- cache hit rate is calculated only with positive input usage");
console.log("- baseline and experiment backend model values validate");
