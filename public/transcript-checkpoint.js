/**
 * Створює менеджер періодичного й фінального збереження транскрипту в LeadFlow.
 * Залежності таймерів, fetch і затримки ін'єктуються для тестів; усі записи
 * серіалізуються через одну Promise-чергу, щоб ревізії не обганяли одна одну.
 */
export const createTranscriptCheckpointManager = ({
  collector,
  leadFlowSession,
  onStatus = () => {},
  fetchImplementation = fetch,
  intervalMs = 20_000,
  textThreshold = 4_000,
  finalAttempts = 3,
  retryDelayMs = 450,
  delayImplementation = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  onDiagnostic = (diagnostic) => console.warn("[Transcript]", diagnostic),
  setIntervalImplementation = setInterval,
  clearIntervalImplementation = clearInterval,
}) => {
  let lastPersistedRevision = 0;
  let lastPersistedTextSize = 0;
  let interval;
  let stopped = false;
  let queue = Promise.resolve(false);
  let finalPromise;

  /**
   * Надсилає один snapshot, пропускаючи порожні або вже збережені PARTIAL-ревізії.
   * Повертає структурований результат і розкриває назовні лише дозволені причини помилок.
   */
  const sendOnce = async (state, keepalive = false) => {
    const snapshot = collector.snapshot();
    if (snapshot.segments.length === 0) return { ok: true, skipped: true };
    if (state === "PARTIAL" && snapshot.revision <= lastPersistedRevision) {
      return { ok: true, skipped: true };
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
      return { ok: false, reason: "leadflow_unavailable" };
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
      return { ok: false, reason };
    }
    lastPersistedRevision = snapshot.revision;
    lastPersistedTextSize = collector.getTotalTextSize();
    if (state === "FINAL") onStatus("Transcript saved");
    const calendarMirrorFailures = new Set([
      "not_managed_by_emma",
      "call_task_mismatch",
      "calendar_transcript_mirror_failed",
    ]);
    if (state === "FINAL" && calendarMirrorFailures.has(result?.calendarMirrorStatus)) {
      onStatus(`Transcript saved; Calendar mirror failed: ${result.calendarMirrorStatus}`);
    }
    return { ok: true };
  };

  /**
   * Виконує одну PARTIAL-спробу або кілька FINAL-спроб з експоненційною затримкою.
   * Повертає boolean, записує діагностику кожної невдачі й повідомляє статус фіналу.
   */
  const send = async (state, keepalive = false) => {
    const attempts = state === "FINAL" ? Math.max(1, finalAttempts) : 1;
    let result = { ok: false, reason: "provider_error" };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      result = await sendOnce(state, keepalive);
      if (result.ok) return true;
      onDiagnostic({ state, attempt, attempts, reason: result.reason });
      if (attempt < attempts) {
        await delayImplementation(retryDelayMs * 2 ** (attempt - 1));
      }
    }
    if (state === "FINAL") {
      onStatus(`Transcript could not be saved: ${result.reason}`);
    }
    return false;
  };

  /** Додає збереження до спільної черги навіть після відхилення попередньої операції. */
  const checkpoint = (state = "PARTIAL", keepalive = false) => {
    queue = queue.then(
      () => send(state, keepalive),
      () => send(state, keepalive),
    );
    return queue;
  };

  return {
    /** Запускає єдиний періодичний PARTIAL-checkpoint, якщо менеджер ще активний. */
    start() {
      if (interval || stopped) return;
      interval = setIntervalImplementation(() => {
        void checkpoint("PARTIAL");
      }, intervalMs);
    },
    /** Позапланово ставить PARTIAL-checkpoint у чергу після досягнення текстового порога. */
    noteChanged() {
      if (
        !stopped &&
        collector.getTotalTextSize() - lastPersistedTextSize >= textThreshold
      ) {
        void checkpoint("PARTIAL");
      }
    },
    checkpoint,
    /**
     * Один раз зупиняє таймер, фіналізує колектор і повертає спільний Promise FINAL-запису.
     * keepalive дозволяє браузеру завершити запит під час закриття сторінки.
     */
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
    /** Зупиняє нові автоматичні checkpoint-и та очищує активний інтервал. */
    stop() {
      stopped = true;
      if (interval) clearIntervalImplementation(interval);
      interval = undefined;
    },
  };
};

