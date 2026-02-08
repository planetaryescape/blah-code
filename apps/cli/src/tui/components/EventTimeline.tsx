import { For, Show, createMemo } from "solid-js";
import type { TuiEvent } from "../state";
import { theme } from "../theme";

interface SessionRunState {
  phase: "idle" | "running" | "tool" | "failed" | "cancelled";
  startedAt?: number;
  message?: string;
}

interface EventTimelineProps {
  events: TuiEvent[];
  streamingText?: string;
  showSystemStream?: boolean;
  showToolsExpanded?: boolean;
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

function toolName(event: TuiEvent): string {
  const payload = asRecord(event.payload);
  return typeof payload.tool === "string" ? payload.tool : "tool";
}

function toolArgsOrResult(event: TuiEvent): string {
  const payload = asRecord(event.payload);
  if (event.kind === "tool_call") {
    return stringifyPayload(payload.arguments ?? payload.input ?? payload.args ?? {});
  }
  if (event.kind === "tool_result") {
    return stringifyPayload(payload.result ?? payload.output ?? {});
  }
  return stringifyPayload(payload);
}

function textForEvent(event: TuiEvent): string {
  const payload = asRecord(event.payload);
  const directText = typeof payload.text === "string" ? payload.text : "";
  if (directText.trim()) return directText;

  if (event.kind === "tool_call" || event.kind === "tool_result") {
    return compact(toolArgsOrResult(event));
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
    const toolsExpanded = Boolean(props.showToolsExpanded);

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
        const name = toolName(event);
        const label = event.kind === "tool_call" ? `tool call: ${name}` : `tool result: ${name}`;
        const body = toolsExpanded
          ? compact(`${event.kind === "tool_call" ? "args" : "out"}: ${toolArgsOrResult(event)}`, 220)
          : compact(toolArgsOrResult(event), 80);

        rows.push({
          id: event.id,
          variant: "tool",
          text: body,
          label,
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
        borderColor={theme.colors.border}
        backgroundColor={theme.colors.bg}
        padding={1}
      >
        <Show when={!hasConversation() && (!props.streamingText || props.streamingText.trim().length === 0)}>
          <box flexDirection="column" marginBottom={1}>
            <text fg={theme.colors.text} attributes={1}>
              Start a conversation
            </text>
            <text fg={theme.colors.muted}>Enter sends · Shift+Enter newline · Ctrl+K palette</text>
            <text fg={theme.colors.faint}>Try: tell me what this repo does</text>
          </box>
        </Show>

        <For each={timelineRows()}>
          {(row) => {
            const isUser = row.variant === "user";
            const isAssistant = row.variant === "assistant";
            const isTool = row.variant === "tool";
            const isActivity = row.variant === "activity";
            const isError = row.variant === "error";
            const lines = () => row.text.split("\n");

            if (isActivity) {
              return (
                <box justifyContent="center" marginBottom={1}>
                  <text fg={theme.colors.faint}>
                    {row.label} · {formatClock(row.createdAt)}
                  </text>
                </box>
              );
            }

            return (
              <box alignItems={isUser ? "flex-end" : "flex-start"} marginBottom={1}>
                <box
                  width={isUser || isAssistant ? "72%" : "90%"}
                  flexDirection="column"
                  borderStyle="single"
                  border={["left"]}
                  borderColor={
                    isUser
                      ? theme.colors.userBorder
                      : isAssistant
                        ? theme.colors.assistantBorder
                        : isTool
                          ? theme.colors.toolBorder
                          : isError
                            ? theme.colors.danger
                            : theme.colors.border
                  }
                  backgroundColor={
                    isUser
                      ? theme.colors.userBg
                      : isAssistant
                        ? theme.colors.assistantBg
                        : isTool
                          ? theme.colors.toolBg
                          : isError
                            ? "#20070b"
                            : theme.colors.panelAlt
                  }
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text
                    fg={isError ? theme.colors.danger : theme.colors.muted}
                    attributes={1}
                  >
                    {row.label} {formatClock(row.createdAt)}
                  </text>
                  <For each={lines()}>
                    {(line) => (
                      <text fg={isError ? "#fecaca" : theme.colors.text}>
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
              width="72%"
              flexDirection="column"
              borderStyle="single"
              border={["left"]}
              borderColor={theme.colors.warning}
              backgroundColor={theme.colors.panelAlt}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.colors.muted} attributes={1}>
                assistant streaming
              </text>
              <text fg={theme.colors.text}>{props.streamingText}</text>
            </box>
          </box>
        </Show>

        <Show when={props.runState?.phase === "cancelled" && timelineRows().length === 0}>
          <box alignItems="flex-start" marginBottom={1}>
            <box
              width="90%"
              borderStyle="single"
              border={["left"]}
              borderColor={theme.colors.warning}
              backgroundColor={theme.colors.panelAlt}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.colors.warning} attributes={1}>
                run cancelled
              </text>
              <text fg={theme.colors.text}>{props.runState?.message ?? "cancelled by user"}</text>
            </box>
          </box>
        </Show>
      </scrollbox>

      <Show when={props.showSystemStream}>
        <box
          flexDirection="column"
          border
          borderStyle={theme.border.panelStyle}
          borderColor={theme.colors.border}
          backgroundColor={theme.colors.panelAlt}
          marginTop={1}
          paddingLeft={1}
          paddingRight={1}
          minHeight={4}
          maxHeight={8}
        >
          <text fg={theme.colors.muted} attributes={1}>
            system
          </text>
          <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
            <For each={systemRows()}>
              {(row) => (
                <box flexDirection="row">
                  <text fg={theme.colors.faint}>{formatClock(row.createdAt)} </text>
                  <text fg={row.kind === "error" ? theme.colors.danger : theme.colors.accent}>{row.kind}</text>
                  <Show when={row.text}>
                    <text fg={theme.colors.muted}>{` · ${row.text}`}</text>
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