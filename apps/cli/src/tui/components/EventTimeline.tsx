import { For, Show, createMemo } from "solid-js";
import type { TuiEvent } from "../state";

interface SessionRunState {
  phase: "idle" | "running" | "tool" | "failed" | "cancelled";
  startedAt?: number;
  message?: string;
}

interface EventTimelineProps {
  events: TuiEvent[];
  streamingText?: string;
  showSystemStream?: boolean;
  runState?: SessionRunState;
}

interface TimelineRow {
  id: string;
  variant: "user" | "assistant" | "tool" | "activity" | "error";
  text: string;
  label: string;
  createdAt: number;
}

interface SystemRow {
  id: string;
  kind: string;
  text: string;
  createdAt: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringifyPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (typeof payload === "object" && payload !== null) return JSON.stringify(payload);
  return "";
}

function compact(value: string, max = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function textForEvent(event: TuiEvent): string {
  const payload = asRecord(event.payload);
  const directText = typeof payload.text === "string" ? payload.text : "";
  if (directText.trim()) return directText;

  if (event.kind === "tool_call") {
    const tool = typeof payload.tool === "string" ? payload.tool : "tool";
    const args = stringifyPayload(payload.arguments ?? payload.input ?? payload.args ?? {});
    return compact(`${tool} ${args}`.trim());
  }

  if (event.kind === "tool_result") {
    const tool = typeof payload.tool === "string" ? payload.tool : "tool";
    const result = stringifyPayload(payload.result ?? payload.output ?? {});
    return compact(`${tool} ${result}`.trim());
  }

  if (event.kind === "run_failed" || event.kind === "error" || event.kind === "model_timeout") {
    const message = typeof payload.message === "string" ? payload.message : stringifyPayload(payload);
    return compact(message);
  }

  return compact(stringifyPayload(event.payload));
}

function systemLabel(event: TuiEvent): string {
  switch (event.kind) {
    case "run_started":
      return "run started";
    case "run_finished":
    case "done":
      return "run finished";
    case "tool_call":
      return "tool call";
    case "tool_result":
      return "tool result";
    case "permission_request":
      return "permission";
    case "permission_resolved":
      return "permission resolved";
    case "model_timeout":
      return "model timeout";
    case "run_failed":
    case "error":
      return "error";
    default:
      return event.kind;
  }
}

export function EventTimeline(props: EventTimelineProps) {
  const timelineRows = createMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [];

    for (const event of props.events) {
      if (event.kind === "assistant_delta") continue;

      if (event.kind === "user" || event.kind === "assistant") {
        const text = textForEvent(event);
        if (!text) continue;
        rows.push({
          id: event.id,
          variant: event.kind,
          text,
          label: event.kind === "user" ? "you" : "assistant",
          createdAt: event.createdAt,
        });
        continue;
      }

      if (event.kind === "tool_call" || event.kind === "tool_result") {
        const text = textForEvent(event) || event.kind;
        rows.push({
          id: event.id,
          variant: "tool",
          text,
          label: systemLabel(event),
          createdAt: event.createdAt,
        });
        continue;
      }

      if (
        event.kind === "run_started" ||
        event.kind === "run_finished" ||
        event.kind === "done" ||
        event.kind === "permission_request" ||
        event.kind === "permission_resolved"
      ) {
        rows.push({
          id: event.id,
          variant: "activity",
          text: textForEvent(event) || systemLabel(event),
          label: systemLabel(event),
          createdAt: event.createdAt,
        });
        continue;
      }

      if (event.kind === "run_failed" || event.kind === "model_timeout" || event.kind === "error") {
        const text = textForEvent(event) || event.kind;
        rows.push({
          id: event.id,
          variant: "error",
          text,
          label: event.kind,
          createdAt: event.createdAt,
        });
      }
    }

    rows.sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt));
    return rows;
  });

  const systemRows = createMemo<SystemRow[]>(() => {
    const rows: SystemRow[] = [];
    for (const event of props.events) {
      if (event.kind === "user" || event.kind === "assistant" || event.kind === "assistant_delta") continue;
      rows.push({
        id: event.id,
        kind: systemLabel(event),
        text: textForEvent(event),
        createdAt: event.createdAt,
      });
    }
    return rows;
  });

  const hasConversation = createMemo(
    () => timelineRows().some((row) => row.variant === "user" || row.variant === "assistant"),
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox
        flexGrow={1}
        stickyScroll
        stickyStart="bottom"
        border
        borderColor="#1e293b"
        backgroundColor="#020617"
        padding={1}
      >
        <Show when={!hasConversation() && (!props.streamingText || props.streamingText.trim().length === 0)}>
          <box flexDirection="column" marginBottom={1}>
            <text fg="#f8fafc" attributes={1}>
              Start a conversation
            </text>
            <text fg="#94a3b8">Enter sends. Shift+Enter newline. Ctrl+K opens command palette.</text>
            <text fg="#64748b">Try: tell me what this repo does</text>
          </box>
        </Show>

        <For each={timelineRows()}>
          {(row) => {
            const isUser = row.variant === "user";
            const isAssistant = row.variant === "assistant";
            const isTool = row.variant === "tool";
            const isActivity = row.variant === "activity";
            const lines = () => row.text.split("\n");
            return (
              <box alignItems={isUser ? "flex-end" : "flex-start"} marginBottom={1}>
                <box
                  width={isUser ? "78%" : "90%"}
                  flexDirection="column"
                  border
                  borderColor={
                    isUser
                      ? "#3b82f6"
                      : isAssistant
                        ? "#334155"
                        : isTool
                          ? "#0284c7"
                          : isActivity
                            ? "#475569"
                            : "#dc2626"
                  }
                  backgroundColor={
                    isUser
                      ? "#0f2146"
                      : isAssistant
                        ? "#111827"
                        : isTool
                          ? "#0a1f2f"
                          : isActivity
                            ? "#111827"
                            : "#2a0f14"
                  }
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text
                    fg={
                      isUser
                        ? "#bfdbfe"
                        : isAssistant
                          ? "#e2e8f0"
                          : isTool
                            ? "#7dd3fc"
                            : isActivity
                              ? "#94a3b8"
                              : "#fca5a5"
                    }
                    attributes={1}
                  >
                    {row.label} · {formatClock(row.createdAt)}
                  </text>
                  <For each={lines()}>
                    {(line) => (
                      <text
                        fg={
                          isUser
                            ? "#dbeafe"
                            : isAssistant
                              ? "#f8fafc"
                              : isTool
                                ? "#bae6fd"
                                : isActivity
                                  ? "#cbd5e1"
                                  : "#fecaca"
                        }
                      >
                        {line || " "}
                      </text>
                    )}
                  </For>
                </box>
              </box>
            );
          }}
        </For>

        <Show when={props.streamingText && props.streamingText.trim().length > 0}>
          <box alignItems="flex-start" marginBottom={1}>
            <box
              width="90%"
              flexDirection="column"
              border
              borderColor="#f59e0b"
              backgroundColor="#1a2438"
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg="#fbbf24" attributes={1}>
                assistant · streaming
              </text>
              <text fg="#f8fafc">{props.streamingText}</text>
            </box>
          </box>
        </Show>

        <Show when={props.runState?.phase === "cancelled" && timelineRows().length === 0}>
          <box alignItems="flex-start" marginBottom={1}>
            <box width="90%" border borderColor="#f59e0b" backgroundColor="#1f2937" paddingLeft={1} paddingRight={1}>
              <text fg="#fbbf24" attributes={1}>run cancelled</text>
              <text fg="#fde68a">{props.runState?.message ?? "cancelled by user"}</text>
            </box>
          </box>
        </Show>
      </scrollbox>

      <Show when={props.showSystemStream}>
        <box
          flexDirection="column"
          border
          borderColor="#1e293b"
          backgroundColor="#020617"
          marginTop={1}
          paddingLeft={1}
          paddingRight={1}
          minHeight={4}
          maxHeight={8}
        >
          <text fg="#94a3b8" attributes={1}>
            system stream
          </text>
          <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
            <For each={systemRows()}>
              {(row) => (
                <box flexDirection="row">
                  <text fg="#475569">{formatClock(row.createdAt)} </text>
                  <text fg={row.kind === "error" ? "#fca5a5" : "#93c5fd"}>{row.kind}</text>
                  <Show when={row.text}>
                    <text fg="#94a3b8">{` · ${row.text}`}</text>
                  </Show>
                </box>
              )}
            </For>
          </scrollbox>
        </box>
      </Show>
    </box>
  );
}
