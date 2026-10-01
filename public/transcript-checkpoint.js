export const createTranscriptCheckpointManager = ({
  collector,
  leadFlowSession,
  onStatus = () => {},
  fetchImplementation = fetch,
  intervalMs = 10_000,
  textThreshold = 2_000,
  setIntervalImplementation = setInterval,
  clearIntervalImplementation = clearInterval,
}) => {
  let lastPersistedRevision = 0;
  let lastPersistedTextSize = 0;
  let interval;
  let stopped = false;
  let queue = Promise.resolve(false);
  let finalPromise;

  const send = async (state, keepalive = false) => {
    const snapshot = collector.snapshot();
    if (snapshot.segments.length === 0) return false;
    if (state === "PARTIAL" && snapshot.revision <= lastPersistedRevision) {
      return false;
    }
    let response;
    try {
      response = await fetchImplementation("/api/leadflow/transcript", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadFlowSession,
          ...snapshot,
          state,
        }),
        keepalive,
      });
    } catch {
      onStatus("Transcript checkpoint failed: leadflow_unavailable");
      return false;
    }
    let result;
    try {
      result = await response.json();
    } catch {
      result = undefined;
    }
    if (!response.ok) {
      const safeReasons = new Set([
        "invalid_payload",
        "authentication_failure",
        "lead_not_found",
        "call_task_not_found",
        "call_task_mismatch",
        "stale_revision",
        "event_conflict",
        "leadflow_unavailable",
        "provider_error",
      ]);
      const reason = safeReasons.has(result?.status)
        ? result.status
        : "provider_error";
      onStatus(`Transcript checkpoint failed: ${reason}`);
      return false;
    }
    lastPersistedRevision = snapshot.revision;
    lastPersistedTextSize = collector.getTotalTextSize();
    onStatus(state === "FINAL" ? "Transcript saved" : "Transcript checkpointed");
    const calendarMirrorFailures = new Set([
      "not_managed_by_emma",
      "call_task_mismatch",
      "calendar_transcript_mirror_failed",
    ]);
    if (state === "FINAL" && calendarMirrorFailures.has(result?.calendarMirrorStatus)) {
      onStatus(`Transcript saved; Calendar mirror failed: ${result.calendarMirrorStatus}`);
    }
    return true;
  };

  const checkpoint = (state = "PARTIAL", keepalive = false) => {
    queue = queue.then(
      () => send(state, keepalive),
      () => send(state, keepalive),
    );
    return queue;
  };

  return {
    start() {
      if (interval || stopped) return;
      interval = setIntervalImplementation(() => {
        void checkpoint("PARTIAL");
      }, intervalMs);
    },
    noteChanged() {
      if (
        !stopped &&
        collector.getTotalTextSize() - lastPersistedTextSize >= textThreshold
      ) {
        void checkpoint("PARTIAL");
      }
    },
    checkpoint,
    finalize({ keepalive = true } = {}) {
      if (finalPromise) return finalPromise;
      if (!stopped) {
        stopped = true;
        if (interval) clearIntervalImplementation(interval);
        interval = undefined;
        collector.markFinal();
      }
      finalPromise = checkpoint("FINAL", keepalive);
      return finalPromise;
    },
    stop() {
      stopped = true;
      if (interval) clearIntervalImplementation(interval);
      interval = undefined;
    },
  };
};
