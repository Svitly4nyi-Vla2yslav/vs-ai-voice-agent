export type PromptCacheUsage = {
  inputTokens?: number | undefined;
  cachedTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
};

export type PromptCacheTelemetry = PromptCacheUsage & {
  hitRate?: number;
};

/**
 * Обчислює частку cached tokens від загальної кількості input tokens.
 * Повертає `undefined`, якщо лічильники відсутні або inputTokens не додатний,
 * щоб телеметрія не містила некоректного ділення чи штучного нуля.
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
 * Пропускає поля зі значенням `undefined` і додає hitRate лише коли його можна обчислити.
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
