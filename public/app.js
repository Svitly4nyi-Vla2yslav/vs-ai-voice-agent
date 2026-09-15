const startButton = document.querySelector("#start");
const endButton = document.querySelector("#end");
const statusElement = document.querySelector("#status");
const remoteAudio = document.querySelector("#remote-audio");

let peerConnection;
let microphoneStream;
let eventChannel;
let connectionAttempt = 0;

const setStatus = (message) => {
  statusElement.textContent = message;
};

const cleanup = () => {
  connectionAttempt += 1;
  microphoneStream?.getTracks().forEach((track) => track.stop());
  eventChannel?.close();
  peerConnection?.close();

  microphoneStream = undefined;
  eventChannel = undefined;
  peerConnection = undefined;
  remoteAudio.srcObject = null;
  startButton.disabled = false;
  endButton.disabled = true;
};

const requestClientSecret = async () => {
  let response;
  try {
    response = await fetch("/api/realtime/client-secret", {
      method: "POST",
      headers: { Accept: "application/json" },
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
  const currentAttempt = ++connectionAttempt;

  try {
    setStatus("Requesting a short-lived Realtime credential…");
    const clientSecret = await requestClientSecret();
    if (currentAttempt !== connectionAttempt) return;

    setStatus("Waiting for microphone permission…");
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
        setStatus("Connected — speak in German.");
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
        setStatus("Connected — speak in German.");
      }
    });
    channel.addEventListener("message", (event) => {
      try {
        const serverEvent = JSON.parse(event.data);
        if (serverEvent.type === "error") {
          setStatus("The Realtime session reported an error.");
        }
      } catch {
        setStatus("Received an unreadable Realtime event.");
      }
    });

    setStatus("Connecting to OpenAI Realtime…");
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
  setStatus("Conversation ended.");
});

window.addEventListener("beforeunload", cleanup);
