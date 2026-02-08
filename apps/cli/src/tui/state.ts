export interface TuiEvent {
  id: string;
  sessionId: string;
  kind: string;
  payload: unknown;
  createdAt: number;
}

export interface FormattedEvent {
  variant: "user" | "assistant" | "tool" | "activity" | "error";
  header: string;
  body?: string;
  color?: string;
  accent?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function truncateText(value: string, max = 320): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatEventTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function payloadText(payload: Record<string, unknown>): string {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (text) return text;
  return truncateText(JSON.stringify(payload));
}

export function formatEvent(event: TuiEvent): FormattedEvent | null {
  const payload = asRecord(event.payload);
  const time = formatEventTime(event.createdAt);

  if (event.kind === "assistant_delta") return null;

  if (event.kind === "assistant") {
    const text = payloadText(payload);
    return {
      variant: "assistant",
      header: `assistant · ${time}`,
      body: text || "(empty assistant response)",
      color: "#f4f4f5",
      accent: "#334155",
    };
  }

  if (event.kind === "user") {
    const text = payloadText(payload);
    return {
      variant: "user",
      header: `you · ${time}`,
      body: text || "(empty message)",
      color: "#dbeafe",
      accent: "#2563eb",
    };
  }

  if (event.kind === "tool_call") {
    const tool = typeof payload.tool === "string" ? payload.tool : "tool";
    const input = asRecord(payload.input ?? payload.args);
    return {
      variant: "tool",
      header: `tool call · ${tool} · ${time}`,
      body:
        Object.keys(input).length > 0 ? truncateText(JSON.stringify(input)) : undefined,
      color: "#93c5fd",
      accent: "#1d4ed8",
    };
  }

  if (event.kind === "tool_result") {
    const tool = typeof payload.tool === "string" ? payload.tool : "tool";
    const output =
      typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output ?? {});
    return {
      variant: "tool",
      header: `tool result · ${tool} · ${time}`,
      body: truncateText(output),
      color: "#86efac",
      accent: "#15803d",
    };
  }

  if (event.kind === "permission_request") {
    const tool = typeof payload.tool === "string" ? payload.tool : "unknown";
    const target = typeof payload.target === "string" ? payload.target : "";
    return {
      variant: "activity",
      header: `permission required · ${time}`,
      body: `${tool} ${target}`.trim(),
      color: "#fbbf24",
      accent: "#ca8a04",
    };
  }

  if (event.kind === "permission_resolved") {
    const decision = typeof payload.decision === "string" ? payload.decision : "unknown";
    return {
      variant: "activity",
      header: `permission ${decision} · ${time}`,
      color: decision === "allow" ? "#86efac" : "#fca5a5",
      accent: decision === "allow" ? "#16a34a" : "#dc2626",
    };
  }

  if (event.kind === "run_started") {
    return {
      variant: "activity",
      header: `run started · ${time}`,
      body: truncateText(JSON.stringify(payload)),
      color: "#a5b4fc",
      accent: "#4f46e5",
    };
  }

  if (event.kind === "run_finished" || event.kind === "done") {
    return {
      variant: "activity",
      header: `run finished · ${time}`,
      color: "#86efac",
      accent: "#16a34a",
    };
  }

  if (event.kind === "run_failed" || event.kind === "error" || event.kind === "model_timeout") {
    const message = typeof payload.message === "string" ? payload.message : event.kind;
    return {
      variant: "error",
      header: `error · ${time}`,
      body: message,
      color: "#fca5a5",
      accent: "#dc2626",
    };
  }

  return {
    variant: "activity",
    header: `${event.kind} · ${time}`,
    body: truncateText(JSON.stringify(event.payload)),
    color: "#a1a1aa",
    accent: "#52525b",
  };
}

export function formatSessionTime(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
