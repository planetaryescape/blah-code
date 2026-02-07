import { createMemo, For, Show } from "solid-js";
import type { SessionSummary } from "@blah-code/session";
import { formatSessionTime } from "../state";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelect: (id: string) => void;
}

export function SessionList(props: SessionListProps) {
  const selectedIndex = createMemo(() =>
    props.sessions.findIndex((session) => session.id === props.selectedSessionId),
  );

  const windowSize = 14;
  const startIndex = createMemo(() => {
    const index = selectedIndex();
    if (index < 0) return 0;
    const half = Math.floor(windowSize / 2);
    return Math.max(0, index - half);
  });

  const endIndex = createMemo(() => Math.min(props.sessions.length, startIndex() + windowSize));

  const visibleSessions = createMemo(() => props.sessions.slice(startIndex(), endIndex()));

  const shortId = (id: string): string =>
    id.length > 18 ? `${id.slice(0, 8)}…${id.slice(id.length - 6)}` : id;

  return (
    <box flexDirection="column" border borderColor="#3f3f46" padding={1} width={34}>
      <box flexDirection="row">
        <text attributes={1}>sessions</text>
        <box flexGrow={1} />
        <text fg="#71717a">
          {props.sessions.length > 0 ? `${Math.max(selectedIndex(), 0) + 1}/${props.sessions.length}` : "0/0"}
        </text>
      </box>

      <Show when={props.sessions.length === 0}>
        <box marginTop={1}>
          <text fg="#71717a">no sessions yet</text>
        </box>
      </Show>

      <Show when={props.sessions.length > 0}>
        <box justifyContent="center">
          <text fg="#71717a">
            {startIndex() > 0 ? `↑ ${startIndex()} more` : " "}
          </text>
        </box>
      </Show>

      <For each={visibleSessions()}>
        {(session, idx) => {
          const actualIndex = () => startIndex() + idx();
          const selected = () => actualIndex() === selectedIndex();
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI box is the interactive primitive in TUI.
            <box
              flexDirection="column"
              backgroundColor={selected() ? "#27272a" : undefined}
              paddingBottom={1}
              onMouseUp={(event) => {
                if (event.button !== 0) return;
                props.onSelect(session.id);
              }}
            >
              <box flexDirection="row">
                <text fg={selected() ? "#93c5fd" : "#e4e4e7"}>{shortId(session.id)}</text>
                <box flexGrow={1} />
                <text fg={selected() ? "#93c5fd" : "#71717a"}>{session.eventCount}</text>
              </box>
              <text fg="#71717a">
                {formatSessionTime(session.lastEventAt ?? session.createdAt)}
              </text>
            </box>
          );
        }}
      </For>

      <Show when={props.sessions.length > 0}>
        <box justifyContent="center">
          <text fg="#71717a">
            {endIndex() < props.sessions.length ? `↓ ${props.sessions.length - endIndex()} more` : " "}
          </text>
        </box>
      </Show>
    </box>
  );
}
