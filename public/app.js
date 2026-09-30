import { startLiveConversation } from "/live-client.js";
import { createFirstSpeechGate } from "/outbound-opening.js";
import { createTranscriptCheckpointManager } from "/transcript-checkpoint.js";
import { createTranscriptCollector } from "/transcript-collector.js";

const startButton = document.querySelector("#start");
const endButton = document.querySelector("#end");
const statusElement = document.querySelector("#status");
const remoteAudio = document.querySelector("#remote-audio");
const modeSelect = document.querySelector("#mode");
const voiceSelect = document.querySelector("#voice");
const modelElement = document.querySelector("#model");
const outputVolumeSlider = document.querySelector("#output-volume");
const outputVolumeValue = document.querySelector("#output-volume-value");
const toolActivityElement = document.querySelector("#tool-activity");
const leadFlowLeadIdInput = document.querySelector("#leadflow-lead-id");
const leadFlowStatusElement = document.querySelector("#leadflow-status");
const backendCacheStatusElement = document.querySelector("#backend-cache-status");
const transcriptElement = document.querySelector("#automatic-transcript");
const transcriptStatusElement = document.querySelector("#transcript-status");
const leadFlowContextElement = document.querySelector("#leadflow-context");
const leadFlowModeElement = document.querySelector("#leadflow-mode");
const leadFlowCompanyElement = document.querySelector("#leadflow-company");
const leadFlowContactRow = document.querySelector("#leadflow-contact-row");
const leadFlowContactElement = document.querySelector("#leadflow-contact");
const leadFlowCallStatusElement = document.querySelector("#leadflow-call-status");
const leadFlowObjectiveRow = document.querySelector("#leadflow-objective-row");
const leadFlowObjectiveElement = document.querySelector("#leadflow-objective");
const leadFlowDevFallback = document.querySelector("#leadflow-dev-fallback");

const DEFAULT_OUTPUT_VOLUME = 70;
const OUTPUT_VOLUME_STORAGE_KEY = "vs-voice-agent-output-volume";

const modeModels = {
  realtime: "OpenAI / gpt-realtime-2.1-mini",
  live: "OpenAI / gpt-live-1",
};

let peerConnection;
let microphoneStream;
let eventChannel;
let activeLiveConversation;
let connectionAbortController;
let connectionAttempt = 0;
let activeLeadFlowContext;
let manualFallbackActive = false;
let activeTranscriptCollector;
let activeTranscriptCheckpoints;
let activeFirstSpeechGate;

const loggedRealtimeEvents = new Set([
  "session.created",
  "session.updated",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
  "response.created",
  "response.done",
  "response.cancelled",
  "conversation.item.truncated",
  "output_audio_buffer.cleared",
  "error",
]);

const setStatus = (message) => {
  statusElement.textContent = message;
};

const setToolActivity = (message) => {
  toolActivityElement.textContent = message;
};

const setLeadFlowStatus = (message) => {
  leadFlowStatusElement.textContent = message;
};

const setBackendCacheStatus = (message) => {
  backendCacheStatusElement.textContent = message;
};

const setTranscriptStatus = (message) => {
  transcriptStatusElement.textContent = message;
};

const renderTranscript = () => {
  const segments = activeTranscriptCollector?.snapshot().segments ?? [];
  const turns = [];
  for (const segment of segments) {
    const previous = turns.at(-1);
    if (previous?.speaker === segment.speaker) {
      previous.text += segment.delta;
    } else {
      turns.push({ speaker: segment.speaker, text: segment.delta });
    }
  }
  transcriptElement.replaceChildren();
  for (const turn of turns) {
    const row = document.createElement("p");
    const label = document.createElement("strong");
    label.textContent = turn.speaker === "CUSTOMER" ? "Customer: " : "Emma: ";
    row.append(label, document.createTextNode(turn.text));
    transcriptElement.append(row);
  }
  transcriptElement.scrollTop = transcriptElement.scrollHeight;
};

const noOpTranscriptCheckpoints = {
  start() {},
  noteChanged() {},
  finalize() {
    return Promise.resolve(false);
  },
  stop() {},
};

const leadFlowFailureMessage = (reason) => {
  switch (reason) {
    case "configuration_missing":
      return "LeadFlow not configured";
    case "leadflow_unavailable":
      return "LeadFlow unavailable";
    case "authentication_failure":
      return "LeadFlow authentication failed";
    case "handoff_invalid":
    case "handoff_expired":
      return "Handoff expired or invalid";
    case "lead_not_found":
    case "task_context_missing":
      return "Lead/CallTask unavailable";
    default:
      return "LeadFlow connection failed";
  }
};

const initializeLeadFlowContext = async () => {
  activeLeadFlowContext = undefined;
  manualFallbackActive = false;
  startButton.disabled = true;
  leadFlowContextElement.hidden = true;
  leadFlowModeElement.textContent = "";
  leadFlowCompanyElement.textContent = "";
  leadFlowContactElement.textContent = "";
  leadFlowContactRow.hidden = true;
  leadFlowCallStatusElement.textContent = "";
  leadFlowObjectiveElement.textContent = "";
  leadFlowObjectiveRow.hidden = true;
  leadFlowDevFallback.hidden = true;
  const url = new URL(window.location.href);
  const handoffToken = url.searchParams.get("handoff");
  const manualFallbackRequested =
    url.searchParams.get("dev") === "manual-lead-id";
  if (handoffToken) {
    url.searchParams.delete("handoff");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  try {
    const statusResponse = await fetch("/api/leadflow/status", {
      headers: { Accept: "application/json" },
    });
    const statusBody = statusResponse.ok ? await statusResponse.json() : null;

    if (handoffToken) {
      setLeadFlowStatus("Connecting");
      const response = await fetch("/api/leadflow/handoff", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ handoffToken }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setLeadFlowStatus(leadFlowFailureMessage(body?.reason));
        return;
      }
      if (
        !body?.ok ||
        typeof body.sessionToken !== "string" ||
        typeof body.context?.company !== "string" ||
        body.context?.conversationMode !== "OUTBOUND_SALES" ||
        body.context?.callStatus !== "Ready"
      ) {
        throw new Error("handoff-failed");
      }
      activeLeadFlowContext = {
        leadFlowSession: body.sessionToken,
        conversationMode: body.context.conversationMode,
      };
      leadFlowModeElement.textContent = "Outbound";
      leadFlowCompanyElement.textContent = body.context.company;
      leadFlowCallStatusElement.textContent = body.context.callStatus;
      if (typeof body.context.contactPerson === "string") {
        leadFlowContactElement.textContent = body.context.contactPerson;
        leadFlowContactRow.hidden = false;
      } else {
        leadFlowContactRow.hidden = true;
      }
      if (typeof body.context.callObjective === "string") {
        leadFlowObjectiveElement.textContent = body.context.callObjective;
        leadFlowObjectiveRow.hidden = false;
      }
      leadFlowContextElement.hidden = false;
      setLeadFlowStatus("Connected");
      startButton.disabled = false;
      return;
    }

    if (
      manualFallbackRequested &&
      statusBody?.manualFallbackEnabled === true
    ) {
      manualFallbackActive = true;
      leadFlowDevFallback.hidden = false;
      setLeadFlowStatus("Developer fallback");
      startButton.disabled = false;
      return;
    }

    setLeadFlowStatus("Open this Voice Agent from a prepared LeadFlow call.");
  } catch {
    activeLeadFlowContext = undefined;
    setLeadFlowStatus(
      handoffToken
        ? "LeadFlow connection failed"
        : "Open this Voice Agent from a prepared LeadFlow call.",
    );
  }
};

const readStoredOutputVolume = () => {
  try {
    const storedValue = Number.parseInt(
      localStorage.getItem(OUTPUT_VOLUME_STORAGE_KEY) ?? "",
      10,
    );
    return Number.isFinite(storedValue)
      ? Math.min(100, Math.max(0, storedValue))
      : DEFAULT_OUTPUT_VOLUME;
  } catch {
    return DEFAULT_OUTPUT_VOLUME;
  }
};

const applyOutputVolume = (percentage, persist = false) => {
  const normalizedPercentage = Math.min(
    100,
    Math.max(0, Math.round(percentage)),
  );

  outputVolumeSlider.value = String(normalizedPercentage);
  outputVolumeValue.textContent = `${normalizedPercentage}%`;
  remoteAudio.volume = normalizedPercentage / 100;

  if (persist) {
    try {
      localStorage.setItem(
        OUTPUT_VOLUME_STORAGE_KEY,
        String(normalizedPercentage),
      );
    } catch {
      // Volume still works when browser storage is unavailable.
    }
  }
};

const logRealtimeEvent = (serverEvent) => {
  if (!loggedRealtimeEvents.has(serverEvent.type)) return;

  const safeDetails = { type: serverEvent.type };

  if (serverEvent.type === "response.done") {
    safeDetails.responseStatus = serverEvent.response?.status;
  } else if (serverEvent.type === "error") {
    safeDetails.errorCode = serverEvent.error?.code;
    safeDetails.errorType = serverEvent.error?.type;
  }

  const logMethod = serverEvent.type === "error" ? "error" : "debug";
  console[logMethod]("[OpenAI Realtime]", safeDetails);
};

const updateStatusFromRealtimeEvent = (serverEvent) => {
  switch (serverEvent.type) {
    case "session.created":
      setStatus("Listening");
      break;
    case "session.updated":
      setStatus("Connected");
      break;
    case "input_audio_buffer.speech_started":
      setStatus("Listening");
      break;
    case "input_audio_buffer.speech_stopped":
      setStatus("Connected");
      break;
    case "response.created":
      setStatus("AI speaking");
      break;
    case "response.done":
      setStatus("Listening");
      break;
    case "response.cancelled":
    case "conversation.item.truncated":
    case "output_audio_buffer.cleared":
      setStatus("Listening");
      break;
    case "error":
      setStatus("The Realtime session reported an error.");
      break;
  }
};

const cleanup = () => {
  activeFirstSpeechGate?.close();
  void activeTranscriptCheckpoints?.finalize();
  connectionAttempt += 1;
  connectionAbortController?.abort();
  activeLiveConversation?.close();
  microphoneStream?.getTracks().forEach((track) => track.stop());
  eventChannel?.close();
  peerConnection?.close();

  connectionAbortController = undefined;
  activeLiveConversation = undefined;
  microphoneStream = undefined;
  eventChannel = undefined;
  peerConnection = undefined;
  activeFirstSpeechGate = undefined;
  activeTranscriptCheckpoints = undefined;
  remoteAudio.srcObject = null;
  modeSelect.disabled = false;
  voiceSelect.disabled = false;
  if (manualFallbackActive) leadFlowLeadIdInput.disabled = false;
  startButton.disabled = false;
  endButton.disabled = true;
};

const requestClientSecret = async (voice, leadFlowContext) => {
  let response;
  try {
    response = await fetch("/api/realtime/client-secret", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voice,
        ...(leadFlowContext?.leadFlowSession
          ? { leadFlowSession: leadFlowContext.leadFlowSession }
          : {}),
      }),
    });
  } catch {
    throw new Error("backend-unavailable");
  }

  if (!response.ok) {
    throw new Error("client-secret-request-failed");
  }

  const body = await response.json();
  if (typeof body.clientSecret !== "string" || !body.clientSecret) {
    throw new Error("invalid-client-secret-response");
  }

  return body.clientSecret;
};

const startConversation = async () => {
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser does not support the required WebRTC APIs.");
    return;
  }

  const leadFlowContext = activeLeadFlowContext ??
    (manualFallbackActive && leadFlowLeadIdInput.value.trim()
      ? { devLeadId: leadFlowLeadIdInput.value.trim() }
      : undefined);
  if (!leadFlowContext) {
    setStatus(
      manualFallbackActive
        ? "Enter the developer fallback LeadFlow Lead ID."
        : "LeadFlow connection failed.",
    );
    if (manualFallbackActive) leadFlowLeadIdInput.focus();
    return;
  }

  startButton.disabled = true;
  endButton.disabled = false;
  modeSelect.disabled = true;
  voiceSelect.disabled = true;
  if (manualFallbackActive) leadFlowLeadIdInput.disabled = true;
  const currentAttempt = ++connectionAttempt;
  const selectedMode = modeSelect.value;
  const selectedVoice = voiceSelect.value;

  activeTranscriptCollector = createTranscriptCollector();
  activeTranscriptCheckpoints = leadFlowContext.leadFlowSession
    ? createTranscriptCheckpointManager({
        collector: activeTranscriptCollector,
        leadFlowSession: leadFlowContext.leadFlowSession,
        onStatus: setTranscriptStatus,
      })
    : noOpTranscriptCheckpoints;
  transcriptElement.replaceChildren();
  setTranscriptStatus("Waiting for speech");

  try {
    setStatus("Connecting");
    if (selectedMode === "live") {
      setBackendCacheStatus("No usage data yet");
      const abortController = new AbortController();
      connectionAbortController = abortController;
      const liveConversation = await startLiveConversation({
        voice: selectedVoice,
        remoteAudio,
        setStatus,
        setToolActivity,
        setLeadFlowStatus,
        setBackendCacheStatus,
        leadFlowContext,
        transcriptCollector: activeTranscriptCollector,
        transcriptCheckpoints: activeTranscriptCheckpoints,
        renderTranscript,
        onSilenceTimeout: () => {
          cleanup();
          setStatus("No speech detected – conversation ended");
        },
        signal: abortController.signal,
      });

      if (currentAttempt !== connectionAttempt) {
        liveConversation.close();
        return;
      }

      activeLiveConversation = liveConversation;
      return;
    }

    const clientSecret = await requestClientSecret(selectedVoice, leadFlowContext);
    if (currentAttempt !== connectionAttempt) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (currentAttempt !== connectionAttempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      microphoneStream = stream;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw new Error("microphone-denied");
      }
      throw new Error("microphone-unavailable");
    }

    const connection = new RTCPeerConnection();
    peerConnection = connection;

    connection.ontrack = (event) => {
      if (peerConnection !== connection) return;
      remoteAudio.srcObject =
        event.streams[0] ?? new MediaStream([event.track]);
      void remoteAudio.play().catch(() => {
        setStatus("Connected, but the browser blocked audio playback.");
      });
    };

    connection.onconnectionstatechange = () => {
      if (peerConnection !== connection) return;

      if (connection.connectionState === "connected") {
        setStatus("Connected");
      } else if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected"
      ) {
        cleanup();
        setStatus("The WebRTC connection ended unexpectedly.");
      }
    };

    for (const track of microphoneStream.getAudioTracks()) {
      connection.addTrack(track, microphoneStream);
    }

    const channel = connection.createDataChannel("oai-events");
    eventChannel = channel;
    const firstSpeechGate = createFirstSpeechGate({
      conversationMode: leadFlowContext.conversationMode,
      onFirstSpeech: () => {
        if (eventChannel !== channel || channel.readyState !== "open") return;
        channel.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              audio: {
                input: {
                  turn_detection: {
                    type: "server_vad",
                    create_response: true,
                    interrupt_response: true,
                  },
                },
              },
            },
          }),
        );
        channel.send(JSON.stringify({ type: "response.create" }));
      },
      onTimeout: () => {
        cleanup();
        setStatus("No speech detected – conversation ended");
      },
    });
    activeFirstSpeechGate = firstSpeechGate;
    channel.addEventListener("open", () => {
      if (eventChannel === channel) {
        setStatus("Connecting");
      }
    });
    channel.addEventListener("message", (event) => {
      try {
        const serverEvent = JSON.parse(event.data);
        logRealtimeEvent(serverEvent);
        if (serverEvent.type === "session.created") {
          activeTranscriptCollector.markStarted();
          activeTranscriptCheckpoints.start();
          firstSpeechGate.start();
          setStatus("Listening");
        } else if (serverEvent.type === "conversation.item.created") {
          activeTranscriptCollector.registerRealtimeItem(
            serverEvent.item?.id,
            serverEvent.previous_item_id,
          );
        } else if (
          serverEvent.type ===
          "conversation.item.input_audio_transcription.delta"
        ) {
          if (typeof serverEvent.delta === "string") {
            activeTranscriptCollector.addRealtimeCustomerFragment(
              serverEvent.item_id,
              serverEvent.delta,
            );
            firstSpeechGate.observeTranscript(serverEvent.delta);
            activeTranscriptCheckpoints.noteChanged();
            renderTranscript();
          }
        } else if (
          serverEvent.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          activeTranscriptCollector.finalizeRealtimeTurn(
            "CUSTOMER",
            serverEvent.item_id,
            serverEvent.transcript,
          );
          firstSpeechGate.observeTranscript(serverEvent.transcript);
          activeTranscriptCheckpoints.noteChanged();
          renderTranscript();
        } else if (
          serverEvent.type === "response.output_audio_transcript.delta"
        ) {
          activeTranscriptCollector.addRealtimeEmmaFragment(
            serverEvent.item_id,
            serverEvent.delta,
          );
          activeTranscriptCheckpoints.noteChanged();
          renderTranscript();
        } else if (
          serverEvent.type === "response.output_audio_transcript.done"
        ) {
          activeTranscriptCollector.finalizeRealtimeTurn(
            "EMMA",
            serverEvent.item_id,
            serverEvent.transcript,
          );
          activeTranscriptCheckpoints.noteChanged();
          renderTranscript();
        }
        updateStatusFromRealtimeEvent(serverEvent);
      } catch {
        setStatus("Received an unreadable Realtime event.");
      }
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    const realtimeResponse = await fetch(
      "https://api.openai.com/v1/realtime/calls",
      {
        method: "POST",
        body: connection.localDescription?.sdp ?? offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      },
    );

    if (!realtimeResponse.ok) {
      throw new Error("realtime-connection-failed");
    }
    if (currentAttempt !== connectionAttempt) return;

    await connection.setRemoteDescription({
      type: "answer",
      sdp: await realtimeResponse.text(),
    });
  } catch (error) {
    if (currentAttempt !== connectionAttempt) return;
    cleanup();

    if (error instanceof Error && error.message === "microphone-denied") {
      setStatus("Microphone permission was denied.");
    } else if (
      error instanceof Error &&
      error.message === "microphone-unavailable"
    ) {
      setStatus("No usable microphone is available.");
    } else if (
      error instanceof Error &&
      error.message === "backend-unavailable"
    ) {
      setStatus("The backend is unavailable.");
    } else if (
      error instanceof Error &&
      (error.message === "client-secret-request-failed" ||
        error.message === "invalid-client-secret-response")
    ) {
      setStatus("The backend could not create a Realtime credential.");
    } else if (
      error instanceof Error &&
      error.message === "live-session-request-failed"
    ) {
      setStatus("The backend could not create a Live session.");
    } else {
      setStatus("The WebRTC connection could not be established.");
    }
  }
};

startButton.addEventListener("click", () => {
  void startConversation();
});

endButton.addEventListener("click", () => {
  cleanup();
  setStatus("Conversation ended");
});

modeSelect.addEventListener("change", () => {
  modelElement.textContent = modeModels[modeSelect.value];
});

outputVolumeSlider.addEventListener("input", () => {
  applyOutputVolume(outputVolumeSlider.valueAsNumber, true);
});

modelElement.textContent = modeModels[modeSelect.value];
applyOutputVolume(readStoredOutputVolume());
void initializeLeadFlowContext();

window.addEventListener("beforeunload", cleanup);
