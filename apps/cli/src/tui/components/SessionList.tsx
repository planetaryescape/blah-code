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

  const displayName = (session: SessionSummary): string => {
    const name = typeof session.name === "string" ? session.name.trim() : "";
    return name || shortId(session.id);
  };

  return (
    <box flexDirection="column" border borderColor="#334155" backgroundColor="#0b1220" padding={1} width={36}>
      <box flexDirection="row">
        <text fg="#e2e8f0" attributes={1}>sessions</text>
        <box flexGrow={1} />
        <text fg="#94a3b8">
          {props.sessions.length > 0 ? `${Math.max(selectedIndex(), 0) + 1}/${props.sessions.length}` : "0/0"}
        </text>
      </box>

      <Show when={props.sessions.length === 0}>
        <box marginTop={1}>
          <text fg="#94a3b8">no sessions yet</text>
        </box>
      </Show>

      <Show when={props.sessions.length > 0}>
        <box justifyContent="center">
          <text fg="#64748b">
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
              backgroundColor={selected() ? "#172554" : undefined}
              paddingBottom={1}
              onMouseUp={(event) => {
                if (event.button !== 0) return;
                props.onSelect(session.id);
              }}
            >
              <box flexDirection="row">
                <text fg={selected() ? "#bfdbfe" : "#e2e8f0"}>{displayName(session)}</text>
                <box flexGrow={1} />
                <text fg={selected() ? "#bfdbfe" : "#94a3b8"}>{session.eventCount}</text>
              </box>
              <Show when={session.name}>
                <text fg={selected() ? "#93c5fd" : "#64748b"}>{shortId(session.id)}</text>
              </Show>
              <text fg={selected() ? "#93c5fd" : "#94a3b8"}>{formatSessionTime(session.lastEventAt ?? session.createdAt)}</text>
            </box>
          );
        }}
      </For>

      <Show when={props.sessions.length > 0}>
        <box justifyContent="center">
          <text fg="#64748b">
            {endIndex() < props.sessions.length ? `↓ ${props.sessions.length - endIndex()} more` : " "}
          </text>
        </box>
      </Show>

      <box marginTop={1}>
        <text fg="#64748b">click or ctrl+p/ctrl+shift+n</text>
      </box>
    </box>
  );
}
