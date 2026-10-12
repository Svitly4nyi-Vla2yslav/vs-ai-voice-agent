export const OUTBOUND_SALES_MODE = "OUTBOUND_SALES";
export const FIRST_SPEECH_TIMEOUT_MS = 30_000;

/**
 * Створює gate першої репліки для outbound-дзвінка.
 * У звичайному режимі він одразу відкритий; у `OUTBOUND_SALES` очікує перший непорожній transcript,
 * викликає `onFirstSpeech` один раз або завершує очікування через `onTimeout`.
 */
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

  // Безпечно скасовує активний таймер і очищує посилання для повторних викликів.
  const cancelTimer = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  return {
    // Запускає timeout лише один раз для ще закритого outbound gate.
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
    // Перший непорожній текст відкриває gate, скасовує timeout і передає початкову репліку callback.
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
    // Остаточно закриває gate та прибирає таймер без виклику timeout-callback.
    close() {
      closed = true;
      cancelTimer();
    },
    // Дає викликачеві прочитати поточний стан без його зміни.
    isUnlocked() {
      return unlocked;
    },
  };
};
