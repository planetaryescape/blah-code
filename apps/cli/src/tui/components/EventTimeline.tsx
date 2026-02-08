import { For, Show } from "solid-js";
import type { TuiEvent } from "../state";
import { formatEvent } from "../state";

interface EventTimelineProps {
  events: TuiEvent[];
  streamingText?: string;
}

export function EventTimeline(props: EventTimelineProps) {
  return (
    <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
      <Show when={props.events.length === 0 && (!props.streamingText || props.streamingText.trim().length === 0)}>
        <box
          flexDirection="column"
          border
          borderColor="#334155"
          backgroundColor="#0f172a"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          marginBottom={1}
        >
          <text fg="#f8fafc" attributes={1}>
            Welcome to blah-code
          </text>
          <text fg="#94a3b8">Enter to send. Ctrl+K opens command palette.</text>
          <text fg="#94a3b8">Try: tell me what this repo does</text>
        </box>
      </Show>
      <For each={props.events}>
        {(event) => {
          const item = formatEvent(event);
          if (!item) return null;
          const lines = () => (item.body ? item.body.split("\n") : []);

          if (item.variant === "user") {
            return (
              <box alignItems="flex-end" marginBottom={1}>
                <box
                  width="80%"
                  flexDirection="column"
                  border
                  borderColor={item.accent ?? "#2563eb"}
                  backgroundColor="#172554"
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={item.color} attributes={1}>
                    {item.header}
                  </text>
                  <For each={lines()}>
                    {(line) => <text fg={item.color}>{line || " "}</text>}
                  </For>
                </box>
              </box>
            );
          }

          if (item.variant === "assistant") {
            return (
              <box alignItems="flex-start" marginBottom={1}>
                <box
                  width="88%"
                  flexDirection="column"
                  border
                  borderColor={item.accent ?? "#334155"}
                  backgroundColor="#111827"
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={item.color} attributes={1}>
                    {item.header}
                  </text>
                  <For each={lines()}>
                    {(line) => <text fg={item.color}>{line || " "}</text>}
                  </For>
                </box>
              </box>
            );
          }

          if (item.variant === "tool") {
            return (
              <box
                flexDirection="column"
                border
                borderColor={item.accent ?? "#1d4ed8"}
                backgroundColor="#0b1220"
                paddingLeft={1}
                paddingRight={1}
                marginBottom={1}
              >
                <text fg={item.color} attributes={1}>
                  {item.header}
                </text>
                <For each={lines()}>
                  {(line) => <text fg="#bfdbfe">{line || " "}</text>}
                </For>
              </box>
            );
          }

          return (
            <box
              flexDirection="row"
              border
              borderColor={item.accent ?? "#3f3f46"}
              backgroundColor={item.variant === "error" ? "#2a0e11" : "#0f172a"}
              paddingLeft={1}
              paddingRight={1}
              marginBottom={1}
            >
              <text fg={item.variant === "error" ? "#fca5a5" : "#93c5fd"}>{item.variant === "error" ? "✕ " : "• "}</text>
              <box flexDirection="column">
                <text fg={item.color} attributes={1}>
                  {item.header}
                </text>
                <For each={lines()}>
                  {(line) => <text fg={item.color}>{line || " "}</text>}
                </For>
              </box>
            </box>
          );
        }}
      </For>
      <Show when={props.streamingText && props.streamingText.trim().length > 0}>
        <box alignItems="flex-start" marginBottom={1}>
          <box
            width="88%"
            flexDirection="column"
            border
            borderColor="#7c3aed"
            backgroundColor="#1e1b4b"
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg="#c4b5fd" attributes={1}>
              assistant · streaming
            </text>
            <text fg="#ddd6fe">{props.streamingText}</text>
          </box>
        </box>
      </Show>
    </scrollbox>
  );
}
