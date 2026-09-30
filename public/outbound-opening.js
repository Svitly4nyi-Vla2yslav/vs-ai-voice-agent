export const OUTBOUND_SALES_MODE = "OUTBOUND_SALES";
export const FIRST_SPEECH_TIMEOUT_MS = 30_000;

export const createFirstSpeechGate = ({
  conversationMode,
  onFirstSpeech,
  onTimeout,
  timeoutMs = FIRST_SPEECH_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) => {
  let timer;
  let started = false;
  let unlocked = conversationMode !== OUTBOUND_SALES_MODE;
  let closed = false;

  const cancelTimer = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  return {
    start() {
      if (started || closed || unlocked) return false;
      started = true;
      timer = setTimer(() => {
        timer = undefined;
        if (unlocked || closed) return;
        closed = true;
        onTimeout();
      }, timeoutMs);
      return true;
    },
    observeTranscript(delta) {
      if (
        closed ||
        unlocked ||
        typeof delta !== "string" ||
        delta.trim().length === 0
      ) {
        return false;
      }
      unlocked = true;
      cancelTimer();
      onFirstSpeech(delta);
      return true;
    },
    close() {
      closed = true;
      cancelTimer();
    },
    isUnlocked() {
      return unlocked;
    },
  };
};
