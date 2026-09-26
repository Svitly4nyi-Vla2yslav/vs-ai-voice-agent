export const OUTBOUND_SALES_MODE = "OUTBOUND_SALES";

export const createOutboundOpeningRequester = (sendEvent) => {
  let outboundOpeningRequested = false;

  return {
    request(conversationMode) {
      if (
        conversationMode !== OUTBOUND_SALES_MODE ||
        outboundOpeningRequested
      ) {
        return false;
      }
      outboundOpeningRequested = true;
      sendEvent({ type: "response.create" });
      return true;
    },
  };
};
