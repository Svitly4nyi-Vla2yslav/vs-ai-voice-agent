import { createFirstSpeechGate } from "/outbound-opening.js";
import {
  executeToolRelayRequest,
  TOOL_BACKEND_UNAVAILABLE,
  TOOL_REQUEST_INVALID,
} from "/tool-relay.js";

const loggedLiveEvents = new Set([
  "session.started",
  "session.closed",
  "session.delegation.created",
  "response.event",
  "error",
  "info",
]);

const logLiveEvent = (serverEvent) => {
  if (!loggedLiveEvents.has(serverEvent.type)) return;

  const safeDetails = { type: serverEvent.type };
  if (serverEvent.type === "session.closed") {
    safeDetails.reason = serverEvent.reason;
    if (Number.isFinite(serverEvent.usage?.seconds)) {
      safeDetails.usageSeconds = serverEvent.usage.seconds;
    }
  } else if (serverEvent.type === "error") {
    safeDetails.errorCode = serverEvent.error?.code;
    safeDetails.errorType = serverEvent.error?.type;
  } else if (serverEvent.type === "info") {
    safeDetails.infoCode = serverEvent.code;
  } else if (serverEvent.type === "session.delegation.created") {
    safeDetails.delegationTarget = serverEvent.delegation?.target;
  } else if (serverEvent.type === "response.event") {
    safeDetails.responseEventType = serverEvent.event?.type;
  }

  const logMethod = serverEvent.type === "error" ? "error" : "debug";
  console[logMethod]("[OpenAI Live]", safeDetails);
};

export const startLiveConversation = async ({
  voice,
  remoteAudio,
  setStatus,
  setToolActivity,
  setLeadFlowStatus,
  setBackendCacheStatus,
  leadFlowContext,
  transcriptCollector,
  transcriptCheckpoints,
  renderTranscript,
  onSilenceTimeout,
  signal,
}) => {
  let connection;
  let channel;
  let stream;
  let speakingTimer;
  let closed = false;
  const handledToolCalls = new Set();
  let toolQueue = Promise.resolve();

  const promptCacheUsageFromResponse = (response) => {
    const usage = response?.usage;
    if (!Number.isInteger(usage?.input_tokens) || usage.input_tokens < 0) {
      return undefined;
    }

    const cacheDetails = usage.input_tokens_details;
    return {
      inputTokens: usage.input_tokens,
      ...(Number.isInteger(cacheDetails?.cached_tokens) &&
      cacheDetails.cached_tokens >= 0
        ? { cachedTokens: cacheDetails.cached_tokens }
        : {}),
      ...(Number.isInteger(cacheDetails?.cache_write_tokens) &&
      cacheDetails.cache_write_tokens >= 0
        ? { cacheWriteTokens: cacheDetails.cache_write_tokens }
        : {}),
    };
  };

  const reportPromptCacheUsage = async (usage) => {
    try {
      const response = await fetch("/api/live/cache-usage", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(usage),
        signal,
      });
      if (!response.ok) return;
      const telemetry = await response.json();
      if (Number.isFinite(telemetry?.hitRate)) {
        setBackendCacheStatus(`${Math.round(telemetry.hitRate * 100)}% reused`);
      }
    } catch {
      // Cache telemetry is diagnostic-only and must never interrupt the call.
    }
  };

  const sendLiveEvent = (clientEvent) => {
    if (closed || channel?.readyState !== "open") {
      throw new Error("live-channel-unavailable");
    }
    channel.send(JSON.stringify(clientEvent));
  };
  const firstSpeechGate = createFirstSpeechGate({
    conversationMode: leadFlowContext?.conversationMode,
    onFirstSpeech: () => setStatus("Listening"),
    onTimeout: () => {
      void transcriptCheckpoints.finalize();
      close();
      onSilenceTimeout();
    },
  });

  const executeToolCall = async (item) => {
    if (
      item?.type !== "function_call" ||
      typeof item.call_id !== "string" ||
      !item.call_id ||
      typeof item.name !== "string" ||
      !item.name ||
      typeof item.arguments !== "string"
    ) {
      return;
    }

    if (handledToolCalls.has(item.call_id)) return;
    handledToolCalls.add(item.call_id);
    if (item.name === "getCalendarAvailability") {
      setToolActivity("Checking calendar");
    } else if (item.name === "getNextAvailableMeetingSlots") {
      setToolActivity("Finding next available slots");
    } else if (item.name === "bookMeeting") {
      setToolActivity("Booking requested");
    } else if (item.name === "findEmmaMeetings") {
      setToolActivity("Finding meeting");
    } else if (item.name === "rescheduleMeeting") {
      setToolActivity("Rescheduling");
    } else if (item.name === "cancelMeeting") {
      setToolActivity("Cancelling");
    } else if (item.name === "updateMeetingDetails") {
      setToolActivity("Updating meeting details");
    } else if (item.name === "prepareNextStep") {
      setToolActivity("prepareNextStep requested");
    } else if (item.name === "syncLeadFlowInteraction") {
      setToolActivity("LeadFlow syncing");
      setLeadFlowStatus("Syncing");
    } else {
      setToolActivity("Tool error");
    }

    const result = await executeToolRelayRequest({
      name: item.name,
      arguments: item.arguments,
      leadFlowContext,
      signal,
    });
    if (signal?.aborted || !result) return;

    if (
      result.status === "tool_error" &&
      result.error === TOOL_REQUEST_INVALID
    ) {
      setToolActivity("Tool request invalid");
    } else if (
      result.status === "tool_error" &&
      result.error === TOOL_BACKEND_UNAVAILABLE
    ) {
      setToolActivity("Tool backend unavailable");
    } else if (result.status === "needs_clarification") {
      setToolActivity("Clarification required");
    } else if (result.status === "prepared_only") {
      setToolActivity("prepareNextStep completed");
    } else if (result.status === "available") {
      setToolActivity("Slot available");
    } else if (
      result.status === "unavailable" ||
      result.status === "outside_working_hours" ||
      result.status === "slot_no_longer_available"
    ) {
      setToolActivity("Slot unavailable");
    } else if (
      result.status === "confirmed" &&
      result.externalActionPerformed === true
    ) {
      setToolActivity("Meeting confirmed");
    } else if (result.status === "meeting_found") {
      setToolActivity("Meeting found");
    } else if (result.status === "multiple_meetings") {
      setToolActivity("Clarification required");
    } else if (result.status === "rescheduled") {
      setToolActivity("Meeting rescheduled");
    } else if (result.status === "cancelled") {
      setToolActivity("Meeting cancelled");
    } else if (result.status === "details_updated") {
      setToolActivity("Meeting details updated");
    } else if (result.status === "synced") {
      setToolActivity("LeadFlow synced");
      setLeadFlowStatus("Synced");
    } else if (result.status === "duplicate_accepted") {
      setToolActivity("LeadFlow duplicate accepted");
      setLeadFlowStatus("Duplicate accepted");
    } else if (result.status === "leadflow_error") {
      setToolActivity("LeadFlow sync error");
      setLeadFlowStatus(
        result.reason === "lead_not_found"
          ? "Lead not found"
          : result.reason === "configuration_missing"
            ? "Not configured"
            : "Sync error",
      );
    } else if (
      result.status === "no_meetings" ||
      result.status === "not_found" ||
      result.status === "not_found_or_already_cancelled" ||
      result.status === "not_managed_by_emma" ||
      result.status === "recurring_event_not_supported" ||
      result.status === "details_required" ||
      result.status === "confirmation_required"
    ) {
      setToolActivity("Clarification required");
    } else if (
      result.status === "calendar_error" ||
      result.status === "duplicate_conflict"
    ) {
      setToolActivity("Calendar error");
    } else {
      setToolActivity("Tool error");
    }

    try {
      sendLiveEvent({
        type: "response.item.create",
        item: {
          type: "function_call_output",
          call_id: item.call_id,
          output: JSON.stringify(result),
        },
      });
      sendLiveEvent({ type: "response.create" });
    } catch {
      setToolActivity("Tool error");
    }
  };

  const handleResponseEvent = (serverEvent) => {
    const nestedEvent = serverEvent.event;
    if (
      nestedEvent?.type === "response.output_item.done" &&
      nestedEvent.item?.type === "function_call"
    ) {
      toolQueue = toolQueue
        .then(() => executeToolCall(nestedEvent.item))
        .catch(() => setToolActivity("Tool error"));
    } else if (nestedEvent?.type === "response.failed") {
      setToolActivity("Tool error");
    } else if (nestedEvent?.type === "response.completed") {
      const usage = promptCacheUsageFromResponse(nestedEvent.response);
      if (usage) void reportPromptCacheUsage(usage);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    firstSpeechGate.close();
    clearTimeout(speakingTimer);
    signal?.removeEventListener("abort", close);

    if (channel?.readyState === "open") {
      try {
        channel.send(JSON.stringify({ type: "session.close" }));
      } catch {
        // Closing the local transport remains sufficient if the channel races shut.
      }
    }

    stream?.getTracks().forEach((track) => track.stop());
    channel?.close();
    connection?.close();
    remoteAudio.srcObject = null;
  };

  signal?.addEventListener("abort", close, { once: true });

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    connection = new RTCPeerConnection();
    connection.ontrack = (event) => {
      remoteAudio.srcObject =
        event.streams[0] ?? new MediaStream([event.track]);
      void remoteAudio.play().catch(() => {
        setStatus("Connected, but the browser blocked audio playback.");
      });
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        setStatus("Connected");
      } else if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected"
      ) {
        setStatus("The Live WebRTC connection ended unexpectedly.");
        close();
      }
    };

    for (const track of stream.getAudioTracks()) {
      connection.addTrack(track, stream);
    }

    channel = connection.createDataChannel("oai-events");
    channel.addEventListener("message", (event) => {
      try {
        const serverEvent = JSON.parse(event.data);
        logLiveEvent(serverEvent);

        if (serverEvent.type === "session.started") {
          transcriptCollector.markStarted();
          transcriptCheckpoints.start();
          firstSpeechGate.start();
          setStatus("Listening");
        } else if (serverEvent.type === "session.input_transcript.delta") {
          transcriptCollector.addCustomerFragment({
            delta: serverEvent.delta,
            startMs: serverEvent.start_ms,
            endMs: serverEvent.end_ms,
          });
          transcriptCheckpoints.noteChanged();
          renderTranscript();
          firstSpeechGate.observeTranscript(serverEvent.delta);
          setStatus("Listening");
        } else if (serverEvent.type === "session.output_transcript.delta") {
          transcriptCollector.addEmmaFragment({
            delta: serverEvent.delta,
            startMs: serverEvent.start_ms,
            endMs: serverEvent.end_ms,
          });
          transcriptCheckpoints.noteChanged();
          renderTranscript();
          setStatus("AI speaking");
          clearTimeout(speakingTimer);
          speakingTimer = setTimeout(() => setStatus("Listening"), 1_200);
        } else if (serverEvent.type === "session.closed") {
          void transcriptCheckpoints.finalize();
          setStatus("Conversation ended");
        } else if (serverEvent.type === "response.event") {
          handleResponseEvent(serverEvent);
        } else if (serverEvent.type === "error") {
          setStatus("The Live session reported an error.");
        }
      } catch {
        setStatus("Received an unreadable Live event.");
      }
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    const sdp = connection.localDescription?.sdp ?? offer.sdp;
    if (!sdp) throw new Error("live-offer-missing");

    const response = await fetch("/api/live/session", {
      method: "POST",
      headers: {
        Accept: "application/sdp",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sdp,
        voice,
        ...(leadFlowContext?.leadFlowSession
          ? { leadFlowSession: leadFlowContext.leadFlowSession }
          : {}),
      }),
      signal,
    });

    if (!response.ok) throw new Error("live-session-request-failed");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    await connection.setRemoteDescription({
      type: "answer",
      sdp: await response.text(),
    });

    return { close };
  } catch (error) {
    close();

    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error("microphone-denied");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("connection-aborted");
    }
    throw error;
  }
};
