export type PromptCacheUsage = {
  inputTokens?: number | undefined;
  cachedTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
};

export type PromptCacheTelemetry = PromptCacheUsage & {
  hitRate?: number;
};

/**
 * Обчислює необмежену частку cached tokens від загальної кількості input tokens.
 * @param inputTokens — загальна кількість вхідних токенів; має бути додатною.
 * @param cachedTokens — кількість токенів, прочитаних із кешу.
 * @returns Відношення `cachedTokens / inputTokens` без округлення або `undefined`, якщо лічильників бракує.
 * Функція чиста й не змінює отримані значення.
 */
export const cacheHitRate = (
  inputTokens: number | undefined,
  cachedTokens: number | undefined,
): number | undefined =>
  typeof inputTokens === "number" &&
  inputTokens > 0 &&
  typeof cachedTokens === "number"
    ? cachedTokens / inputTokens
    : undefined;

/**
 * Нормалізує доступні лічильники prompt cache в компактний об'єкт телеметрії.
 * @param usage — необов’язкові лічильники input, cache read і cache write.
 * @returns Новий об’єкт без полів `undefined`; `hitRate` додається лише коли його можна обчислити.
 * Функція не журналює дані й не змінює вхідний об’єкт.
 */
export const promptCacheTelemetry = (
  usage: PromptCacheUsage,
): PromptCacheTelemetry => {
  const hitRate = cacheHitRate(usage.inputTokens, usage.cachedTokens);
  return {
    ...(usage.inputTokens !== undefined
      ? { inputTokens: usage.inputTokens }
      : {}),
    ...(usage.cachedTokens !== undefined
      ? { cachedTokens: usage.cachedTokens }
      : {}),
    ...(usage.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: usage.cacheWriteTokens }
      : {}),
    ...(hitRate !== undefined ? { hitRate } : {}),
  };
};

/**
 * Записує нормалізовану телеметрію prompt cache в інформаційний лог.
 * Функція нічого не повертає; її єдиний побічний ефект — виклик `console.info`.
 */
export const logPromptCacheTelemetry = (usage: PromptCacheUsage): void => {
  console.info("[Prompt Cache]", promptCacheTelemetry(usage));
};
