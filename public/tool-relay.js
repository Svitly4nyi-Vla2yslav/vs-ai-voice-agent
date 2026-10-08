const registeredToolNames = new Set([
  "prepareNextStep",
  "getCalendarAvailability",
  "getNextAvailableMeetingSlots",
  "bookMeeting",
  "findEmmaMeetings",
  "rescheduleMeeting",
  "cancelMeeting",
  "updateMeetingDetails",
  "syncLeadFlowInteraction",
]);

export const TOOL_REQUEST_INVALID = "tool_request_invalid";
export const TOOL_BACKEND_UNAVAILABLE = "tool_backend_unavailable";

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export const createToolExecutionContext = (leadFlowContext) => {
  if (!leadFlowContext || typeof leadFlowContext !== "object") {
    return undefined;
  }

  if (isNonEmptyString(leadFlowContext.leadFlowSession)) {
    return { leadFlowSession: leadFlowContext.leadFlowSession };
  }

  if (isNonEmptyString(leadFlowContext.devLeadId)) {
    return { devLeadId: leadFlowContext.devLeadId };
  }

  return undefined;
};

export const categorizeToolRelayFailure = (httpStatus) =>
  httpStatus === 400 ? TOOL_REQUEST_INVALID : TOOL_BACKEND_UNAVAILABLE;

const failureResult = (category) => ({
  status: "tool_error",
  error: category,
  externalActionPerformed: false,
});

const isValidToolResult = (result) =>
  result &&
  typeof result === "object" &&
  typeof result.externalActionPerformed === "boolean" &&
  typeof result.status === "string";

const logRelayFailure = ({ name, httpStatus, category, logError }) => {
  const safeDetails = {
    tool: registeredToolNames.has(name) ? name : "unknown",
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    category,
  };

  try {
    logError("[Agent Tool] relay failed", safeDetails);
  } catch {
    // Diagnostics must never interfere with returning a safe tool result.
  }
};

export const executeToolRelayRequest = async ({
  name,
  arguments: toolArguments,
  leadFlowContext,
  signal,
  fetchImplementation = globalThis.fetch,
  logError = (message, details) => console.error(message, details),
}) => {
  let httpStatus;

  try {
    const toolContext = createToolExecutionContext(leadFlowContext);
    const response = await fetchImplementation("/api/tools/execute", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        arguments: toolArguments,
        ...(toolContext ? { context: toolContext } : {}),
      }),
      signal,
    });

    httpStatus = response.status;
    if (!response.ok) {
      const category = categorizeToolRelayFailure(httpStatus);
      logRelayFailure({ name, httpStatus, category, logError });
      return failureResult(category);
    }

    const result = await response.json();
    if (!isValidToolResult(result)) {
      throw new Error("invalid-tool-result");
    }

    return result;
  } catch {
    if (signal?.aborted) return undefined;

    const category = categorizeToolRelayFailure(httpStatus);
    logRelayFailure({ name, httpStatus, category, logError });
    return failureResult(category);
  }
};
