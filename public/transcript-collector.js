export const createTranscriptCollector = ({ now = () => new Date() } = {}) => {
  let startedAt;
  let endedAt;
  let state = "PARTIAL";
  let revision = 0;
  let sequence = 0;
  let segments = [];
  const realtimeItemOrder = [];

  const markChanged = () => {
    revision += 1;
  };

  const registerRealtimeItem = (itemId, previousItemId) => {
    if (typeof itemId !== "string" || !itemId) return;
    const existingIndex = realtimeItemOrder.indexOf(itemId);
    if (existingIndex >= 0) realtimeItemOrder.splice(existingIndex, 1);
    if (previousItemId === "root" || previousItemId === null) {
      realtimeItemOrder.unshift(itemId);
      return;
    }
    const previousIndex = realtimeItemOrder.indexOf(previousItemId);
    if (previousIndex >= 0) {
      realtimeItemOrder.splice(previousIndex + 1, 0, itemId);
    } else {
      realtimeItemOrder.push(itemId);
    }
  };

  const add = ({ speaker, delta, startMs, endMs, itemId, source }) => {
    if (
      (speaker !== "CUSTOMER" && speaker !== "EMMA") ||
      typeof delta !== "string" ||
      delta.length === 0 ||
      state === "FINAL"
    ) {
      return false;
    }
    sequence += 1;
    segments.push({
      speaker,
      delta,
      ...(Number.isInteger(startMs) && startMs >= 0 ? { startMs } : {}),
      ...(Number.isInteger(endMs) && endMs >= 0 ? { endMs } : {}),
      ...(typeof itemId === "string" && itemId ? { itemId } : {}),
      source,
      sequence,
    });
    markChanged();
    return true;
  };

  const orderedInternalSegments = () =>
    [...segments].sort((left, right) => {
      if (left.source === "live" && right.source === "live") {
        const leftStart = left.startMs ?? Number.MAX_SAFE_INTEGER;
        const rightStart = right.startMs ?? Number.MAX_SAFE_INTEGER;
        return leftStart - rightStart || left.sequence - right.sequence;
      }
      if (left.source === "realtime" && right.source === "realtime") {
        const leftOrder = realtimeItemOrder.indexOf(left.itemId);
        const rightOrder = realtimeItemOrder.indexOf(right.itemId);
        return (
          (leftOrder < 0 ? Number.MAX_SAFE_INTEGER : leftOrder) -
            (rightOrder < 0 ? Number.MAX_SAFE_INTEGER : rightOrder) ||
          left.sequence - right.sequence
        );
      }
      return left.sequence - right.sequence;
    });

  const joinText = (left, right) => {
    if (!left) return right.trimStart();
    if (!right) return left;
    if (/\s$/u.test(left) || /^\s/u.test(right)) return `${left}${right}`;
    if (/^[,.;:!?%)\]}]/u.test(right) || /[(\[{â€žâ€œ"']$/u.test(left)) {
      return `${left}${right}`;
    }
    return `${left} ${right}`;
  };

  const startsNewTurn = (previous, current) => {
    if (!previous || previous.speaker !== current.speaker) return true;
    if (
      previous.source === "realtime" &&
      current.source === "realtime" &&
      previous.itemId &&
      current.itemId &&
      previous.itemId !== current.itemId
    ) return true;
    if (previous.endMs === undefined || current.startMs === undefined) return false;
    const pause = current.startMs - previous.endMs;
    return pause >= 1_200 || (pause >= 500 && /[.!?â€¦][â€"']?\s*$/u.test(previous.delta));
  };

  const snapshotSegments = () => {
    const turns = [];
    let previous;
    for (const segment of orderedInternalSegments()) {
      const currentTurn = turns.at(-1);
      if (startsNewTurn(previous, segment) || !currentTurn) {
        turns.push({
          speaker: segment.speaker,
          delta: segment.delta.trimStart(),
          ...(segment.startMs !== undefined ? { startMs: segment.startMs } : {}),
          ...(segment.endMs !== undefined ? { endMs: segment.endMs } : {}),
        });
      } else {
        currentTurn.delta = joinText(currentTurn.delta, segment.delta);
        if (segment.endMs !== undefined) currentTurn.endMs = segment.endMs;
      }
      previous = segment;
    }
    return turns
      .map((turn) => ({ ...turn, delta: turn.delta.trim() }))
      .filter((turn) => turn.delta.length > 0);
  };

  return {
    markStarted(value = now().toISOString()) {
      if (!startedAt) startedAt = value;
      return startedAt;
    },
    addCustomerFragment(fragment) {
      return add({ speaker: "CUSTOMER", source: "live", ...fragment });
    },
    addEmmaFragment(fragment) {
      return add({ speaker: "EMMA", source: "live", ...fragment });
    },
    registerRealtimeItem,
    addRealtimeCustomerFragment(itemId, delta) {
      if (!realtimeItemOrder.includes(itemId)) registerRealtimeItem(itemId);
      return add({
        speaker: "CUSTOMER",
        source: "realtime",
        itemId,
        delta,
      });
    },
    addRealtimeEmmaFragment(itemId, delta) {
      if (!realtimeItemOrder.includes(itemId)) registerRealtimeItem(itemId);
      return add({
        speaker: "EMMA",
        source: "realtime",
        itemId,
        delta,
      });
    },
    finalizeRealtimeTurn(speaker, itemId, transcript) {
      if (
        (speaker !== "CUSTOMER" && speaker !== "EMMA") ||
        typeof itemId !== "string" ||
        !itemId ||
        typeof transcript !== "string" ||
        state === "FINAL"
      ) {
        return false;
      }
      if (!realtimeItemOrder.includes(itemId)) registerRealtimeItem(itemId);
      const matching = segments.filter(
        (segment) => segment.itemId === itemId && segment.speaker === speaker,
      );
      const replacementSequence =
        matching.reduce(
          (lowest, segment) => Math.min(lowest, segment.sequence),
          Number.MAX_SAFE_INTEGER,
        ) || ++sequence;
      segments = segments.filter(
        (segment) => !(segment.itemId === itemId && segment.speaker === speaker),
      );
      if (transcript.length > 0) {
        segments.push({
          speaker,
          delta: transcript,
          itemId,
          source: "realtime",
          sequence:
            replacementSequence === Number.MAX_SAFE_INTEGER
              ? ++sequence
              : replacementSequence,
        });
      }
      markChanged();
      return true;
    },
    markFinal(value = now().toISOString()) {
      if (state !== "FINAL") {
        state = "FINAL";
        endedAt = value;
        markChanged();
      }
    },
    snapshot() {
      return {
        revision,
        state,
        startedAt: startedAt ?? now().toISOString(),
        ...(endedAt ? { endedAt } : {}),
        segments: snapshotSegments(),
      };
    },
    getRevision() {
      return revision;
    },
    getSegmentCount() {
      return segments.length;
    },
    getTotalTextSize() {
      return segments.reduce((total, segment) => total + segment.delta.length, 0);
    },
  };
};
