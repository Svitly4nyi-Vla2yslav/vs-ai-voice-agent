import { startLiveConversation } from "/live-client.js";

const startButton = document.querySelector("#start");
const endButton = document.querySelector("#end");
const statusElement = document.querySelector("#status");
const remoteAudio = document.querySelector("#remote-audio");
const modeSelect = document.querySelector("#mode");
const voiceSelect = document.querySelector("#voice");
const modelElement = document.querySelector("#model");
const outputVolumeSlider = document.querySelector("#output-volume");
const outputVolumeValue = document.querySelector("#output-volume-value");

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
  remoteAudio.srcObject = null;
  modeSelect.disabled = false;
  voiceSelect.disabled = false;
  startButton.disabled = false;
  endButton.disabled = true;
};

const requestClientSecret = async (voice) => {
  let response;
  try {
    response = await fetch("/api/realtime/client-secret", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice }),
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

  startButton.disabled = true;
  endButton.disabled = false;
  modeSelect.disabled = true;
  voiceSelect.disabled = true;
  const currentAttempt = ++connectionAttempt;
  const selectedMode = modeSelect.value;
  const selectedVoice = voiceSelect.value;

  try {
    setStatus("Connecting");
    if (selectedMode === "live") {
      const abortController = new AbortController();
      connectionAbortController = abortController;
      const liveConversation = await startLiveConversation({
        voice: selectedVoice,
        remoteAudio,
        setStatus,
        signal: abortController.signal,
      });

      if (currentAttempt !== connectionAttempt) {
        liveConversation.close();
        return;
      }

      activeLiveConversation = liveConversation;
      return;
    }

    const clientSecret = await requestClientSecret(selectedVoice);
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
    channel.addEventListener("open", () => {
      if (eventChannel === channel) {
        setStatus("Listening");
      }
    });
    channel.addEventListener("message", (event) => {
      try {
        const serverEvent = JSON.parse(event.data);
        logRealtimeEvent(serverEvent);
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

window.addEventListener("beforeunload", cleanup);
