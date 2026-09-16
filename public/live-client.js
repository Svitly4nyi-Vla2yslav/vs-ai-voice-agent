const loggedLiveEvents = new Set([
  "session.started",
  "session.closed",
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
  }

  const logMethod = serverEvent.type === "error" ? "error" : "debug";
  console[logMethod]("[OpenAI Live]", safeDetails);
};

export const startLiveConversation = async ({
  voice,
  remoteAudio,
  setStatus,
  signal,
}) => {
  let connection;
  let channel;
  let stream;
  let speakingTimer;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
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
          setStatus("Listening");
        } else if (serverEvent.type === "session.input_transcript.delta") {
          setStatus("Listening");
        } else if (serverEvent.type === "session.output_transcript.delta") {
          setStatus("AI speaking");
          clearTimeout(speakingTimer);
          speakingTimer = setTimeout(() => setStatus("Listening"), 1_200);
        } else if (serverEvent.type === "session.closed") {
          setStatus("Conversation ended");
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
      body: JSON.stringify({ sdp, voice }),
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
