// Parser untuk output `pi --mode json` (NDJSON event stream).
// Mengambil teks assistant terakhir/final, sekaligus menandai error dari stopReason.
export function createPiEventParser() {
  let buffer = "";
  let lastAssistantText = "";
  let finalText = "";
  let partialText = "";
  let lastError = null;

  const extractText = (message) => {
    const content = message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((part) => part?.type === "text" && part.text)
      .map((part) => part.text)
      .join("");
  };

  const handleEvent = (event) => {
    if (!event || typeof event !== "object") return;

    if (event.type === "message_start" && event.message?.role === "assistant") {
      partialText = "";
    }

    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      partialText += event.assistantMessageEvent.delta || "";
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = extractText(event.message);
      if (text) lastAssistantText = text;
      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        lastError = event.message.errorMessage || `Stop reason: ${event.message.stopReason}`;
      }
      if (text && event.message.stopReason === "stop") finalText = text;
      partialText = "";
    }

    if (event.type === "turn_end" && event.message?.role === "assistant") {
      const text = extractText(event.message);
      if (text) {
        lastAssistantText = text;
        finalText = text;
      }
      partialText = "";
    }

    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      for (let i = event.messages.length - 1; i >= 0; i--) {
        if (event.messages[i]?.role === "assistant") {
          const text = extractText(event.messages[i]);
          if (text) {
            lastAssistantText = text;
            finalText = text;
          }
          break;
        }
      }
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // Abaikan baris non-JSON (mis. peringatan startup)
        }
      }
    },
    getText() {
      return partialText || finalText || lastAssistantText;
    },
    getError() {
      return lastError;
    },
  };
}
