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
      <For each={props.events}>
        {(event) => {
          const item = formatEvent(event);
          if (!item) return null;
          const lines = () => (item.body ? item.body.split("\n") : []);
          return (
            <box
              flexDirection="column"
              border
              borderColor={item.accent ?? "#3f3f46"}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={0}
              paddingBottom={0}
              marginBottom={1}
            >
              <text fg={item.color} attributes={1}>
                {item.header}
              </text>
              <For each={lines()}>
                {(line) => <text fg={item.color}>{line || " "}</text>}
              </For>
            </box>
          );
        }}
      </For>
      <Show when={props.streamingText && props.streamingText.trim().length > 0}>
        <box
          flexDirection="column"
          border
          borderColor="#7c3aed"
          paddingLeft={1}
          paddingRight={1}
          marginBottom={1}
        >
          <text fg="#c4b5fd" attributes={1}>
            assistant · streaming
          </text>
          <text fg="#ddd6fe">{props.streamingText}</text>
        </box>
      </Show>
    </scrollbox>
  );
}
